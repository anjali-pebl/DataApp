"""
YOLOv8 Video Processing for Motion Analysis Dashboard

Processes videos in public/videos with the trained underwater YOLOv8 model.
Generates:
1. Bounding box videos (*_yolov8.mp4) - Videos with detection boxes drawn (H.264 for browser)
2. Detection JSON files (*_yolov8.json) - Frame-by-frame detection data for timeline

Usage:
    python process_videos_yolov8.py                    # Process all videos
    python process_videos_yolov8.py --input video.mp4  # Process specific video
"""

import os
# Suppress OpenCV/FFmpeg codec warnings (e.g., OpenH264 library errors)
# Must be set BEFORE importing cv2
os.environ['OPENCV_LOG_LEVEL'] = 'ERROR'
os.environ['OPENCV_FFMPEG_LOGLEVEL'] = '-8'  # AV_LOG_QUIET

import sys
import json
import cv2
import argparse
import shutil
import subprocess
from pathlib import Path
from ultralytics import YOLO
import numpy as np
from typing import List, Dict, Any, Optional

# Suppress OpenCV logging at runtime
cv2.setLogLevel(0)

# Configuration
TRAINED_MODEL_PATH = "Labeled_Datasets/05_Models/Y12_11kL_12k(brackish)_E100_Augmented_best.pt"
INPUT_DIR = "public/videos"
OUTPUT_DIR = "public/videos"  # Save in same directory
DETECTION_DATA_DIR = "public/motion-analysis-results"  # Save detection JSON with motion analysis data

# Only process original videos (not background_subtracted or yolov8)
def is_original_video(filename: str) -> bool:
    """Check if this is an original video file (not processed)."""
    return (filename.endswith(".mp4") and
            "_background_subtracted" not in filename and
            "_yolov8" not in filename)


def get_video_writer(output_path: str, fps: float, width: int, height: int):
    """
    Create VideoWriter with optimal codec selection (skip OpenH264 to avoid warnings).
    Returns (writer, codec_name) tuple.

    Args:
        output_path: Path to output video file
        fps: Frames per second
        width: Frame width
        height: Frame height

    Returns:
        Tuple of (VideoWriter, codec_name) or (None, None) if all codecs fail
    """
    import platform

    # Platform-specific optimal codecs (skip libopenh264 which causes warnings)
    if platform.system() == 'Windows':
        codecs_to_try = ['avc1', 'H264', 'mp4v', 'XVID']
    else:
        codecs_to_try = ['avc1', 'mp4v', 'XVID', 'MJPG']

    for codec_name in codecs_to_try:
        try:
            fourcc = cv2.VideoWriter_fourcc(*codec_name)
            writer = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
            if writer.isOpened():
                return writer, codec_name
            writer.release()
        except Exception:
            continue

    return None, None


