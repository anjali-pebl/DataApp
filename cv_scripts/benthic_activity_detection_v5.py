"""
Benthic Activity Detection V5 - Unified Pipeline

Complete end-to-end pipeline: raw video → benthic activity tracking

Takes raw underwater video and produces:
- Background-subtracted video
- Annotated video with track trails
- JSON results with all tracking data

V5 Enhancements (Unified Pipeline):
- Single script for complete pipeline (no separate background subtraction needed)
- Efficient processing: background subtraction + detection in one pass
- Automatic output organization
- Progress tracking throughout entire pipeline
- Memory-efficient streaming processing

V4 Features (Retained):
- Shadow-reflection coupling: Detects dark blob (shadow) + bright blob (reflection) pairs
- Complete track trails: Entire path visible from tracking start to current frame
- Enhanced sensitivity: Lower dark threshold (10) for faint shadows
- Track trails remain visible during rest periods

V3 Features:
- Dual-threshold detection for darker organisms
- Dark and bright blob detection with separate thresholds

V2 Features:
- Extended skip frames (60 frames / ~7.5 seconds) to track through rest periods
- Rest-position memory and ROI monitoring
- Spatial proximity matching for resumed movement
- Handles scoot-rest-scoot behavior patterns typical of seafloor organisms
"""

import cv2
import numpy as np
from pathlib import Path
import json
from datetime import datetime
from dataclasses import dataclass, asdict, field
from typing import List, Tuple, Optional
from scipy.spatial.distance import cdist
import argparse


@dataclass
class Blob:
    """Single blob detection in one frame"""
    frame_idx: int
    bbox: Tuple[int, int, int, int]
    centroid: Tuple[float, float]
    area: float
    circularity: float
    aspect_ratio: float
    confidence: float = 1.0
    blob_type: str = 'standard'  # 'dark', 'bright', 'standard', or 'coupled'
    coupled_with: Optional[int] = None


@dataclass
class Track:
    """Multi-frame track of a moving organism"""
    track_id: int
    frames: List[int] = field(default_factory=list)
    bboxes: List[Tuple[int, int, int, int]] = field(default_factory=list)
    centroids: List[Tuple[float, float]] = field(default_factory=list)
    areas: List[float] = field(default_factory=list)
    confidences: List[float] = field(default_factory=list)
    is_valid: bool = False

    # Rest tracking
    last_seen_frame: int = 0
    last_known_position: Optional[Tuple[float, float]] = None
    is_resting: bool = False
    rest_roi: Optional[Tuple[int, int, int, int]] = None
    frames_since_detection: int = 0

    # Complete track trail
    position_history: List[Tuple[float, float]] = field(default_factory=list)

    # Coupling statistics
    coupled_detections: int = 0
    total_detections: int = 0

    def add_position(self, x: float, y: float):
        """Add position to complete history"""
        self.position_history.append((x, y))

    @property
    def length(self) -> int:
        return len(self.frames)

    @property
    def displacement(self) -> float:
        if len(self.centroids) < 2:
            return 0.0
        total = 0.0
        for i in range(1, len(self.centroids)):
            dx = self.centroids[i][0] - self.centroids[i-1][0]
            dy = self.centroids[i][1] - self.centroids[i-1][1]
            total += np.sqrt(dx**2 + dy**2)
        return total

    @property
    def avg_speed(self) -> float:
        if len(self.centroids) < 2:
            return 0.0
        return self.displacement / (len(self.centroids) - 1)

    @property
    def total_duration(self) -> int:
        if len(self.frames) == 0:
            return 0
        return self.frames[-1] - self.frames[0] + 1

    @property
    def coupling_rate(self) -> float:
        if self.total_detections == 0:
            return 0.0
        return (self.coupled_detections / self.total_detections) * 100


@dataclass
class DetectionParams:
    threshold: int = 30
    dark_threshold: int = 10
    bright_threshold: int = 25
    min_area: int = 30
    max_area: int = 2000
    min_circularity: float = 0.3
    max_aspect_ratio: float = 3.0
    morph_kernel_size: int = 5
    coupling_distance: int = 100
    require_coupling: bool = False
    coupling_boost: float = 1.3


@dataclass
class TrackingParams:
    max_distance: float = 50.0
    max_skip_frames: int = 60
    rest_zone_radius: int = 100


