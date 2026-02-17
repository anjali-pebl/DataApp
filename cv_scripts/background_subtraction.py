"""
Background Subtraction using Temporal Averaging

Takes a video, computes the average of all pixels across time (the "static background"),
then subtracts this average from each frame to highlight movement.

Perfect for underwater benthic videos where:
- Background is mostly static (rocks, sand, seaweed)
- Organisms move slowly (fish, crabs)
- You want to detect subtle movement

Usage:
    python background_subtraction.py --input video.mp4 --output results/ --duration 12 --subsample 3
"""

import os
# Suppress OpenCV/FFmpeg codec warnings (e.g., OpenH264 library errors)
# Must be set BEFORE importing cv2
os.environ['OPENCV_LOG_LEVEL'] = 'ERROR'
os.environ['OPENCV_FFMPEG_LOGLEVEL'] = '-8'  # AV_LOG_QUIET

import cv2
import numpy as np
from pathlib import Path
import argparse
import json
from datetime import datetime
import time

# Additional runtime suppression for any remaining codec warnings
cv2.setLogLevel(0)  # Disable OpenCV logging

# Import logging utilities
from logging_utils import (
    set_verbosity, get_verbosity,
    VERBOSITY_MINIMAL, VERBOSITY_NORMAL, VERBOSITY_DETAILED,
    print_step_start, print_step_complete, print_step_error,
    print_result_success, print_result_info, print_result_warning,
    print_progress_bar, print_box_line, print_box_bottom,
    STATUS_SUCCESS, STATUS_ERROR, STATUS_WARNING, STATUS_INFO
)


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
            writer = cv2.VideoWriter(str(output_path), fourcc, fps, (width, height))
            if writer.isOpened():
                return writer, codec_name
            writer.release()
        except Exception:
            continue

    return None, None


def load_frames(video_path, duration_seconds=None, subsample_rate=3, max_frames=None):
    """
    Load video frames with optional subsampling and duration limit.

    Args:
        video_path: Path to input video
        duration_seconds: Maximum video duration to process (None = entire video)
        subsample_rate: Take every Nth frame (3 = every 3rd frame)
        max_frames: Maximum number of frames to load (overrides duration)

    Returns:
        frames: List of numpy arrays (BGR images)
        fps: Original video FPS
        metadata: Dict with video info
    """
    cap = cv2.VideoCapture(str(video_path))

    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Calculate how many frames to load
    if duration_seconds:
        frames_to_load = min(int(fps * duration_seconds), total_frames)
    else:
        frames_to_load = total_frames

    if max_frames:
        frames_to_load = min(frames_to_load, max_frames)

    print(f"Video Info:")
    print(f"  FPS: {fps:.2f}")
    print(f"  Total frames: {total_frames}")
    print(f"  Resolution: {width}x{height}")
    print(f"  Duration: {total_frames/fps:.1f}s")
    print(f"  Loading: {frames_to_load} frames (every {subsample_rate}th frame)")

    frames = []
    frame_indices = []
    frame_count = 0

    while frame_count < frames_to_load:
        ret, frame = cap.read()
        if not ret:
            break

        # Subsample: only keep every Nth frame
        if frame_count % subsample_rate == 0:
            frames.append(frame)
            frame_indices.append(frame_count)

        frame_count += 1

    cap.release()

    metadata = {
        'fps': fps,
        'total_frames': total_frames,
        'width': width,
        'height': height,
        'loaded_frames': len(frames),
        'subsample_rate': subsample_rate,
        'frame_indices': frame_indices
    }

    print(f"  Loaded: {len(frames)} frames")

    return frames, fps, metadata


