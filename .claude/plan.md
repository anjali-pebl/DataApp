# Crash-Resilient Local GPU Processing Plan

## Executive Summary

Make the local GPU video processing system fully resilient to browser crashes, page refreshes, network interruptions, and server restarts. The system should be able to resume processing from where it left off without losing progress or corrupting state.

---

## Current State Analysis

### What Exists Today

**Database State Tracking:**
- `processing_runs` table tracks overall batch jobs (run_id, status, progress)
- `uploaded_videos` table tracks individual video status (pending, processing, completed, failed)
- Process PID stored in `process_pid` column for cancellation
- Active run detection via `/api/motion-analysis/process/active` endpoint
- 30-minute stale run timeout (marks old "running" jobs as failed)

**Python Processing:**
- `batch_process_videos.py` runs as background Python process (spawned via Node.js)
- Processes videos sequentially in a loop
- Calls `/api/motion-analysis/process/complete` after each video
- Writes logs to file system (`processing-{runId}.log`)
- No built-in resume capability - starts from beginning if interrupted

**Frontend UI:**
- `ProcessingStatusPanel.tsx` polls status every 2 seconds
- Restores active run on page refresh (via `useEffect` checking active endpoint)
- Shows "stuck videos" banner if videos are in "processing" state without active run
- Manual reset button to fix stuck videos

### Current Failure Modes

❌ **Browser Crash/Refresh:**
- ProcessingStatusPanel disappears
- Python process continues running in background (orphaned)
- UI can restore the panel on reload BUT cannot display progress if Python crashes
- No way to know which video was being processed when browser crashed

❌ **Python Process Crash:**
- Videos remain stuck in "processing" state
- Database shows run as "running" forever
- No automatic retry or resume
- User must manually reset stuck videos and restart entire batch

❌ **Server Restart (Next.js):**
- Python child process is killed
- No tracking of which videos were completed before kill
- Database may show stale "running" status
- Videos in progress may be partially processed (incomplete output files)

❌ **Network Interruption:**
- Python process cannot call `/api/motion-analysis/process/complete`
- Database never updated with completion status
- Video output files exist on disk but database says "processing"
- Batch completes but database is inconsistent

❌ **Partial File Writes:**
- If processing is killed mid-video, output JSON files may be incomplete
- No checksums or validation of output files
- No way to detect corrupted output vs incomplete processing

---

## Solution Architecture

### Core Principles

1. **Idempotent Operations:** Any video can be reprocessed safely without side effects
2. **Atomic Checkpoints:** Each completed video is a checkpoint (not just the entire batch)
3. **Persistent State:** All progress tracked in database, not just in-memory
4. **Recovery-First Design:** System assumes crashes will happen and plans accordingly
5. **File System as Source of Truth:** Check disk for completed outputs, not just database

### State Machine for Processing Runs

```
run_status:
  'queued'      → Waiting to start (NEW STATE)
  'running'     → Python process actively running
  'paused'      → Python process stopped, can resume (NEW STATE)
  'completed'   → All videos processed successfully
  'failed'      → Critical error, cannot continue
  'cancelled'   → User cancelled
```

### State Machine for Individual Videos

```
processing_status:
  'pending'     → Not yet processed
  'processing'  → Currently being processed
  'completed'   → Successfully processed, outputs verified
  'failed'      → Processing failed, needs retry
  'skipped'     → Intentionally skipped (already completed)
```

---

## Implementation Plan

### Phase 1: Enhanced Database State Tracking

**Goal:** Make database the authoritative source of processing state

#### 1.1 Update `processing_runs` Table

Add new columns:

```sql
ALTER TABLE processing_runs ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMPTZ;
ALTER TABLE processing_runs ADD COLUMN IF NOT EXISTS current_video_id UUID;
ALTER TABLE processing_runs ADD COLUMN IF NOT EXISTS resume_count INTEGER DEFAULT 0;
ALTER TABLE processing_runs ADD COLUMN IF NOT EXISTS checkpoint_data JSONB DEFAULT '{}'::jsonb;
```

**Purpose:**
- `last_heartbeat`: Python writes timestamp every 10 seconds → detect dead processes
- `current_video_id`: Exact video being processed → resume from next video
- `resume_count`: How many times this run has been resumed → debugging
- `checkpoint_data`: Store arbitrary state for resume (settings, last video index, etc.)

