# Video Processing Log Improvements - User-Friendly Format

## Current Problems

1. **Too Technical** - Terms like "temporal averaging", "shadow-reflection coupling", "dual-threshold detection"
2. **Buried Key Info** - Important results like "0 organisms found" hidden in noise
3. **No Progress Tracking** - Hard to tell overall progress (e.g., Step 2 of 4)
4. **Excessive Separators** - The `===` lines create visual clutter
5. **Technical Warnings** - "Duration mismatch" warnings confuse non-experts
6. **No Summary** - No simple "what did we find?" at the end

---

## Proposed Improvements

### 1. **Clear Progress Tracking**
- Show overall progress: `[Step 1/3]`, `[Video 1/2]`
- Use simple progress indicators: `████░░░░░░ 40%`
- Estimated time remaining where possible

### 2. **Plain Language**
- Replace "Temporal Averaging" → "Analyzing background"
- Replace "Benthic Activity Detection V4" → "Looking for moving organisms"
- Replace "Shadow-reflection coupling" → "Advanced tracking features"

### 3. **Visual Hierarchy**
- **Summary at top**: Quick status and key findings
- **Details folded**: Technical info only if errors occur
- **Emoji/symbols**: ✓ ✗ ⚠ → for quick status scanning

### 4. **Executive Summary**
- Clear results at the end of each video
- Overall summary at end of batch

---

## Example: Before vs After

### BEFORE (Current Format) ❌

```
================================================================================
Processing Benthic Activity V4: algapelago_1_2025-06-20_12-00-47_background_subtracted.mp4
================================================================================

================================================================================
BENTHIC ACTIVITY DETECTION V4 - Shadow-Reflection Coupling & Track Trails
================================================================================
Input: public\motion-analysis-results\algapelago_1_2025-06-20_12-00-47\algapelago_1_2025-06-20_12-00-47_background_subtracted.mp4
Output: public\motion-analysis-results\algapelago_1_2025-06-20_12-00-47

V4 Enhancements:
  - Shadow-reflection coupling (max distance: 100px)
  - Complete track trails (entire path from start to current frame)
  - Enhanced sensitivity (dark threshold: 18)

V3 Features:
  - Dual-threshold detection (dark: 18, bright: 40)
  - Dark + bright blob detection

V2 Features:
  - Extended skip frames: 90 (~7.5 seconds)
  - Rest zone monitoring: 120px radius
  - Spatial proximity matching

Video Info:
  FPS: 3.97
  Frames: 120
  Resolution: 1920x1080

Processing 120 frames...
  Frame 50/120 - 0 tracks (0 resting, 0.0% coupled)
  Frame 100/120 - 0 tracks (0 resting, 0.0% coupled)

Validating 0 tracks...
  Valid tracks: 0/0

================================================================================
DETECTION COMPLETE
================================================================================
Processing time: 18.1s
Valid tracks: 0
Overall coupling rate: 0.0%
Annotated video: public\motion-analysis-results\algapelago_1_2025-06-20_12-00-47\algapelago_1_2025-06-20_12-00-47_background_subtracted_benthic_activity_v4.mp4
Results JSON: public\motion-analysis-results\algapelago_1_2025-06-20_12-00-47\algapelago_1_2025-06-20_12-00-47_background_subtracted_benthic_activity_v4.json
================================================================================
```

### AFTER (Improved Format) ✅

```
┌─────────────────────────────────────────────────────────────────┐
│ Video Processing - Run 2e4e0510                                 │
│ Processing 2 videos with organism detection enabled             │
└─────────────────────────────────────────────────────────────────┘

[Video 1/2] algapelago_1_2025-06-20_12-00-47.mp4
┌─────────────────────────────────────────────────────────────────┐
│ Step 1/2: Analyzing background                                  │
│ ████████████████████████████████████████████████████ 100%      │
│ ✓ Background analysis complete (29s)                            │
│ ✓ Created: average_background.jpg                               │
│ ✓ Created: background_subtracted.mp4 (120 frames)               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Step 2/2: Looking for moving organisms                          │
│ ████████████████████████████████████████████████████ 100%      │
│ • Scanning 120 frames at 4 fps (30 second video)                │
│ • Using advanced tracking (shadows + reflections)               │
│                                                                  │
│ RESULTS:                                                         │
│ ✗ No organisms detected in this video                           │
│                                                                  │
│ ✓ Processing complete (18s)                                     │
│ ✓ Created: benthic_activity_v4.mp4                              │
│ ✓ Created: results.json                                         │
└─────────────────────────────────────────────────────────────────┘

[Video 2/2] algapelago_1_2025-06-20_14-00-48.mp4
┌─────────────────────────────────────────────────────────────────┐
│ Step 1/2: Analyzing background                                  │
│ ████████████████████████████████████████████████████ 100%      │
│ ✓ Background analysis complete (29s)                            │
│ ✓ Created: average_background.jpg                               │
│ ✓ Created: background_subtracted.mp4 (120 frames)               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Step 2/2: Looking for moving organisms                          │
│ ████████████████████████████████████████████████████ 100%      │
│ • Scanning 120 frames at 4 fps (30 second video)                │
│ • Using advanced tracking (shadows + reflections)               │
│                                                                  │
│ RESULTS:                                                         │
│ ✗ No organisms detected in this video                           │
│                                                                  │
│ ✓ Processing complete (19s)                                     │
│ ✓ Created: benthic_activity_v4.mp4                              │
│ ✓ Created: results.json                                         │
└─────────────────────────────────────────────────────────────────┘

╔═════════════════════════════════════════════════════════════════╗
║                     PROCESSING COMPLETE                         ║
╚═════════════════════════════════════════════════════════════════╝

SUMMARY:
• Videos processed: 2/2 ✓
• Total time: 1m 36s
• Organisms found: 0
• Success rate: 100%

OUTPUT LOCATION:
D:\DataApp\public\motion-analysis-results\
```