def compute_average_background(frames):
    """
    Compute the temporal average of all frames (the "background").
    Uses incremental averaging to avoid loading all frames into memory at once.

    Args:
        frames: List of numpy arrays (BGR images)

    Returns:
        avg_background: Average image (float32)
    """
    print(f"\nComputing average background from {len(frames)} frames...")

    if len(frames) == 0:
        raise ValueError("No frames to compute average from")

    # Initialize accumulator with first frame
    avg_background = frames[0].astype(np.float64)  # Use float64 for better precision

    # Incrementally compute average
    for i, frame in enumerate(frames[1:], start=2):
        # Update running average: avg_new = avg_old + (frame - avg_old) / count
        avg_background += (frame.astype(np.float64) - avg_background) / i

        if i % 500 == 0:
            print(f"  Processed {i}/{len(frames)} frames for background averaging")

    # Convert back to float32
    avg_background = avg_background.astype(np.float32)

    print(f"  Background computed: {avg_background.shape}, dtype: {avg_background.dtype}")
    print(f"  Value range: [{avg_background.min():.1f}, {avg_background.max():.1f}]")

    return avg_background


def subtract_background(frames, avg_background, normalize=True):
    """
    Subtract the average background from each frame.

    Args:
        frames: List of numpy arrays (BGR images)
        avg_background: Average background image (float32)
        normalize: If True, normalize output to [0, 255] range

    Returns:
        subtracted_frames: List of background-subtracted frames
    """
    print(f"\nSubtracting background from {len(frames)} frames...")

    subtracted_frames = []

    for i, frame in enumerate(frames):
        # Convert to float
        frame_float = frame.astype(np.float32)

        # Subtract background
        diff = frame_float - avg_background

        if normalize:
            # Shift and scale to [0, 255]
            # Add 128 to center around middle gray (0 difference = gray)
            normalized = diff + 128.0
            normalized = np.clip(normalized, 0, 255)
            subtracted = normalized.astype(np.uint8)
        else:
            # Just clip to [0, 255]
            subtracted = np.clip(diff, 0, 255).astype(np.uint8)

        subtracted_frames.append(subtracted)

        if (i + 1) % 100 == 0:
            print(f"  Processed {i+1}/{len(frames)} frames")

    print(f"  All frames processed")

    return subtracted_frames


def save_output_video(frames, output_path, fps, codec='avc1'):
    """
    Save frames as a video file with codec fallback for compatibility.

    Args:
        frames: List of numpy arrays
        output_path: Path to output video
        fps: Frames per second
        codec: Video codec (avc1 for H.264 - browser compatible, mp4v, XVID, etc.)

    Returns:
        bool: True if video was saved successfully, False otherwise
    """
    print(f"\nSaving output video: {output_path}")

    if len(frames) == 0:
        print("  No frames to save!")
        return False

    height, width = frames[0].shape[:2]

    # Use the helper function to get video writer
    writer, successful_codec = get_video_writer(str(output_path), fps, width, height)

    if writer is None or not writer.isOpened():
        print(f"  [X] ERROR: Failed to initialize VideoWriter with any codec")
        return False

    print(f"  [OK] Using codec: {successful_codec}")

    try:
        for i, frame in enumerate(frames):
            writer.write(frame)
            if (i + 1) % 100 == 0:
                print(f"  Written {i+1}/{len(frames)} frames ({((i+1)/len(frames)*100):.1f}%)")

        writer.release()
        print(f"  [OK] Video saved: {len(frames)} frames at {fps:.2f} FPS using {successful_codec}")
        return True
    except Exception as e:
        print(f"  [X] ERROR writing video frames: {e}")
        writer.release()
        return False