@dataclass
class ValidationParams:
    min_track_length: int = 5
    min_displacement: float = 10.0
    max_speed: float = 30.0
    min_speed: float = 0.1


@dataclass
class BackgroundParams:
    sample_every_nth_frame: int = 3
    output_fps_reduction: int = 3


def convert_to_native_types(obj):
    """Convert numpy types to native Python types for JSON serialization"""
    if isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, list):
        return [convert_to_native_types(item) for item in obj]
    elif isinstance(obj, tuple):
        return tuple(convert_to_native_types(item) for item in obj)
    elif isinstance(obj, dict):
        return {key: convert_to_native_types(value) for key, value in obj.items()}
    else:
        return obj


def compute_background(
    video_path: Path,
    params: BackgroundParams,
    max_frames_in_memory: int = 150
) -> Tuple[np.ndarray, dict]:
    """
    V5: Compute MEDIAN background from video (MEMORY-EFFICIENT VERSION).
    Uses temporal median (more robust to moving objects than mean).
    Returns background image and video metadata.

    Memory optimization: Limits frames in memory to prevent OOM errors on large videos.
    For HD 1080p videos, 150 frames ≈ 1.2GB RAM vs 21.9GB for 947 frames.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    print(f"\n[1/3] Computing Background (Temporal Median - Memory Efficient)")
    print(f"  Video: {width}x{height} @ {fps:.2f} FPS")
    print(f"  Total frames: {total_frames}")

    # Calculate effective sampling rate to stay within memory limit
    naive_sample_count = total_frames // params.sample_every_nth_frame
    if naive_sample_count > max_frames_in_memory:
        effective_sample_rate = total_frames // max_frames_in_memory
        print(f"  Memory limit: Using every {effective_sample_rate} frames (max {max_frames_in_memory} frames)")
    else:
        effective_sample_rate = params.sample_every_nth_frame
        print(f"  Sampling every {effective_sample_rate} frames")

    # Accumulate frames for median computation
    frames_list = []
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % effective_sample_rate == 0:
            frames_list.append(frame.astype(np.float32))

            # Safety check - should never exceed limit
            if len(frames_list) >= max_frames_in_memory:
                break

        frame_idx += 1

    cap.release()

    # Calculate MEDIAN background (more robust to moving objects than mean)
    print(f"  Computing median from {len(frames_list)} frames...")
    background = np.median(frames_list, axis=0).astype(np.float32)

    print(f"  Background computed from {len(frames_list)} frames")
    print(f"  Memory usage: ~{(len(frames_list) * width * height * 3 * 4) / (1024**3):.1f} GB")

    metadata = {
        'original_fps': fps,
        'total_frames': total_frames,
        'width': width,
        'height': height,
        'output_fps': fps / params.output_fps_reduction,
        'background_frames_used': len(frames_list)
    }

    return background, metadata


def subtract_background_and_detect(
    video_path: Path,
    background: np.ndarray,
    metadata: dict,
    detection_params: DetectionParams,
    tracking_params: TrackingParams,
    validation_params: ValidationParams,
    bg_params: BackgroundParams,
    output_dir: Path
) -> dict:
    """
    V5: Unified pipeline - background subtraction + benthic activity detection.
    Processes video only once for maximum efficiency.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")

    width = metadata['width']
    height = metadata['height']
    output_fps = metadata['output_fps']

    print(f"\n[2/3] Processing Pipeline")
    print(f"  Input FPS: {metadata['original_fps']:.2f}")
    print(f"  Output FPS: {output_fps:.2f}")
    print(f"  Processing every {bg_params.output_fps_reduction} frames")

    # Output paths
    video_name = video_path.stem
    bg_subtracted_path = output_dir / f"{video_name}_background_subtracted.mp4"
    annotated_path = output_dir / f"{video_name}_benthic_activity_v5.mp4"

    # Video writers
    fourcc = cv2.VideoWriter_fourcc(*'avc1')
    bg_writer = cv2.VideoWriter(str(bg_subtracted_path), fourcc, output_fps, (width, height))
    annotated_writer = cv2.VideoWriter(str(annotated_path), fourcc, output_fps, (width, height))

    # Tracking state
    active_tracks = []
    completed_tracks = []
    next_track_id = 1
    total_coupled_detections = 0
    total_detections = 0

    frame_idx = 0
    processed_frame_idx = 0

    print(f"  Starting detection...")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Process every Nth frame
        if frame_idx % bg_params.output_fps_reduction == 0:
            # Background subtraction
            frame_float = frame.astype(np.float32)
            diff = np.abs(frame_float - background)
            bg_subtracted = diff.astype(np.uint8)

            # Preprocess for detection
            gray = cv2.cvtColor(bg_subtracted, cv2.COLOR_BGR2GRAY)
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)

            # Detect blobs
            blobs = detect_blobs(blurred, processed_frame_idx, detection_params)

            # Count coupling statistics
            for blob in blobs:
                total_detections += 1
                if blob.blob_type == 'coupled':
                    total_coupled_detections += 1

            # Match to tracks
            active_tracks, unmatched_blobs = match_blobs_to_tracks(
                blobs, active_tracks, processed_frame_idx, tracking_params
            )

            # Create new tracks
            for blob in unmatched_blobs:
                new_track = Track(
                    track_id=next_track_id,
                    frames=[processed_frame_idx],
                    bboxes=[blob.bbox],
                    centroids=[blob.centroid],
                    areas=[blob.area],
                    confidences=[blob.confidence],
                    last_seen_frame=processed_frame_idx
                )
                new_track.add_position(blob.centroid[0], blob.centroid[1])
                new_track.total_detections = 1
                if blob.blob_type == 'coupled':
                    new_track.coupled_detections = 1

                active_tracks.append(new_track)
                next_track_id += 1

            # Render annotated frame
            annotated = render_annotated_frame(
                frame, active_tracks, processed_frame_idx, show_history=True
            )

            # Write outputs
            bg_writer.write(bg_subtracted)
            annotated_writer.write(annotated)

            # Progress update
            if (processed_frame_idx + 1) % 50 == 0:
                resting_count = sum(1 for t in active_tracks if t.is_resting)
                coupled_rate = (total_coupled_detections / total_detections * 100) if total_detections > 0 else 0
                print(f"  Frame {processed_frame_idx+1} - {len(active_tracks)} tracks ({resting_count} resting, {coupled_rate:.1f}% coupled)")

            processed_frame_idx += 1

        frame_idx += 1

    cap.release()
    bg_writer.release()
    annotated_writer.release()

    print(f"\n[3/3] Validation & Results")
    print(f"  Validating {len(active_tracks)} tracks...")

    # Validate tracks
    for track in active_tracks:
        track.is_valid = validate_track(track, validation_params)
        completed_tracks.append(track)

    valid_tracks = [t for t in completed_tracks if t.is_valid]
    print(f"  Valid tracks: {len(valid_tracks)}/{len(completed_tracks)}")

    # Print track statistics
    for track in valid_tracks:
        rest_periods = sum(1 for i in range(1, len(track.frames)) if track.frames[i] - track.frames[i-1] > 1)
        print(f"  Track {track.track_id}: {track.length} detections, {track.total_duration} frame span, {rest_periods} rest periods, {track.coupling_rate:.1f}% coupled")

    overall_coupling_rate = (total_coupled_detections / total_detections * 100) if total_detections > 0 else 0

    return {
        'video_info': metadata,
        'parameters': {
            'detection': asdict(detection_params),
            'tracking': asdict(tracking_params),
            'validation': asdict(validation_params),
            'background': asdict(bg_params)
        },
        'tracks': [
            {
                'track_id': t.track_id,
                'frames': t.frames,
                'bboxes': t.bboxes,
                'centroids': t.centroids,
                'areas': t.areas,
                'confidences': t.confidences,
                'is_valid': t.is_valid,
                'length': t.length,
                'displacement': t.displacement,
                'avg_speed': t.avg_speed,
                'total_duration': t.total_duration,
                'rest_periods': sum(1 for i in range(1, len(t.frames)) if t.frames[i] - t.frames[i-1] > 1),
                'coupling_rate': t.coupling_rate,
                'coupled_detections': t.coupled_detections,
                'total_detections': t.total_detections
            }
            for t in completed_tracks
        ],
        'summary': {
            'total_tracks': len(completed_tracks),
            'valid_tracks': len(valid_tracks),
            'total_detections': sum(t.length for t in completed_tracks),
            'overall_coupling_rate': overall_coupling_rate,
            'total_coupled_detections': total_coupled_detections,
            'total_blob_detections': total_detections
        },
        'version': 'v5',
        'output_paths': {
            'background_subtracted_video': str(bg_subtracted_path),
            'annotated_video': str(annotated_path),
            'results_json': str(output_dir / f"{video_path.stem}_benthic_activity_v5.json")
        }
    }


