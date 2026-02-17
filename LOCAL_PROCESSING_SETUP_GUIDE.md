# Local Processing Setup Guide

## Overview

This guide helps new users set up local video processing for underwater organism detection. The system will automatically check for missing requirements and provide fix suggestions through the UI.

---

## Quick Start

1. **Navigate to Motion Analysis page** in the app
2. **Click "Start Processing"** - the system will automatically check requirements
3. **Follow the on-screen setup wizard** to fix any issues
4. **Retry processing** after setup is complete

---

## System Requirements

### ✅ Auto-Fixable Requirements

These will be automatically created if missing:

- **Videos Directory** (`public/videos/`)
- **Motion Analysis Results Directory** (`public/motion-analysis-results/`)
- **Temp Directory** (`public/temp/`)

### ⚙️ Manual Setup Requirements

#### 1. **Python Environment** (Required)

**Check Status:**
```bash
python --version
```

**Installation:**
- Windows: Download from [python.org](https://python.org/downloads/)
  - ✅ Check "Add Python to PATH" during installation
- Mac: `brew install python`
- Linux: `sudo apt install python3`

**Troubleshooting:**
- If `python` command not found, try `python3`
- Restart terminal/computer after installation
- Verify PATH includes Python installation directory

---

#### 2. **Python Dependencies** (Required)

**Check Status:**
```bash
python -c "import cv2, ultralytics, numpy, requests"
```

**Installation:**
```bash
# Option 1: Using requirements.txt (recommended)
pip install -r requirements.txt

# Option 2: Manual installation
pip install opencv-python ultralytics numpy requests
```

**Required Packages:**
- `opencv-python` - Video processing and computer vision
- `ultralytics` - YOLOv8 object detection
- `numpy` - Numerical computations
- `requests` - API communication

**Troubleshooting:**
- If pip not found: `python -m pip install <package>`
- If permission errors: `pip install --user <package>`
- If package conflicts: `pip install --force-reinstall <package>`

---

#### 3. **FFmpeg** (Optional - Recommended)

**Check Status:**
```bash
ffmpeg -version
```

**Installation:**
- Windows: `winget install ffmpeg` or download from [ffmpeg.org](https://ffmpeg.org/download.html)
- Mac: `brew install ffmpeg`
- Linux: `sudo apt install ffmpeg`

**Note:** FFmpeg is optional - the system will fall back to OpenCV if unavailable, but FFmpeg provides better video format support.

---

#### 4. **YOLO Model** (Optional)

**Trained Underwater Model:**
- File: `Labeled_Datasets/05_Models/Y12_11kL_12k(brackish)_E100_Augmented_best.pt`
- Contact administrator to obtain this file
- Place in `Labeled_Datasets/05_Models/` directory

**Alternative:**
- Use pre-trained YOLO models (yolov8n, yolov8m, yolov8l)
- Will be automatically downloaded on first use
- Not optimized for underwater organisms

---

## Processing Pipeline

### Phase 1: Background Subtraction

**Script:** `cv_scripts/background_subtraction.py`

**What it does:**
- Computes temporal average of video frames
- Subtracts background to isolate moving objects
- Outputs: `{video_name}_background_subtracted.mp4`

**Settings:**
- `duration`: Seconds to process (default: 30s)
- `subsample`: Process every Nth frame (default: 6)

---

### Phase 2: Benthic Activity Detection V4

**Script:** `cv_scripts/benthic_activity_detection_v4.py`

**What it does:**
- Detects and tracks moving organisms
- Uses dual-threshold blob detection (dark + bright objects)
- Implements shadow-reflection coupling
- Tracks complete motion trails
- Validates tracks based on displacement, speed, duration

**Output Files:**
- `{video_name}_benthic_activity_v4.mp4` - Annotated video with bounding boxes
- `{video_name}_benthic_activity_v4.json` - Detailed track data

**Key Parameters:**
- `dark_threshold`: 18 (sensitivity for dark organisms)
- `bright_threshold`: 40 (sensitivity for bright organisms/reflections)
- `min_area`: 75 pixels
- `max_area`: 2000 pixels
- `max_skip_frames`: 90 frames (~7.5 seconds at 4 fps)
- `min_track_length`: 4 frames
- `min_displacement`: 8 pixels
- `min_speed`: 0.1 pixels/frame
- `max_speed`: 30 pixels/frame

---

### Phase 3: YOLO Detection (Optional)

**Script:** `process_videos_yolov8.py`

**What it does:**
- Runs YOLOv8 object detection on original videos
- Detects and classifies marine organisms
- Draws bounding boxes with confidence scores

**Output Files:**
- `{video_name}_yolov8.mp4` - Annotated video with detections
- `{video_name}_yolov8.json` - Frame-by-frame detection data

**Models Available:**
- `yolov8m` (default) - Custom trained underwater model (if available)
- `yolov8n` - Nano (fastest, lowest accuracy)
- `yolov8l` - Large (slowest, highest accuracy)

---

## Common Issues & Fixes

### Issue: "Python not found"

**Symptom:** Processing fails with "python is not recognized"

**Fix:**
1. Check if Python is installed: `python --version` or `python3 --version`
2. If not installed, download from python.org
3. If installed but not in PATH:
   - Windows: Add Python to PATH in Environment Variables
   - Mac/Linux: Add to `.bashrc` or `.zshrc`
4. Restart terminal/computer after PATH changes

---

### Issue: "Module cv2 not found"

**Symptom:** Processing fails with ImportError for cv2, ultralytics, etc.

**Fix:**
```bash
# Install missing packages
pip install opencv-python ultralytics numpy requests

# Or install from requirements.txt
pip install -r requirements.txt

# Verify installation
python -c "import cv2; print(cv2.__version__)"
```

---

### Issue: "YOLO model not found"

**Symptom:** YOLO processing fails with model file not found error

**Fix:**
1. **Option A:** Place custom model in `Labeled_Datasets/05_Models/`
2. **Option B:** Use pre-trained model (yolov8n, yolov8m, yolov8l)
   - Will auto-download on first use
3. **Option C:** Disable YOLO processing in settings

---

### Issue: "Processing stuck or very slow"

**Symptom:** Videos take extremely long to process

**Possible Causes:**
1. **Large video file** - Reduce duration setting (default: 30s)
2. **High resolution** - Videos are 1920x1080, processing is intensive
3. **No GPU** - YOLO runs much faster on GPU (10-20 fps vs 2-5 fps CPU)
4. **Low subsample rate** - Increase subsample value (default: 6)

**Fix:**
- Adjust settings in Motion Analysis page
- Process shorter clips first (10-15 seconds)
- Increase subsample rate (e.g., 10 = every 10th frame)
- Consider using Modal.com for GPU processing

---

### Issue: "Duration mismatch warning"

**Symptom:** Log shows "Duration mismatch: expected=120s, actual=30s"

**Explanation:** This is a known metadata issue with OpenCV video encoding. The video file is correctly created with all frames, but the duration metadata may be incorrect. This does not affect processing quality or results.

**Impact:** Minimal - may cause playback timeline issues in some video players, but all frames are present and correctly processed.

**Status:** Low priority bug, does not affect analysis results.

---

### Issue: "No organisms detected"

**Symptom:** Benthic Activity V4 reports 0 valid tracks

**Possible Causes:**
1. **Low activity in video** - No organisms present during clip
2. **Thresholds too strict** - Parameters filter out all detections
3. **Background too similar** - Organisms blend with background
4. **Short tracks** - Organisms move too slowly or briefly

**Fix:**
- Try different video clips with more activity
- Adjust sensitivity parameters (lower dark_threshold, increase max_skip_frames)
- Review annotated video to see if any detections occurred before filtering
- Check background-subtracted video for visibility

---

## Using the System Setup UI

### Accessing Setup Checker

1. Navigate to **Motion Analysis** page
2. Click **"Check System Setup"** button (or automatic check on first processing)
3. Review requirements status

### Understanding Status Indicators

- ✅ **Green checkmark** - Requirement met
- ⚠️ **Yellow warning** - Optional requirement missing (can proceed without it)
- ❌ **Red X** - Required component missing (must fix before processing)

### Auto-Fix

Click **"Auto-Fix"** button to automatically create missing directories.

**Note:** Only directories can be auto-fixed. Dependencies (Python, packages) require manual installation.

### Manual Fix Instructions

Click **"Show Instructions"** next to any failed requirement to see detailed setup steps.

---

## Advanced Configuration

### Custom Processing Parameters

Edit settings in the Motion Analysis UI:

**Background Subtraction:**
- Duration: How many seconds of video to process
- Subsample: Process every Nth frame (higher = faster but less smooth)

**Benthic Activity V4:**
- All detection parameters can be tuned via UI
- Use presets (Sensitive, Balanced, Conservative) or custom values

**YOLO Detection:**
- Model selection (yolov8n, yolov8m, yolov8l)
- Enable/disable YOLO processing

### Running from Command Line

For advanced users:

```bash
# Process single video
python cv_scripts/batch_process_videos.py \
  --run-id <UUID> \
  --run-type local \
  --videos '<JSON>' \
  --api-url http://localhost:9002 \
  --settings '<JSON>'
```

**Note:** Normally invoked automatically by the API. Manual use requires proper JSON formatting for videos and settings.

---

## Database Updates

The processing pipeline automatically updates the Supabase database:

### After Each Video:
- Processing status: `processing` → `completed` or `failed`
- Motion analysis file path
- Processed timestamp

### After Full Run:
- Processing run statistics
- Total videos processed/failed
- Processing logs (compact summary)

**API Endpoints:**
- `/api/motion-analysis/process/complete` - Mark video complete
- `/api/motion-analysis/process/progress` - Update progress (not currently used)

---

## Troubleshooting Checklist

When processing fails, check in order:

1. ✅ **Python installed and in PATH** - `python --version`
2. ✅ **Python packages installed** - `python -c "import cv2, ultralytics, numpy, requests"`
3. ✅ **Directories exist** - Auto-fix button or check `public/videos/`, `public/motion-analysis-results/`
4. ✅ **Video file exists** - Check `public/videos/{filename}.mp4`
5. ✅ **cv_scripts directory exists** - Should be in project root
6. ✅ **Disk space available** - Processing generates large temporary files
7. ✅ **No other processes using files** - Close video players/editors

**Still having issues?**

Check processing logs:
- Location: Project root, named `processing-{run-id}.log`
- Contains detailed output from all processing steps
- Look for ERROR or WARNING messages

---

## Performance Benchmarks

**Typical Processing Times (Local CPU):**

| Video Length | Resolution | BAv4 | YOLO | Total |
|-------------|-----------|------|------|-------|
| 30s | 1920x1080 | ~30s | ~60s | ~90s |
| 60s | 1920x1080 | ~60s | ~120s | ~180s |
| 120s | 1920x1080 | ~120s | ~240s | ~360s |

**With GPU (CUDA):**
- YOLO processing: 5-10x faster
- BAv4: No GPU support (CPU only)

**Optimization Tips:**
- Process shorter clips for faster results
- Increase subsample rate (e.g., 10) for 2x speedup
- Disable YOLO if only interested in organism counts
- Use Modal.com for GPU processing of large batches

---

## Getting Help

**System Setup Issues:**
1. Use the built-in System Setup Checker in the UI
2. Follow auto-fix suggestions
3. Read detailed setup instructions for each component

**Processing Errors:**
1. Check processing logs (`processing-{run-id}.log`)
2. Verify all requirements are met
3. Try processing a shorter clip (10-15 seconds)
4. Review error messages in UI

**Contact:**
- Administrator: For trained YOLO model access
- GitHub Issues: Report bugs or request features

---

## Next Steps After Setup

Once setup is complete:

1. **Upload test video** - Try a short (~30 second) clip first
2. **Run prescreening** - Get quick quality assessment
3. **Start processing** - Run full analysis pipeline
4. **Review results** - Check annotated videos and JSON data
5. **Adjust parameters** - Fine-tune based on results
6. **Process batch** - Scale up to multiple videos

**Recommended First Test:**
- Duration: 15-30 seconds
- Resolution: 1920x1080
- Content: Clear organism activity
- Expected time: 1-2 minutes

---

## Summary

The local processing pipeline is fully implemented and includes:

✅ **Background subtraction** - Isolates moving objects
✅ **Benthic Activity Detection V4** - Tracks organisms with advanced algorithms
✅ **YOLO Detection** - Classifies organisms (optional)
✅ **Database integration** - Automatic status updates
✅ **System setup checker** - Guides users through requirements
✅ **Comprehensive error handling** - Clear error messages and recovery

**System automatically checks for:**
- Python installation
- Required Python packages
- Directory structure
- YOLO models (optional)
- FFmpeg (optional)

**Issues are caught early via UI:**
- Pre-processing system check
- Auto-fix for directories
- Detailed setup instructions for dependencies
- Real-time processing logs

Your colleague can now sign in, navigate to Motion Analysis, and the system will guide them through any missing requirements before allowing processing to start.
