# Benthic Activity V4 Integration Plan

## Overview

Integrate the **Benthic Activity Detection V4** script (`cv_scripts/benthic_activity_detection_v4.py`) into the DataApp's Motion Analysis pipeline. When users click "Run Processing", it will execute BAv4 instead of the current motion analysis, producing:

1. **BAv4 Annotated Video** - Shows track trails, bounding boxes, coupling info
2. **YOLOv8 Detection Video** - Object detection visualization (existing)
3. **Dual-Axis Chart** - BAv4 track counts on one axis, YOLOv8 detections on the other

---

## Current Architecture Summary

### Processing Pipeline (Current)
```
User clicks "Run Processing"
    ↓
ProcessingEstimationModal (GPU selection, settings)
    ↓
POST /api/motion-analysis/process/start
    ↓
Spawns: python batch_process_videos.py
    ↓
Phase 1: background_subtraction.py → {video}_background_subtracted.mp4
Phase 2: motion_analysis.py → {video}_motion_analysis.json
Phase 3: process_videos_yolov8.py → {video}_yolov8.mp4 + _yolov8.json
    ↓
Results stored in:
    - Database: uploaded_videos table (processing_status, motion_analysis, etc.)
    - Filesystem: public/motion-analysis-results/{video_stem}/
```

### Video Comparison Modal (Current)
```
Modal opens on double-click:
    ↓
TOP PANEL: Crab detection video OR motion video
BOTTOM PANEL: YOLOv8 detection video
    ↓
TIMELINE CHART (dual-axis):
    - Left Y-axis: Motion density (green area)
    - Right Y-axis: YOLOv8 detection count (blue bars)
```

---

## Benthic Activity V4 Script Analysis

### Key Features
- **Shadow-Reflection Coupling**: Pairs dark blobs (shadows) with bright blobs (reflections) for hard-shelled organism detection
- **Persistent Track Trails**: Complete path visible from tracking start to current frame
- **Rest Period Handling**: Extended skip frames (90 frames ~11s) for scoot-rest-scoot behavior
- **Multi-frame Tracking**: KNN greedy matching with confidence boosting for coupled detections

### Inputs
- Background-subtracted video (grayscale, motion-only frames)
- Detection parameters (thresholds, area limits, coupling distance)
- Tracking parameters (max distance, skip frames, rest zone radius)
- Validation parameters (min track length, displacement, speed)

### Outputs
1. **Annotated Video** (`{video}_benthic_activity_v4.mp4`)
   - Green bounding boxes for valid tracks
   - Orange bounding boxes for invalid/short tracks
   - Complete trail lines showing organism movement path
   - Labels with track ID and coupling percentage

2. **Results JSON** (`{video}_benthic_activity_v4.json`)
   ```json
   {
     "video_info": { "filename", "fps", "total_frames", "resolution" },
     "parameters": { "detection", "tracking", "validation" },
     "tracks": [
       {
         "track_id": 1,
         "frames": [0, 1, 2, 5, 6, ...],
         "centroids": [[x1, y1], [x2, y2], ...],
         "length": 42,
         "displacement": 156.3,
         "avg_speed": 3.72,
         "coupling_rate": 71.4,
         "is_valid": true
       }
     ],
     "summary": {
       "total_tracks": 47,
       "valid_tracks": 12,
       "overall_coupling_rate": 62.5,
       "processing_time": 45.3
     }
   }
   ```

---

## Integration Plan

### Phase 1: Backend Processing Pipeline Modifications

#### 1.1 Modify batch_process_videos.py
**File:** `cv_scripts/batch_process_videos.py`

Add new phase for benthic activity detection:

```python
def run_benthic_activity_v4(bg_subtracted_video, output_dir, params=None):
    """Run Benthic Activity Detection V4 on a background-subtracted video."""
    print(f"\n{'='*80}")
    print(f"Processing Benthic Activity V4: {os.path.basename(bg_subtracted_video)}")
    print(f"{'='*80}")

    cmd = [
        "python", "cv_scripts/benthic_activity_detection_v4.py",
        "--input", bg_subtracted_video,
        "--output", output_dir,
    ]

    # Add optional parameter overrides
    if params:
        if 'dark_threshold' in params:
            cmd.extend(["--dark-threshold", str(params['dark_threshold'])])
        if 'bright_threshold' in params:
            cmd.extend(["--bright-threshold", str(params['bright_threshold'])])
        if 'min_area' in params:
            cmd.extend(["--min-area", str(params['min_area'])])
        if 'max_distance' in params:
            cmd.extend(["--max-distance", str(params['max_distance'])])
        if 'max_skip_frames' in params:
            cmd.extend(["--max-skip-frames", str(params['max_skip_frames'])])
        # ... other params

    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        print(result.stdout)
        return True
    except subprocess.CalledProcessError as e:
        print(f"ERROR: Benthic Activity V4 failed for {bg_subtracted_video}")
        print(e.stderr)
        return False
```

