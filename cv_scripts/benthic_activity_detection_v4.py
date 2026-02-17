"""
Benthic Activity Detection V4 - Shadow-Reflection Coupling & Track Trails

Tracks slow-moving benthic organisms (crabs, snails, starfish, etc.) in
background-subtracted underwater videos.

V4 Enhancements:
- Shadow-reflection coupling: Detects dark blob (shadow) + bright blob (reflection) pairs
- Hard-shelled organisms create distinctive coupled patterns from light reflection
- Persistent track trails: Complete path visible from tracking start to current frame
- Track trails remain visible during rest periods for easy organism following
- Enhanced sensitivity: Lower dark threshold (10) for faint shadows

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
import time

# Import logging utilities
from logging_utils import (
    set_verbosity, get_verbosity,
    VERBOSITY_MINIMAL, VERBOSITY_NORMAL, VERBOSITY_DETAILED,
    print_organisms_result, print_result_info, print_result_success,
    print_box_line, print_box_top, print_box_bottom, print_progress_bar,
    STATUS_SUCCESS, STATUS_ERROR, STATUS_WARNING, STATUS_INFO
)


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
    blob_type: str = 'standard'  # V4: 'dark', 'bright', 'standard', or 'coupled'
    coupled_with: Optional[int] = None  # V4: Index of coupled blob if applicable


@dataclass
class Track:
    """Multi-frame track of a moving organism with rest-position tracking"""
    track_id: int
    frames: List[int] = field(default_factory=list)
    bboxes: List[Tuple[int, int, int, int]] = field(default_factory=list)
    centroids: List[Tuple[float, float]] = field(default_factory=list)
    areas: List[float] = field(default_factory=list)
    confidences: List[float] = field(default_factory=list)
    is_valid: bool = False

    # V2 Enhancement: Rest tracking
    last_seen_frame: int = 0
    last_known_position: Optional[Tuple[float, float]] = None
    is_resting: bool = False
    rest_roi: Optional[Tuple[int, int, int, int]] = None
    frames_since_detection: int = 0

    # V4 Enhancement: Track trail (complete path from start)
    position_history: List[Tuple[float, float]] = field(default_factory=list)

    # V4 Enhancement: Coupling statistics
    coupled_detections: int = 0
    total_detections: int = 0

    def add_position(self, x: float, y: float):
        """V4: Add position to history - keeps entire path from beginning"""
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
        """Total frames from first to last detection (including rest periods)"""
        if len(self.frames) == 0:
            return 0
        return self.frames[-1] - self.frames[0] + 1

    @property
    def coupling_rate(self) -> float:
        """V4: Percentage of detections that were coupled"""
        if self.total_detections == 0:
            return 0.0
        return (self.coupled_detections / self.total_detections) * 100


@dataclass
class DetectionParams:
    threshold: int = 30
    dark_threshold: int = 18  # V4.6: Reduced false positives - raised from 8 to 18
    bright_threshold: int = 40  # V4.6: Reduced false positives - raised from 25 to 40
    min_area: int = 75  # V4.6: Filter small noise - raised from 25 to 75
    max_area: int = 2000
    min_circularity: float = 0.3
    max_aspect_ratio: float = 3.0
    morph_kernel_size: int = 5

    # V4: Coupling parameters
    coupling_distance: int = 100  # Max pixel distance for shadow-reflection pairing
    require_coupling: bool = False  # If True, only accept coupled detections
    coupling_boost: float = 1.3  # Confidence boost for coupled detections


@dataclass
class TrackingParams:
    max_distance: float = 75.0  # V4.5: Increased from 50 to 75 for longer tracking
    max_skip_frames: int = 90  # V4.5: Extended from 60 to 90 frames (~11 sec at 8fps)
    rest_zone_radius: int = 120  # V4.5: Increased from 100 to 120px for wider rest monitoring


@dataclass
class ValidationParams:
    min_track_length: int = 4  # V4.5: Lowered from 5 to 4 to keep shorter tracks
    min_displacement: float = 8.0  # V4.5: Lowered from 10 to 8 for slower organisms
    max_speed: float = 30.0
    min_speed: float = 0.1


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


def preprocess_frame(frame: np.ndarray) -> np.ndarray:
    """Prepare frame for blob detection."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    return blurred