def check_ffmpeg() -> bool:
    """Check if FFmpeg is available on the system."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True,
            text=True,
            timeout=10
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def reencode_to_h264(input_path: str, output_path: Optional[str] = None) -> bool:
    """
    Re-encode video to H.264 codec for browser compatibility using FFmpeg.

    Args:
        input_path: Path to input video (mp4v codec)
        output_path: Path for output video (H.264). If None, replaces input.

    Returns:
        True if successful, False otherwise
    """
    if output_path is None:
        # Create temp output, then replace original
        temp_output = input_path.replace('.mp4', '_h264_temp.mp4')
        replace_original = True
    else:
        temp_output = output_path
        replace_original = False

    cmd = [
        "ffmpeg",
        "-i", input_path,
        "-c:v", "libx264",      # H.264 codec (browser compatible)
        "-preset", "fast",       # Encoding speed (fast = good balance)
        "-crf", "23",            # Quality (18-28, lower = better)
        "-pix_fmt", "yuv420p",   # Pixel format for maximum compatibility
        "-c:a", "copy",          # Copy audio if present
        "-y",                    # Overwrite output
        "-loglevel", "error",    # Only show errors
        temp_output
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)

        if result.returncode == 0 and os.path.exists(temp_output):
            if os.path.getsize(temp_output) > 0:
                if replace_original:
                    # Replace original with H.264 version
                    os.remove(input_path)
                    shutil.move(temp_output, input_path)
                return True
            else:
                # Output is empty, cleanup
                if os.path.exists(temp_output):
                    os.remove(temp_output)
                return False
        else:
            if os.path.exists(temp_output):
                os.remove(temp_output)
            return False

    except (subprocess.TimeoutExpired, Exception) as e:
        print(f"    [WARNING] FFmpeg error: {e}")
        if os.path.exists(temp_output):
            os.remove(temp_output)
        return False


def load_model(model_path: str = None):
    """Load the trained YOLOv8 model."""
    if model_path is None:
        model_path = TRAINED_MODEL_PATH

    print(f"Loading YOLOv8 model: {model_path}")
    model = YOLO(model_path)
    print(f"Model loaded! Classes: {model.names}")
    return model


def estimate_processing_time(total_frames: int, fps: float) -> str:
    """Estimate processing time based on typical YOLOv8 performance."""
    # Typical processing: ~10-20 frames/second on GPU, ~2-5 frames/second on CPU
    # We'll assume ~5 fps as conservative estimate
    estimated_fps = 5.0
    estimated_seconds = total_frames / estimated_fps

    if estimated_seconds < 60:
        return f"~{int(estimated_seconds)} seconds"
    elif estimated_seconds < 3600:
        mins = int(estimated_seconds / 60)
        secs = int(estimated_seconds % 60)
        return f"~{mins}m {secs}s"
    else:
        hours = int(estimated_seconds / 3600)
        mins = int((estimated_seconds % 3600) / 60)
        return f"~{hours}h {mins}m"


def process_video(model: YOLO, video_path: str, output_video_path: str, output_json_path: str):
    """
    Process a video with YOLOv8 and generate bounding box video + detection data.

    Args:
        model: Trained YOLO model
        video_path: Path to input video
        output_video_path: Path for output video with bounding boxes
        output_json_path: Path for JSON detection data
    """
    import time
    start_time = time.time()

    print(f"\nProcessing: {os.path.basename(video_path)}", flush=True)

    # Open video
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"  [ERROR] Could not open video {video_path}", flush=True)
        return

    # Get video properties
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if fps > 0 else 0

    estimated_time = estimate_processing_time(total_frames, fps)
    print(f"  Video: {width}x{height} @ {fps:.2f} fps, {total_frames} frames, {duration:.1f}s", flush=True)
    print(f"  Estimated processing time: {estimated_time}", flush=True)

    # Create video writer for bounding box video with codec fallback
    out, successful_codec = get_video_writer(output_video_path, fps, width, height)

    if out is None or not out.isOpened():
        print(f"  [ERROR] Could not create output video writer with any codec", flush=True)
        cap.release()
        return

    print(f"  [OK] Using codec: {successful_codec}", flush=True)

    # Detection data structure
    detection_data = {
        "video_filename": os.path.basename(video_path),
        "model": os.path.basename(TRAINED_MODEL_PATH),
        "fps": fps,
        "resolution": {"width": width, "height": height},
        "total_frames": total_frames,
        "duration_seconds": duration,
        "detections": []  # List of frame-level detections
    }

    frame_idx = 0
    detections_count = 0

    print(f"  Processing frames...")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Run YOLOv8 detection
        results = model(frame, verbose=False)[0]

        # Extract detection data for this frame
        frame_detections = []

        if len(results.boxes) > 0:
            for box in results.boxes:
                # Get bounding box coordinates
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                confidence = float(box.conf[0])
                class_id = int(box.cls[0])
                class_name = model.names[class_id]

                # Store detection data
                frame_detections.append({
                    "class_id": class_id,
                    "class_name": class_name,
                    "confidence": confidence,
                    "bbox": {
                        "x1": x1,
                        "y1": y1,
                        "x2": x2,
                        "y2": y2
                    }
                })

                detections_count += 1

                # Draw bounding box on frame
                color = (0, 255, 0)  # Green
                thickness = 2
                cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), color, thickness)

                # Draw label
                label = f"{class_name} {confidence:.2f}"
                label_size, _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                label_y = int(y1) - 10 if y1 - 10 > label_size[1] else int(y1) + label_size[1] + 10

                cv2.rectangle(frame, (int(x1), label_y - label_size[1] - 5),
                            (int(x1) + label_size[0], label_y + 5), color, -1)
                cv2.putText(frame, label, (int(x1), label_y),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)

        # Add frame detection data (even if empty)
        detection_data["detections"].append({
            "frame": frame_idx,
            "timestamp": frame_idx / fps if fps > 0 else 0,
            "count": len(frame_detections),
            "objects": frame_detections
        })

        # Write frame to output video
        out.write(frame)

        frame_idx += 1

        # Progress indicator with elapsed time
        if frame_idx % 100 == 0:
            progress = (frame_idx / total_frames) * 100
            elapsed = time.time() - start_time
            fps_actual = frame_idx / elapsed if elapsed > 0 else 0
            remaining = (total_frames - frame_idx) / fps_actual if fps_actual > 0 else 0
            print(f"    Progress: {progress:.1f}% ({frame_idx}/{total_frames}) - {fps_actual:.1f} fps - ETA: {remaining:.0f}s", flush=True)

    elapsed_total = time.time() - start_time
    print(f"    Progress: 100.0% ({total_frames}/{total_frames} frames) - Done in {elapsed_total:.1f}s", flush=True)

    # Release resources
    cap.release()
    out.release()

    # Verify output video before re-encoding
    print(f"\n  [VERIFY] Verifying output video before re-encoding...", flush=True)
    cap_verify = cv2.VideoCapture(output_video_path)
    if cap_verify.isOpened():
        output_frames_written = int(cap_verify.get(cv2.CAP_PROP_FRAME_COUNT))
        output_fps_actual = cap_verify.get(cv2.CAP_PROP_FPS)
        output_duration_written = output_frames_written / output_fps_actual if output_fps_actual > 0 else 0

        cap_verify.release()

        print(f"    Input: {total_frames} frames, {duration:.1f}s @ {fps:.2f} fps", flush=True)
        print(f"    Output (before H.264): {output_frames_written} frames, {output_duration_written:.1f}s @ {output_fps_actual:.2f} fps", flush=True)

        frame_diff = abs(total_frames - output_frames_written)
        duration_diff = abs(duration - output_duration_written)

        if frame_diff > 5:  # Allow 5 frames tolerance
            print(f"  [WARNING] Frame count mismatch: input={total_frames}, output={output_frames_written} (diff={frame_diff})", flush=True)
            print(f"      This may indicate incomplete processing!", flush=True)
        elif duration_diff > 2.0:  # Allow 2 second tolerance
            print(f"  [WARNING] Duration mismatch: input={duration:.1f}s, output={output_duration_written:.1f}s (diff={duration_diff:.1f}s)", flush=True)
            print(f"      This may cause playback issues in the modal.", flush=True)
        else:
            print(f"  [OK] Output verified: frame count and duration match within tolerance", flush=True)
    else:
        print(f"  [ERROR] Could not verify output video!", flush=True)
        print(f"      Output video may be corrupted or incomplete", flush=True)

    # Note: FFmpeg re-encoding is no longer needed - we use avc1 codec directly
    # If avc1 worked, the video is already H.264 browser-compatible
    if successful_codec == 'avc1':
        print(f"  [OK] Video saved with H.264 codec - ready for browser playback", flush=True)
    elif successful_codec in ['mp4v', 'MJPG', 'XVID']:
        print(f"  [WARNING] Video saved with {successful_codec} codec - may not play in some browsers", flush=True)

    # Save detection JSON
    with open(output_json_path, 'w') as f:
        json.dump(detection_data, f, indent=2)

    print(f"  [OK] Complete! {detections_count} detections across {total_frames} frames (took {elapsed_total:.1f}s)", flush=True)
    print(f"  Bounding box video: {output_video_path}", flush=True)
    print(f"  Detection data: {output_json_path}", flush=True)


def main():
    """Process videos with YOLOv8."""
    parser = argparse.ArgumentParser(description='Process videos with YOLOv8 for motion analysis dashboard')
    parser.add_argument('--input', '-i', type=str, help='Specific video filename to process (e.g., video.mp4)')
    parser.add_argument('--all', '-a', action='store_true', help='Process all videos in directory')
    parser.add_argument('--model', '-m', type=str, default=TRAINED_MODEL_PATH, help='Path to YOLO model (.pt file)')
    parser.add_argument('--no-reencode', action='store_true', help='Skip H.264 re-encoding (keep mp4v codec)')
    args = parser.parse_args()

    # Force unbuffered output for real-time logging
    sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, 'reconfigure') else None

    print("="*80)
    print("YOLOv8 Video Processing for Motion Analysis Dashboard")
    print("="*80)
    print(flush=True)

    # Note: FFmpeg is no longer required - we use OpenCV's avc1 codec directly for H.264 output
    # This provides browser-compatible videos without external dependencies
    has_ffmpeg = check_ffmpeg()  # Keep for potential future use
    print("[INFO] Using OpenCV avc1 codec for H.264 output (browser-compatible)")
    print(flush=True)

    # Load model
    try:
        model = load_model(args.model)
    except Exception as e:
        print(f"[ERROR] Error loading model: {e}")
        print(f"   Make sure {args.model} exists")
        sys.exit(1)

    # Determine which videos to process
    video_files = []

    if args.input:
        # Process specific video
        filename = args.input
        # Handle both full path and just filename
        if os.path.sep in filename or '/' in filename:
            filename = os.path.basename(filename)

        input_path = os.path.join(INPUT_DIR, filename)
        if not os.path.exists(input_path):
            print(f"[ERROR] Video not found: {input_path}")
            sys.exit(1)

        video_files = [filename]
        print(f"Processing single video: {filename}")
    else:
        # Process all original videos
        for filename in os.listdir(INPUT_DIR):
            if is_original_video(filename):
                video_files.append(filename)

        if not video_files:
            print(f"[ERROR] No original videos found in {INPUT_DIR}")
            sys.exit(1)

        print(f"Found {len(video_files)} videos to process:")
        for video in video_files:
            print(f"   - {video}")

    print(flush=True)

    # Create output directories
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(DETECTION_DATA_DIR, exist_ok=True)

    # Process each video
    for i, filename in enumerate(video_files, 1):
        print(f"\n[{i}/{len(video_files)}] Processing: {filename}", flush=True)

        # Input path
        input_path = os.path.join(INPUT_DIR, filename)

        # Output paths
        base_name = os.path.splitext(filename)[0]
        output_video_path = os.path.join(OUTPUT_DIR, f"{base_name}_yolov8.mp4")
        output_json_path = os.path.join(DETECTION_DATA_DIR, f"{base_name}_yolov8.json")

        # Process video
        try:
            process_video(model, input_path, output_video_path, output_json_path)
        except Exception as e:
            print(f"  [ERROR] Error processing {filename}: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)

    print("\n" + "="*80)
    print("[OK] Processing complete!")
    print("   Videos encoded with avc1 codec (H.264) - ready for browser playback")
    print("="*80)
    print(flush=True)


if __name__ == "__main__":
    main()