**Modified main() function:**
```python
# Current phases:
# Phase 1: Background Subtraction
# Phase 2: Motion Analysis
# Phase 3: YOLOv8 Detection

# NEW pipeline when BAv4 is enabled:
# Phase 1: Background Subtraction (same)
# Phase 2: Benthic Activity V4 (replaces Motion Analysis)
# Phase 3: YOLOv8 Detection (same)
```

#### 1.2 Modify API Route
**File:** `src/app/api/motion-analysis/process/start/route.ts`

Add BAv4 settings to processing settings:

```typescript
const processingSettings = {
  targetFps: settings?.targetFps || '10',
  enableMotionAnalysis: settings?.enableMotionAnalysis ?? false, // Disabled by default
  enableYolo: settings?.enableYolo ?? true,
  yoloModel: settings?.yoloModel || 'yolov8m',

  // NEW: Benthic Activity V4 settings
  enableBenthicActivityV4: settings?.enableBenthicActivityV4 ?? true, // Enabled by default
  benthicActivityParams: settings?.benthicActivityParams || {
    dark_threshold: 18,
    bright_threshold: 40,
    min_area: 75,
    max_area: 2000,
    coupling_distance: 100,
    max_distance: 75.0,
    max_skip_frames: 90,
    min_track_length: 4,
    min_displacement: 8.0,
  },
};
```

#### 1.3 Update benthic_activity_detection_v4.py
**File:** `cv_scripts/benthic_activity_detection_v4.py`

Add `video_id` and `run_id` parameters for database updates:

```python
def process_video(
    video_path: Path,
    output_dir: Path,
    detection_params: DetectionParams,
    tracking_params: TrackingParams,
    validation_params: ValidationParams,
    video_id: str = None,  # For database updates
    run_id: str = None     # For processing run tracking
) -> dict:
    # ... existing code ...

    # Add video_id and run_id to results
    results['video_id'] = video_id
    results['run_id'] = run_id

    return results
```

Add per-frame detection counts for timeline chart:

```python
# Track detection counts per frame for timeline visualization
frame_detection_counts = []

while True:
    ret, frame = cap.read()
    if not ret:
        break

    # ... existing detection code ...

    # Count active tracks at this frame
    active_count = len([t for t in active_tracks if frame_idx in t.frames or
                        (t.is_resting and frame_idx - t.last_seen_frame <= tracking_params.max_skip_frames)])

    frame_detection_counts.append({
        'frame': frame_idx,
        'timestamp': frame_idx / fps,
        'active_tracks': active_count,
        'blobs_detected': len(blobs),
        'coupled_blobs': len([b for b in blobs if b.blob_type == 'coupled']),
    })

# Add to results JSON
results['frame_detections'] = frame_detection_counts
```

---

### Phase 2: Database Schema Updates

#### 2.1 Add BAv4 columns to uploaded_videos table
**File:** `supabase/migrations/YYYYMMDD_add_benthic_activity_v4.sql`

```sql
ALTER TABLE uploaded_videos
ADD COLUMN IF NOT EXISTS has_benthic_activity_v4 BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS benthic_activity_valid_tracks INTEGER,
ADD COLUMN IF NOT EXISTS benthic_activity_total_tracks INTEGER,
ADD COLUMN IF NOT EXISTS benthic_activity_coupling_rate DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS benthic_activity_json JSONB;
```