def detect_dark_blobs(
    frame: np.ndarray,
    frame_idx: int,
    params: DetectionParams
) -> List[Blob]:
    """
    V4: Detect dark blobs (shadows) with enhanced sensitivity.
    Pixels darker than background (< 128) with deviation > dark_threshold.
    """
    frame_float = frame.astype(float)

    # Detect dark pixels with deviation
    dark_pixels = (frame_float < 128.0).astype(np.uint8) * 255
    deviation = np.abs(frame_float - 128.0)
    _, binary_deviation = cv2.threshold(
        deviation.astype(np.uint8),
        params.dark_threshold,
        255,
        cv2.THRESH_BINARY
    )

    # Combine: must be both dark AND have sufficient deviation
    binary = cv2.bitwise_and(dark_pixels, binary_deviation)

    # Morphological operations
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (params.morph_kernel_size, params.morph_kernel_size)
    )
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)

    return extract_blobs_from_binary(binary, frame_idx, params, blob_type='dark')


def detect_bright_blobs(
    frame: np.ndarray,
    frame_idx: int,
    params: DetectionParams
) -> List[Blob]:
    """
    V4: Detect bright blobs (reflections) from hard shells.
    Pixels brighter than background (> 128) with deviation > bright_threshold.
    """
    frame_float = frame.astype(float)

    # Detect bright pixels with deviation
    bright_pixels = (frame_float > 128.0).astype(np.uint8) * 255
    deviation = np.abs(frame_float - 128.0)
    _, binary_deviation = cv2.threshold(
        deviation.astype(np.uint8),
        params.bright_threshold,
        255,
        cv2.THRESH_BINARY
    )

    # Combine: must be both bright AND have sufficient deviation
    binary = cv2.bitwise_and(bright_pixels, binary_deviation)

    # Morphological operations
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (params.morph_kernel_size, params.morph_kernel_size)
    )
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)

    return extract_blobs_from_binary(binary, frame_idx, params, blob_type='bright')


