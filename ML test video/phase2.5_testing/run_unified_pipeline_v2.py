"""
Run Unified Pipeline V2 - Fixed Motion Detection

Uses pre-computed V4 background-subtracted videos for motion detection
instead of on-the-fly MOG2 (which produces too much noise).

For each clip:
1. RT-DETR only tracking
2. V5 motion only tracking (uses V4 background-subtracted video)
3. Unified V2 tracking (RT-DETR on original + V5 detection on V4 video)
4. Side-by-side comparison videos

Author: Claude Code
Date: 2025-12-02
"""

import cv2
import numpy as np
from pathlib import Path
import json
from datetime import datetime

# Import trackers
from unified_tracker_v2 import process_unified_v2, SOURCE_COLORS, DetectionSource
from robust_tracker_v5 import (
    process_video_robust,
    DetectionParams,
    MergeParams,
    RobustTrackingParams
)


def run_rtdetr_only(
    original_video_path: Path,
    output_dir: Path,
    rtdetr_model_path: Path
) -> dict:
    """Run RT-DETR only tracking (no motion detection)."""
    print(f"\n{'='*60}")
    print("RT-DETR ONLY TRACKING")
    print(f"{'='*60}")

    from ultralytics import RTDETR
    import cv2

    start_time = datetime.now()
    output_dir.mkdir(parents=True, exist_ok=True)

    # Load model
    model = RTDETR(str(rtdetr_model_path))

    # Open video
    cap = cv2.VideoCapture(str(original_video_path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Output video
    output_video_path = output_dir / f"{original_video_path.stem}_rtdetr_only.avi"
    fourcc = cv2.VideoWriter_fourcc(*'MJPG')
    writer = cv2.VideoWriter(str(output_video_path), fourcc, fps, (width, height))

    # Simple tracking with DeepSORT-like approach
    from collections import defaultdict
    tracks = defaultdict(list)  # track_id -> list of (frame, bbox, centroid)
    next_track_id = 1

    # Simple tracker state
    active_tracks = {}  # track_id -> last_centroid

    frame_idx = 0
    total_detections = 0

    print(f"Processing {total_frames} frames...")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Run RT-DETR
        results = model.predict(frame, conf=0.4, verbose=False)

        detections = []
        if results and len(results) > 0:
            result = results[0]
            boxes = result.boxes

            for i in range(len(boxes)):
                xyxy = boxes.xyxy[i].cpu().numpy()
                conf = boxes.conf[i].cpu().item()
                cls = int(boxes.cls[i].cpu().item())

                x1, y1, x2, y2 = xyxy
                cx, cy = (x1 + x2) / 2, (y1 + y2) / 2

                detections.append({
                    'bbox': (int(x1), int(y1), int(x2-x1), int(y2-y1)),
                    'centroid': (cx, cy),
                    'conf': conf,
                    'class': result.names[cls] if cls in result.names else f"class_{cls}"
                })

        total_detections += len(detections)

        # Simple greedy tracking
        used_detections = set()
        for tid, last_pos in list(active_tracks.items()):
            best_det_idx = None
            best_dist = 100  # Max distance

            for i, det in enumerate(detections):
                if i in used_detections:
                    continue
                dist = np.sqrt((det['centroid'][0] - last_pos[0])**2 +
                              (det['centroid'][1] - last_pos[1])**2)
                if dist < best_dist:
                    best_dist = dist
                    best_det_idx = i

            if best_det_idx is not None:
                det = detections[best_det_idx]
                tracks[tid].append((frame_idx, det['bbox'], det['centroid']))
                active_tracks[tid] = det['centroid']
                used_detections.add(best_det_idx)
            else:
                # Lost track - keep for a few frames
                if frame_idx - tracks[tid][-1][0] > 30:  # Lost for >30 frames
                    del active_tracks[tid]

        # Create new tracks for unmatched detections
        for i, det in enumerate(detections):
            if i not in used_detections:
                tracks[next_track_id].append((frame_idx, det['bbox'], det['centroid']))
                active_tracks[next_track_id] = det['centroid']
                next_track_id += 1

        # Draw
        annotated = frame.copy()
        for tid, track_data in tracks.items():
            if len(track_data) < 2:
                continue

            # Draw trail
            for i in range(1, len(track_data)):
                pt1 = (int(track_data[i-1][2][0]), int(track_data[i-1][2][1]))
                pt2 = (int(track_data[i][2][0]), int(track_data[i][2][1]))
                cv2.line(annotated, pt1, pt2, (0, 165, 255), 2)  # Orange

            # Draw current position if active
            if tid in active_tracks and track_data[-1][0] == frame_idx:
                x, y, w, h = track_data[-1][1]
                cv2.rectangle(annotated, (x, y), (x+w, y+h), (0, 165, 255), 2)
                cv2.putText(annotated, f"ID:{tid}", (x, y-5),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 165, 255), 1)

        # Info overlay
        cv2.putText(annotated, f"RT-DETR Only | Frame {frame_idx} | Tracks: {len(active_tracks)}",
                   (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

        writer.write(annotated)
        frame_idx += 1

        if frame_idx % 100 == 0:
            print(f"  Frame {frame_idx}/{total_frames}")

    cap.release()
    writer.release()

    # Count valid tracks (>5 frames)
    valid_tracks = [tid for tid, data in tracks.items() if len(data) >= 5]

    duration = (datetime.now() - start_time).total_seconds()

    print(f"\nRT-DETR Only Results:")
    print(f"  Total detections: {total_detections}")
    print(f"  Valid tracks: {len(valid_tracks)}")
    print(f"  Processing time: {duration:.1f}s")

    return {
        'method': 'rtdetr_only',
        'video': str(output_video_path),
        'total_detections': total_detections,
        'valid_tracks': len(valid_tracks),
        'processing_time': duration
    }


def create_sidebyside_video(
    left_video: Path,
    right_video: Path,
    output_path: Path,
    label_left: str = "Left",
    label_right: str = "Right"
):
    """Create side-by-side comparison video."""
    print(f"Creating side-by-side: {output_path.name}")

    cap_left = cv2.VideoCapture(str(left_video))
    cap_right = cv2.VideoCapture(str(right_video))

    fps = cap_left.get(cv2.CAP_PROP_FPS)
    left_w = int(cap_left.get(cv2.CAP_PROP_FRAME_WIDTH))
    left_h = int(cap_left.get(cv2.CAP_PROP_FRAME_HEIGHT))
    right_w = int(cap_right.get(cv2.CAP_PROP_FRAME_WIDTH))
    right_h = int(cap_right.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Scale to same height
    target_h = min(left_h, right_h)
    left_scale = target_h / left_h
    right_scale = target_h / right_h
    scaled_left_w = int(left_w * left_scale)
    scaled_right_w = int(right_w * right_scale)

    combined_w = scaled_left_w + scaled_right_w

    fourcc = cv2.VideoWriter_fourcc(*'MJPG')
    writer = cv2.VideoWriter(str(output_path), fourcc, fps, (combined_w, target_h))

    frame_count = 0
    while True:
        ret_l, frame_l = cap_left.read()
        ret_r, frame_r = cap_right.read()

        if not ret_l or not ret_r:
            break

        # Resize
        frame_l = cv2.resize(frame_l, (scaled_left_w, target_h))
        frame_r = cv2.resize(frame_r, (scaled_right_w, target_h))

        # Combine
        combined = np.hstack([frame_l, frame_r])

        # Labels
        cv2.rectangle(combined, (5, 5), (200, 35), (0, 0, 0), -1)
        cv2.rectangle(combined, (scaled_left_w + 5, 5), (scaled_left_w + 200, 35), (0, 0, 0), -1)
        cv2.putText(combined, label_left, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        cv2.putText(combined, label_right, (scaled_left_w + 10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

        writer.write(combined)
        frame_count += 1

    cap_left.release()
    cap_right.release()
    writer.release()

    print(f"  Created {frame_count} frames")


def process_clip(clip_name: str, base_dir: Path, output_base: Path, rtdetr_model: Path):
    """Process a single clip with all methods and create comparisons."""
    print(f"\n{'='*80}")
    print(f"PROCESSING {clip_name.upper()}")
    print(f"{'='*80}")

    # Find files
    original_video = base_dir / f"{clip_name}.mp4"
    if not original_video.exists():
        original_video = base_dir / f"{clip_name}.avi"

    # V4 background-subtracted video
    v4_output_dir = base_dir / "phase2.5_testing" / "outputs_v4" / clip_name
    motion_video = v4_output_dir / f"{clip_name}_background_subtracted.mp4"

    if not original_video.exists():
        print(f"  [SKIP] Original video not found: {original_video}")
        return None

    if not motion_video.exists():
        print(f"  [SKIP] V4 motion video not found: {motion_video}")
        print(f"  Run V4 first to generate background-subtracted video")
        return None

    output_dir = output_base / clip_name
    output_dir.mkdir(parents=True, exist_ok=True)

    results = {'clip': clip_name}

    # 1. RT-DETR only
    print(f"\n--- Step 1: RT-DETR Only ---")
    rtdetr_result = run_rtdetr_only(original_video, output_dir, rtdetr_model)
    results['rtdetr_only'] = rtdetr_result

    # 2. V5 Motion only (on V4 background-subtracted video)
    print(f"\n--- Step 2: V5 Motion Only ---")
    # Use SAME parameters as working comparison run (not the higher thresholds!)
    v5_params = DetectionParams(dark_threshold=10, bright_threshold=25, min_area=30, max_area=3000)
    merge_params = MergeParams(merge_radius=80.0, min_separation=10.0)
    tracking_params = RobustTrackingParams()

    v5_result = process_video_robust(motion_video, output_dir, v5_params, merge_params, tracking_params)
    results['v5_motion'] = {
        'method': 'v5_motion',
        'video': str(output_dir / f"{motion_video.stem}_robust_v5.avi"),
        'valid_tracks': v5_result.get('valid_track_count', 0),
        'processing_time': v5_result.get('processing_time_s', 0)
    }

    # 3. Unified V2 (RT-DETR + V5 on V4 video)
    print(f"\n--- Step 3: Unified V2 ---")
    unified_result = process_unified_v2(
        original_video,
        motion_video,
        output_dir,
        rtdetr_model
    )
    results['unified_v2'] = {
        'method': 'unified_v2',
        'video': str(output_dir / f"{motion_video.stem}_unified_v2.avi"),
        'valid_tracks': unified_result.get('valid_tracks', 0),
        'processing_time': unified_result.get('processing_time_s', 0)
    }

    # 4. Create side-by-side comparison videos
    print(f"\n--- Step 4: Side-by-Side Comparisons ---")

    # RT-DETR vs Unified V2
    rtdetr_video = Path(results['rtdetr_only']['video'])
    unified_video = Path(results['unified_v2']['video'])
    v5_video = Path(results['v5_motion']['video'])

    if rtdetr_video.exists() and unified_video.exists():
        sbs_rtdetr_unified = output_dir / f"{clip_name}_rtdetr_vs_unified_v2.avi"
        create_sidebyside_video(rtdetr_video, unified_video, sbs_rtdetr_unified,
                               "RT-DETR Only", "Unified V2")
        results['comparison_rtdetr_unified'] = str(sbs_rtdetr_unified)

    # V5 Motion vs Unified V2
    if v5_video.exists() and unified_video.exists():
        sbs_v5_unified = output_dir / f"{clip_name}_v5_vs_unified_v2.avi"
        create_sidebyside_video(v5_video, unified_video, sbs_v5_unified,
                               "V5 Motion Only", "Unified V2")
        results['comparison_v5_unified'] = str(sbs_v5_unified)

    # Save results
    results_path = output_dir / f"{clip_name}_comparison_results.json"
    with open(results_path, 'w') as f:
        json.dump(results, f, indent=2)

    print(f"\n--- {clip_name} Summary ---")
    print(f"  RT-DETR Only: {results['rtdetr_only'].get('valid_tracks', 0)} tracks")
    print(f"  V5 Motion Only: {results['v5_motion'].get('valid_tracks', 0)} tracks")
    print(f"  Unified V2: {results['unified_v2'].get('valid_tracks', 0)} tracks")

    return results


def main():
    """Run unified pipeline V2 on test clips."""
    print("="*80)
    print("UNIFIED PIPELINE V2 - Fixed Motion Detection")
    print("="*80)
    print("\nKey Fix: Uses pre-computed V4 background-subtracted videos")
    print("         instead of on-the-fly MOG2 subtraction")

    base_dir = Path(__file__).parent.parent  # ML test video folder
    output_base = Path(__file__).parent / "unified_comparison_v2"
    rtdetr_model = base_dir / "phase7_model_training" / "models" / "merged_brak_bruv_rtdetr-l_best.pt"

    test_clips = ['clip011', 'clip021', 'clip031', 'clip041']

    all_results = {}

    for clip_name in test_clips:
        result = process_clip(clip_name, base_dir, output_base, rtdetr_model)
        if result:
            all_results[clip_name] = result

    # Save summary
    summary_path = output_base / "comparison_summary_v2.json"
    with open(summary_path, 'w') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'clips': all_results
        }, f, indent=2)

    print("\n" + "="*80)
    print("UNIFIED PIPELINE V2 COMPLETE")
    print("="*80)
    print(f"\nResults saved to: {output_base}")

    # Print summary table
    print("\n" + "-"*60)
    print(f"{'Clip':<10} {'RT-DETR':<12} {'V5 Motion':<12} {'Unified V2':<12}")
    print("-"*60)
    for clip, data in all_results.items():
        rt = data.get('rtdetr_only', {}).get('valid_tracks', 'N/A')
        v5 = data.get('v5_motion', {}).get('valid_tracks', 'N/A')
        uni = data.get('unified_v2', {}).get('valid_tracks', 'N/A')
        print(f"{clip:<10} {rt:<12} {v5:<12} {uni:<12}")
    print("-"*60)


if __name__ == '__main__':
    main()