#### 2.2 Create benthic_activity_results table (optional, for detailed track data)
```sql
CREATE TABLE IF NOT EXISTS benthic_activity_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID REFERENCES uploaded_videos(id) ON DELETE CASCADE,
    run_id UUID REFERENCES processing_runs(id),

    -- Summary metrics
    valid_tracks INTEGER NOT NULL DEFAULT 0,
    total_tracks INTEGER NOT NULL DEFAULT 0,
    overall_coupling_rate DECIMAL(5,2),
    processing_time_seconds DECIMAL(10,3),

    -- Parameters used
    detection_params JSONB,
    tracking_params JSONB,
    validation_params JSONB,

    -- Full results
    tracks JSONB,  -- Array of track objects
    frame_detections JSONB,  -- Per-frame detection counts for timeline

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_benthic_activity_video_id ON benthic_activity_results(video_id);
```

---

### Phase 3: Frontend Modifications

#### 3.1 Update ProcessingEstimationModal
**File:** `src/components/motion-analysis/ProcessingEstimationModal.tsx`

Replace crab detection toggle with Benthic Activity V4:

```typescript
interface ProcessingSettings {
  gpuType: GpuType;
  targetFps: 'all' | '15' | '10' | '5';
  enableMotionAnalysis: boolean;  // Legacy - keep for backward compatibility
  enableYolo: boolean;
  yoloModel: 'yolov8n' | 'yolov8m' | 'yolov8l';
  enableBenthicActivityV4: boolean;  // NEW - replaces motion analysis
  benthicActivityParams: BenthicActivityV4Params | null;
}

interface BenthicActivityV4Params {
  // Detection
  dark_threshold: number;
  bright_threshold: number;
  min_area: number;
  max_area: number;
  coupling_distance: number;

  // Tracking
  max_distance: number;
  max_skip_frames: number;
  rest_zone_radius: number;

  // Validation
  min_track_length: number;
  min_displacement: number;
  max_speed: number;
  min_speed: number;
}

const DEFAULT_BAV4_PARAMS: BenthicActivityV4Params = {
  dark_threshold: 18,
  bright_threshold: 40,
  min_area: 75,
  max_area: 2000,
  coupling_distance: 100,
  max_distance: 75.0,
  max_skip_frames: 90,
  rest_zone_radius: 120,
  min_track_length: 4,
  min_displacement: 8.0,
  max_speed: 30.0,
  min_speed: 0.1,
};
```

Add settings dialog for BAv4 parameters (reuse existing BenthicActivitySettingsDialog).

#### 3.2 Create BenthicActivityV4SettingsDialog
**File:** `src/components/motion-analysis/BenthicActivityV4SettingsDialog.tsx`

```typescript
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export interface BenthicActivityV4Params {
  // Detection parameters
  dark_threshold: number;
  bright_threshold: number;
  min_area: number;
  max_area: number;
  coupling_distance: number;

  // Tracking parameters
  max_distance: number;
  max_skip_frames: number;
  rest_zone_radius: number;

  // Validation parameters
  min_track_length: number;
  min_displacement: number;
  max_speed: number;
  min_speed: number;
}

interface BenthicActivityV4SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  params: BenthicActivityV4Params;
  onSave: (params: BenthicActivityV4Params) => void;
}

export default function BenthicActivityV4SettingsDialog({
  isOpen,
  onClose,
  params,
  onSave,
}: BenthicActivityV4SettingsDialogProps) {
  const [localParams, setLocalParams] = useState<BenthicActivityV4Params>(params);

  // Render sliders for each parameter group
  // Detection, Tracking, Validation sections
  // ...
}
```

#### 3.3 Update VideoComparisonModal
**File:** `src/components/motion-analysis/VideoComparisonModal.tsx`

**A. Add BAv4 video support:**

```typescript
// Video paths
const bav4Filename = originalFilename.replace('.mp4', '_benthic_activity_v4.mp4');
const [bav4VideoPath, setBav4VideoPath] = useState(`/videos/${bav4Filename}`);
const [bav4VideoLoaded, setBav4VideoLoaded] = useState(false);
const [bav4VideoError, setBav4VideoError] = useState(false);
const bav4VideoRef = useRef<HTMLVideoElement>(null);

// Load BAv4 detection JSON data
const [bav4Detections, setBav4Detections] = useState<BAv4Detection[]>([]);

interface BAv4Detection {
  frame: number;
  timestamp: number;
  active_tracks: number;
  blobs_detected: number;
  coupled_blobs: number;
}
```

**B. Update video layout (stacked view):**