#### 1.2 Update `uploaded_videos` Table

Add new columns:

```sql
ALTER TABLE uploaded_videos ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
ALTER TABLE uploaded_videos ADD COLUMN IF NOT EXISTS processing_completed_at TIMESTAMPTZ;
ALTER TABLE uploaded_videos ADD COLUMN IF NOT EXISTS processing_duration_seconds FLOAT;
ALTER TABLE uploaded_videos ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
ALTER TABLE uploaded_videos ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE uploaded_videos ADD COLUMN IF NOT EXISTS output_file_paths JSONB DEFAULT '[]'::jsonb;
ALTER TABLE uploaded_videos ADD COLUMN IF NOT EXISTS output_files_verified BOOLEAN DEFAULT false;
```

**Purpose:**
- Timestamps: Track exactly when processing started/ended for each video
- `retry_count`: Prevent infinite retry loops (max 3 retries)
- `last_error`: Store Python error message for debugging
- `output_file_paths`: List of all output files that should exist
- `output_files_verified`: Checksum validation passed

### Phase 2: Heartbeat & Dead Process Detection

**Goal:** Automatically detect when Python process dies

#### 2.1 Python Heartbeat System

Create new module: `cv_scripts/heartbeat.py`

```python
import requests
import threading
import time

class Heartbeat:
    def __init__(self, api_url, run_id, interval_seconds=10):
        self.api_url = api_url
        self.run_id = run_id
        self.interval = interval_seconds
        self.running = False
        self.thread = None

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False

    def _heartbeat_loop(self):
        while self.running:
            try:
                requests.post(
                    f"{self.api_url}/api/motion-analysis/process/heartbeat",
                    json={"runId": self.run_id},
                    timeout=5
                )
            except Exception as e:
                # Log but don't crash - heartbeat is best-effort
                print(f"[HEARTBEAT] Failed: {e}")
            time.sleep(self.interval)
```

**Integration in `batch_process_videos.py`:**

```python
# After receiving run_id from args
heartbeat = Heartbeat(api_url, run_id, interval_seconds=10)
heartbeat.start()

try:
    # ... process videos ...
finally:
    heartbeat.stop()
```

#### 2.2 Heartbeat API Endpoint

Create new endpoint: `/api/motion-analysis/process/heartbeat`

```typescript
// src/app/api/motion-analysis/process/heartbeat/route.ts
export async function POST(request: NextRequest) {
  const { runId } = await request.json();

  await supabase
    .from('processing_runs')
    .update({
      last_heartbeat: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', runId);

  return NextResponse.json({ success: true });
}
```

#### 2.3 Dead Process Detection Cron Job

Create new endpoint: `/api/motion-analysis/process/check-dead`

```typescript
// Runs every 30 seconds via cron or setInterval
export async function GET() {
  const DEAD_THRESHOLD = 60 * 1000; // 60 seconds without heartbeat
  const now = new Date();

  // Find runs that are "running" but haven't heartbeat recently
  const { data: deadRuns } = await supabase
    .from('processing_runs')
    .select('id, current_video_id, video_ids')
    .eq('status', 'running')
    .lt('last_heartbeat', new Date(now.getTime() - DEAD_THRESHOLD).toISOString());

  for (const run of deadRuns || []) {
    console.log(`Detected dead run: ${run.id}`);

    // Mark run as 'paused' (not failed - can be resumed)
    await supabase
      .from('processing_runs')
      .update({
        status: 'paused',
        updated_at: new Date().toISOString()
      })
      .eq('id', run.id);

    // Mark current video as 'failed' (needs retry)
    if (run.current_video_id) {
      await supabase
        .from('uploaded_videos')
        .update({
          processing_status: 'failed',
          last_error: 'Processing interrupted (process died)',
          updated_at: new Date().toISOString()
        })
        .eq('id', run.current_video_id);
    }
  }

  return NextResponse.json({ success: true, deadRunsDetected: deadRuns?.length || 0 });
}
```

**Frontend Integration:**

Run check every 60 seconds in `motion-analysis/page.tsx`:

```typescript
useEffect(() => {
  const interval = setInterval(async () => {
    await fetch('/api/motion-analysis/process/check-dead');
  }, 60000);
  return () => clearInterval(interval);
}, []);
```