def detect_dark_blobs(frame: np.ndarray, frame_idx: int, params: DetectionParams) -> List[Blob]:
    """Detect dark blobs (shadows)"""
    frame_float = frame.astype(float)
    dark_pixels = (frame_float < 128.0).astype(np.uint8) * 255
    deviation = np.abs(frame_float - 128.0)
    _, binary_deviation = cv2.threshold(
        deviation.astype(np.uint8), params.dark_threshold, 255, cv2.THRESH_BINARY
    )
    binary = cv2.bitwise_and(dark_pixels, binary_deviation)

    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (params.morph_kernel_size, params.morph_kernel_size)
    )
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)

    return extract_blobs_from_binary(binary, frame_idx, params, blob_type='dark')


def detect_bright_blobs(frame: np.ndarray, frame_idx: int, params: DetectionParams) -> List[Blob]:
    """Detect bright blobs (reflections)"""
    frame_float = frame.astype(float)
    bright_pixels = (frame_float > 128.0).astype(np.uint8) * 255
    deviation = np.abs(frame_float - 128.0)
    _, binary_deviation = cv2.threshold(
        deviation.astype(np.uint8), params.bright_threshold, 255, cv2.THRESH_BINARY
    )
    binary = cv2.bitwise_and(bright_pixels, binary_deviation)

    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (params.morph_kernel_size, params.morph_kernel_size)
    )
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)

    return extract_blobs_from_binary(binary, frame_idx, params, blob_type='bright')