def extract_blobs_from_binary(
    binary: np.ndarray,
    frame_idx: int,
    params: DetectionParams,
    blob_type: str = 'standard'
) -> List[Blob]:
    """Extract blob objects from binary mask"""
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
        binary, connectivity=8
    )

    blobs = []

    for label in range(1, num_labels):
        area = stats[label, cv2.CC_STAT_AREA]
        x = stats[label, cv2.CC_STAT_LEFT]
        y = stats[label, cv2.CC_STAT_TOP]
        w = stats[label, cv2.CC_STAT_WIDTH]
        h = stats[label, cv2.CC_STAT_HEIGHT]
        cx, cy = centroids[label]

        # Area filtering
        if area < params.min_area or area > params.max_area:
            continue

        # Aspect ratio filtering
        aspect_ratio = max(w, h) / (min(w, h) + 1e-6)
        if aspect_ratio > params.max_aspect_ratio:
            continue

        # Circularity filtering
        blob_mask = (labels == label).astype(np.uint8)
        contours, _ = cv2.findContours(blob_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if len(contours) > 0:
            perimeter = cv2.arcLength(contours[0], True)
            if perimeter > 0:
                circularity = (4 * np.pi * area) / (perimeter ** 2)
            else:
                circularity = 0.0
        else:
            circularity = 0.0

        if circularity < params.min_circularity:
            continue

        blob = Blob(
            frame_idx=frame_idx,
            bbox=(x, y, w, h),
            centroid=(cx, cy),
            area=area,
            circularity=circularity,
            aspect_ratio=aspect_ratio,
            confidence=circularity,
            blob_type=blob_type
        )
        blobs.append(blob)

    return blobs


def find_coupled_blobs(
    dark_blobs: List[Blob],
    bright_blobs: List[Blob],
    params: DetectionParams
) -> Tuple[List[Blob], List[Blob], List[Blob]]:
    """
    V4: Find shadow-reflection pairs (dark + bright blob coupling).

    Returns:
        coupled_blobs: List of coupled detections (dark-bright pairs merged)
        uncoupled_dark: Dark blobs without bright partners
        uncoupled_bright: Bright blobs without dark partners
    """
    if len(dark_blobs) == 0 or len(bright_blobs) == 0:
        return [], dark_blobs, bright_blobs

    # Calculate pairwise distances between dark and bright blob centroids
    dark_centroids = np.array([blob.centroid for blob in dark_blobs])
    bright_centroids = np.array([blob.centroid for blob in bright_blobs])

    distances = cdist(dark_centroids, bright_centroids, metric='euclidean')

    # Greedy matching: find closest pairs within coupling_distance
    coupled_pairs = []
    matched_dark = set()
    matched_bright = set()

    # Sort all possible pairs by distance
    pairs = []
    for i in range(len(dark_blobs)):
        for j in range(len(bright_blobs)):
            if distances[i, j] <= params.coupling_distance:
                pairs.append((i, j, distances[i, j]))

    pairs.sort(key=lambda x: x[2])  # Sort by distance

    # Match greedily
    for dark_idx, bright_idx, dist in pairs:
        if dark_idx not in matched_dark and bright_idx not in matched_bright:
            coupled_pairs.append((dark_idx, bright_idx))
            matched_dark.add(dark_idx)
            matched_bright.add(bright_idx)

    # Create coupled blob objects
    coupled_blobs = []
    for dark_idx, bright_idx in coupled_pairs:
        dark_blob = dark_blobs[dark_idx]
        bright_blob = bright_blobs[bright_idx]

        # Use dark blob as primary, boost confidence
        coupled_blob = Blob(
            frame_idx=dark_blob.frame_idx,
            bbox=dark_blob.bbox,
            centroid=dark_blob.centroid,
            area=dark_blob.area,
            circularity=dark_blob.circularity,
            aspect_ratio=dark_blob.aspect_ratio,
            confidence=dark_blob.confidence * params.coupling_boost,
            blob_type='coupled',
            coupled_with=bright_idx
        )
        coupled_blobs.append(coupled_blob)

    # Uncoupled blobs
    uncoupled_dark = [dark_blobs[i] for i in range(len(dark_blobs)) if i not in matched_dark]
    uncoupled_bright = [bright_blobs[i] for i in range(len(bright_blobs)) if i not in matched_bright]

    return coupled_blobs, uncoupled_dark, uncoupled_bright


def detect_blobs(
    frame: np.ndarray,
    frame_idx: int,
    params: DetectionParams
) -> List[Blob]:
    """
    V4: Detect all blobs with shadow-reflection coupling analysis.

    Returns combined list of:
    - Coupled detections (shadow + reflection pairs)
    - Uncoupled dark blobs (shadows without reflections)
    - Uncoupled bright blobs (reflections without shadows) - optional
    - Standard motion blobs
    """
    # Detect dark blobs (shadows)
    dark_blobs = detect_dark_blobs(frame, frame_idx, params)

    # Detect bright blobs (reflections)
    bright_blobs = detect_bright_blobs(frame, frame_idx, params)

    # Find coupled pairs
    coupled_blobs, uncoupled_dark, uncoupled_bright = find_coupled_blobs(
        dark_blobs, bright_blobs, params
    )

    # Combine all detections
    all_blobs = coupled_blobs.copy()

    if not params.require_coupling:
        # Include uncoupled dark blobs (may still be valid organisms)
        all_blobs.extend(uncoupled_dark)

    # Also detect standard bright motion for any other movement
    frame_float = frame.astype(float)
    deviation = np.abs(frame_float - 128.0)
    _, binary_standard = cv2.threshold(
        deviation.astype(np.uint8),
        params.threshold,
        255,
        cv2.THRESH_BINARY
    )

    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (params.morph_kernel_size, params.morph_kernel_size)
    )
    binary_standard = cv2.morphologyEx(binary_standard, cv2.MORPH_CLOSE, kernel)
    binary_standard = cv2.morphologyEx(binary_standard, cv2.MORPH_OPEN, kernel)

    standard_blobs = extract_blobs_from_binary(binary_standard, frame_idx, params, blob_type='standard')

    # Remove standard blobs that overlap with dark/bright detections
    # (avoid double-counting)
    for std_blob in standard_blobs:
        std_cx, std_cy = std_blob.centroid
        is_duplicate = False

        for existing_blob in all_blobs:
            ex_cx, ex_cy = existing_blob.centroid
            dist = np.sqrt((std_cx - ex_cx)**2 + (std_cy - ex_cy)**2)
            if dist < 20:  # Threshold for duplicate detection
                is_duplicate = True
                break

        if not is_duplicate:
            all_blobs.append(std_blob)

    return all_blobs