### Phase 3: Resume Processing Logic

**Goal:** Allow Python process to resume from last checkpoint

#### 3.1 Resume API Endpoint

Create new endpoint: `/api/motion-analysis/process/resume`

```typescript
// src/app/api/motion-analysis/process/resume/route.ts
export async function POST(request: NextRequest) {
  const { runId } = await request.json();

  // Get the paused run
  const { data: run } = await supabase
    .from('processing_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  if (run.status !== 'paused' && run.status !== 'failed') {
    return NextResponse.json({ error: 'Run is not paused/failed' }, { status: 400 });
  }

  // Get all videos in this run
  const { data: videos } = await supabase
    .from('uploaded_videos')
    .select('*')
    .in('id', run.video_ids);

  // Filter to pending + failed videos (skip completed)
  const videosToProcess = videos.filter(v =>
    v.processing_status === 'pending' ||
    v.processing_status === 'failed'
  );

  if (videosToProcess.length === 0) {
    // All videos are completed - mark run as completed
    await supabase
      .from('processing_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', runId);

    return NextResponse.json({
      success: true,
      message: 'All videos already completed',
      needsResume: false
    });
  }

  // Mark run as running again
  await supabase
    .from('processing_runs')
    .update({
      status: 'running',
      resume_count: (run.resume_count || 0) + 1,
      last_heartbeat: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', runId);

  // Spawn Python process with --resume flag
  const videoInfo = videosToProcess.map(v => ({
    video_id: v.id,
    filename: v.filename,
    filepath: `public/videos/${v.filename}`,
    width: v.width,
    height: v.height,
    fps: v.fps,
    duration_seconds: v.duration_seconds,
    total_frames: v.total_frames,
  }));

  const settings = run.checkpoint_data?.settings || {};

  const args = [
    '-u',
    'cv_scripts/batch_process_videos.py',
    '--run-id', runId,
    '--run-type', run.run_type,
    '--videos', JSON.stringify(videoInfo),
    '--api-url', apiUrl,
    '--settings', JSON.stringify(settings),
    '--resume',  // NEW FLAG
  ];

  const childProcess = spawn('python', args, { /* ... */ });

  // Store PID
  if (childProcess.pid) {
    await supabase
      .from('processing_runs')
      .update({ process_pid: childProcess.pid })
      .eq('id', runId);
  }

  return NextResponse.json({
    success: true,
    runId,
    videosToProcess: videosToProcess.length,
    videosCompleted: videos.length - videosToProcess.length,
    message: `Resumed processing ${videosToProcess.length} remaining video(s)`,
  });
}
```

#### 3.2 Python Resume Logic

Update `batch_process_videos.py`:

```python
# Add --resume flag to argument parser
parser.add_argument('--resume', action='store_true', help='Resume from previous checkpoint')

# In main function
if args.resume:
    print(f"\n🔄 RESUMING PROCESSING")
    print(f"Run ID: {args.run_id}")
    print(f"Videos to process: {len(videos_info)}")
    print(f"(Skipping already completed videos)\n")

# Before processing each video, check if outputs already exist
for i, video in enumerate(videos_info, 1):
    video_id = video.get('video_id')
    base_name = os.path.splitext(video['filename'])[0]
    video_output_dir = os.path.join(output_dir, base_name)

    # Check if video was already completed
    if check_video_already_completed(video_id, video_output_dir, base_name):
        print(f"[Video {i}/{len(videos_info)}] {video['filename']} - SKIPPING (already completed)")

        # Mark as completed in database (in case it was marked as failed)
        if args.api_url and video_id:
            notify_api_complete(args.api_url, args.run_id, video_id,
                motion_analysis_path=f"motion-analysis-results/{base_name}/...",
                success=True,
                skipped=True)
        continue

    # Process video normally
    # ...
```

#### 3.3 Output File Verification

Add helper function in Python:

```python
def check_video_already_completed(video_id, output_dir, base_name):
    """Check if video has already been processed by verifying output files exist."""
    required_files = [
        os.path.join(output_dir, f"{base_name}_background_subtracted.mp4"),
        os.path.join(output_dir, f"{base_name}_background_subtracted_benthic_activity_v4.json"),
    ]

    # Check all required files exist
    for file_path in required_files:
        if not os.path.exists(file_path):
            return False

        # Check file is not empty
        if os.path.getsize(file_path) == 0:
            return False

        # For JSON files, verify they can be parsed
        if file_path.endswith('.json'):
            try:
                with open(file_path, 'r') as f:
                    json.load(f)
            except:
                return False

    return True
```