def extract_blobs_from_binary(
    binary: np.ndarray, frame_idx: int, params: DetectionParams, blob_type: str = 'standard'
) -> List[Blob]:
    """Extract blob objects from binary mask"""
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(binary, connectivity=8)

    blobs = []
    for label in range(1, num_labels):
        area = stats[label, cv2.CC_STAT_AREA]
        x = stats[label, cv2.CC_STAT_LEFT]
        y = stats[label, cv2.CC_STAT_TOP]
        w = stats[label, cv2.CC_STAT_WIDTH]
        h = stats[label, cv2.CC_STAT_HEIGHT]
        cx, cy = centroids[label]

        if area < params.min_area or area > params.max_area:
            continue

        aspect_ratio = max(w, h) / (min(w, h) + 1e-6)
        if aspect_ratio > params.max_aspect_ratio:
            continue

        blob_mask = (labels == label).astype(np.uint8)
        contours, _ = cv2.findContours(blob_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if len(contours) > 0:
            perimeter = cv2.arcLength(contours[0], True)
            circularity = (4 * np.pi * area) / (perimeter ** 2) if perimeter > 0 else 0.0
        else:
            circularity = 0.0

        if circularity < params.min_circularity:
            continue

        blobs.append(Blob(
            frame_idx=frame_idx, bbox=(x, y, w, h), centroid=(cx, cy),
            area=area, circularity=circularity, aspect_ratio=aspect_ratio,
            confidence=circularity, blob_type=blob_type
        ))

    return blobs


def find_coupled_blobs(
    dark_blobs: List[Blob], bright_blobs: List[Blob], params: DetectionParams
) -> Tuple[List[Blob], List[Blob], List[Blob]]:
    """Find shadow-reflection pairs"""
    if len(dark_blobs) == 0 or len(bright_blobs) == 0:
        return [], dark_blobs, bright_blobs

    dark_centroids = np.array([blob.centroid for blob in dark_blobs])
    bright_centroids = np.array([blob.centroid for blob in bright_blobs])
    distances = cdist(dark_centroids, bright_centroids, metric='euclidean')

    # Greedy matching
    pairs = []
    for i in range(len(dark_blobs)):
        for j in range(len(bright_blobs)):
            if distances[i, j] <= params.coupling_distance:
                pairs.append((i, j, distances[i, j]))
    pairs.sort(key=lambda x: x[2])

    coupled_pairs = []
    matched_dark = set()
    matched_bright = set()

    for dark_idx, bright_idx, dist in pairs:
        if dark_idx not in matched_dark and bright_idx not in matched_bright:
            coupled_pairs.append((dark_idx, bright_idx))
            matched_dark.add(dark_idx)
            matched_bright.add(bright_idx)

    # Create coupled blobs
    coupled_blobs = []
    for dark_idx, bright_idx in coupled_pairs:
        dark_blob = dark_blobs[dark_idx]
        coupled_blobs.append(Blob(
            frame_idx=dark_blob.frame_idx, bbox=dark_blob.bbox, centroid=dark_blob.centroid,
            area=dark_blob.area, circularity=dark_blob.circularity,
            aspect_ratio=dark_blob.aspect_ratio,
            confidence=dark_blob.confidence * params.coupling_boost,
            blob_type='coupled', coupled_with=bright_idx
        ))

    uncoupled_dark = [dark_blobs[i] for i in range(len(dark_blobs)) if i not in matched_dark]
    uncoupled_bright = [bright_blobs[i] for i in range(len(bright_blobs)) if i not in matched_bright]

    return coupled_blobs, uncoupled_dark, uncoupled_bright


def detect_blobs(frame: np.ndarray, frame_idx: int, params: DetectionParams) -> List[Blob]:
    """Detect all blobs with shadow-reflection coupling"""
    dark_blobs = detect_dark_blobs(frame, frame_idx, params)
    bright_blobs = detect_bright_blobs(frame, frame_idx, params)
    coupled_blobs, uncoupled_dark, uncoupled_bright = find_coupled_blobs(dark_blobs, bright_blobs, params)

    all_blobs = coupled_blobs.copy()
    if not params.require_coupling:
        all_blobs.extend(uncoupled_dark)

    # Standard motion detection
    frame_float = frame.astype(float)
    deviation = np.abs(frame_float - 128.0)
    _, binary_standard = cv2.threshold(
        deviation.astype(np.uint8), params.threshold, 255, cv2.THRESH_BINARY
    )

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (params.morph_kernel_size, params.morph_kernel_size))
    binary_standard = cv2.morphologyEx(binary_standard, cv2.MORPH_CLOSE, kernel)
    binary_standard = cv2.morphologyEx(binary_standard, cv2.MORPH_OPEN, kernel)

    standard_blobs = extract_blobs_from_binary(binary_standard, frame_idx, params, blob_type='standard')

    # Remove duplicates
    for std_blob in standard_blobs:
        std_cx, std_cy = std_blob.centroid
        is_duplicate = False
        for existing_blob in all_blobs:
            ex_cx, ex_cy = existing_blob.centroid
            if np.sqrt((std_cx - ex_cx)**2 + (std_cy - ex_cy)**2) < 20:
                is_duplicate = True
                break
        if not is_duplicate:
            all_blobs.append(std_blob)

    return all_blobs