def is_blob_in_rest_zone(blob: Blob, track: Track, params: TrackingParams) -> bool:
    """V2 Enhancement: Check if blob is within rest zone of resting track"""
    if not track.is_resting or track.last_known_position is None:
        return False

    last_x, last_y = track.last_known_position
    blob_x, blob_y = blob.centroid

    distance = np.sqrt((blob_x - last_x)**2 + (blob_y - last_y)**2)

    return distance <= params.rest_zone_radius


def match_blobs_to_tracks(
    blobs: List[Blob],
    active_tracks: List[Track],
    frame_idx: int,
    params: TrackingParams
) -> Tuple[List[Track], List[Blob]]:
    """V2 Enhanced: Match detected blobs to existing tracks with rest-zone support"""
    if len(active_tracks) == 0:
        return [], blobs

    if len(blobs) == 0:
        # V2: Update rest status for all tracks
        updated_tracks = []
        for track in active_tracks:
            track.frames_since_detection += 1

            if track.frames_since_detection <= params.max_skip_frames:
                # Mark as resting
                if not track.is_resting and track.last_known_position is not None:
                    track.is_resting = True
                    lx, ly = track.last_known_position
                    track.rest_roi = (
                        int(lx - params.rest_zone_radius),
                        int(ly - params.rest_zone_radius),
                        int(2 * params.rest_zone_radius),
                        int(2 * params.rest_zone_radius)
                    )
                updated_tracks.append(track)

        return updated_tracks, []

    # Calculate distances between blobs and tracks
    blob_centroids = np.array([b.centroid for b in blobs])
    track_centroids = np.array([t.centroids[-1] for t in active_tracks])

    distances = cdist(blob_centroids, track_centroids, metric='euclidean')

    # V2: Adjust distances for resting tracks (prefer rest zone matches)
    for t_idx, track in enumerate(active_tracks):
        if track.is_resting:
            for b_idx, blob in enumerate(blobs):
                if is_blob_in_rest_zone(blob, track, params):
                    distances[b_idx, t_idx] *= 0.5  # Boost rest-zone matches

    # Match blobs to tracks (greedy)
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

            # V4: Update position history and coupling stats
            track.add_position(blob.centroid[0], blob.centroid[1])
            track.total_detections += 1
            if blob.blob_type == 'coupled':
                track.coupled_detections += 1

            matched_blobs.add(b_idx)
            matched_tracks.add(t_idx)

    # Update unmatched tracks (check skip frames)
    for t_idx, track in enumerate(active_tracks):
        if t_idx not in matched_tracks:
            track.frames_since_detection += 1

            if track.frames_since_detection <= params.max_skip_frames:
                # Mark as resting
                if not track.is_resting and track.last_known_position is not None:
                    track.is_resting = True
                    lx, ly = track.last_known_position
                    track.rest_roi = (
                        int(lx - params.rest_zone_radius),
                        int(ly - params.rest_zone_radius),
                        int(2 * params.rest_zone_radius),
                        int(2 * params.rest_zone_radius)
                    )
                updated_tracks.append(track)

    # Add matched tracks
    for t_idx in matched_tracks:
        updated_tracks.append(active_tracks[t_idx])

    unmatched_blobs = [blobs[i] for i in range(len(blobs)) if i not in matched_blobs]

    return updated_tracks, unmatched_blobs


def validate_track(track: Track, params: ValidationParams) -> bool:
    """Validate if a track meets minimum quality criteria"""
    if track.length < params.min_track_length:
        return False

    if track.displacement < params.min_displacement:
        return False

    if track.avg_speed < params.min_speed:
        return False

    if track.avg_speed > params.max_speed:
        return False

    return True