```tsx
{/* VIDEO PLAYERS - Stacked Vertically */}
<div className="flex flex-col gap-3">
  {/* TOP PANEL: BAv4 Annotated Video */}
  <div className="relative bg-black rounded-lg overflow-hidden" style={{ height: '45vh' }}>
    <video
      ref={bav4VideoRef}
      src={bav4VideoPath}
      className="w-full h-full object-contain"
      muted={isMuted}
      playsInline
    />
    <div className="absolute top-2 left-2 bg-black/70 px-2 py-1 rounded text-xs text-white">
      Benthic Activity V4 - Track Trails
    </div>
  </div>

  {/* BOTTOM PANEL: YOLOv8 Detection Video */}
  <div className="relative bg-black rounded-lg overflow-hidden" style={{ height: '45vh' }}>
    <video
      ref={yolov8VideoRef}
      src={yolov8VideoPath}
      className="w-full h-full object-contain"
      muted={isMuted}
      playsInline
    />
    <div className="absolute top-2 left-2 bg-black/70 px-2 py-1 rounded text-xs text-white">
      YOLOv8 Object Detection
    </div>
  </div>
</div>
```

**C. Update dual-axis chart:**

```typescript
// Parse BAv4 detection data for chart
const bav4Data = useMemo(() => {
  if (!bav4Detections || bav4Detections.length === 0) {
    return [];
  }

  return bav4Detections.map(detection => ({
    frame: detection.frame,
    time: detection.timestamp,
    tracks: detection.active_tracks,
    blobs: detection.blobs_detected,
  }));
}, [bav4Detections]);

// Combine both datasets for dual-axis chart
const combinedTimelineData = useMemo(() => {
  const timePoints = new Set<number>();

  // Collect time points from both sources
  bav4Data.forEach(d => timePoints.add(Math.round(d.time * 10) / 10));
  yolov8Data.forEach(d => timePoints.add(Math.round(d.time * 10) / 10));

  const sortedTimes = Array.from(timePoints).sort((a, b) => a - b);

  return sortedTimes.map(time => {
    // Find BAv4 data
    const bav4Point = bav4Data.find(d => Math.abs(d.time - time) < 0.1);
    const tracks = bav4Point?.tracks || 0;

    // Find YOLO data
    const yoloPoint = yolov8Data.find(d => Math.abs(d.time - time) < 0.1);
    const detections = yoloPoint?.count || 0;

    return { time, tracks, detections };
  });
}, [bav4Data, yolov8Data]);
```

**D. Render dual-axis chart:**

```tsx
<ComposedChart data={combinedTimelineData}>
  <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />

  {/* Left Y-axis: BAv4 Active Tracks (green) */}
  <YAxis
    yAxisId="left"
    orientation="left"
    stroke="#10b981"
    label={{ value: 'BAv4 Tracks', angle: -90, position: 'insideLeft' }}
  />

  {/* Right Y-axis: YOLOv8 Detections (blue) */}
  <YAxis
    yAxisId="right"
    orientation="right"
    stroke="#3b82f6"
    label={{ value: 'YOLO Detections', angle: 90, position: 'insideRight' }}
  />

  <XAxis
    dataKey="time"
    stroke="#9ca3af"
    tickFormatter={(value) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`}
  />

  {/* BAv4 Tracks - Green Area */}
  <Area
    yAxisId="left"
    type="monotone"
    dataKey="tracks"
    stroke="#10b981"
    fill="url(#bav4Gradient)"
    strokeWidth={2}
    name="BAv4 Tracks"
  />

  {/* YOLOv8 Detections - Blue Bars */}
  <Bar
    yAxisId="right"
    dataKey="detections"
    fill="#3b82f6"
    opacity={0.7}
    name="YOLO Detections"
  />

  <Tooltip
    content={({ active, payload, label }) => {
      if (active && payload && payload.length) {
        return (
          <div className="bg-white p-2 border rounded shadow-lg text-xs">
            <p className="font-semibold">{formatTime(label as number)}</p>
            <p className="text-green-600">BAv4 Tracks: {payload[0]?.value || 0}</p>
            <p className="text-blue-600">YOLO Detections: {payload[1]?.value || 0}</p>
          </div>
        );
      }
      return null;
    }}
  />

  {/* Gradient definitions */}
  <defs>
    <linearGradient id="bav4Gradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
      <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
    </linearGradient>
  </defs>
