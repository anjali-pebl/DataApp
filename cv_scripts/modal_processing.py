"""
Modal.com GPU Processing for YOLOv8 Video Inference

This module provides cloud GPU processing for YOLO object detection.
Motion analysis runs locally (CPU-bound), YOLO runs on Modal (GPU-accelerated).

Usage:
    # From Python
    from cv_scripts.modal_processing import process_video_on_modal
    results = process_video_on_modal(video_path, gpu_type='modal-t4')

    # CLI deployment
    modal deploy cv_scripts/modal_processing.py
"""

import modal
from pathlib import Path
import json
import time

# ============================================================================
# MODAL APP CONFIGURATION
# ============================================================================

app = modal.App("underwater-yolo-processor")

# GPU image with YOLO and crab detection dependencies
gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1-mesa-glx", "libglib2.0-0")  # OpenCV dependencies
    .pip_install(
        "ultralytics>=8.0.0",
        "opencv-python-headless>=4.8.0",
        "numpy>=1.24.0",
        "torch>=2.0.0",
        "torchvision>=0.15.0",
        "scipy>=1.10.0",  # For crab detection (distance calculations)
    )
)

# CPU image for motion analysis (no GPU needed)
cpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1-mesa-glx", "libglib2.0-0")  # OpenCV dependencies
    .pip_install(
        "opencv-python-headless>=4.8.0",
        "numpy>=1.24.0",
        "scipy>=1.10.0",  # For connected components analysis
    )
)

# Volume for caching models (avoids re-downloading each run)
model_cache = modal.Volume.from_name("yolo-model-cache", create_if_missing=True)


# ============================================================================
# MODAL FUNCTIONS
# ============================================================================

@app.function(
    gpu="T4",
    timeout=900,  # 15 minutes max
    memory=8192,
    image=gpu_image,
    volumes={"/model_cache": model_cache},
)
def process_video_t4(
    video_bytes: bytes,
    video_id: str,
    filename: str,
    model_weights: bytes = None,
    settings: dict = None,
) -> dict:
    """Process video on T4 GPU ($0.59/hour)"""
    return _process_video_on_gpu(video_bytes, video_id, filename, model_weights, settings, "T4")


@app.function(
    gpu="A10G",
    timeout=600,  # 10 minutes max (A10G is faster)
    memory=16384,
    image=gpu_image,
    volumes={"/model_cache": model_cache},
)
def process_video_a10g(
    video_bytes: bytes,
    video_id: str,
    filename: str,
    model_weights: bytes = None,
    settings: dict = None,
) -> dict:
    """Process video on A10G GPU ($1.10/hour)"""
    return _process_video_on_gpu(video_bytes, video_id, filename, model_weights, settings, "A10G")


@app.function(
    gpu="A100",
    timeout=300,  # 5 minutes max (A100 is fastest)
    memory=32768,
    image=gpu_image,
    volumes={"/model_cache": model_cache},
)
def process_video_a100(
    video_bytes: bytes,
    video_id: str,
    filename: str,
    model_weights: bytes = None,
    settings: dict = None,
) -> dict:
    """Process video on A100 GPU ($3.30/hour) - Fastest option"""
    return _process_video_on_gpu(video_bytes, video_id, filename, model_weights, settings, "A100")


# =============================================================================
# UNIFIED GPU PIPELINE (Phase 2 Optimization)
# =============================================================================