### Phase 4: Frontend Auto-Resume UI

**Goal:** Automatically detect paused runs and offer resume

#### 4.1 Update Active Run Detection

Modify `/api/motion-analysis/process/active` to also return paused runs:

```typescript
// Find running OR paused runs
const { data: activeRuns } = await supabase
  .from('processing_runs')
  .select('*')
  .eq('user_id', user.id)
  .in('status', ['running', 'paused'])  // Include paused runs
  .order('started_at', { ascending: false })
  .limit(1);
```

#### 4.2 Add Resume Banner to UI

Update `motion-analysis/page.tsx`:

```tsx
interface ResumePrompt {
  runId: string;
  runType: string;
  startedAt: string;
  videosProcessed: number;
  totalVideos: number;
}

const [resumePrompt, setResumePrompt] = useState<ResumePrompt | null>(null);

// In checkActiveRuns effect
if (result?.hasActiveRun && result.activeRun) {
  if (result.activeRun.status === 'paused') {
    setResumePrompt({
      runId: result.activeRun.id,
      runType: result.activeRun.run_type,
      startedAt: result.activeRun.started_at,
      videosProcessed: result.activeRun.videos_processed,
      totalVideos: result.activeRun.total_videos,
    });
  } else if (result.activeRun.status === 'running') {
    setCurrentRunId(result.activeRun.id);
  }
}

// Resume prompt UI (above dashboard)
{resumePrompt && (
  <div className="mb-4 bg-yellow-50 border-2 border-yellow-400 rounded-lg p-4">
    <div className="flex items-start justify-between">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-6 h-6 text-yellow-600 mt-0.5" />
        <div>
          <h3 className="font-semibold text-gray-900 mb-1">
            Processing Interrupted
          </h3>
          <p className="text-sm text-gray-700 mb-2">
            A previous processing run was interrupted. It processed{' '}
            <strong>{resumePrompt.videosProcessed} of {resumePrompt.totalVideos}</strong>{' '}
            videos before stopping.
          </p>
          <p className="text-xs text-gray-600 mb-3">
            Started: {new Date(resumePrompt.startedAt).toLocaleString()} •
            Run type: {resumePrompt.runType.toUpperCase()}
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleResumeProcessing}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Resume Processing
            </button>
            <button
              onClick={handleDiscardRun}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
            >
              Discard
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
)}
```

#### 4.3 Resume Handler

```typescript
const handleResumeProcessing = async () => {
  if (!resumePrompt) return;

  try {
    const response = await fetch('/api/motion-analysis/process/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: resumePrompt.runId }),
    });

    const result = await response.json();

    if (result.success) {
      if (result.needsResume !== false) {
        // Start showing the status panel
        setCurrentRunId(resumePrompt.runId);
      }
      setResumePrompt(null);
      loadData(); // Refresh video list
    } else {
      alert(`Failed to resume: ${result.error}`);
    }
  } catch (err: any) {
    alert(`Failed to resume: ${err.message}`);
  }
};

const handleDiscardRun = async () => {
  if (!resumePrompt) return;

  const confirmed = window.confirm(
    'Are you sure you want to discard this run? Progress will be lost.'
  );

  if (!confirmed) return;

  // Mark run as cancelled
  await fetch('/api/motion-analysis/process/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId: resumePrompt.runId }),
  });

  setResumePrompt(null);
  loadData();
};
```

### Phase 5: Server Restart Recovery

**Goal:** Handle Next.js server restarts gracefully

#### 5.1 Persistent Process Tracking

**Problem:** When Next.js restarts, child Python processes are orphaned (continue running but no longer tracked).

**Solution:** Store PID in database, check if process is still alive on server startup.

Create server initialization hook:

