# Benthic Activity V4 Integration - Implementation Progress

## ✅ Completed (Backend & Infrastructure)

### 1. Python Scripts ✅
- **benthic_activity_detection_v4.py**: Added per-frame detection counts output
  - Added `frame_detection_counts` array tracking active_tracks, blobs_detected, coupled_blobs per frame
  - Included in JSON output as `frame_detections` field for timeline visualization

- **batch_process_videos.py**: Added BAv4 processing pipeline
  - Created `run_benthic_activity_v4()` function with parameter support
  - Added API-based processing mode with `--run-id`, `--videos`, `--settings` arguments
  - BAv4 runs by default when `enableBenthicActivityV4: true` in settings

### 2. Database Schema ✅
- **Migration**: `20250128000000_add_benthic_activity_v4_columns.sql`
  - Added columns: `has_benthic_activity_v4`, `benthic_activity_valid_tracks`, `benthic_activity_total_tracks`, `benthic_activity_coupling_rate`, `benthic_activity_processing_time`
  - Created index on `has_benthic_activity_v4` for filtering
  - Added column comments for documentation

### 3. API Routes ✅
- **/api/motion-analysis/process/start**: Updated with BAv4 settings
  - `enableBenthicActivityV4: true` by default
  - `enableMotionAnalysis: false` by default (replaced by BAv4)
  - Full BAv4 parameter support with sensible defaults

- **/api/motion-analysis/videos**: Enriched with BAv4 data
  - Loads `{filename}_benthic_activity_v4.json` from results directory
  - Returns `benthic_activity_v4` summary (valid_tracks, total_tracks, coupling_rate, processing_time)
  - Returns `bav4_frame_detections` for timeline chart

### 4. Frontend - ProcessingEstimationModal (Partial) ✅
- Added `DEFAULT_BAV4_PARAMS` with V4.6 tuned parameters
- Updated `DEFAULT_SETTINGS` to enable BAv4 by default
- **TODO**: Add UI toggle and settings dialog (see below)

---

## 🚧 Remaining Tasks

### Frontend Components

#### 1. ProcessingEstimationModal - UI Updates
**File**: `src/components/motion-analysis/ProcessingEstimationModal.tsx`

**Changes Needed**:
```tsx
// In the settings panel, add BAv4 toggle (around line 600-700)
<div className="flex items-center justify-between">
  <label className="text-sm font-medium text-gray-700">
    Benthic Activity V4 Tracking
  </label>
  <div className="flex items-center gap-2">
    <input
      type="checkbox"
      checked={settings.enableBenthicActivity}
      onChange={(e) => setSettings({ ...settings, enableBenthicActivity: e.target.checked })}
      className="rounded border-gray-300"
    />
    {settings.enableBenthicActivity && (
      <button
        onClick={() => setShowBav4SettingsDialog(true)}
        className="text-xs text-blue-600 hover:text-blue-700"
      >
        ⚙️ Configure
      </button>
    )}
  </div>
</div>

// Add state for BAv4 settings dialog
const [showBav4SettingsDialog, setShowBav4SettingsDialog] = useState(false);

// Add the dialog component
{showBav4SettingsDialog && (
  <BenthicActivitySettingsDialog
    isOpen={showBav4SettingsDialog}
    onClose={() => setShowBav4SettingsDialog(false)}
    params={settings.benthicActivityParams || DEFAULT_BAV4_PARAMS}
    onSave={(params) => {
      setSettings({ ...settings, benthicActivityParams: params });
      setShowBav4SettingsDialog(false);
    }}
  />
)}
```

**Note**: `BenthicActivitySettingsDialog` already exists and can be reused!

#### 2. VideoComparisonModal - BAv4 Video Support
**File**: `src/components/motion-analysis/VideoComparisonModal.tsx`

**Changes Needed**:

**A. Add State & Refs** (around line 100-120):
```tsx
const [bav4VideoLoaded, setBav4VideoLoaded] = useState(false);
const [bav4VideoError, setBav4VideoError] = useState(false);
const [bav4Detections, setBav4Detections] = useState<BAv4Detection[]>([]);
const bav4VideoRef = useRef<HTMLVideoElement>(null);

interface BAv4Detection {
  frame: number;
  timestamp: number;
  active_tracks: number;
  blobs_detected: number;
  coupled_blobs: number;
}
```

**B. Add Video Path Resolution** (around line 140-200):
```tsx
const bav4Filename = originalFilename.replace('.mp4', '_benthic_activity_v4.mp4');
const [bav4VideoPath, setBav4VideoPath] = useState(`/videos/${bav4Filename}`);

// Check which BAv4 video path exists (similar to existing motion video check)
useEffect(() => {
  if (!isOpen) return;

  const newPath = `/motion-analysis-results/${baseName}/${bav4Filename}`;
  const oldPath = `/videos/${bav4Filename}`;

  fetch(newPath, { method: 'HEAD' })
    .then(res => {
      if (res.ok) {
        setBav4VideoPath(newPath);
        console.log('✅ BAv4 video found at new path:', newPath);
      } else {
        setBav4VideoPath(oldPath);
        console.log('📍 Using old BAv4 video path:', oldPath);
      }
    })
    .catch(() => {
      setBav4VideoPath(oldPath);
      console.log('📍 Falling back to old BAv4 video path:', oldPath);
    });
}, [isOpen, baseName, bav4Filename]);
```