def save_comparison_frames(original_frames, subtracted_frames, output_dir, num_samples=10):
    """
    Save side-by-side comparison images (original vs background-subtracted).

    Args:
        original_frames: List of original frames
        subtracted_frames: List of background-subtracted frames
        output_dir: Directory to save comparison images
        num_samples: Number of sample frames to save
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"\nSaving {num_samples} comparison frames to: {output_dir}")

    # Sample evenly across the video
    indices = np.linspace(0, len(original_frames) - 1, num_samples, dtype=int)

    for idx in indices:
        orig = original_frames[idx]
        sub = subtracted_frames[idx]

        # Stack horizontally
        comparison = np.hstack([orig, sub])

        output_path = output_dir / f"comparison_frame_{idx:04d}.jpg"
        cv2.imwrite(str(output_path), comparison)

    print(f"  Saved {num_samples} comparison frames")


def compute_average_background_from_video(video_path, duration_seconds=None, subsample_rate=3, max_frames=None):
    """
    Compute average background directly from video without loading all frames into memory.
    Uses incremental averaging to minimize memory usage.

    Args:
        video_path: Path to input video
        duration_seconds: Maximum duration to process
        subsample_rate: Process every Nth frame
        max_frames: Maximum number of frames to process

    Returns:
        avg_background: Average background image (float32)
        fps: Original video FPS
        metadata: Video metadata dict
    """
    cap = cv2.VideoCapture(str(video_path))

    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Calculate how many frames to process
    if duration_seconds:
        frames_to_load = min(int(fps * duration_seconds), total_frames)
    else:
        frames_to_load = total_frames

    if max_frames:
        frames_to_load = min(frames_to_load, max_frames)

    if get_verbosity() >= VERBOSITY_DETAILED:
        print(f"\nComputing average background from video...")
        print(f"  Video: {width}x{height} @ {fps:.2f} FPS")
        print(f"  Total frames: {total_frames}, Processing: {frames_to_load} (every {subsample_rate}th frame)")

    avg_background = None
    frame_count = 0
    processed_count = 0
    frame_indices = []

    while frame_count < frames_to_load:
        ret, frame = cap.read()
        if not ret:
            break

        # Subsample: only process every Nth frame
        if frame_count % subsample_rate == 0:
            if avg_background is None:
                # Initialize with first frame
                avg_background = frame.astype(np.float64)
                processed_count = 1
            else:
                # Incremental averaging
                processed_count += 1
                avg_background += (frame.astype(np.float64) - avg_background) / processed_count

            frame_indices.append(frame_count)

            if processed_count % 500 == 0 and get_verbosity() >= VERBOSITY_DETAILED:
                print(f"  Processed {processed_count} frames for background averaging")

        frame_count += 1

    cap.release()

    if avg_background is None:
        raise ValueError("No frames were processed")

    # Convert to float32
    avg_background = avg_background.astype(np.float32)

    if get_verbosity() >= VERBOSITY_DETAILED:
        print(f"  Background computed from {processed_count} frames")
        print(f"  Shape: {avg_background.shape}, dtype: {avg_background.dtype}")
        print(f"  Value range: [{avg_background.min():.1f}, {avg_background.max():.1f}]")

    metadata = {
        'fps': fps,
        'total_frames': total_frames,
        'width': width,
        'height': height,
        'loaded_frames': processed_count,
        'subsample_rate': subsample_rate,
        'frame_indices': frame_indices
    }

    return avg_background, fps, metadata


def main():
    parser = argparse.ArgumentParser(
        description="Background subtraction using temporal averaging for motion detection"
    )
    parser.add_argument('--input', '-i', required=True, help='Input video path')
    parser.add_argument('--output', '-o', default='results/', help='Output directory')
    parser.add_argument('--duration', '-d', type=float, default=None,
                       help='Video duration to process in seconds (default: entire video)')
    parser.add_argument('--subsample', '-s', type=int, default=3,
                       help='Subsample rate: process every Nth frame (default: 3)')
    parser.add_argument('--max-frames', '-m', type=int, default=None,
                       help='Maximum number of frames to process (overrides duration)')
    parser.add_argument('--normalize', action='store_true', default=True,
                       help='Normalize output to [0, 255] range (default: True)')
    parser.add_argument('--save-comparison', '-c', action='store_true',
                       help='Save comparison frames (original vs subtracted)')
    parser.add_argument('--comparison-samples', type=int, default=10,
                       help='Number of comparison frames to save (default: 10)')

    args = parser.parse_args()

    # Setup paths
    input_path = Path(args.input)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Use detailed mode when running standalone
    if get_verbosity() == VERBOSITY_NORMAL:
        set_verbosity(VERBOSITY_DETAILED)

    start_time = datetime.now()

    # Step 1: Compute average background (first pass - incremental, memory efficient)
    print_step_start(1, 2, "Analyzing background")

    avg_background, fps, metadata = compute_average_background_from_video(
        input_path,
        duration_seconds=args.duration,
        subsample_rate=args.subsample,
        max_frames=args.max_frames
    )

    # Save average background as image
    bg_path = output_dir / f"{input_path.stem}_average_background.jpg"
    cv2.imwrite(str(bg_path), avg_background.astype(np.uint8))

    if get_verbosity() >= VERBOSITY_NORMAL:
        print_result_success(f"Created: {bg_path.name}")

    step1_time = (datetime.now() - start_time).total_seconds()
    print_step_complete(step1_time)

    # Step 2: Second pass - subtract background and write output video
    step2_start = datetime.now()
    print_step_start(2, 2, "Creating motion video")

    cap = cv2.VideoCapture(str(input_path))

    # Calculate frames to process
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if args.duration:
        frames_to_load = min(int(fps * args.duration), total_frames)
    else:
        frames_to_load = total_frames
    if args.max_frames:
        frames_to_load = min(frames_to_load, args.max_frames)

    # Setup output video writer with codec fallback
    output_video_path = output_dir / f"{input_path.stem}_background_subtracted.mp4"
    output_fps = fps / args.subsample
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Use helper function to get video writer
    writer, successful_codec = get_video_writer(str(output_video_path), output_fps, width, height)

    video_write_success = False
    frame_count = 0
    processed_count = 0
    comparison_frames_original = []
    comparison_frames_subtracted = []

    if writer is None or not writer.isOpened():
        if get_verbosity() >= VERBOSITY_NORMAL:
            print_box_line(f"{STATUS_WARNING} Failed to initialize VideoWriter")
            print_box_line(f"{STATUS_INFO} Background image will still be saved")
    else:
        if get_verbosity() >= VERBOSITY_DETAILED:
            print_box_line(f"{STATUS_INFO} Using codec: {successful_codec}")

    while frame_count < frames_to_load:
        ret, frame = cap.read()
        if not ret:
            break

        # Subsample: only process every Nth frame
        if frame_count % args.subsample == 0:
            # Subtract background
            frame_float = frame.astype(np.float32)
            diff = frame_float - avg_background

            if args.normalize:
                # Shift and scale to [0, 255]
                normalized = diff + 128.0
                normalized = np.clip(normalized, 0, 255)
                subtracted = normalized.astype(np.uint8)
            else:
                subtracted = np.clip(diff, 0, 255).astype(np.uint8)

            # Write to output video (if writer is available)
            if writer is not None and writer.isOpened():
                try:
                    writer.write(subtracted)
                    video_write_success = True
                except Exception as e:
                    print(f"  [X] ERROR writing frame {processed_count}: {e}")
                    # Close writer to prevent further errors
                    writer.release()
                    writer = None

            processed_count += 1

            # Save samples for comparison if requested
            if args.save_comparison and len(comparison_frames_original) < args.comparison_samples:
                sample_interval = frames_to_load // (args.subsample * args.comparison_samples)
                if processed_count % max(1, sample_interval) == 0:
                    comparison_frames_original.append(frame.copy())
                    comparison_frames_subtracted.append(subtracted.copy())

            # Progress reporting every 10% or 500 frames
            if processed_count % 100 == 0:
                progress_pct = (processed_count / (frames_to_load // args.subsample)) * 100
                print(f"  Processed {processed_count} frames ({progress_pct:.1f}%)")

        frame_count += 1

    cap.release()
    if writer is not None:
        writer.release()

    if video_write_success:
        print(f"  [OK] Output video saved: {processed_count} frames at {output_fps:.2f} FPS using {successful_codec}")
    else:
        print(f"  [X] Video writing failed or was skipped")
        print(f"  [OK] Processed {processed_count} frames (data saved in JSON)")

    # Verify output video (if it was created)
    if video_write_success:
        print(f"\n  [VERIFY] Verifying output video...")
        cap_verify = cv2.VideoCapture(str(output_video_path))
        if cap_verify.isOpened():
            actual_frames = int(cap_verify.get(cv2.CAP_PROP_FRAME_COUNT))
            actual_fps = cap_verify.get(cv2.CAP_PROP_FPS)
            actual_duration = actual_frames / actual_fps if actual_fps > 0 else 0
            expected_duration = total_frames / fps if fps > 0 else 0

            cap_verify.release()

            print(f"    Expected: {frames_to_load} input frames -> {processed_count} output frames @ {output_fps:.2f} fps = {expected_duration:.1f}s")
            print(f"    Actual:   {actual_frames} frames @ {actual_fps:.2f} fps = {actual_duration:.1f}s")

            frame_diff = abs(processed_count - actual_frames)
            duration_diff = abs(expected_duration - actual_duration)

            if frame_diff > 5:  # Allow 5 frames tolerance
                print(f"  [WARNING] Frame count mismatch: expected={processed_count}, actual={actual_frames} (diff={frame_diff})")
                print(f"      Some frames may not have been written to output!")
            elif duration_diff > 2.0:  # Allow 2 second tolerance
                print(f"  [WARNING] Duration mismatch: expected={expected_duration:.1f}s, actual={actual_duration:.1f}s (diff={duration_diff:.1f}s)")
                print(f"      This may cause playback issues!")
            else:
                print(f"  [OK] Output verified: frame count and duration match within tolerance")
        else:
            print(f"  [ERROR] Could not verify output video!")
            print(f"      Output video may be corrupted or incomplete")
    else:
        print(f"\n  [SKIP] Video verification skipped (video was not created)")
        print(f"  [!] Install OpenH264 codec or use different codec for video output")

    # Step 3: Save comparison frames (optional)
    if args.save_comparison and len(comparison_frames_original) > 0:
        comparison_dir = output_dir / f"{input_path.stem}_comparisons"
        comparison_dir.mkdir(parents=True, exist_ok=True)

        print(f"\nSaving {len(comparison_frames_original)} comparison frames...")
        for idx, (orig, sub) in enumerate(zip(comparison_frames_original, comparison_frames_subtracted)):
            comparison = np.hstack([orig, sub])
            output_path = comparison_dir / f"comparison_frame_{idx:04d}.jpg"
            cv2.imwrite(str(output_path), comparison)

        print(f"  Saved to: {comparison_dir}")

    # Step 4: Save metadata
    end_time = datetime.now()
    processing_time = (end_time - start_time).total_seconds()

    result_metadata = {
        'input_video': str(input_path),
        'output_video': str(output_video_path) if video_write_success else None,
        'output_video_created': video_write_success,
        'video_codec_used': successful_codec if video_write_success else None,
        'average_background': str(bg_path),
        'processing_time_seconds': processing_time,
        'timestamp': datetime.now().isoformat(),
        'frames_processed': processed_count,
        'parameters': {
            'duration_seconds': args.duration,
            'subsample_rate': args.subsample,
            'max_frames': args.max_frames,
            'normalize': args.normalize
        },
        'video_metadata': metadata
    }

    metadata_path = output_dir / f"{input_path.stem}_metadata.json"
    with open(metadata_path, 'w') as f:
        json.dump(result_metadata, f, indent=2)

    step2_time = (datetime.now() - step2_start).total_seconds()

    if get_verbosity() >= VERBOSITY_NORMAL:
        if video_write_success:
            print_result_success(f"Created: {output_video_path.name} ({processed_count} frames)")
        else:
            print_result_warning("Video creation failed (codec issue)")

        print_result_success(f"Created: {metadata_path.name}")

    print_step_complete(step2_time)

    if get_verbosity() >= VERBOSITY_DETAILED:
        print(f"\nProcessing time: {processing_time:.1f}s")
        print(f"Processed frames: {processed_count}")
        print(f"\nOutput files:")
        if video_write_success:
            print(f"  {STATUS_SUCCESS} Video:      {output_video_path}")
        else:
            print(f"  {STATUS_ERROR} Video:      Failed (codec issue)")
        print(f"  {STATUS_SUCCESS} Background: {bg_path}")
        print(f"  {STATUS_SUCCESS} Metadata:   {metadata_path}")
        if args.save_comparison:
            print(f"  {STATUS_SUCCESS} Comparisons: {comparison_dir}")
        print()


if __name__ == '__main__':
    main()