```typescript
// src/lib/server-init.ts
import { createClient } from '@/lib/supabase/server';

export async function initializeServer() {
  console.log('[SERVER INIT] Checking for orphaned Python processes...');

  const supabase = await createClient();

  // Find all "running" runs
  const { data: runningRuns } = await supabase
    .from('processing_runs')
    .select('id, process_pid, last_heartbeat')
    .eq('status', 'running');

  for (const run of runningRuns || []) {
    // Check if process is still alive
    const isAlive = checkProcessAlive(run.process_pid);

    if (!isAlive) {
      console.log(`[SERVER INIT] Run ${run.id} has dead PID ${run.process_pid} - marking as paused`);

      await supabase
        .from('processing_runs')
        .update({
          status: 'paused',
          updated_at: new Date().toISOString()
        })
        .eq('id', run.id);
    } else {
      console.log(`[SERVER INIT] Run ${run.id} PID ${run.process_pid} is still alive - continuing`);
    }
  }
}

function checkProcessAlive(pid: number | null): boolean {
  if (!pid) return false;

  try {
    // Send signal 0 to check if process exists (doesn't actually kill it)
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    // ESRCH = no such process
    return e.code !== 'ESRCH';
  }
}
```

Call in root layout or middleware:

```typescript
// src/app/layout.tsx (server component)
import { initializeServer } from '@/lib/server-init';

export default async function RootLayout({ children }) {
  // Only run once on server startup
  if (process.env.NODE_ENV === 'production' || !global.__serverInitialized) {
    await initializeServer();
    global.__serverInitialized = true;
  }

  // ... rest of layout
}
```

### Phase 6: Network Resilience

**Goal:** Handle temporary network failures without losing progress

#### 6.1 Retry Logic for API Calls

Update Python API calls with exponential backoff:

```python
import requests
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.retry import Retry

def create_resilient_session():
    """Create HTTP session with automatic retries."""
    session = requests.Session()

    retry = Retry(
        total=5,  # 5 retries
        backoff_factor=1,  # Wait 1s, 2s, 4s, 8s, 16s
        status_forcelist=[500, 502, 503, 504],  # Retry on server errors
        allowed_methods=["POST", "GET"],
    )

    adapter = HTTPAdapter(max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)

    return session

# Use in notify_api_complete
def notify_api_complete(api_url, run_id, video_id, motion_analysis_path, success=True, error=None):
    """Notify API with automatic retries."""
    session = create_resilient_session()

    try:
        response = session.post(
            f"{api_url}/api/motion-analysis/process/complete",
            json={
                "runId": run_id,
                "videoId": video_id,
                "motionAnalysisPath": motion_analysis_path,
                "success": success,
                "error": error
            },
            timeout=30  # Longer timeout
        )

        if response.status_code == 200:
            return True
        else:
            print(f"  [WARNING] API update failed after retries: {response.status_code}")
            return False

    except Exception as e:
        print(f"  [ERROR] API update failed after retries: {e}")
        # DON'T crash - continue processing other videos
        return False
```

#### 6.2 Database Sync Reconciliation

Create periodic reconciliation job that checks file system vs database:

```typescript
// src/app/api/motion-analysis/reconcile/route.ts
export async function POST() {
  const supabase = await createClient();

  // Get all videos marked as "completed"
  const { data: videos } = await supabase
    .from('uploaded_videos')
    .select('*')
    .eq('processing_status', 'completed');

  let fixedCount = 0;

  for (const video of videos || []) {
    const baseName = video.filename.replace(/\.[^.]+$/, '');
    const outputDir = path.join('public', 'motion-analysis-results', baseName);

    // Check if output files actually exist
    const requiredFiles = [
      path.join(outputDir, `${baseName}_background_subtracted_benthic_activity_v4.json`),
    ];

    let allFilesExist = true;
    for (const file of requiredFiles) {
      if (!fs.existsSync(file)) {
        allFilesExist = false;
        break;
      }
    }

    if (!allFilesExist) {
      // Database says completed but files don't exist - mark as failed
      console.log(`Fixing inconsistency: ${video.filename} (marked completed but files missing)`);

      await supabase
        .from('uploaded_videos')
        .update({
          processing_status: 'failed',
          last_error: 'Output files missing - marked by reconciliation job',
          updated_at: new Date().toISOString()
        })
        .eq('id', video.id);

      fixedCount++;
    }
  }

  return NextResponse.json({
    success: true,
    videosChecked: videos?.length || 0,
    inconsistenciesFixed: fixedCount
  });
}
```

Run reconciliation:
- Manually via admin UI
- Automatically on page load (once)
- Via cron job (daily at 3am)