def is_blob_in_rest_zone(blob: Blob, track: Track, params: TrackingParams) -> bool:
    """Check if blob is within rest zone"""
    if not track.is_resting or track.last_known_position is None:
        return False
    last_x, last_y = track.last_known_position
    blob_x, blob_y = blob.centroid
    distance = np.sqrt((blob_x - last_x)**2 + (blob_y - last_y)**2)
    return distance <= params.rest_zone_radius


def match_blobs_to_tracks(
    blobs: List[Blob], active_tracks: List[Track], frame_idx: int, params: TrackingParams
) -> Tuple[List[Track], List[Blob]]:
    """Match blobs to existing tracks"""
    if len(active_tracks) == 0:
        return [], blobs

    if len(blobs) == 0:
        updated_tracks = []
        for track in active_tracks:
            track.frames_since_detection += 1
            if track.frames_since_detection <= params.max_skip_frames:
                if not track.is_resting and track.last_known_position is not None:
                    track.is_resting = True
                    lx, ly = track.last_known_position
                    track.rest_roi = (
                        int(lx - params.rest_zone_radius), int(ly - params.rest_zone_radius),
                        int(2 * params.rest_zone_radius), int(2 * params.rest_zone_radius)
                    )
                updated_tracks.append(track)
        return updated_tracks, []

    blob_centroids = np.array([b.centroid for b in blobs])
    track_centroids = np.array([t.centroids[-1] for t in active_tracks])
    distances = cdist(blob_centroids, track_centroids, metric='euclidean')

    # Adjust for resting tracks
    for t_idx, track in enumerate(active_tracks):
        if track.is_resting:
            for b_idx, blob in enumerate(blobs):
                if is_blob_in_rest_zone(blob, track, params):
                    distances[b_idx, t_idx] *= 0.5

    # Greedy matching
    matched_blobs = set()
    matched_tracks = set()
    updated_tracks = []

    pairs = []
    for b_idx in range(len(blobs)):
        for t_idx in range(len(active_tracks)):
            if distances[b_idx, t_idx] <= params.max_distance:
                pairs.append((b_idx, t_idx, distances[b_idx, t_idx]))
    pairs.sort(key=lambda x: x[2])

    for b_idx, t_idx, dist in pairs:
        if b_idx not in matched_blobs and t_idx not in matched_tracks:
            track = active_tracks[t_idx]
            blob = blobs[b_idx]

            track.frames.append(frame_idx)
            track.bboxes.append(blob.bbox)
            track.centroids.append(blob.centroid)
            track.areas.append(blob.area)
            track.confidences.append(blob.confidence)
            track.last_seen_frame = frame_idx
            track.last_known_position = blob.centroid
            track.frames_since_detection = 0
            track.is_resting = False
            track.rest_roi = None
            track.add_position(blob.centroid[0], blob.centroid[1])
            track.total_detections += 1
            if blob.blob_type == 'coupled':
                track.coupled_detections += 1

            matched_blobs.add(b_idx)
            matched_tracks.add(t_idx)

    # Update unmatched tracks
    for t_idx, track in enumerate(active_tracks):
        if t_idx not in matched_tracks:
            track.frames_since_detection += 1
            if track.frames_since_detection <= params.max_skip_frames:
                if not track.is_resting and track.last_known_position is not None:
                    track.is_resting = True
                    lx, ly = track.last_known_position
                    track.rest_roi = (
                        int(lx - params.rest_zone_radius), int(ly - params.rest_zone_radius),
                        int(2 * params.rest_zone_radius), int(2 * params.rest_zone_radius)
                    )
                updated_tracks.append(track)

    for t_idx in matched_tracks:
        updated_tracks.append(active_tracks[t_idx])

    unmatched_blobs = [blobs[i] for i in range(len(blobs)) if i not in matched_blobs]
    return updated_tracks, unmatched_blobs


