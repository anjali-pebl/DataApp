# CLAUDE.md - ML Test Video Project

## PHASE 2 COMPLETE: BEST MODEL CONFIGURATION FOUND

**Status: COMPLETE - 2025-12-02**
**Winner: Merged Brackish+BRUV Dataset + RT-DETR Architecture**

### Phase 2 Summary: Model Progression

| Model | Dataset | Avg Track Duration | Improvement |
|-------|---------|-------------------|-------------|
| UK BRUV Only (YOLOv8s) | 3k images | 15.9 | Baseline |
| Brackish Only (YOLOv8s) | 11k images | 22.9 | +44% |
| **Merged Brak+BRUV (YOLOv8s)** | 15k images | 24.8 | +56% |
| **Merged Brak+BRUV (RT-DETR)** | 15k images | **27.3** | **+72%** |

### Phase 3 Recommended Configuration

**Use for Production:**
- **Dataset:** `merged_brak_bruv` (15,274 images = 11k Brackish + 2k UK BRUV)
- **Architecture:** RT-DETR-L (transformer-based detector)
- **Model File:** `phase7_model_training/models/merged_brak_bruv_rtdetr-l_best.pt` (125.9 MB)
- **Speed:** ~13 FPS (2.3x slower than YOLOv8s, but much better accuracy)

**Alternative for Real-Time:**
- **Model File:** `phase7_model_training/models/merged_brak_bruv_yolov8s_best.pt` (42.8 MB)
- **Speed:** ~30 FPS
- **Trade-off:** 10% lower track duration but 2.3x faster

### Key Phase 2 Insights

1. **Dataset diversity matters:** Merging Brackish + UK BRUV improved over Brackish-only (+8%)
2. **Architecture matters:** RT-DETR outperforms YOLOv8s (+10% track duration, 4x more detections)
3. **Track duration is the key metric:** Longer tracks = more reliable organism identification
4. **Original video is best:** No preprocessing needed

---

## PHASE 2.5: BACKGROUND SUBTRACTION MOTION DETECTION

**Status: COMPLETE - 2025-12-02**
**Purpose:** Detect slow-moving organisms missed by RT-DETR
**Full Report:** See `PHASE_2.5_PROJECT_REPORT.md`

### Phase 2.5 Results Summary

| Clip | RT-DETR Only | V5 Motion Only | Unified V2 | Improvement |
|------|--------------|----------------|------------|-------------|
| clip011 | 22 tracks | 12 tracks | 17 tracks | Complementary |
| clip021 | 13 tracks | 18 tracks | 23 tracks | **+77%** |

**Key Achievement:** Unified V2 detected **77% more organisms** in clip021 vs RT-DETR alone!

### Architecture: Unified Tracker V2

```
Original Video (24 fps)
       │
       ├──► RT-DETR Model ──────────────────┐
       │    (appearance-based)              │
       │                                    ├──► Detection Fusion ──► Unified Tracks
V4 Background-Subtracted Video (8 fps)     │
       │                                    │
       └──► V5 Motion Detection ────────────┘
            (position-only tracking)
```

### Critical Detection Parameters

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `dark_threshold` | 10 | Deviation from 128 for shadows |
| `bright_threshold` | 25 | Deviation from 128 for reflections |
| `min_area` | 30 | Minimum blob area |
| `merge_radius` | 80.0 | Merge nearby blobs |

### Output Color Coding

| Color | Source | Meaning |
|-------|--------|---------|
| **Green** | FUSED | Both RT-DETR and motion detected |
| **Orange** | RT-DETR Only | Appearance-based detection |
| **Magenta** | Motion Only | Motion-based (crabs, slow movers) |

### Files Created

- `unified_tracker_v2.py` - Main unified tracker class
- `run_unified_pipeline_v2.py` - Batch processing pipeline
- `unified_comparison_v2/` - Output videos and results

---

## Pipeline Position