**C. Load BAv4 Detection Data** (around line 200-250):
```tsx
useEffect(() => {
  if (isOpen) {
    const detectionDataPath = `/motion-analysis-results/${baseName}/${baseName}_benthic_activity_v4.json`;

    fetch(detectionDataPath)
      .then(res => {
        if (!res.ok) throw new Error('BAv4 detection data not found');
        return res.json();
      })
      .then(data => {
        const detections = data.frame_detections || [];
        setBav4Detections(detections);
        console.log('✅ BAV4 DETECTION DATA LOADED:', detections.length, 'frames');
      })
      .catch(err => {
        console.warn('⚠️ No BAv4 detection data found:', err.message);
        setBav4Detections([]);
      });
  } else {
    setBav4Detections([]);
  }
}, [isOpen, baseName]);
```

**D. Update Video Layout** (around line 1300-1400):
```tsx
{/* TOP PANEL: BAv4 Annotated Video */}
<div className="relative bg-black rounded-lg overflow-hidden" style={{ height: '45vh' }}>
  <video
    ref={bav4VideoRef}
    src={bav4VideoPath}
    className="w-full h-full object-contain"
    muted={isMuted}
    playsInline
    onLoadedData={() => setBav4VideoLoaded(true)}
    onError={() => setBav4VideoError(true)}
  />
  <div className="absolute top-2 left-2 bg-black/70 px-2 py-1 rounded text-xs text-white">
    Benthic Activity V4 - Track Trails
  </div>
  {bav4VideoError && (
    <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white text-sm">
      BAv4 video not available
    </div>
  )}
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
```

**E. Update Dual-Axis Chart** (around line 1040-1165):
```tsx
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

// Combine BAv4 and YOLO data for dual-axis chart
const combinedTimelineData = useMemo(() => {
  const timePoints = new Set<number>();

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

**F. Render Dual-Axis Chart** (around line 1700-1850):
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
    tickFormatter={(value) => formatTime(value)}
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

  <defs>
    <linearGradient id="bav4Gradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
      <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
    </linearGradient>
  </defs>
</ComposedChart>
```

**G. Update Video Synchronization** (around line 580-650):
- Add `bav4VideoRef` to play/pause handlers
- Add `bav4VideoRef` to seek handlers
- Synchronize playback speed
- Sync time updates

#### 3. MotionAnalysisDashboard - Display BAv4 Metrics
**File**: `src/components/motion-analysis/MotionAnalysisDashboard.tsx`

**Changes Needed**:
```tsx
// Update table headers
<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
  BAv4 Tracks
</th>
<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
  Coupling
</th>

// Update table rows
<td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
  {video.benthic_activity_v4?.valid_tracks || '-'}
</td>
<td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
  {video.benthic_activity_v4?.coupling_rate ? `${video.benthic_activity_v4.coupling_rate.toFixed(1)}%` : '-'}
</td>
```

---

## Testing Checklist

### Backend Testing
- [ ] Run migration: Apply to Supabase database
- [ ] Test BAv4 script standalone with a video
- [ ] Verify JSON output contains `frame_detections`
- [ ] Test batch_process_videos.py with API mode

### API Testing
- [ ] POST /api/motion-analysis/process/start with BAv4 enabled
- [ ] Verify settings are passed correctly to Python script
- [ ] Check GET /api/motion-analysis/videos returns `benthic_activity_v4` and `bav4_frame_detections`

### Frontend Testing
- [ ] ProcessingEstimationModal shows BAv4 toggle
- [ ] BAv4 settings dialog opens and saves parameters
- [ ] Processing starts successfully with BAv4 enabled
- [ ] VideoComparisonModal loads BAv4 video
- [ ] Dual-axis chart shows BAv4 tracks (green) vs YOLO detections (blue)
- [ ] Video playback is synchronized
- [ ] Dashboard shows BAv4 metrics (tracks, coupling rate)

### End-to-End Testing
- [ ] Upload a video
- [ ] Run processing with BAv4 enabled
- [ ] Wait for completion
- [ ] Double-click video to open comparison modal
- [ ] Verify:
  - Top video shows BAv4 track trails
  - Bottom video shows YOLO detections
  - Chart shows dual-axis with correct data
  - Videos play in sync
  - Seeking works correctly

---

## File Change Summary

### Modified Files
1. `cv_scripts/benthic_activity_detection_v4.py` ✅
2. `cv_scripts/batch_process_videos.py` ✅
3. `supabase/migrations/20250128000000_add_benthic_activity_v4_columns.sql` ✅
4. `src/app/api/motion-analysis/process/start/route.ts` ✅
5. `src/app/api/motion-analysis/videos/route.ts` ✅
6. `src/components/motion-analysis/ProcessingEstimationModal.tsx` 🚧 (Partial)
7. `src/components/motion-analysis/VideoComparisonModal.tsx` ⏳ (Pending)
8. `src/components/motion-analysis/MotionAnalysisDashboard.tsx` ⏳ (Pending)

### New Files
- `BENTHIC_ACTIVITY_V4_INTEGRATION_PLAN.md` ✅
- `BAV4_INTEGRATION_PROGRESS.md` ✅

---

## Next Steps

1. **Complete ProcessingEstimationModal UI** - Add BAv4 toggle and settings button
2. **Update VideoComparisonModal** - Add BAv4 video player and dual-axis chart
3. **Update MotionAnalysisDashboard** - Add BAv4 metrics display columns
4. **Run Database Migration** - Apply to Supabase
5. **Test End-to-End** - Process a video and verify complete flow

Estimated remaining time: ~4-5 hours for frontend completion + 1-2 hours testing