</ComposedChart>
```

#### 3.4 Update MotionAnalysisDashboard
**File:** `src/components/motion-analysis/MotionAnalysisDashboard.tsx`

Update display columns to show BAv4 metrics:

```typescript
// Table columns
<th>BAv4 Tracks</th>
<th>Coupling Rate</th>
<th>YOLO Detections</th>

// Row data
<td>{video.benthic_activity_valid_tracks || '-'}</td>
<td>{video.benthic_activity_coupling_rate ? `${video.benthic_activity_coupling_rate.toFixed(1)}%` : '-'}</td>
<td>{video.yolo_detections_count || '-'}</td>
```

---

### Phase 4: API Updates

#### 4.1 Update Video Fetch API
**File:** `src/app/api/motion-analysis/videos/route.ts`

Add BAv4 data enrichment:

```typescript
// Enrich with BAv4 results
const bav4JsonPath = path.join(
  process.cwd(),
  'public/motion-analysis-results',
  baseName,
  `${baseName}_benthic_activity_v4.json`
);

if (fs.existsSync(bav4JsonPath)) {
  try {
    const bav4Data = JSON.parse(fs.readFileSync(bav4JsonPath, 'utf-8'));
    enrichedVideo.benthic_activity = {
      valid_tracks: bav4Data.summary?.valid_tracks || 0,
      total_tracks: bav4Data.summary?.total_tracks || 0,
      coupling_rate: bav4Data.summary?.overall_coupling_rate || 0,
      processing_time: bav4Data.summary?.processing_time || 0,
    };
    enrichedVideo.bav4_frame_detections = bav4Data.frame_detections;
  } catch (e) {
    console.warn('Failed to parse BAv4 JSON:', e);
  }
}
```

#### 4.2 Create BAv4 Settings Endpoint (optional)
**File:** `src/app/api/motion-analysis/bav4-settings/route.ts`

For saving/loading user's preferred BAv4 parameters:

```typescript
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch user's saved BAv4 settings
  const { data, error } = await supabase
    .from('user_settings')
    .select('bav4_params')
    .eq('user_id', user.id)
    .single();

  return NextResponse.json({ params: data?.bav4_params || DEFAULT_BAV4_PARAMS });
}