---

## Implementation Details

### Progress Bar Function
```python
def print_progress_bar(current, total, width=50):
    """Print a simple text-based progress bar"""
    filled = int(width * current / total)
    bar = '█' * filled + '░' * (width - filled)
    percent = int(100 * current / total)
    print(f"│ {bar} {percent}%")
```

### Status Symbols
```python
STATUS_SUCCESS = "✓"
STATUS_ERROR = "✗"
STATUS_WARNING = "⚠"
STATUS_INFO = "•"
```

### Section Headers
```python
def print_section_header(title, width=65):
    """Print a clean section header"""
    print(f"┌─{'─' * (width - 2)}┐")
    print(f"│ {title:<{width - 3}}│")
    print(f"└─{'─' * (width - 2)}┘")
```

### Detail Levels
```python
# Control verbosity based on user preference
VERBOSITY_MINIMAL = 0   # Only show progress and results
VERBOSITY_NORMAL = 1    # Show progress, results, and warnings
VERBOSITY_DETAILED = 2  # Show all technical details
```

---

## Key Changes by File

### 1. `batch_process_videos.py`
- Add overall progress tracking (Video X/Y)
- Add step tracking per video (Step X/Y)
- Add final summary section
- Hide technical warnings unless error occurs

### 2. `background_subtraction.py`
- Rename section: "Background Subtraction - Temporal Averaging" → "Analyzing background"
- Add progress bar for frame processing
- Hide duration mismatch warnings (not user-actionable)
- Show only: frames processed, time taken, files created

### 3. `benthic_activity_detection_v4.py`
- Rename section: "BENTHIC ACTIVITY DETECTION V4" → "Looking for moving organisms"
- Remove V2/V3/V4 feature lists (too technical)
- Add progress bar for frame scanning
- Highlight key result: "X organisms detected" or "No organisms detected"
- Hide coupling rate unless organisms found

### 4. Error Handling
- Keep technical details when errors occur
- Show simplified message first, full details below
- Example:
  ```
  ✗ Processing failed: Could not open video file

  Technical details:
  FileNotFoundError: [Errno 2] No such file or directory: 'video.mp4'
  Full path: D:\DataApp\public\videos\video.mp4
  ```

---

## Verbosity Modes

### Minimal (`--quiet`)
```
Processing 2 videos...
[1/2] algapelago_1_12-00-47.mp4 ✓ (47s, 0 organisms)
[2/2] algapelago_1_14-00-48.mp4 ✓ (48s, 0 organisms)
Complete: 2/2 videos, 0 organisms found
```

### Normal (default)
```
[Video 1/2] algapelago_1_2025-06-20_12-00-47.mp4
Step 1/2: Analyzing background... ✓ (29s)
Step 2/2: Looking for organisms... ✓ (18s)
RESULT: No organisms detected

[Video 2/2] algapelago_1_2025-06-20_14-00-48.mp4
Step 1/2: Analyzing background... ✓ (29s)
Step 2/2: Looking for organisms... ✓ (19s)
RESULT: No organisms detected

SUMMARY: 2 videos processed, 0 organisms found, 1m 36s
```

### Detailed (`--verbose`)
```
[Current format with all technical details]
```

---

## Benefits

✅ **Non-experts can follow along** - Plain English, clear progress
✅ **Quick status scanning** - Symbols and headers make scanning easy
✅ **Less clutter** - Technical details hidden unless needed
✅ **Better UX** - Progress bars and time estimates reduce anxiety
✅ **Actionable results** - Key findings highlighted
✅ **Professional appearance** - Clean boxes and formatting

---

## Migration Path

1. **Phase 1**: Add new logging functions to a `logging_utils.py` module
2. **Phase 2**: Update `batch_process_videos.py` to use new format
3. **Phase 3**: Update individual scripts (background_subtraction, benthic_activity_v4)
4. **Phase 4**: Add verbosity flags (`--quiet`, `--verbose`)
5. **Phase 5**: Add color support for terminals that support it

---

## Open Questions

1. **Unicode support**: Some Windows terminals may not render box characters correctly
   - Fallback: Use ASCII characters instead (`+---+` instead of `┌───┐`)

2. **Color support**: Should we add terminal colors?
   - Green for success, red for errors, yellow for warnings
   - Requires checking terminal capability

3. **Log file format**: Should log files use same format or separate format?
   - Proposal: Console gets pretty format, log file gets structured format

4. **Timing estimates**: Should we show estimated time remaining?
   - Requires tracking average processing time per frame
   - Could be useful for long videos

---

## Next Steps

**If you approve this direction, I can:**

1. Create `cv_scripts/logging_utils.py` with helper functions
2. Update `batch_process_videos.py` to use new format
3. Update `background_subtraction.py` to use new format
4. Update `benthic_activity_detection_v4.py` to use new format
5. Add verbosity control flags
6. Test with your sample videos

**Which verbosity level would you like as the default?**
- Minimal
- Normal (recommended)
- Detailed

**Should I proceed with implementation?**