def draw_track_trail(
    frame: np.ndarray,
    track: Track,
    color: Tuple[int, int, int]
) -> np.ndarray:
    """
    V4: Draw complete track trail from beginning to current position.
    Shows entire path history - helps user follow organism even during rest periods.
    """
    if len(track.position_history) < 2:
        return frame

    # Draw solid polyline trail
    points = np.array([(int(x), int(y)) for x, y in track.position_history], dtype=np.int32)
    cv2.polylines(frame, [points], False, color, 2, lineType=cv2.LINE_AA)

    # Optional: Draw dots at each position for better visibility
    for i, (x, y) in enumerate(track.position_history):
        # Fade older positions
        alpha = (i + 1) / len(track.position_history)
        radius = max(1, int(2 * alpha))
        cv2.circle(frame, (int(x), int(y)), radius, color, -1)

    return frame


def render_annotated_frame(
    frame: np.ndarray,
    tracks: List[Track],
    current_frame: int,
    show_history: bool = True
) -> np.ndarray:
    """Render frame with track annotations and trails"""
    annotated = frame.copy()

    # V4: Draw trails first (behind bounding boxes)
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
        confidence = track.confidences[idx_in_track]

        x, y, w, h = bbox
        cx, cy = centroid

        color = (0, 255, 0) if track.is_valid else (0, 165, 255)

        # Bounding box
        cv2.rectangle(annotated, (x, y), (x+w, y+h), color, 2)

        # Centroid
        cv2.circle(annotated, (int(cx), int(cy)), 3, color, -1)

        # Label with coupling info
        label = f"ID:{track.track_id}"
        if track.total_detections > 0:
            coupling_pct = track.coupling_rate
            label += f" ({coupling_pct:.0f}% coupled)"

        cv2.putText(
            annotated, label, (x, y-5),
            cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1
        )

    return annotated


