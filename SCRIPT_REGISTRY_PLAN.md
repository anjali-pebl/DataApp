# Script Registry Plan

**Date:** November 28, 2025
**Status:** Planned (Not Yet Implemented)

## Overview

This document outlines a plan to make the motion analysis processing system modular and extensible. The goal is to enable a "building blocks" approach where new CV/ML scripts can be easily added without modifying core application code.

## Current Architecture

### Existing Scripts

| Script | Location | Input Type | Has Settings Dialog |
|--------|----------|------------|---------------------|
| `background_subtraction.py` | cv_scripts/ | raw | No (always runs) |
| `benthic_activity_detection_v4.py` | cv_scripts/ | bg_subtracted | **Yes** (12 params) |
| `benthic_activity_detection_v5.py` | cv_scripts/ | raw (unified) | No |
| `motion_analysis.py` | cv_scripts/ | bg_subtracted | No |
| `video_prescreen.py` | cv_scripts/ | raw | No |
| `process_videos_yolov8.py` | root/ | raw | No (model selection only) |

### Current Limitations

1. **Hardcoded Analysis Types**: Scripts are defined in 3 places:
   - `ProcessingEstimationModal.tsx` (checkbox UI)
   - `batch_process_videos.py` (run_* functions)
   - `start/route.ts` (default settings)

2. **Fixed Execution Order**: Background sub → BAv4/Motion → YOLO

3. **No Plugin Registry**: Adding a new script requires modifying multiple files

## Proposed Solution

### 1. Script Registry File

Create `cv_scripts/scripts.json`:

```json
{
  "scripts": [
    {
      "id": "benthic-activity-v4",
      "name": "Benthic Activity V4",
      "file": "benthic_activity_detection_v4.py",
      "inputType": "background_subtracted",
      "category": "organism_detection",
      "hasSettingsDialog": true,
      "settingsDialogComponent": "BenthicActivitySettingsDialog",
      "enabled": true,
      "order": 10
    },
    {
      "id": "benthic-activity-v5",
      "name": "Benthic Activity V5 (Unified)",
      "file": "benthic_activity_detection_v5.py",
      "inputType": "raw",
      "category": "organism_detection",
      "hasSettingsDialog": false,
      "enabled": false,
      "order": 11
    },
    {
      "id": "yolo-detection",
      "name": "YOLO Detection",
      "file": "../process_videos_yolov8.py",
      "inputType": "raw",
      "category": "ai_detection",
      "hasSettingsDialog": false,
      "yoloModelOptions": ["yolov8n", "yolov8m", "yolov8l"],
      "enabled": true,
      "order": 20
    },
    {
      "id": "motion-analysis",
      "name": "Motion Analysis (Legacy)",
      "file": "motion_analysis.py",
      "inputType": "background_subtracted",
      "category": "motion",
      "hasSettingsDialog": false,
      "enabled": false,
      "order": 30
    },
    {
      "id": "video-prescreen",
      "name": "Video Prescreen",
      "file": "video_prescreen.py",
      "inputType": "raw",
      "category": "quality",
      "hasSettingsDialog": false,
      "enabled": false,
      "order": 5
    }
  ],
  "preprocessing": {
    "background_subtraction": {
      "file": "background_subtraction.py",
      "required_by": ["benthic-activity-v4", "motion-analysis"]
    }
  }
}
```

### 2. API Endpoint

Create `src/app/api/motion-analysis/scripts/route.ts`:
- GET → Returns scripts.json contents
- Frontend reads this to generate checkboxes dynamically

### 3. Frontend Changes

Update `ProcessingEstimationModal.tsx`:
- Fetch scripts from `/api/motion-analysis/scripts` on mount
- Generate checkboxes dynamically from registry
- Send `enabledScripts: ["benthic-activity-v4", "yolo-detection"]` to API

### 4. Python Changes

Update `batch_process_videos.py`:
- Read `scripts.json` registry
- Run enabled scripts in order
- Auto-run background subtraction when needed

## Script Interface Contract

Each script must follow this interface:

```
CLI Arguments:
  --input <video_path>     Required: Input video file
  --output <output_dir>    Required: Output directory

Output:
  JSON file at: <output_dir>/<video_name>_<script_id>.json

Exit Codes:
  0 = success
  non-zero = failure
```

## Adding a New Script (Workflow)

```
1. Create cv_scripts/my_detector.py
   - Accept: --input <video> --output <dir>
   - Output: JSON results file

2. Add entry to cv_scripts/scripts.json:
   {
     "id": "my-detector",
     "name": "My Detector",
     "file": "my_detector.py",
     "inputType": "raw",
     "hasSettingsDialog": false,
     "enabled": true,
     "order": 15
   }

3. Restart app → Checkbox appears automatically
```

## Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `cv_scripts/scripts.json` | CREATE | Script registry |
| `src/app/api/motion-analysis/scripts/route.ts` | CREATE | API to read registry |
| `ProcessingEstimationModal.tsx` | UPDATE | Dynamic checkboxes |
| `batch_process_videos.py` | UPDATE | Read registry, run scripts |

## What Stays the Same

- `BenthicActivitySettingsDialog.tsx` - Keep as-is (manual dialog for BAv4)
- Background subtraction logic - Auto-runs when needed
- YOLO model selection dropdown - Keep existing UI
- All existing scripts - No changes needed
- Current experiment tracking in `processing_runs` table

## Implementation Priority

1. **Phase 1**: Create registry file and API endpoint
2. **Phase 2**: Update frontend to read from registry
3. **Phase 3**: Update Python to use registry
4. **Phase 4**: Add any new scripts using the new system

## Design Decisions

1. **Why JSON registry?** Simple, human-readable, easy to edit
2. **Why keep manual settings dialogs?** Complex UIs are hard to auto-generate; keep them manual for now
3. **Why order field?** Allows control over execution order without complex dependency graphs
4. **Why inputType field?** Determines if background subtraction is needed as preprocessing

## Future Enhancements (Not in Initial Scope)

- Auto-generate parameter dialogs from script metadata
- Drag-and-drop pipeline builder UI
- Script versioning and compatibility checking
- Parallel execution of independent scripts
- Script dependency graphs beyond simple preprocessing