```
Phase 1: Pre-processing & marine snow filter     ✓ (skipped - not needed)
Phase 2: Detection, tracking, snapshot capture   ✓ COMPLETE
Phase 2.5: Background subtraction motion detect  ✓ COMPLETE
Phase 3: Motion & behavioural features           ← IN PROGRESS
Phase 4: Appearance features (DINO embeddings)
Phase 5: Context & expert priors
Phase 6: Active learning & human-in-the-loop
Phase 7: Model training & evaluation
Phase 8: Deployment & iteration
```

---

## PHASE 3: MOTION & BEHAVIORAL FEATURES

**Status: IN PROGRESS - 2025-12-02**
**Purpose:** Extract behavioral features from unified tracker output for species classification

### Phase 3 Components

| Module | File | Status | Description |
|--------|------|--------|-------------|
| Motion Metrics | `motion_feature_extractor.py` | ✓ COMPLETE | Speed, acceleration, direction analysis |
| Trajectory Classification | `motion_feature_extractor.py` | ✓ COMPLETE | Linear, meandering, stationary, darting |
| Behavioral Clustering | `behavioral_clustering.py` | ✓ COMPLETE | K-means clustering on 20-dim feature vectors |
| Pipeline Runner | `run_phase3_pipeline.py` | ✓ COMPLETE | Batch processing and visualization |

### Motion Metrics Extracted

| Metric | Description | Use Case |
|--------|-------------|----------|
| `mean_speed` | Average pixels/frame | Activity level |
| `max_speed` | Peak velocity | Burst detection |
| `straightness_index` | displacement/total_distance | Trajectory type |
| `direction_changes` | Significant turns (>45°) | Foraging behavior |
| `rest_count` | Number of rest periods | Activity patterns |
| `burst_count` | Speed burst events | Startle/escape detection |

### Trajectory Types

| Type | Characteristics | Typical Organism |
|------|-----------------|------------------|
| **STATIONARY** | speed < 1 px/frame | Shellfish, filter feeders |
| **LINEAR** | straightness > 0.7 | Fast-moving fish |
| **MEANDERING** | many direction changes | Foraging crabs |
| **DARTING** | burst-rest-burst | Startled fish |
| **CIRCULAR** | low straightness, regular | Patrolling behavior |

### Organism Inference

Based on motion patterns, the system infers organism type:

| Organism | Motion Pattern | Confidence |
|----------|---------------|------------|
| FISH_FAST | High speed, linear | 75% |
| FISH_SLOW | Moderate speed, varied | 60% |
| CRAB | Meandering, rest periods | 70% |
| SNAIL | Very slow, continuous | 65% |
| SHELLFISH | Stationary | 70% |

### Feature Vector (20 dimensions)

```
[0-4]  Speed features: mean, max, std, activity, burst_ratio
[5-9]  Trajectory: straightness, direction_changes, displacement_ratio, acceleration, regularity
[10-13] Rest: rest_count, rest_ratio, mean_rest_duration, activity_level
[14-17] Behavioral: exploration, regularity, foraging_indicator, organism_encoding
[18-19] Quality: total_frames, total_distance
```

### Output Files

| File | Description |
|------|-------------|
| `*_motion_features.json` | Complete feature extraction per track |
| `*_feature_matrix.npy` | NumPy matrix for ML clustering |
| `*_clusters.json` | Behavioral clustering results |
| `*_trajectories.png` | Trajectory visualization by type |
| `*_clusters.png` | Trajectory visualization by cluster |
| `*_phase3_report.md` | Detailed analysis report |

### Running Phase 3

```bash
cd "ML test video/phase3_motion_features"
python run_phase3_pipeline.py
```

### Integration with Phase 2.5

The unified tracker now exports position history in JSON format:
```json
{
  "tracks": {
    "1": {
      "positions": [{"x": 100.5, "y": 200.3, "frame": 0}, ...],
      "sources": ["RTDETR", "FUSED", "MOTION", ...],
      "primary_source": "FUSED"
    }
  }
}
```