def process_video(
    video_path: Path,
    output_dir: Path,
    detection_params: DetectionParams,
    tracking_params: TrackingParams,
    validation_params: ValidationParams,
    video_id: str = None,
    run_id: str = None
) -> dict:
    """Main processing pipeline for benthic activity detection V4."""
    if get_verbosity() >= VERBOSITY_DETAILED:
        print(f"\n{'='*80}")
        print("BENTHIC ACTIVITY DETECTION V4 - Shadow-Reflection Coupling & Track Trails")
        print(f"{'='*80}")
        print(f"Input: {video_path}")
        print(f"Output: {output_dir}")
        print(f"\nV4 Enhancements:")
        print(f"  - Shadow-reflection coupling (max distance: {detection_params.coupling_distance}px)")
        print(f"  - Complete track trails (entire path from start to current frame)")
        print(f"  - Enhanced sensitivity (dark threshold: {detection_params.dark_threshold})")
        print(f"\nV3 Features:")
        print(f"  - Dual-threshold detection (dark: {detection_params.dark_threshold}, bright: {detection_params.bright_threshold})")
        print(f"  - Dark + bright blob detection")
        print(f"\nV2 Features:")
        print(f"  - Extended skip frames: {tracking_params.max_skip_frames} (~7.5 seconds)")
        print(f"  - Rest zone monitoring: {tracking_params.rest_zone_radius}px radius")
        print(f"  - Spatial proximity matching")

    start_time = datetime.now()

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Calculate video duration
    duration_seconds = total_frames / fps if fps > 0 else 0

    if get_verbosity() >= VERBOSITY_NORMAL:
        print_box_line(f"{STATUS_INFO} Scanning {total_frames} frames at {fps:.0f} fps ({duration_seconds:.0f} second video)")
        print_box_line(f"{STATUS_INFO} Using advanced tracking (shadows + reflections)")
        print_box_line("")

    if get_verbosity() >= VERBOSITY_DETAILED:
        print(f"\nVideo Info:")
        print(f"  FPS: {fps:.2f}")
        print(f"  Frames: {total_frames}")
        print(f"  Resolution: {width}x{height}")

    output_video_path = output_dir / f"{video_path.stem}_benthic_activity_v4.mp4"
    fourcc = cv2.VideoWriter_fourcc(*'avc1')
    writer = cv2.VideoWriter(str(output_video_path), fourcc, fps, (width, height))

    active_tracks = []
    completed_tracks = []
    next_track_id = 1

    # V4: Track coupling statistics
    total_coupled_detections = 0
    total_detections = 0

    # Track per-frame detection counts for timeline visualization
    frame_detection_counts = []

    if get_verbosity() >= VERBOSITY_DETAILED:
        print(f"\nProcessing {total_frames} frames...")

    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        gray = preprocess_frame(frame)
        blobs = detect_blobs(gray, frame_idx, detection_params)

        # V4: Count coupling statistics
        for blob in blobs:
            total_detections += 1
            if blob.blob_type == 'coupled':
                total_coupled_detections += 1

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
                confidences=[blob.confidence],
                last_seen_frame=frame_idx
            )
            new_track.add_position(blob.centroid[0], blob.centroid[1])
            new_track.total_detections = 1
            if blob.blob_type == 'coupled':
                new_track.coupled_detections = 1

            active_tracks.append(new_track)
            next_track_id += 1

        annotated = render_annotated_frame(frame, active_tracks, frame_idx, show_history=True)
        writer.write(annotated)

        # Track detection counts for timeline visualization
        active_count = len([t for t in active_tracks if frame_idx in t.frames or
                            (t.is_resting and frame_idx - t.last_seen_frame <= tracking_params.max_skip_frames)])
        coupled_blobs_count = sum(1 for blob in blobs if blob.blob_type == 'coupled')

        frame_detection_counts.append({
            'frame': int(frame_idx),
            'timestamp': float(frame_idx / fps),
            'active_tracks': int(active_count),
            'blobs_detected': int(len(blobs)),
            'coupled_blobs': int(coupled_blobs_count),
        })

        if (frame_idx + 1) % 50 == 0 and get_verbosity() >= VERBOSITY_DETAILED:
            resting_count = sum(1 for t in active_tracks if t.is_resting)
            coupled_rate = (total_coupled_detections / total_detections * 100) if total_detections > 0 else 0
            print(f"  Frame {frame_idx+1}/{total_frames} - {len(active_tracks)} tracks ({resting_count} resting, {coupled_rate:.1f}% coupled)")

        frame_idx += 1

    cap.release()
    writer.release()

    if get_verbosity() >= VERBOSITY_DETAILED:
        print(f"\nValidating {len(active_tracks)} tracks...")

    for track in active_tracks:
        track.is_valid = validate_track(track, validation_params)
        completed_tracks.append(track)

    valid_tracks = [t for t in completed_tracks if t.is_valid]

    if get_verbosity() >= VERBOSITY_DETAILED:
        print(f"  Valid tracks: {len(valid_tracks)}/{len(completed_tracks)}")

        # V4: Enhanced statistics with coupling info
        for track in valid_tracks:
            rest_periods = sum(1 for i in range(1, len(track.frames)) if track.frames[i] - track.frames[i-1] > 1)
            print(f"  Track {track.track_id}: {track.length} detections, {track.total_duration} frame span, {rest_periods} rest periods, {track.coupling_rate:.1f}% coupled")

    # Calculate overall coupling rate
    overall_coupling_rate = (total_coupled_detections / total_detections * 100) if total_detections > 0 else 0

    results = {
        'video_info': {
            'filename': video_path.name,
            'fps': fps,
            'total_frames': total_frames,
            'resolution': {'width': width, 'height': height}
        },
        'parameters': {
            'detection': asdict(detection_params),
            'tracking': asdict(tracking_params),
            'validation': asdict(validation_params)
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
        'frame_detections': frame_detection_counts,
        'summary': {
            'total_tracks': len(completed_tracks),
            'valid_tracks': len(valid_tracks),
            'total_detections': sum(t.length for t in completed_tracks),
            'processing_time': (datetime.now() - start_time).total_seconds(),
            'overall_coupling_rate': overall_coupling_rate,
            'total_coupled_detections': total_coupled_detections,
            'total_blob_detections': total_detections
        },
        'version': 'v4',
        'timestamp': datetime.now().isoformat(),
        'video_id': video_id,
        'run_id': run_id,
        'output_paths': {
            'annotated_video': str(output_video_path),
            'results_json': str(output_dir / f"{video_path.stem}_benthic_activity_v4.json")
        }
    }

    results_path = output_dir / f"{video_path.stem}_benthic_activity_v4.json"
    with open(results_path, 'w') as f:
        json.dump(convert_to_native_types(results), f, indent=2)

    # Print organism results
    if get_verbosity() >= VERBOSITY_NORMAL:
        print_organisms_result(len(valid_tracks))
        if get_verbosity() >= VERBOSITY_NORMAL:
            print_result_success(f"Processing complete ({results['summary']['processing_time']:.0f}s)")
            print_result_success(f"Created: {output_video_path.name}")
            print_result_success(f"Created: {results_path.name}")
        print_box_bottom()

    if get_verbosity() >= VERBOSITY_DETAILED:
        print(f"\n{'='*80}")
        print("DETECTION COMPLETE")
        print(f"{'='*80}")
        print(f"Processing time: {results['summary']['processing_time']:.1f}s")
        print(f"Valid tracks: {len(valid_tracks)}")
        print(f"Overall coupling rate: {overall_coupling_rate:.1f}%")
        print(f"Annotated video: {output_video_path}")
        print(f"Results JSON: {results_path}")
        print(f"{'='*80}")

    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description="Benthic Activity Detection V4: Shadow-reflection coupling and track trails"
    )
    parser.add_argument('--input', '-i', required=True, help='Input motion video path')
    parser.add_argument('--output', '-o', default='results/', help='Output directory')

    # Detection parameters
    parser.add_argument('--threshold', type=int, default=30)
    parser.add_argument('--dark-threshold', type=int, default=10)  # V4: Enhanced sensitivity
    parser.add_argument('--bright-threshold', type=int, default=25)  # V4: New - threshold for bright reflections
    parser.add_argument('--min-area', type=int, default=30)  # V4: Detect smaller organisms
    parser.add_argument('--max-area', type=int, default=2000)
    parser.add_argument('--min-circularity', type=float, default=0.3)
    parser.add_argument('--max-aspect-ratio', type=float, default=3.0)

    # V4: Coupling parameters
    parser.add_argument('--coupling-distance', type=int, default=100)
    parser.add_argument('--require-coupling', action='store_true')
    parser.add_argument('--coupling-boost', type=float, default=1.3)

    # Tracking parameters
    parser.add_argument('--max-distance', type=float, default=75.0)  # V4: Increased from 50 for longer tracking
    parser.add_argument('--max-skip-frames', type=int, default=90)  # V4: Extended from 60 frames
    parser.add_argument('--rest-zone-radius', type=int, default=120)  # V4: Increased from 100px

    # Validation parameters
    parser.add_argument('--min-track-length', type=int, default=4)  # V4: Lowered from 5
    parser.add_argument('--min-displacement', type=float, default=8.0)  # V4: Lowered from 10.0
    parser.add_argument('--max-speed', type=float, default=30.0)
    parser.add_argument('--min-speed', type=float, default=0.1)

    args = parser.parse_args()

    params_detection = DetectionParams(
        threshold=args.threshold,
        dark_threshold=args.dark_threshold,
        bright_threshold=args.bright_threshold,
        min_area=args.min_area,
        max_area=args.max_area,
        min_circularity=args.min_circularity,
        max_aspect_ratio=args.max_aspect_ratio,
        coupling_distance=args.coupling_distance,
        require_coupling=args.require_coupling,
        coupling_boost=args.coupling_boost
    )

    params_tracking = TrackingParams(
        max_distance=args.max_distance,
        max_skip_frames=args.max_skip_frames,
        rest_zone_radius=args.rest_zone_radius
    )

    params_validation = ValidationParams(
        min_track_length=args.min_track_length,
        min_displacement=args.min_displacement,
        min_speed=args.min_speed,
        max_speed=args.max_speed
    )

    process_video(
        Path(args.input),
        Path(args.output),
        params_detection,
        params_tracking,
        params_validation
    )