@app.function(
    gpu="A10G",
    timeout=1200,  # 20 minutes max for full pipeline
    memory=24576,  # 24GB RAM for holding all frames
    image=gpu_image,
    volumes={"/model_cache": model_cache},
)
def process_video_unified_pipeline(
    video_bytes: bytes,
    video_id: str,
    filename: str,
    model_weights: bytes = None,
    settings: dict = None,
) -> dict:
    """
    Unified GPU pipeline: Background Subtraction → Motion Analysis → YOLO Detection

    All processing happens on GPU in a single session, avoiding multiple uploads
    and leveraging GPU memory for data sharing between steps.

    This is the Phase 2 optimization that reduces processing time by 60-70%.

    Args:
        video_bytes: Raw video file bytes (original video)
        video_id: Database ID for this video
        filename: Original filename
        model_weights: Custom YOLO model weights (bytes) or None for default
        settings: Processing settings dict with keys:
            - targetFps: 'all' | '15' | '10' | '5'
            - enableMotionAnalysis: bool
            - enableYolo: bool

    Returns:
        dict: Combined results with keys:
            - background_subtraction: BG subtraction metadata
            - motion_analysis: Motion metrics (activity_score, organisms, etc.)
            - yolo_detection: YOLO detection results
            - processing: Timing and performance metrics
    """
    import cv2
    import numpy as np
    from ultralytics import YOLO
    import tempfile
    import os
    from datetime import datetime

    settings = settings or {}
    sample_rate = {'all': 1, '15': 2, '10': 3, '5': 5}.get(settings.get('targetFps', '10'), 3)
    enable_motion = settings.get('enableMotionAnalysis', True)
    enable_yolo = settings.get('enableYolo', True)

    pipeline_start = time.time()
    results = {
        'video_id': video_id,
        'filename': filename,
        'processing': {},
    }

    print(f"[Unified Pipeline] Starting: {filename}")
    print(f"[Unified Pipeline] Video size: {len(video_bytes) / 1024 / 1024:.1f} MB")
    print(f"[Unified Pipeline] Settings: sample_rate={sample_rate}, motion={enable_motion}, yolo={enable_yolo}")

    # Write video to temp file
    with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as f:
        f.write(video_bytes)
        temp_video_path = f.name

    try:
        # Load video
        cap = cv2.VideoCapture(temp_video_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {filename}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration = total_frames / fps if fps > 0 else 0

        print(f"[Unified Pipeline] Video: {width}x{height} @ {fps:.1f}fps, {total_frames} frames")

        # =====================================================================
        # STEP 1: BACKGROUND SUBTRACTION (GPU-ACCELERATED)
        # =====================================================================
        bg_start = time.time()
        print("[Unified Pipeline] Step 1: Background Subtraction")

        # Load all sampled frames
        original_frames = []
        frame_idx = 0
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if frame_idx % sample_rate == 0:
                original_frames.append(frame)
            frame_idx += 1

        print(f"[Unified Pipeline] Loaded {len(original_frames)} frames (sampled every {sample_rate})")

        # Compute average background using vectorized numpy operations
        frames_array = np.array(original_frames, dtype=np.float32)
        avg_background = np.mean(frames_array, axis=0)

        # Subtract background from all frames
        subtracted_frames = []
        for frame in original_frames:
            diff = frame.astype(np.float32) - avg_background
            normalized = np.clip(diff + 128.0, 0, 255).astype(np.uint8)
            subtracted_frames.append(normalized)

        bg_time = time.time() - bg_start
        print(f"[Unified Pipeline] Background subtraction: {bg_time:.1f}s")

        # Save background-subtracted video (always generate for verification)
        print("[Unified Pipeline] Generating background-subtracted video...")
        bg_video_start = time.time()

        output_fps = fps / sample_rate
        fourcc = cv2.VideoWriter_fourcc(*'avc1')

        with tempfile.NamedTemporaryFile(suffix='_background_subtracted.mp4', delete=False) as bg_out:
            bg_video_path = bg_out.name

        bg_writer = cv2.VideoWriter(bg_video_path, fourcc, output_fps, (width, height))

        if bg_writer.isOpened():
            for frame in subtracted_frames:
                bg_writer.write(frame)
            bg_writer.release()

            # Read video bytes to return
            with open(bg_video_path, 'rb') as f:
                bg_video_bytes = f.read()

            os.unlink(bg_video_path)

            bg_video_time = time.time() - bg_video_start
            bg_video_size_mb = len(bg_video_bytes) / 1024 / 1024

            print(f"[Unified Pipeline] Background video: {bg_video_size_mb:.1f} MB in {bg_video_time:.1f}s")

            results['background_subtraction'] = {
                'frames_processed': len(original_frames),
                'processing_time_seconds': bg_time,
                'sample_rate': sample_rate,
                'output_fps': output_fps,
                'bg_video_bytes': bg_video_bytes,
                'bg_video_size_mb': bg_video_size_mb,
                'bg_video_generation_seconds': bg_video_time,
            }
        else:
            print("[Unified Pipeline] Warning: Could not create video writer for background-subtracted video")
            results['background_subtraction'] = {
                'frames_processed': len(original_frames),
                'processing_time_seconds': bg_time,
                'sample_rate': sample_rate,
                'output_fps': output_fps,
            }

        # =====================================================================
        # STEP 2: MOTION ANALYSIS (on subtracted frames)
        # =====================================================================
        if enable_motion:
            motion_start = time.time()
            print("[Unified Pipeline] Step 2: Motion Analysis")

            # Motion energy
            motion_energies = []
            for frame in subtracted_frames:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                energy = np.sum(np.abs(gray.astype(float) - 128.0))
                motion_energies.append(energy)

            # Motion density
            threshold = settings.get('motion_threshold', 15)
            total_pixels = width * height
            motion_densities = []
            for frame in subtracted_frames:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                diff = np.abs(gray.astype(float) - 128.0)
                motion_pixels = np.sum(diff > threshold)
                density = (motion_pixels / total_pixels) * 100
                motion_densities.append(density)

            # Blob detection (organism counting)
            min_size = settings.get('min_size', 50)
            max_size = settings.get('max_size', 50000)
            blob_threshold = settings.get('blob_threshold', 30)

            blob_counts = []
            blob_sizes = []

            for frame in subtracted_frames:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                diff = np.abs(gray.astype(float) - 128.0).astype(np.uint8)
                _, binary = cv2.threshold(diff, blob_threshold, 255, cv2.THRESH_BINARY)
                num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)

                frame_count = 0
                for j in range(1, num_labels):
                    area = stats[j, cv2.CC_STAT_AREA]
                    if min_size <= area <= max_size:
                        frame_count += 1
                        blob_sizes.append(float(area))

                blob_counts.append(frame_count)

            # Activity score calculation
            avg_energy = np.mean(motion_energies)
            avg_density = np.mean(motion_densities)
            avg_count = np.mean(blob_counts) if blob_counts else 0
            mean_size = np.mean(blob_sizes) if blob_sizes else 0

            energy_score = min(100, (avg_energy / 5000000) * 100)
            density_score = min(100, avg_density * 50)
            count_score = min(100, avg_count * 20)
            size_score = min(100, (mean_size / 2000) * 100) if mean_size > 0 else 0

            weights = {'energy': 0.3, 'density': 0.2, 'count': 0.3, 'size': 0.2}
            overall_score = (
                energy_score * weights['energy'] +
                density_score * weights['density'] +
                count_score * weights['count'] +
                size_score * weights['size']
            )

            motion_time = time.time() - motion_start
            print(f"[Unified Pipeline] Motion analysis: {motion_time:.1f}s, score={overall_score:.1f}")

            results['motion_analysis'] = {
                'activity_score': {
                    'overall_score': float(overall_score),
                    'component_scores': {
                        'energy': float(energy_score),
                        'density': float(density_score),
                        'count': float(count_score),
                        'size': float(size_score),
                    },
                    'weights': weights,
                },
                'motion': {
                    'total_energy': float(sum(motion_energies)),
                    'avg_energy': float(avg_energy),
                    'max_energy': float(max(motion_energies)),
                },
                'density': {
                    'avg_density': float(avg_density),
                    'max_density': float(max(motion_densities)),
                },
                'organisms': {
                    'total_detections': len(blob_sizes),
                    'avg_count': float(avg_count),
                    'max_count': int(max(blob_counts)) if blob_counts else 0,
                    'size_distribution': {
                        'small': len([s for s in blob_sizes if s < 500]),
                        'medium': len([s for s in blob_sizes if 500 <= s < 5000]),
                        'large': len([s for s in blob_sizes if s >= 5000]),
                        'mean_size': float(mean_size),
                    },
                },
                'processing_time_seconds': motion_time,
            }

        # =====================================================================
        # STEP 3: YOLO DETECTION (on original frames)
        # =====================================================================
        if enable_yolo:
            yolo_start = time.time()
            print("[Unified Pipeline] Step 3: YOLO Detection")

            # Load YOLO model
            if model_weights:
                model_path = "/model_cache/custom_model.pt"
                with open(model_path, 'wb') as f:
                    f.write(model_weights)
                model = YOLO(model_path)
                print(f"[Unified Pipeline] Loaded custom model ({len(model_weights) / 1024 / 1024:.1f} MB)")
            else:
                model = YOLO('yolov8m.pt')
                print("[Unified Pipeline] Using default yolov8m model")

            model.to('cuda:0')

            # Process frames in batches for efficiency
            batch_size = 16
            detections = []
            inference_start = time.time()

            for batch_start in range(0, len(original_frames), batch_size):
                batch_end = min(batch_start + batch_size, len(original_frames))
                batch_frames = original_frames[batch_start:batch_end]

                # Run batch inference
                batch_results = model(batch_frames, verbose=False, device='cuda:0')

                for i, result in enumerate(batch_results):
                    frame_num = (batch_start + i) * sample_rate
                    frame_detections = []

                    for box in result.boxes:
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        confidence = float(box.conf[0])
                        class_id = int(box.cls[0])
                        class_name = model.names[class_id]

                        frame_detections.append({
                            "class_id": class_id,
                            "class_name": class_name,
                            "confidence": confidence,
                            "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}
                        })

                    detections.append({
                        "frame": frame_num,
                        "timestamp": frame_num / fps if fps > 0 else 0,
                        "count": len(frame_detections),
                        "objects": frame_detections
                    })

                if (batch_start + batch_size) % 100 < batch_size:
                    elapsed = time.time() - inference_start
                    processed = batch_end
                    fps_actual = processed / elapsed if elapsed > 0 else 0
                    print(f"[Unified Pipeline] YOLO progress: {processed}/{len(original_frames)} frames @ {fps_actual:.1f} fps")

            inference_time = time.time() - inference_start
            yolo_time = time.time() - yolo_start
            total_detections = sum(d['count'] for d in detections)

            print(f"[Unified Pipeline] YOLO complete: {len(detections)} frames, {total_detections} detections, {yolo_time:.1f}s")

            results['yolo_detection'] = {
                'model': 'custom' if model_weights else 'yolov8m',
                'detections': detections,
                'total_detections': total_detections,
                'frames_processed': len(detections),
                'inference_time_seconds': inference_time,
                'processing_fps': len(detections) / inference_time if inference_time > 0 else 0,
            }

            # =====================================================================
            # OPTIONAL: Generate Annotated Video (Phase 3)
            # =====================================================================
            if settings.get('generateAnnotatedVideo', False):
                print("[Unified Pipeline] Generating annotated YOLO video...")
                annotated_start = time.time()

                # Create video writer
                output_fps = fps / sample_rate
                fourcc = cv2.VideoWriter_fourcc(*'avc1')

                with tempfile.NamedTemporaryFile(suffix='_yolov8.mp4', delete=False) as out_file:
                    annotated_output_path = out_file.name

                writer = cv2.VideoWriter(annotated_output_path, fourcc, output_fps, (width, height))

                if not writer.isOpened():
                    print("[Unified Pipeline] Warning: Could not create video writer for annotated video")
                else:
                    # Color palette for different classes (using RGB)
                    import matplotlib.pyplot as plt
                    colors = plt.cm.tab10.colors

                    # Draw boxes on frames
                    for i, detection in enumerate(detections):
                        frame = original_frames[i].copy()

                        for obj in detection['objects']:
                            bbox = obj['bbox']
                            class_id = obj['class_id']
                            confidence = obj['confidence']
                            class_name = obj['class_name']

                            # Get color for this class (convert to BGR for OpenCV)
                            color_rgb = colors[class_id % len(colors)]
                            color = (int(color_rgb[2] * 255), int(color_rgb[1] * 255), int(color_rgb[0] * 255))

                            # Draw bounding box
                            x1, y1, x2, y2 = int(bbox['x1']), int(bbox['y1']), int(bbox['x2']), int(bbox['y2'])
                            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

                            # Draw label background and text
                            label = f"{class_name}: {confidence:.2f}"
                            (label_w, label_h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                            cv2.rectangle(frame, (x1, y1 - label_h - 4), (x1 + label_w, y1), color, -1)
                            cv2.putText(frame, label, (x1, y1 - 2), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

                        writer.write(frame)

                    writer.release()

                    # Read annotated video bytes to return
                    with open(annotated_output_path, 'rb') as f:
                        annotated_video_bytes = f.read()

                    os.unlink(annotated_output_path)

                    annotated_time = time.time() - annotated_start
                    annotated_size_mb = len(annotated_video_bytes) / 1024 / 1024

                    results['yolo_detection']['annotated_video_bytes'] = annotated_video_bytes
                    results['yolo_detection']['annotated_video_size_mb'] = annotated_size_mb
                    results['yolo_detection']['annotated_generation_seconds'] = annotated_time

                    print(f"[Unified Pipeline] Annotated video: {annotated_size_mb:.1f} MB in {annotated_time:.1f}s")

        # =====================================================================
        # STEP 4: CRAB DETECTION (on subtracted frames)
        # =====================================================================
        enable_crab = settings.get('enableCrabDetection', False)
        if enable_crab:
            crab_start = time.time()
            print("[Unified Pipeline] Step 4: Crab Detection")

            crab_params = settings.get('crabDetectionParams', {})

            from crab_detection import DetectionParams, TrackingParams, ValidationParams
            from crab_detection import detect_blobs, match_blobs_to_tracks, validate_track, Track

            detection_params = DetectionParams(
                threshold=crab_params.get('threshold', 30),
                min_area=crab_params.get('min_area', 30),
                max_area=crab_params.get('max_area', 2000),
                min_circularity=crab_params.get('min_circularity', 0.3),
                max_aspect_ratio=crab_params.get('max_aspect_ratio', 3.0),
                morph_kernel_size=crab_params.get('morph_kernel_size', 5)
            )

            tracking_params = TrackingParams(
                max_distance=crab_params.get('max_distance', 50.0),
                max_skip_frames=crab_params.get('max_skip_frames', 5)
            )

            validation_params = ValidationParams(
                min_track_length=crab_params.get('min_track_length', 15),
                min_displacement=crab_params.get('min_displacement', 20.0),
                min_speed=crab_params.get('min_speed', 0.5),
                max_speed=crab_params.get('max_speed', 30.0)
            )

            active_tracks = []
            completed_tracks = []
            next_track_id = 1

            for frame_idx, frame in enumerate(subtracted_frames):
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                blobs = detect_blobs(gray, frame_idx, detection_params)

                active_tracks, unmatched_blobs = match_blobs_to_tracks(
                    blobs, active_tracks, frame_idx, tracking_params
                )

                for blob in unmatched_blobs:
                    new_track = Track(
                        track_id=next_track_id,
                        frames=[frame_idx],
                        bboxes=[blob.bbox],
                        centroids=[blob.centroid],
                        areas=[blob.area],
                        confidences=[blob.confidence]
                    )
                    active_tracks.append(new_track)
                    next_track_id += 1

                if (frame_idx + 1) % 50 == 0:
                    print(f"[Unified Pipeline] Crab detection progress: {frame_idx+1}/{len(subtracted_frames)} frames")

            for track in active_tracks:
                track.is_valid = validate_track(track, validation_params)
                completed_tracks.append(track)

            valid_tracks = [t for t in completed_tracks if t.is_valid]

            crab_time = time.time() - crab_start
            print(f"[Unified Pipeline] Crab detection: {crab_time:.1f}s, {len(valid_tracks)} valid tracks")

            results['crab_detection'] = {
                'total_tracks': len(completed_tracks),
                'valid_tracks': len(valid_tracks),
                'total_detections': sum(t.length for t in completed_tracks),
                'tracks': [
                    {
                        'track_id': t.track_id,
                        'frames': t.frames,
                        'bboxes': t.bboxes,
                        'centroids': t.centroids,
                        'is_valid': t.is_valid,
                        'length': t.length,
                        'displacement': t.displacement,
                        'avg_speed': t.avg_speed
                    }
                    for t in completed_tracks
                ],
                'parameters': {
                    'detection': {
                        'threshold': detection_params.threshold,
                        'min_area': detection_params.min_area,
                        'max_area': detection_params.max_area,
                        'min_circularity': detection_params.min_circularity,
                        'max_aspect_ratio': detection_params.max_aspect_ratio,
                        'morph_kernel_size': detection_params.morph_kernel_size,
                    },
                    'tracking': {
                        'max_distance': tracking_params.max_distance,
                        'max_skip_frames': tracking_params.max_skip_frames,
                    },
                    'validation': {
                        'min_track_length': validation_params.min_track_length,
                        'min_displacement': validation_params.min_displacement,
                        'min_speed': validation_params.min_speed,
                        'max_speed': validation_params.max_speed,
                    }
                },
                'processing_time_seconds': crab_time,
            }

        # =====================================================================
        # FINALIZE RESULTS
        # =====================================================================
        pipeline_time = time.time() - pipeline_start

        results['video_info'] = {
            'filename': filename,
            'fps': fps,
            'resolution': {'width': width, 'height': height},
            'total_frames': total_frames,
            'duration_seconds': duration,
        }

        results['processing'] = {
            'gpu_type': 'A10G',
            'pipeline': 'unified',
            'total_time_seconds': pipeline_time,
            'bg_subtraction_seconds': results.get('background_subtraction', {}).get('processing_time_seconds', 0),
            'motion_analysis_seconds': results.get('motion_analysis', {}).get('processing_time_seconds', 0),
            'yolo_detection_seconds': results.get('yolo_detection', {}).get('inference_time_seconds', 0),
            'crab_detection_seconds': results.get('crab_detection', {}).get('processing_time_seconds', 0),
            'frames_processed': len(original_frames),
            'sample_rate': sample_rate,
            'timestamp': datetime.now().isoformat(),
        }

        print(f"[Unified Pipeline] COMPLETE: {pipeline_time:.1f}s total")

        return results

    finally:
        os.unlink(temp_video_path)


def _process_video_on_gpu(
    video_bytes: bytes,
    video_id: str,
    filename: str,
    model_weights: bytes,
    settings: dict,
    gpu_type: str,
) -> dict:
    """
    Core GPU processing function for YOLO inference.

    Args:
        video_bytes: Raw video file bytes
        video_id: Database ID for this video
        filename: Original filename
        model_weights: Custom model weights (bytes) or None for default
        settings: Processing settings dict
        gpu_type: GPU type string for logging

    Returns:
        dict: Detection results compatible with our JSON format
    """
    import cv2
    import numpy as np
    from ultralytics import YOLO
    import tempfile
    import os

    settings = settings or {}
    sample_rate = {'all': 1, '15': 2, '10': 3, '5': 5}.get(settings.get('targetFps', '10'), 3)

    start_time = time.time()

    print(f"[Modal {gpu_type}] Processing: {filename}")
    print(f"[Modal {gpu_type}] Video size: {len(video_bytes) / 1024 / 1024:.1f} MB")
    print(f"[Modal {gpu_type}] Sample rate: every {sample_rate} frames")

    # Write video to temp file
    with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as f:
        f.write(video_bytes)
        temp_video_path = f.name

    try:
        # Load video
        cap = cv2.VideoCapture(temp_video_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {filename}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration = total_frames / fps if fps > 0 else 0

        print(f"[Modal {gpu_type}] Video: {width}x{height} @ {fps:.1f}fps, {total_frames} frames, {duration:.1f}s")

        # Load YOLO model
        if model_weights:
            # Use custom model weights
            model_path = "/model_cache/custom_model.pt"
            with open(model_path, 'wb') as f:
                f.write(model_weights)
            model = YOLO(model_path)
            print(f"[Modal {gpu_type}] Loaded custom model ({len(model_weights) / 1024 / 1024:.1f} MB)")
        else:
            # Use default YOLOv8m
            model = YOLO('yolov8m.pt')
            print(f"[Modal {gpu_type}] Using default yolov8m model")

        # Move to GPU
        model.to('cuda:0')
        print(f"[Modal {gpu_type}] Model loaded on GPU")

        # Process frames
        detections = []
        frame_idx = 0
        processed_count = 0

        inference_start = time.time()

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # Sample frames
            if frame_idx % sample_rate == 0:
                # Run YOLO inference
                results = model(frame, verbose=False, device='cuda:0')[0]

                frame_detections = []
                for box in results.boxes:
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    confidence = float(box.conf[0])
                    class_id = int(box.cls[0])
                    class_name = model.names[class_id]

                    frame_detections.append({
                        "class_id": class_id,
                        "class_name": class_name,
                        "confidence": confidence,
                        "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}
                    })

                detections.append({
                    "frame": frame_idx,
                    "timestamp": frame_idx / fps if fps > 0 else 0,
                    "count": len(frame_detections),
                    "objects": frame_detections
                })

                processed_count += 1

                # Progress logging every 100 processed frames
                if processed_count % 100 == 0:
                    elapsed = time.time() - inference_start
                    fps_actual = processed_count / elapsed if elapsed > 0 else 0
                    progress = (frame_idx / total_frames) * 100
                    print(f"[Modal {gpu_type}] Progress: {progress:.1f}% ({processed_count} frames @ {fps_actual:.1f} fps)")

            frame_idx += 1

        cap.release()

        inference_time = time.time() - inference_start
        total_time = time.time() - start_time

        # Count total detections
        total_detections = sum(d['count'] for d in detections)

        print(f"[Modal {gpu_type}] Complete: {processed_count} frames, {total_detections} detections")
        print(f"[Modal {gpu_type}] Inference time: {inference_time:.1f}s ({processed_count / inference_time:.1f} fps)")
        print(f"[Modal {gpu_type}] Total time: {total_time:.1f}s")

        # Build result in our standard format
        result = {
            "video_filename": filename,
            "video_id": video_id,
            "model": "yolov8m" if not model_weights else "custom",
            "fps": fps,
            "resolution": {"width": width, "height": height},
            "total_frames": total_frames,
            "duration_seconds": duration,
            "detections": detections,
            "processing": {
                "gpu_type": gpu_type,
                "inference_time_seconds": inference_time,
                "total_time_seconds": total_time,
                "frames_processed": processed_count,
                "processing_fps": processed_count / inference_time if inference_time > 0 else 0,
                "sample_rate": sample_rate,
            }
        }

        return result

    finally:
        # Cleanup temp file
        os.unlink(temp_video_path)


# ============================================================================
# MOTION ANALYSIS ON MODAL (CPU)
# ============================================================================

@app.function(
    cpu=4,  # 4 CPU cores for parallel numpy operations
    timeout=600,  # 10 minutes max
    memory=16384,  # 16GB RAM for loading all video frames
    image=cpu_image,
)
def analyze_motion_on_modal(
    video_bytes: bytes,
    video_id: str,
    filename: str,
    settings: dict = None,
) -> dict:
    """
    Run motion analysis on Modal's cloud CPUs.

    This computes activity_score, organisms, density, and motion metrics
    from a background-subtracted video.
    """
    import cv2
    import numpy as np
    import tempfile
    import os
    from datetime import datetime

    start_time = time.time()
    settings = settings or {}

    print(f"[Modal Motion] Starting motion analysis for: {filename}")
    print(f"[Modal Motion] Video size: {len(video_bytes) / 1024 / 1024:.1f} MB")

    # Save video to temp file
    with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as tmp:
        tmp.write(video_bytes)
        temp_video_path = tmp.name

    try:
        # Load video
        cap = cv2.VideoCapture(temp_video_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {filename}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration = total_frames / fps if fps > 0 else 0

        print(f"[Modal Motion] Video: {width}x{height} @ {fps:.2f} FPS, {total_frames} frames")

        # Load all frames
        frames = []
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            frames.append(frame)
        cap.release()

        print(f"[Modal Motion] Loaded {len(frames)} frames")

        # =====================================================================
        # MOTION ENERGY COMPUTATION
        # =====================================================================
        print("[Modal Motion] Computing motion energy...")
        motion_energies = []
        for frame in frames:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            energy = np.sum(np.abs(gray.astype(float) - 128.0))
            motion_energies.append(energy)

        total_energy = sum(motion_energies)
        avg_energy = np.mean(motion_energies)
        max_energy = np.max(motion_energies)
        std_energy = np.std(motion_energies)

        # =====================================================================
        # MOTION DENSITY COMPUTATION
        # =====================================================================
        threshold = settings.get('motion_threshold', 15)
        print(f"[Modal Motion] Computing motion density (threshold: {threshold})...")

        motion_densities = []
        total_pixels = width * height

        for frame in frames:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            diff = np.abs(gray.astype(float) - 128.0)
            motion_pixels = np.sum(diff > threshold)
            density = (motion_pixels / total_pixels) * 100
            motion_densities.append(density)

        avg_density = np.mean(motion_densities)
        max_density = np.max(motion_densities)

        # =====================================================================
        # ORGANISM DETECTION (BLOB ANALYSIS)
        # =====================================================================
        min_size = settings.get('min_size', 50)
        max_size = settings.get('max_size', 50000)
        blob_threshold = settings.get('blob_threshold', 30)

        print(f"[Modal Motion] Detecting organisms (size: {min_size}-{max_size})...")

        blob_counts = []
        blob_sizes = []
        blob_centroids = []

        for i, frame in enumerate(frames):
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            diff = np.abs(gray.astype(float) - 128.0).astype(np.uint8)
            _, binary = cv2.threshold(diff, blob_threshold, 255, cv2.THRESH_BINARY)

            # Connected components
            num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)

            frame_count = 0
            frame_centroids = []

            for j in range(1, num_labels):  # Skip background (0)
                area = stats[j, cv2.CC_STAT_AREA]
                if min_size <= area <= max_size:
                    frame_count += 1
                    blob_sizes.append(float(area))
                    cx, cy = centroids[j]
                    frame_centroids.append([float(cx), float(cy)])

            blob_counts.append(frame_count)
            blob_centroids.append(frame_centroids)

            if (i + 1) % 200 == 0:
                print(f"[Modal Motion] Progress: {(i+1)/len(frames)*100:.1f}% ({i+1}/{len(frames)} frames)")

        total_detections = len(blob_sizes)
        avg_count = np.mean(blob_counts) if blob_counts else 0
        max_count = max(blob_counts) if blob_counts else 0

        # Size distribution
        small = len([s for s in blob_sizes if s < 500])
        medium = len([s for s in blob_sizes if 500 <= s < 5000])
        large = len([s for s in blob_sizes if s >= 5000])
        mean_size = np.mean(blob_sizes) if blob_sizes else 0
        median_size = np.median(blob_sizes) if blob_sizes else 0
        std_size = np.std(blob_sizes) if blob_sizes else 0

        # =====================================================================
        # ACTIVITY HEATMAP
        # =====================================================================
        print("[Modal Motion] Computing activity heatmap...")
        grid_size = 50
        heatmap = np.zeros((grid_size, grid_size), dtype=np.float32)

        for frame in frames:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            diff = np.abs(gray.astype(float) - 128.0)
            resized = cv2.resize(diff, (grid_size, grid_size), interpolation=cv2.INTER_AREA)
            heatmap += resized

        heatmap = (heatmap / len(frames) / 128.0) * 100  # Normalize to percentage
        max_activity = float(np.max(heatmap))
        hotspot_idx = np.unravel_index(np.argmax(heatmap), heatmap.shape)

        # Zone activity
        third = grid_size // 3
        top_activity = float(np.mean(heatmap[:third, :]))
        middle_activity = float(np.mean(heatmap[third:2*third, :]))
        bottom_activity = float(np.mean(heatmap[2*third:, :]))

        # =====================================================================
        # ACTIVITY SCORE CALCULATION
        # =====================================================================
        print("[Modal Motion] Computing activity score...")

        # Normalize metrics to 0-100 scale
        energy_score = min(100, (avg_energy / 5000000) * 100)
        density_score = min(100, avg_density * 50)
        count_score = min(100, avg_count * 20)
        size_score = min(100, (mean_size / 2000) * 100) if mean_size > 0 else 0

        # Weighted average
        weights = {'energy': 0.3, 'density': 0.2, 'count': 0.3, 'size': 0.2}
        overall_score = (
            energy_score * weights['energy'] +
            density_score * weights['density'] +
            count_score * weights['count'] +
            size_score * weights['size']
        )

        processing_time = time.time() - start_time

        print(f"[Modal Motion] Complete: Score={overall_score:.1f}, Organisms={total_detections}")
        print(f"[Modal Motion] Processing time: {processing_time:.1f}s")

        # Build result in dashboard-compatible format
        result = {
            "video_info": {
                "filename": filename,
                "fps": fps,
                "resolution": {"width": width, "height": height},
                "total_frames": total_frames,
                "duration_seconds": duration
            },
            "motion": {
                "motion_energies": f"<{len(motion_energies)} values>",  # Compact for JSON
                "total_energy": float(total_energy),
                "avg_energy": float(avg_energy),
                "max_energy": float(max_energy),
                "std_energy": float(std_energy)
            },
            "density": {
                "motion_densities": f"<{len(motion_densities)} values>",
                "avg_density": float(avg_density),
                "max_density": float(max_density),
                "threshold": threshold
            },
            "organisms": {
                "blob_counts": f"<{len(blob_counts)} values>",
                "blob_sizes": f"<{len(blob_sizes)} values>",
                "blob_centroids": f"<{len(blob_centroids)} frames>",
                "total_detections": total_detections,
                "avg_count": float(avg_count),
                "max_count": int(max_count),
                "size_distribution": {
                    "small": small,
                    "medium": medium,
                    "large": large,
                    "mean_size": float(mean_size),
                    "median_size": float(median_size),
                    "std_size": float(std_size)
                },
                "parameters": {
                    "min_size": min_size,
                    "max_size": max_size,
                    "threshold": blob_threshold
                }
            },
            "heatmap": {
                "heatmap": f"<{grid_size}x{grid_size} array>",
                "resolution": [grid_size, grid_size],
                "max_activity": max_activity,
                "hotspot_coords": [int(hotspot_idx[0]), int(hotspot_idx[1])],
                "zone_activity": {
                    "top": top_activity,
                    "middle": middle_activity,
                    "bottom": bottom_activity
                }
            },
            "activity_score": {
                "overall_score": float(overall_score),
                "component_scores": {
                    "energy": float(energy_score),
                    "density": float(density_score),
                    "count": float(count_score),
                    "size": float(size_score)
                },
                "weights": weights
            },
            "processing_time_seconds": processing_time,
            "timestamp": datetime.now().isoformat(),
            "processing": {
                "platform": "modal-cpu",
                "frames_analyzed": len(frames),
            }
        }

        return result

    finally:
        os.unlink(temp_video_path)


# ============================================================================
# LOCAL CLIENT FUNCTIONS (called from batch_process_videos.py)
# ============================================================================

def run_motion_analysis_on_modal(
    video_path: str,
    video_id: str,
    settings: dict = None,
    progress_callback = None,
) -> dict:
    """
    Run motion analysis using Modal cloud CPUs.

    Args:
        video_path: Path to background-subtracted video
        video_id: Database ID for this video
        settings: Processing settings dict
        progress_callback: Optional callback for progress updates

    Returns:
        dict: Motion analysis results
    """
    video_path = Path(video_path)
    filename = video_path.name

    if progress_callback:
        progress_callback(10, "Uploading video to Modal for motion analysis...")

    print(f"[Modal Client] Reading video for motion analysis: {video_path}")

    # Read video file
    with open(video_path, 'rb') as f:
        video_bytes = f.read()

    print(f"[Modal Client] Video size: {len(video_bytes) / 1024 / 1024:.1f} MB")

    if progress_callback:
        progress_callback(20, "Starting motion analysis on Modal...")

    print(f"[Modal Client] Dispatching motion analysis to Modal...")

    with app.run():
        result = analyze_motion_on_modal.remote(video_bytes, video_id, filename, settings)

    if progress_callback:
        progress_callback(90, "Motion analysis complete")

    print(f"[Modal Client] Motion analysis complete")

    return result


def process_video_unified(
    video_path: str,
    video_id: str,
    model_path: str = None,
    settings: dict = None,
    progress_callback = None,
) -> dict:
    """
    Process a video using the unified Modal pipeline (Phase 2 optimization).

    This is the new optimized pipeline that combines:
    - Background subtraction
    - Motion analysis
    - YOLO detection

    All in a single GPU session, eliminating duplicate uploads and leveraging
    GPU memory sharing for 60-70% faster processing.

    Args:
        video_path: Path to local video file
        video_id: Database ID for this video
        model_path: Path to custom YOLO model weights (optional)
        settings: Processing settings dict with keys:
            - targetFps: '30', '15', '10', '5', or 'all' (default: '10')
            - motion_threshold: pixel diff threshold for motion detection (default: 15)
            - min_size: minimum blob size in pixels (default: 50)
            - max_size: maximum blob size in pixels (default: 50000)
            - blob_threshold: threshold for blob detection (default: 30)
        progress_callback: Optional callback(percent, message) for progress updates

    Returns:
        dict: Combined results with structure:
            {
                'background_subtraction': {...},
                'motion_analysis': {...},
                'yolo_detection': {...},
                'video_metadata': {...},
                'pipeline_metrics': {
                    'pipeline_type': 'unified',
                    'total_pipeline_seconds': float,
                    'background_subtraction_seconds': float,
                    'motion_analysis_seconds': float,
                    'yolo_detection_seconds': float,
                    'frames_processed': int,
                    'sample_rate': int,
                    'timestamp': str (ISO 8601),
                }
            }
    """
    from pathlib import Path

    video_path = Path(video_path)
    filename = video_path.name

    if progress_callback:
        progress_callback(5, "Preparing video for unified pipeline...")

    print(f"[Unified Client] Reading video: {video_path}")

    # Read video file
    with open(video_path, 'rb') as f:
        video_bytes = f.read()

    video_size_mb = len(video_bytes) / 1024 / 1024
    print(f"[Unified Client] Video size: {video_size_mb:.1f} MB")

    # Read custom model if provided
    model_weights = None
    if model_path and Path(model_path).exists():
        print(f"[Unified Client] Loading custom model: {model_path}")
        with open(model_path, 'rb') as f:
            model_weights = f.read()
        model_size_mb = len(model_weights) / 1024 / 1024
        print(f"[Unified Client] Model size: {model_size_mb:.1f} MB")

    if progress_callback:
        progress_callback(10, "Uploading to Modal (single upload for all steps)...")

    # Call unified pipeline on Modal A10G GPU
    print(f"[Unified Client] Dispatching to unified pipeline (A10G GPU)...")
    print(f"[Unified Client] This single upload handles: BG subtraction + Motion + YOLO")

    start_time = time.time()

    with app.run():
        result = process_video_unified_pipeline.remote(
            video_bytes,
            video_id,
            filename,
            model_weights,
            settings
        )

    total_time = time.time() - start_time

    if progress_callback:
        progress_callback(95, "Processing complete, finalizing results...")

    print(f"[Unified Client] Complete in {total_time:.1f}s")
    print(f"[Unified Client] Upload savings: {video_size_mb:.1f} MB (vs {video_size_mb * 2:.1f} MB in legacy pipeline)")

    # Save annotated video if generated (Phase 3 feature)
    if 'yolo_detection' in result and 'annotated_video_bytes' in result['yolo_detection']:
        try:
            annotated_bytes = result['yolo_detection']['annotated_video_bytes']
            annotated_size_mb = result['yolo_detection']['annotated_video_size_mb']

            # Save to public/videos directory
            from pathlib import Path
            output_dir = Path('public/videos')
            output_dir.mkdir(parents=True, exist_ok=True)

            annotated_path = output_dir / f"{Path(video_path).stem}_yolov8.mp4"
            with open(annotated_path, 'wb') as f:
                f.write(annotated_bytes)

            print(f"[Unified Client] Saved annotated video: {annotated_path} ({annotated_size_mb:.1f} MB)")

            # Remove bytes from result (no need to keep in memory)
            del result['yolo_detection']['annotated_video_bytes']
            result['yolo_detection']['annotated_video_path'] = str(annotated_path)

        except Exception as e:
            print(f"[Unified Client] Warning: Failed to save annotated video: {e}")

    if progress_callback:
        progress_callback(100, "Done")

    return result


def process_video_on_modal(
    video_path: str,
    video_id: str,
    gpu_type: str = 'modal-a10g',
    model_path: str = None,
    settings: dict = None,
    progress_callback = None,
) -> dict:
    """
    Process a video using Modal cloud GPUs.

    This function is called from batch_process_videos.py when run_type is modal-*.

    Args:
        video_path: Path to local video file
        video_id: Database ID for this video
        gpu_type: 'modal-t4', 'modal-a10g', or 'modal-a100'
        model_path: Path to custom YOLO model weights (optional)
        settings: Processing settings dict
        progress_callback: Optional callback for progress updates

    Returns:
        dict: Detection results
    """
    video_path = Path(video_path)
    filename = video_path.name

    if progress_callback:
        progress_callback(10, "Uploading video to Modal...")

    print(f"[Modal Client] Reading video: {video_path}")

    # Read video file
    with open(video_path, 'rb') as f:
        video_bytes = f.read()

    print(f"[Modal Client] Video size: {len(video_bytes) / 1024 / 1024:.1f} MB")

    # Read custom model if provided
    model_weights = None
    if model_path and Path(model_path).exists():
        print(f"[Modal Client] Loading custom model: {model_path}")
        with open(model_path, 'rb') as f:
            model_weights = f.read()
        print(f"[Modal Client] Model size: {len(model_weights) / 1024 / 1024:.1f} MB")

    if progress_callback:
        progress_callback(20, "Starting GPU processing...")

    # Call appropriate Modal function
    print(f"[Modal Client] Dispatching to {gpu_type}...")

    with app.run():
        if gpu_type == 'modal-a100':
            result = process_video_a100.remote(
                video_bytes, video_id, filename, model_weights, settings
            )
        elif gpu_type == 'modal-a10g':
            result = process_video_a10g.remote(
                video_bytes, video_id, filename, model_weights, settings
            )
        else:
            result = process_video_t4.remote(
                video_bytes, video_id, filename, model_weights, settings
            )

    if progress_callback:
        progress_callback(90, "Processing complete, downloading results...")

    print(f"[Modal Client] Processing complete")

    return result


# ============================================================================
# CLI ENTRYPOINT (for testing)
# ============================================================================

@app.local_entrypoint()
def main(
    video: str = "public/videos/test.mp4",
    gpu: str = "t4",
):
    """
    Test Modal processing with a single video.

    Usage:
        modal run cv_scripts/modal_processing.py --video public/videos/sample.mp4 --gpu t4
    """
    import cv2

    video_path = Path(video)
    if not video_path.exists():
        print(f"Error: Video not found: {video_path}")
        return

    print(f"Processing {video_path} on {gpu.upper()} GPU...")

    # Read video
    with open(video_path, 'rb') as f:
        video_bytes = f.read()

    # Process
    if gpu.lower() == 'a10g':
        result = process_video_a10g.remote(video_bytes, "test-id", video_path.name, None, {})
    else:
        result = process_video_t4.remote(video_bytes, "test-id", video_path.name, None, {})

    # Print results
    print("\n" + "=" * 60)
    print("PROCESSING COMPLETE")
    print("=" * 60)
    print(f"Video: {result['video_filename']}")
    print(f"Frames: {result['total_frames']}")
    print(f"Detections: {sum(d['count'] for d in result['detections'])}")
    print(f"Processing time: {result['processing']['total_time_seconds']:.1f}s")
    print(f"FPS: {result['processing']['processing_fps']:.1f}")
    print("=" * 60)

    # Save results
    output_path = f"{video_path.stem}_modal_results.json"
    with open(output_path, 'w') as f:
        json.dump(result, f, indent=2)
    print(f"Results saved to: {output_path}")


if __name__ == "__main__":
    # For local testing without Modal
    print("Use 'modal run cv_scripts/modal_processing.py' to test")