export async function POST(request: NextRequest) {
  // Save BAv4 parameters
}
```

---

### Phase 5: Output File Structure

After processing, the output directory structure will be:

```
public/motion-analysis-results/{video_stem}/
├── {video_stem}_background_subtracted.mp4    # Motion-only video (input to BAv4)
├── {video_stem}_benthic_activity_v4.mp4      # BAv4 annotated video (NEW)
├── {video_stem}_benthic_activity_v4.json     # BAv4 results JSON (NEW)
├── {video_stem}_yolov8.mp4                   # YOLO annotated video
├── {video_stem}_yolov8.json                  # YOLO detections JSON
└── {video_stem}_motion_analysis.json         # Legacy (can be deprecated)
```

---

## Implementation Sequence

### Step 1: Backend (Python) - 2 hours
1. Update `batch_process_videos.py` to call BAv4
2. Modify `benthic_activity_detection_v4.py` to output per-frame detection counts
3. Test standalone processing

### Step 2: Database - 30 minutes
1. Create migration for new columns
2. Run migration on Supabase

### Step 3: API Routes - 1 hour
1. Update `/api/motion-analysis/process/start` settings
2. Update `/api/motion-analysis/videos` enrichment
3. Test API responses

### Step 4: Frontend - Modal Changes - 2 hours
1. Update `ProcessingEstimationModal` with BAv4 toggle/settings
2. Create/update `BenthicActivityV4SettingsDialog`
3. Test processing flow

### Step 5: Frontend - Video Comparison - 3 hours
1. Add BAv4 video player to `VideoComparisonModal`
2. Load and parse BAv4 JSON data
3. Update dual-axis chart with BAv4 tracks vs YOLO detections
4. Synchronize video playback
5. Test complete flow

### Step 6: Testing & Refinement - 2 hours
1. End-to-end testing
2. UI polish
3. Error handling
4. Documentation

**Total Estimated Time: ~10 hours**

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER INTERFACE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  ProcessingEstimationModal                                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ [✓] Enable Benthic Activity V4  [⚙️ Configure]                       │   │
│  │ [✓] Enable YOLOv8 Detection     Model: yolov8m                       │   │
│  │                                                                       │   │
│  │ GPU: Modal A10G ($0.0003/sec)   Est. Time: 2m 30s   Est. Cost: $0.05 │   │
│  │                                                                       │   │
│  │                    [▶ Start Processing]                               │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API LAYER                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  POST /api/motion-analysis/process/start                                     │
│  Body: { videoIds, runType: "modal-a10g", settings: { enableBAv4: true } }  │
│                                                                              │
│  → Creates processing_runs record                                            │
│  → Spawns: python batch_process_videos.py --settings {...}                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PYTHON PROCESSING                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  batch_process_videos.py                                                     │
│                                                                              │
│  Phase 1: background_subtraction.py                                          │
│           Input:  raw_video.mp4                                              │
│           Output: raw_video_background_subtracted.mp4                        │
│                                                                              │
│  Phase 2: benthic_activity_detection_v4.py  (NEW - replaces motion_analysis)│
│           Input:  raw_video_background_subtracted.mp4                        │
│           Output: raw_video_benthic_activity_v4.mp4                          │
│                   raw_video_benthic_activity_v4.json                         │
│                                                                              │
│  Phase 3: process_videos_yolov8.py                                           │
│           Input:  raw_video.mp4                                              │
│           Output: raw_video_yolov8.mp4                                       │
│                   raw_video_yolov8.json                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATABASE                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  uploaded_videos table:                                                      │
│    - has_benthic_activity_v4: true                                          │
│    - benthic_activity_valid_tracks: 12                                       │
│    - benthic_activity_coupling_rate: 62.5                                    │
│    - has_yolo_output: true                                                   │
│    - yolo_detections_count: 847                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     VIDEO COMPARISON MODAL                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │ TOP: BAv4 Video                                                     │     │
│  │ ┌──────────────────────────────────────────────────────────────┐   │     │
│  │ │  [Green trails showing organism paths]                        │   │     │
│  │ │  [Bounding boxes with ID: 3 (71% coupled)]                   │   │     │
│  │ └──────────────────────────────────────────────────────────────┘   │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │ BOTTOM: YOLOv8 Video                                               │     │
│  │ ┌──────────────────────────────────────────────────────────────┐   │     │
│  │ │  [Object detections: crab 0.87, fish 0.92]                    │   │     │
│  │ └──────────────────────────────────────────────────────────────┘   │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │ TIMELINE CHART (Dual-Axis)                                         │     │
│  │                                                                     │     │
│  │ BAv4 │    ▄▄▄▄▄                    ▄▄▄                             │     │
│  │ Tracks│  ▄█████▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄███▄▄                         │YOLO  │
│  │      │ ██████████████████████████████████▄                        │Detect│
│  │      │▄████████████████████████████████████▄▄  ▌ ▌  ▌▌▌  ▌       │      │
│  │      └───────────────────────────────────────────────────────────▶│      │
│  │        0:00         1:00         2:00         3:00         4:00   │      │
│  │                                  ▲ Playhead                        │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐     │
│  │ [⏮] [⏯] [⏭]  0:45 / 4:00  Speed: [−] 1.0x [+]  🔊                │     │
│  └────────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Considerations

### 1. Backward Compatibility
- Keep motion analysis as optional for legacy comparison
- Don't break existing processed videos
- Migration should be additive

### 2. Performance
- BAv4 is slower than simple motion analysis (~5-10 fps on CPU)
- GPU acceleration with Modal.ai recommended for batch processing
- Consider frame subsampling for very long videos

### 3. Storage
- BAv4 video is similar size to motion video
- JSON results are larger due to per-frame detection data
- Consider compressing frame_detections if storage is a concern

### 4. User Experience
- Clear labeling of BAv4 vs Motion Analysis
- Progress indicators during processing
- Easy-to-understand parameter presets (Conservative, Balanced, Sensitive)

---

## Future Enhancements

1. **Parameter Presets**: Pre-configured settings for different organism types
2. **Hybrid Mode**: Run both BAv4 and motion analysis for comparison
3. **Track Export**: Export individual track paths as CSV/GeoJSON
4. **Track Filtering**: UI to filter tracks by length, speed, coupling rate
5. **Heatmap Overlay**: Aggregate track density visualization
6. **Species Classification**: Combine YOLOv8 species ID with BAv4 tracking