def validate_track(track: Track, params: ValidationParams) -> bool:
    """Validate track quality"""
    if track.length < params.min_track_length:
        return False
    if track.displacement < params.min_displacement:
        return False
    if track.avg_speed < params.min_speed or track.avg_speed > params.max_speed:
        return False
    return True


def draw_track_trail(frame: np.ndarray, track: Track, color: Tuple[int, int, int]) -> np.ndarray:
    """Draw complete track trail"""
    if len(track.position_history) < 2:
        return frame

    points = np.array([(int(x), int(y)) for x, y in track.position_history], dtype=np.int32)
    cv2.polylines(frame, [points], False, color, 2, lineType=cv2.LINE_AA)

    for i, (x, y) in enumerate(track.position_history):
        alpha = (i + 1) / len(track.position_history)
        radius = max(1, int(2 * alpha))
        cv2.circle(frame, (int(x), int(y)), radius, color, -1)

    return frame


def render_annotated_frame(
    frame: np.ndarray, tracks: List[Track], current_frame: int, show_history: bool = True
) -> np.ndarray:
    """Render frame with annotations and trails"""
    annotated = frame.copy()

    # Draw trails first
    for track in tracks:
        color = (0, 255, 0) if track.is_valid else (0, 165, 255)
        if show_history:
            annotated = draw_track_trail(annotated, track, color)

    # Draw current detections
    for track in tracks:
        if current_frame not in track.frames:
            continue

        idx_in_track = track.frames.index(current_frame)
        bbox = track.bboxes[idx_in_track]
        centroid = track.centroids[idx_in_track]
        x, y, w, h = bbox
        cx, cy = centroid
        color = (0, 255, 0) if track.is_valid else (0, 165, 255)

        cv2.rectangle(annotated, (x, y), (x+w, y+h), color, 2)
        cv2.circle(annotated, (int(cx), int(cy)), 3, color, -1)

        label = f"ID:{track.track_id}"
        if track.total_detections > 0:
            label += f" ({track.coupling_rate:.0f}% coupled)"

        cv2.putText(annotated, label, (x, y-5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)

    return annotated


def process_video(
    video_path: Path,
    output_dir: Path,
    detection_params: DetectionParams,
    tracking_params: TrackingParams,
    validation_params: ValidationParams,
    bg_params: BackgroundParams
) -> dict:
    """V5: Complete unified pipeline"""
    print(f"\n{'='*80}")
    print("BENTHIC ACTIVITY DETECTION V5 - Unified Pipeline")
    print(f"{'='*80}")
    print(f"Input: {video_path}")
    print(f"Output: {output_dir}\n")

    start_time = datetime.now()

    # Step 1: Compute background
    background, metadata = compute_background(video_path, bg_params)

    # Save background image
    bg_image_path = output_dir / f"{video_path.stem}_average_background.jpg"
    cv2.imwrite(str(bg_image_path), background.astype(np.uint8))
    print(f"  Background saved: {bg_image_path}")

    # Step 2: Unified processing
    results = subtract_background_and_detect(
        video_path, background, metadata,
        detection_params, tracking_params, validation_params, bg_params,
        output_dir
    )

    # Add timing
    results['processing_time'] = (datetime.now() - start_time).total_seconds()
    results['timestamp'] = datetime.now().isoformat()

    # Save results
    results_path = output_dir / f"{video_path.stem}_benthic_activity_v5.json"
    with open(results_path, 'w') as f:
        json.dump(convert_to_native_types(results), f, indent=2)

    print(f"\n{'='*80}")
    print("PIPELINE COMPLETE")
    print(f"{'='*80}")
    print(f"Processing time: {results['processing_time']:.1f}s")
    print(f"Valid tracks: {results['summary']['valid_tracks']}")
    print(f"Coupling rate: {results['summary']['overall_coupling_rate']:.1f}%")
    print(f"\nOutputs:")
    print(f"  Background: {bg_image_path}")
    print(f"  BG Subtracted: {results['output_paths']['background_subtracted_video']}")
    print(f"  Annotated: {results['output_paths']['annotated_video']}")
    print(f"  Results: {results_path}")
    print(f"{'='*80}\n")

    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description="Benthic Activity Detection V5: Unified pipeline from raw video to tracking results"
    )
    parser.add_argument('--input', '-i', required=True, help='Input raw video path')
    parser.add_argument('--output', '-o', default='results/', help='Output directory')

    # Detection parameters
    parser.add_argument('--threshold', type=int, default=30)
    parser.add_argument('--dark-threshold', type=int, default=10)
    parser.add_argument('--bright-threshold', type=int, default=25)
    parser.add_argument('--min-area', type=int, default=30)
    parser.add_argument('--max-area', type=int, default=2000)
    parser.add_argument('--coupling-distance', type=int, default=100)

    # Tracking parameters
    parser.add_argument('--max-skip-frames', type=int, default=60)
    parser.add_argument('--rest-zone-radius', type=int, default=100)

    # Validation parameters
    parser.add_argument('--min-track-length', type=int, default=5)
    parser.add_argument('--min-displacement', type=float, default=10.0)

    args = parser.parse_args()

    params_detection = DetectionParams(
        threshold=args.threshold,
        dark_threshold=args.dark_threshold,
        bright_threshold=args.bright_threshold,
        min_area=args.min_area,
        max_area=args.max_area,
        coupling_distance=args.coupling_distance
    )

    params_tracking = TrackingParams(
        max_skip_frames=args.max_skip_frames,
        rest_zone_radius=args.rest_zone_radius
    )

    params_validation = ValidationParams(
        min_track_length=args.min_track_length,
        min_displacement=args.min_displacement
    )

    params_bg = BackgroundParams()

    process_video(
        Path(args.input),
        Path(args.output),
        params_detection,
        params_tracking,
        params_validation,
        params_bg
    )