---

## KEY FINDING: NO PREPROCESSING FOR DETECTION/TRACKING

**Status: CONFIRMED - 2025-12-01**
**Finding: ORIGINAL video (no preprocessing) produces BETTER tracking results than ph1_v2_hq**

### Why Original is Better
- Long, consistent track durations are what matter
- More detections/tracks ≠ better performance
- Preprocessing can introduce artifacts that confuse the detector
- Models were trained on original footage, so detection works best on original

### Quality Metric: Track Duration
**IMPORTANT:** When evaluating tracking performance, prioritize:
1. **Average track duration** (frames per track) - HIGHER is better
2. **Max track duration** - shows ability to maintain long tracks
3. Track count and detection count are secondary metrics

### Recommendation
- Use ORIGINAL videos for all future detection/tracking runs
- Skip ph1_v2_hq preprocessing in production pipelines
- Keep preprocessing code for reference only (documented below)

---

## DEPRECATED: ph1_v2_hq Preprocessing (Reference Only)

**Status: DEPRECATED - Use Original Instead**
**Verified: 2024-12-01**
**Source: `phase7_model_training/training_data/scripts/create_clip2_all.py` and `create_clip3.py`**

### The CORRECT ph1_v2_hq Preprocessing Pipeline

This preprocessing was verified by recreating `clip3_ph1_v2_hq.avi` and confirming it is **pixel-identical** to the original.

```python
import cv2
import numpy as np

# Initialize CLAHE (MUST use these exact parameters)
clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

def gentle_white_balance(img, strength=0.3):
    """
    White balance for underwater footage with dead red channel.

    CRITICAL: Only applies when avg_r < 10 (underwater footage)
    - Balances B and G channels ONLY (not red)
    - Adds +10 to red channel to reduce cyan look
    """
    result = img.astype(np.float32)
    avg_b = np.mean(result[:, :, 0])
    avg_g = np.mean(result[:, :, 1])
    avg_r = np.mean(result[:, :, 2])

    if avg_r < 10:  # Red channel essentially dead (underwater)
        avg_bg = (avg_b + avg_g) / 2
        scale_b = 1 + strength * (avg_bg / avg_b - 1)
        scale_g = 1 + strength * (avg_bg / avg_g - 1)
        result[:, :, 0] = np.clip(result[:, :, 0] * scale_b, 0, 255)
        result[:, :, 1] = np.clip(result[:, :, 1] * scale_g, 0, 255)
        result[:, :, 2] = np.clip(result[:, :, 2] + 10, 0, 255)  # Add +10 to red

    return result.astype(np.uint8)

def apply_clahe_lab(img):
    """Apply CLAHE to L channel in LAB color space."""
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l_clahe = clahe.apply(l)
    return cv2.cvtColor(cv2.merge([l_clahe, a, b]), cv2.COLOR_LAB2BGR)

def process_v2_hq(frame):
    """
    The COMPLETE ph1_v2_hq preprocessing pipeline.

    Step 1: gentle_white_balance (strength=0.3)
    Step 2: CLAHE on LAB L channel
    """
    result = gentle_white_balance(frame)
    result = apply_clahe_lab(result)
    return result
```

### Key Parameters (DO NOT CHANGE)

| Parameter | Value | Notes |
|-----------|-------|-------|
| `strength` | 0.3 | White balance strength |
| `avg_r < 10` | threshold | Only apply when red channel is dead |
| `+10 to red` | fixed | Reduces cyan look |
| `clipLimit` | 2.0 | CLAHE clip limit |
| `tileGridSize` | (8, 8) | CLAHE tile size |

### WRONG Preprocessing (DO NOT USE)

The following formulas are INCORRECT and will produce wrong results:

```python
# WRONG - DO NOT USE (strength=0.5 or 0.6)
strength = 0.5  # WRONG! Should be 0.3

# WRONG - DO NOT USE (balances all 3 channels)
result[:, :, c] = np.clip(result[:, :, c] * (1 + strength * (avg_gray - avg_c) / max(avg_c, 1)), 0, 255)

# WRONG - DO NOT USE (no underwater check)
# Missing the `if avg_r < 10:` condition
```

### Expected Results After Processing

For underwater footage with dead red channel:
- **Original:** R=0.0, G=~175, B=~115
- **After ph1_v2_hq:** R=~9-10, G=~165, B=~125 (balanced)

### Reference Files

- Original script: `phase7_model_training/training_data/scripts/create_clip2_all.py`
- Original script: `phase7_model_training/training_data/scripts/create_clip3.py`
- Processing script: `phase1_preprocessing/process_clips_ph1_v2_hq.py`
- Verified output: `phase1_preprocessing/tests/clip3_ph1_v2_hq.avi` (50.94 MB, 480 frames)

### Video Output Settings

When saving preprocessed videos, use:
- Codec: MJPG (`cv2.VideoWriter_fourcc(*'MJPG')`)
- Extension: `.avi`
- This preserves quality without lossy compression artifacts

---

## Project Structure

```
ML test video/
├── source_videos/           # Original source videos (SUBCAM_ALG_*.mp4)
├── clip0XX.mp4              # Extracted clips (original)
├── phase1_preprocessing/
│   ├── tests/               # Preprocessed outputs (*_ph1_v2_hq.avi)
│   └── process_clips_ph1_v2_hq.py
├── phase2_detection_tracking/
├── phase7_model_training/
│   ├── models/              # Trained YOLO models
│   └── training_data/scripts/  # Original preprocessing scripts
└── scripts/                 # Processing and tracking scripts
```

## Models

### Best Models (Phase 2 Winners)

| Model | File | Size | Use Case |
|-------|------|------|----------|
| **RT-DETR (Best Quality)** | `merged_brak_bruv_rtdetr-l_best.pt` | 125.9 MB | Production quality, ~13 FPS |
| **YOLOv8s (Fast)** | `merged_brak_bruv_yolov8s_best.pt` | 42.8 MB | Real-time, ~30 FPS |

**Location:** `phase7_model_training/models/`
**Confidence threshold:** 0.4

### Legacy Models (Superseded)

- `uk_bruv_only_v1_yolov8s_best.pt` - 3k UK BRUV images only
- `Y12_11kL_12k(brackish)_E100_Augmented_best.pt` - 11k Brackish images only

## Tracking

- Tracker: DeepSORT
- Parameters: `max_age=5, n_init=1, max_cosine_distance=0.3, nn_budget=100`

### Phase 2 Results Dashboard

**Dashboard:** `phase2_detection_tracking/tracking_results_dashboard.html`

Open this HTML file in a browser to view:
- Performance progression chart (UK BRUV → Brackish → Merged YOLOv8s → Merged RT-DETR)
- Model comparison cards with all metrics
- Per-clip detailed comparisons across all 4 model configurations
- Phase 3 recommendations

### Results JSON Files

- **Original comparison:** `tracking_traces/multi_model_tracking_results.json` (UK BRUV vs Brackish)
- **Merged models:** `tracking_traces/merged_brak_bruv/tracking_comparison_results.json` (YOLOv8s vs RT-DETR)

### Track Duration Metrics

The Modal tracking script calculates and stores:
- `avg_track_duration`: Average frames per track (HIGHER = BETTER)
- `max_track_duration`: Longest single track in frames
- `track_durations`: Array of all individual track lengths

**To run tracking with merged models:**
```bash
modal run scripts/modal_tracking_merged_models.py
```

**To run tracking with original models (UK BRUV vs Brackish):**
```bash
modal run scripts/modal_tracking_parallel.py
```