### Phase 7: User Experience Improvements

#### 7.1 Processing History Persistence

Store completed runs in database permanently (don't delete):

```typescript
// In ProcessingStatusPanel, add "View History" button when completed
<button onClick={() => setShowHistory(true)}>
  View Processing History
</button>

// Show modal with all past runs
<ProcessingHistoryDialog
  runs={historicalRuns}
  onClose={() => setShowHistory(false)}
/>
```

#### 7.2 Manual Retry Button

Add retry button for failed videos in dashboard:

```tsx
// In MotionAnalysisDashboard
{video.processing_status === 'failed' && (
  <button
    onClick={() => handleRetryVideo(video.id)}
    className="text-xs text-blue-600 hover:text-blue-800"
  >
    Retry
  </button>
)}

async function handleRetryVideo(videoId: string) {
  // Reset video to pending
  await supabase
    .from('uploaded_videos')
    .update({
      processing_status: 'pending',
      last_error: null,
      retry_count: 0,
      updated_at: new Date().toISOString()
    })
    .eq('id', videoId);

  // User can then select it for a new batch
  loadData();
}
```

#### 7.3 Pause Button

Add pause button to ProcessingStatusPanel:

```tsx
<button onClick={handlePause}>
  Pause Processing
</button>

async function handlePause() {
  // Kill Python process gracefully
  await fetch('/api/motion-analysis/process/pause', {
    method: 'POST',
    body: JSON.stringify({ runId }),
  });

  // Python will exit cleanly after current video completes
}
```

In Python:

```python
# Check for pause signal before each video
def should_pause(api_url, run_id):
    try:
        response = requests.get(f"{api_url}/api/motion-analysis/process/{run_id}")
        data = response.json()
        return data.get('run', {}).get('status') == 'paused'
    except:
        return False

# In main loop
for i, video in enumerate(videos_info, 1):
    # Check pause before starting next video
    if should_pause(args.api_url, args.run_id):
        print("\n⏸️  Pause requested - exiting gracefully")
        sys.exit(0)

    # Process video...
```

---

## Testing Strategy

### Test Scenarios

1. **Browser Refresh During Processing**
   - Start processing 5 videos
   - After 2 videos complete, refresh the page
   - EXPECT: ProcessingStatusPanel restores, shows progress, continues

2. **Browser Crash/Close During Processing**
   - Start processing 5 videos
   - After 2 videos complete, close browser tab
   - Python continues in background
   - Reopen page after 1 minute
   - EXPECT: Shows paused run, offers resume

3. **Python Process Crash**
   - Start processing, manually kill Python process
   - EXPECT: Dead process detected within 60s, run marked as paused

4. **Server Restart During Processing**
   - Start processing
   - Restart Next.js server (npm run dev)
   - EXPECT: Python continues, server detects orphaned process on restart

5. **Network Interruption**
   - Start processing
   - Disable network after 1 video completes
   - EXPECT: Python continues, heartbeat fails, marked as paused after 60s

6. **Partial File Corruption**
   - Manually delete output JSON file mid-processing
   - Resume processing
   - EXPECT: Output verification fails, video marked failed, reprocessed

7. **Resume from Checkpoint**
   - Process 3 of 5 videos, force stop
   - Click "Resume"
   - EXPECT: Skips 3 completed videos, processes 2 remaining

8. **Multiple Resume Attempts**
   - Process 2 of 5, stop
   - Resume, process 1 more, stop again
   - Resume again
   - EXPECT: Processes 2 remaining videos, `resume_count = 2`

---

## Implementation Order

### Priority 1 (Critical - Do First)
1. Add database columns (heartbeat, checkpoint)
2. Implement heartbeat system
3. Implement dead process detection
4. Add output file verification
5. Implement resume endpoint + UI

### Priority 2 (Important - Do Second)
6. Add server restart recovery
7. Implement network retry logic
8. Add reconciliation job
9. Update Python with resume flag

### Priority 3 (Nice to Have - Do Later)
10. Add processing history dialog
11. Add manual retry button
12. Add pause button
13. Add detailed logging/debugging UI

---

## Migration Path

### Backward Compatibility

- All new database columns have defaults → existing rows compatible
- Python `--resume` flag is optional → old processing still works
- Frontend falls back gracefully if endpoints don't exist

### Deployment Steps

1. Apply database migrations (new columns)
2. Deploy API endpoints (heartbeat, resume, reconcile)
3. Update Python scripts (heartbeat, resume logic)
4. Deploy frontend UI (resume prompt)
5. Test thoroughly
6. Monitor for 1 week, fix issues

---

## Success Criteria

✅ **System can recover from:**
- Browser crash/refresh
- Python process crash
- Server restart
- Network interruption
- Partial file corruption

✅ **User Experience:**
- Clear UI showing what happened
- One-click resume
- No data loss
- No manual database fixes needed

✅ **Data Integrity:**
- Database always reflects reality
- No orphaned files
- No inconsistent states
- Output files validated

---

## Open Questions

**Q1: Should we auto-resume or require user confirmation?**
- Option A: Auto-resume immediately when paused run detected
- Option B: Show banner, let user click "Resume"
- **Recommendation: Option B** (user control, prevents unwanted GPU usage)

**Q2: What happens if user starts a new batch while old one is paused?**
- Option A: Discard old paused run automatically
- Option B: Prevent new batch until old one resolved
- Option C: Allow multiple concurrent runs (queue them)
- **Recommendation: Option B** (simpler, prevents confusion)

**Q3: Should we store logs in database or file system?**
- Current: File system only (`processing-{runId}.log`)
- Option A: Migrate to database (easier to query, auto-cleanup)
- Option B: Keep file system (simpler, no DB bloat)
- **Recommendation: Option B for now** (file system logs are fine, add DB log summary table later if needed)

**Q4: Max retry count for failed videos?**
- Option A: 3 retries (then mark as permanently failed)
- Option B: Infinite retries (user can always retry manually)
- **Recommendation: Option A** (prevent infinite loops, user can reset retry count manually)

**Q5: What happens to paused runs after 24 hours?**
- Option A: Auto-cancel stale paused runs
- Option B: Keep forever until user explicitly cancels
- **Recommendation: Option A** (cleanup, show warning before cancelling)

---

## Risks & Mitigations

### Risk 1: Database Bloat
- **Risk:** Heartbeat writes every 10 seconds → high write volume
- **Mitigation:**
  - Use single column update (not full row)
  - Add index on `last_heartbeat`
  - Consider Redis for heartbeat (move to DB only on check)

### Risk 2: Race Conditions
- **Risk:** Multiple processes trying to resume same run
- **Mitigation:**
  - Use database transactions with row locking
  - Add `WHERE status = 'paused'` to resume UPDATE
  - Check PID before spawning new process

### Risk 3: File System Sync Issues
- **Risk:** Files written but not flushed before crash
- **Mitigation:**
  - Use `fsync()` after writing critical files
  - Validate JSON files can be parsed before marking complete
  - Add checksums (optional, slower but safer)

### Risk 4: Orphaned Python Processes
- **Risk:** Python processes keep running after Next.js restart
- **Mitigation:**
  - Server init checks PIDs and reattaches or marks paused
  - Add timeout in Python (if heartbeat endpoint unreachable for 5min, exit)
  - Use process monitoring tool (PM2, systemd)

---

## Future Enhancements (Out of Scope)

1. **Distributed Processing:** Multiple Python workers processing videos in parallel
2. **Priority Queue:** Let user prioritize certain videos
3. **Batch Scheduling:** Schedule processing for off-peak hours
4. **GPU Monitoring:** Show real-time GPU usage in UI
5. **Cost Tracking:** Track actual $ cost per video/run
6. **Email Notifications:** Email when batch completes
7. **Webhook Support:** Call webhook on completion for integrations
8. **S3 Integration:** Store results in cloud storage
9. **Real-time Progress:** WebSocket for live frame-by-frame progress
10. **Video Streaming:** Stream processed video to UI in real-time

---

## Summary

This plan makes the local GPU processing system fully resilient to all common failure modes. The key innovations are:

1. **Heartbeat system** - Detect dead processes automatically
2. **Resume capability** - Continue from last checkpoint
3. **Output verification** - Ensure file system matches database
4. **Server restart recovery** - Handle Next.js restarts gracefully
5. **Network resilience** - Retry failed API calls
6. **User-friendly UI** - Clear prompts for paused runs

Implementation is phased to deliver value incrementally while maintaining backward compatibility.
