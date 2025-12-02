"""
Unified Tracker V2 - RT-DETR + V5 Motion Detection Fusion (FIXED)

KEY FIX: Uses PRE-COMPUTED V4 background-subtracted videos for motion detection
instead of on-the-fly MOG2 subtraction (which produces too much noise).

Architecture:
- Original video → RT-DETR (appearance-based detection)
- V4 background-subtracted video → V5 motion detection (position-only tracking)
- Detection fusion → Unified tracking

Author: Claude Code
Date: 2025-12-02
"""

import cv2
import numpy as np
from pathlib import Path
import json
from datetime import datetime
from dataclasses import dataclass, asdict, field
from typing import List, Tuple, Optional, Dict
from scipy.spatial.distance import cdist
from enum import Enum
import sys

# Import V4's detection functions (same as V5 uses)
sys.path.insert(0, str(Path(__file__).parent))
from benthic_activity_detection_v4 import (
    DetectionParams,
    preprocess_frame,
    detect_dark_blobs,
    detect_bright_blobs,
    convert_to_native_types
)
from robust_tracker_v5 import (
    OrganismCandidate,
    MergeParams,
    merge_blobs_into_candidates
)


class DetectionSource(Enum):
    """Source of a detection."""
    RTDETR_ONLY = 'rtdetr'
    MOTION_ONLY = 'motion'
    BOTH_FUSED = 'fused'
    MOTION_REINFORCED = 'reinforced'


@dataclass
class RTDETRDetection:
    """Detection from RT-DETR model."""
    frame_idx: int
    bbox: Tuple[int, int, int, int]  # x, y, w, h
    centroid: Tuple[float, float]
    confidence: float
    class_name: str


@dataclass
class UnifiedDetection:
    """A unified detection combining RT-DETR and/or motion detection."""
    frame_idx: int
    bbox: Tuple[int, int, int, int]
    centroid: Tuple[float, float]
    area: float

    # Confidence scores
    rtdetr_conf: float = 0.0
    motion_conf: float = 0.0
    unified_conf: float = 0.0

    # Source
    source: DetectionSource = DetectionSource.MOTION_ONLY

    # Class info
    rtdetr_class: Optional[str] = None
    motion_type: Optional[str] = None  # dark_only, bright_only, coupled


@dataclass
class UnifiedTrack:
    """Track that fuses RT-DETR and motion detections."""
    track_id: int

    # Position history
    positions: List[Tuple[float, float]] = field(default_factory=list)
    frames: List[int] = field(default_factory=list)
    bboxes: List[Tuple[int, int, int, int]] = field(default_factory=list)
    sources: List[DetectionSource] = field(default_factory=list)
    confidences: List[float] = field(default_factory=list)

    # Class tracking
    rtdetr_classes: List[str] = field(default_factory=list)

    # Rest tracking
    frames_since_detection: int = 0
    is_resting: bool = False
    rest_zone_center: Optional[Tuple[float, float]] = None
    rest_zone_radius: float = 100.0

    @property
    def length(self) -> int:
        return len(self.positions)

    @property
    def displacement(self) -> float:
        if len(self.positions) < 2:
            return 0.0
        return np.sqrt(
            (self.positions[-1][0] - self.positions[0][0])**2 +
            (self.positions[-1][1] - self.positions[0][1])**2
        )

    @property
    def avg_speed(self) -> float:
        if len(self.positions) < 2:
            return 0.0
        total_dist = sum(
            np.sqrt((p2[0]-p1[0])**2 + (p2[1]-p1[1])**2)
            for p1, p2 in zip(self.positions[:-1], self.positions[1:])
        )
        return total_dist / (len(self.positions) - 1)

    @property
    def most_likely_class(self) -> Optional[str]:
        if not self.rtdetr_classes:
            return None
        from collections import Counter
        counts = Counter(self.rtdetr_classes)
        return counts.most_common(1)[0][0]

    def update(self, detection: UnifiedDetection):
        """Update track with new detection."""
        self.positions.append(detection.centroid)
        self.frames.append(detection.frame_idx)
        self.bboxes.append(detection.bbox)
        self.sources.append(detection.source)
        self.confidences.append(detection.unified_conf)

        if detection.rtdetr_class:
            self.rtdetr_classes.append(detection.rtdetr_class)

        self.frames_since_detection = 0
        self.is_resting = False

    def predicted_position(self) -> Tuple[float, float]:
        """Predict next position based on velocity."""
        if len(self.positions) < 2:
            return self.positions[-1] if self.positions else (0, 0)

        # Use last two positions to estimate velocity
        dx = self.positions[-1][0] - self.positions[-2][0]
        dy = self.positions[-1][1] - self.positions[-2][1]

        return (self.positions[-1][0] + dx, self.positions[-1][1] + dy)

    def enter_rest_mode(self, initial_radius: float = 100.0):
        """Enter rest mode with expanding zone."""
        self.is_resting = True
        self.rest_zone_center = self.positions[-1]
        self.rest_zone_radius = initial_radius

    def expand_rest_zone(self, max_radius: float = 200.0):
        """Expand rest zone over time."""
        expansion_rate = 2.0
        self.rest_zone_radius = min(
            self.rest_zone_radius + expansion_rate,
            max_radius
        )

    def get_track_quality(self) -> str:
        """Determine track quality based on detection sources."""
        fused_count = sum(1 for s in self.sources if s == DetectionSource.BOTH_FUSED)
        fused_ratio = fused_count / len(self.sources) if self.sources else 0

        if fused_ratio > 0.5:
            return "HIGH"
        elif fused_ratio > 0.2 or any(s == DetectionSource.BOTH_FUSED for s in self.sources):
            return "MEDIUM"
        else:
            return "LOW"


@dataclass
class FusionParams:
    """Parameters for fusing RT-DETR and motion detections."""
    iou_threshold: float = 0.3
    distance_threshold: float = 50.0
    rtdetr_weight: float = 0.7
    motion_weight: float = 0.3
    both_detected_boost: float = 1.2
    motion_only_base_conf: float = 0.5


@dataclass
class UnifiedTrackingParams:
    """Parameters for unified tracking."""
    max_distance: float = 60.0
    max_frames_without_detection: int = 90  # ~11 seconds at 8fps
    min_track_length: int = 5
    min_displacement: float = 10.0
    min_speed: float = 0.1
    max_speed: float = 50.0
    initial_rest_radius: float = 100.0
    max_rest_radius: float = 200.0


def calculate_iou(bbox1: Tuple[int, int, int, int], bbox2: Tuple[int, int, int, int]) -> float:
    """Calculate IoU between two bboxes (x, y, w, h format)."""
    x1, y1, w1, h1 = bbox1
    x2, y2, w2, h2 = bbox2

    # Convert to (x1, y1, x2, y2)
    box1 = (x1, y1, x1 + w1, y1 + h1)
    box2 = (x2, y2, x2 + w2, y2 + h2)

    # Intersection
    xi1 = max(box1[0], box2[0])
    yi1 = max(box1[1], box2[1])
    xi2 = min(box1[2], box2[2])
    yi2 = min(box1[3], box2[3])

    if xi2 <= xi1 or yi2 <= yi1:
        return 0.0

    inter_area = (xi2 - xi1) * (yi2 - yi1)

    # Union
    area1 = w1 * h1
    area2 = w2 * h2
    union_area = area1 + area2 - inter_area

    return inter_area / union_area if union_area > 0 else 0.0


def parse_rtdetr_results(results, frame_idx: int) -> List[RTDETRDetection]:
    """Parse RT-DETR results into RTDETRDetection objects."""
    detections = []

    if not results or len(results) == 0:
        return detections

    result = results[0]
    boxes = result.boxes

    for i in range(len(boxes)):
        xyxy = boxes.xyxy[i].cpu().numpy()
        conf = boxes.conf[i].cpu().item()
        cls = int(boxes.cls[i].cpu().item())

        x1, y1, x2, y2 = xyxy
        w, h = x2 - x1, y2 - y1
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2

        class_name = result.names[cls] if cls in result.names else f"class_{cls}"

        detections.append(RTDETRDetection(
            frame_idx=frame_idx,
            bbox=(int(x1), int(y1), int(w), int(h)),
            centroid=(cx, cy),
            confidence=conf,
            class_name=class_name
        ))

    return detections


def fuse_detections(
    rtdetr_detections: List[RTDETRDetection],
    motion_candidates: List[OrganismCandidate],
    frame_idx: int,
    params: FusionParams
) -> List[UnifiedDetection]:
    """
    Fuse RT-DETR detections with motion candidates.

    Priority:
    1. FUSED - both RT-DETR and motion agree (highest confidence)
    2. RTDETR_ONLY - appearance-based detection without motion
    3. MOTION_ONLY - motion detection that RT-DETR missed (could be crab, unknown)
    """
    unified = []
    used_motion_indices = set()

    # Match RT-DETR to motion candidates
    for rtdetr_det in rtdetr_detections:
        best_match_idx = None
        best_match_score = 0

        for i, motion_cand in enumerate(motion_candidates):
            if i in used_motion_indices:
                continue

            iou = calculate_iou(rtdetr_det.bbox, motion_cand.bbox)
            dist = np.sqrt(
                (rtdetr_det.centroid[0] - motion_cand.centroid[0])**2 +
                (rtdetr_det.centroid[1] - motion_cand.centroid[1])**2
            )

            if iou >= params.iou_threshold or dist <= params.distance_threshold:
                score = iou * 0.7 + max(0, 1 - dist/params.distance_threshold) * 0.3
                if score > best_match_score:
                    best_match_score = score
                    best_match_idx = i

        if best_match_idx is not None:
            # FUSED
            motion_cand = motion_candidates[best_match_idx]
            used_motion_indices.add(best_match_idx)

            motion_conf = 0.7
            unified_conf = (
                rtdetr_det.confidence * params.rtdetr_weight +
                motion_conf * params.motion_weight
            ) * params.both_detected_boost

            x, y, w, h = rtdetr_det.bbox

            unified.append(UnifiedDetection(
                frame_idx=frame_idx,
                bbox=rtdetr_det.bbox,
                centroid=rtdetr_det.centroid,
                area=w * h,
                rtdetr_conf=rtdetr_det.confidence,
                motion_conf=motion_conf,
                unified_conf=min(unified_conf, 1.0),
                source=DetectionSource.BOTH_FUSED,
                rtdetr_class=rtdetr_det.class_name,
                motion_type=motion_cand.candidate_type
            ))
        else:
            # RT-DETR only
            x, y, w, h = rtdetr_det.bbox

            unified.append(UnifiedDetection(
                frame_idx=frame_idx,
                bbox=rtdetr_det.bbox,
                centroid=rtdetr_det.centroid,
                area=w * h,
                rtdetr_conf=rtdetr_det.confidence,
                motion_conf=0.0,
                unified_conf=rtdetr_det.confidence * params.rtdetr_weight,
                source=DetectionSource.RTDETR_ONLY,
                rtdetr_class=rtdetr_det.class_name
            ))

    # Add unmatched motion candidates
    for i, motion_cand in enumerate(motion_candidates):
        if i not in used_motion_indices:
            motion_conf = 0.7

            unified.append(UnifiedDetection(
                frame_idx=frame_idx,
                bbox=motion_cand.bbox,
                centroid=motion_cand.centroid,
                area=motion_cand.total_area,
                rtdetr_conf=0.0,
                motion_conf=motion_conf,
                unified_conf=params.motion_only_base_conf * motion_conf,
                source=DetectionSource.MOTION_ONLY,
                motion_type=motion_cand.candidate_type
            ))

    return unified


def match_detections_to_tracks(
    detections: List[UnifiedDetection],
    tracks: List[UnifiedTrack],
    params: UnifiedTrackingParams
) -> Tuple[List[UnifiedTrack], List[UnifiedDetection]]:
    """Match detections to tracks using Hungarian algorithm approximation."""
    if not tracks:
        return [], detections

    if not detections:
        updated_tracks = []
        for track in tracks:
            track.frames_since_detection += 1
            if track.frames_since_detection <= params.max_frames_without_detection:
                if not track.is_resting:
                    track.enter_rest_mode(params.initial_rest_radius)
                else:
                    track.expand_rest_zone(params.max_rest_radius)
                updated_tracks.append(track)
        return updated_tracks, []

    # Sort by source priority
    detections_sorted = sorted(detections, key=lambda d: {
        DetectionSource.BOTH_FUSED: 0,
        DetectionSource.RTDETR_ONLY: 1,
        DetectionSource.MOTION_REINFORCED: 2,
        DetectionSource.MOTION_ONLY: 3
    }[d.source])

    # Distance matrix
    detection_centroids = np.array([d.centroid for d in detections_sorted])
    track_predictions = np.array([t.predicted_position() for t in tracks])
    distances = cdist(detection_centroids, track_predictions, metric='euclidean')

    # Adjust for resting tracks
    for t_idx, track in enumerate(tracks):
        if track.is_resting and track.rest_zone_center:
            for d_idx, det in enumerate(detections_sorted):
                dist_to_rest = np.sqrt(
                    (det.centroid[0] - track.rest_zone_center[0])**2 +
                    (det.centroid[1] - track.rest_zone_center[1])**2
                )
                if dist_to_rest <= track.rest_zone_radius:
                    distances[d_idx, t_idx] *= 0.5

    # Greedy matching
    matched_detections = set()
    matched_tracks = set()
    pairs = []

    for d_idx in range(len(detections_sorted)):
        for t_idx in range(len(tracks)):
            max_dist = params.max_distance
            if tracks[t_idx].is_resting:
                max_dist = tracks[t_idx].rest_zone_radius

            if distances[d_idx, t_idx] <= max_dist:
                pairs.append((d_idx, t_idx, distances[d_idx, t_idx]))

    pairs.sort(key=lambda x: x[2])

    for d_idx, t_idx, dist in pairs:
        if d_idx not in matched_detections and t_idx not in matched_tracks:
            tracks[t_idx].update(detections_sorted[d_idx])
            matched_detections.add(d_idx)
            matched_tracks.add(t_idx)

    updated_tracks = []
    for t_idx, track in enumerate(tracks):
        if t_idx not in matched_tracks:
            track.frames_since_detection += 1
            if track.frames_since_detection <= params.max_frames_without_detection:
                if not track.is_resting:
                    track.enter_rest_mode(params.initial_rest_radius)
                else:
                    track.expand_rest_zone(params.max_rest_radius)
                updated_tracks.append(track)
        else:
            updated_tracks.append(track)

    unmatched = [detections_sorted[i] for i in range(len(detections_sorted)) if i not in matched_detections]

    return updated_tracks, unmatched


# Color coding
SOURCE_COLORS = {
    DetectionSource.BOTH_FUSED: (0, 255, 0),      # Green
    DetectionSource.RTDETR_ONLY: (0, 165, 255),   # Orange
    DetectionSource.MOTION_ONLY: (255, 0, 255),   # Magenta
    DetectionSource.MOTION_REINFORCED: (255, 255, 0)  # Cyan
}


def draw_unified_trail(frame: np.ndarray, track: UnifiedTrack) -> np.ndarray:
    """Draw track trail with source-coded colors."""
    if len(track.positions) < 2:
        return frame

    for i in range(1, len(track.positions)):
        pt1 = (int(track.positions[i-1][0]), int(track.positions[i-1][1]))
        pt2 = (int(track.positions[i][0]), int(track.positions[i][1]))

        color = SOURCE_COLORS.get(track.sources[i] if i < len(track.sources) else DetectionSource.MOTION_ONLY, (0, 255, 0))
        cv2.line(frame, pt1, pt2, color, 2, lineType=cv2.LINE_AA)

    for i, (x, y) in enumerate(track.positions):
        alpha = (i + 1) / len(track.positions)
        radius = max(2, int(4 * alpha))
        color = SOURCE_COLORS.get(track.sources[i] if i < len(track.sources) else DetectionSource.MOTION_ONLY, (0, 255, 0))
        cv2.circle(frame, (int(x), int(y)), radius, color, -1)

    return frame


def render_unified_frame(
    frame: np.ndarray,
    tracks: List[UnifiedTrack],
    current_frame: int,
    show_trails: bool = True
) -> np.ndarray:
    """Render frame with unified tracking annotations."""
    annotated = frame.copy()

    for track in tracks:
        if show_trails:
            annotated = draw_unified_trail(annotated, track)

    for track in tracks:
        if current_frame not in track.frames:
            if track.is_resting and track.rest_zone_center:
                cx, cy = track.rest_zone_center
                cv2.circle(annotated, (int(cx), int(cy)), int(track.rest_zone_radius),
                          (128, 128, 128), 1, lineType=cv2.LINE_AA)
            continue

        idx = track.frames.index(current_frame)
        bbox = track.bboxes[idx]
        centroid = track.positions[idx]
        source = track.sources[idx] if idx < len(track.sources) else DetectionSource.MOTION_ONLY

        x, y, w, h = [int(v) for v in bbox]
        color = SOURCE_COLORS.get(source, (0, 255, 0))

        cv2.rectangle(annotated, (x, y), (x+w, y+h), color, 2)
        cv2.circle(annotated, (int(centroid[0]), int(centroid[1])), 5, color, -1)

        quality = track.get_track_quality()
        source_letter = source.value[0].upper()
        label = f"ID:{track.track_id} [{source_letter}] {quality}"
        if track.most_likely_class:
            label += f" {track.most_likely_class}"

        cv2.putText(annotated, label, (x, y-5),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)

    return annotated


class UnifiedTrackerV2:
    """
    Fixed Unified Tracker using pre-computed V4 background-subtracted videos.

    KEY DIFFERENCE from V1:
    - Motion detection uses PRE-COMPUTED V4 videos (same as V5 standalone)
    - RT-DETR uses ORIGINAL video
    - Frame sync handles different frame rates
    """

    def __init__(
        self,
        rtdetr_model_path: Path,
        fusion_params: FusionParams = None,
        tracking_params: UnifiedTrackingParams = None,
        detection_params: DetectionParams = None,
        merge_params: MergeParams = None
    ):
        self.fusion_params = fusion_params or FusionParams()
        self.tracking_params = tracking_params or UnifiedTrackingParams()

        # Use SAME parameters as working comparison run (not the higher thresholds!)
        self.detection_params = detection_params or DetectionParams(
            dark_threshold=10,     # 10 deviation from 128 = pixels < 118 (catches subtle shadows)
            bright_threshold=25,   # 25 deviation from 128 = pixels > 153 (catches reflections)
            min_area=30,           # Smaller min area to catch smaller organisms
            max_area=3000
        )
        self.merge_params = merge_params or MergeParams(
            merge_radius=80.0,     # Same as V5
            min_separation=10.0
        )

        # Load RT-DETR model
        print(f"Loading RT-DETR model: {rtdetr_model_path}")
        try:
            from ultralytics import RTDETR
            self.rtdetr = RTDETR(str(rtdetr_model_path))
            print("  RT-DETR model loaded successfully")
        except Exception as e:
            print(f"  Warning: Could not load RT-DETR: {e}")
            self.rtdetr = None

        self.active_tracks: List[UnifiedTrack] = []
        self.completed_tracks: List[UnifiedTrack] = []
        self.next_track_id = 1

    def detect_motion_from_frame(self, motion_frame: np.ndarray, frame_idx: int) -> List[OrganismCandidate]:
        """
        Detect motion from a PRE-COMPUTED background-subtracted frame.

        Uses EXACTLY the same approach as V5:
        1. preprocess_frame() to convert to gray
        2. detect_dark_blobs() and detect_bright_blobs()
        3. merge_blobs_into_candidates()
        """
        gray = preprocess_frame(motion_frame)

        dark_blobs = detect_dark_blobs(gray, frame_idx, self.detection_params)
        bright_blobs = detect_bright_blobs(gray, frame_idx, self.detection_params)

        dark_dicts = [{'centroid': b.centroid, 'bbox': b.bbox, 'area': b.area} for b in dark_blobs]
        bright_dicts = [{'centroid': b.centroid, 'bbox': b.bbox, 'area': b.area} for b in bright_blobs]

        candidates = merge_blobs_into_candidates(dark_dicts, bright_dicts, frame_idx, self.merge_params)

        return candidates

    def detect_rtdetr(self, original_frame: np.ndarray, frame_idx: int) -> List[RTDETRDetection]:
        """Run RT-DETR on original video frame."""
        if self.rtdetr is None:
            return []

        results = self.rtdetr.predict(original_frame, conf=0.4, verbose=False)
        return parse_rtdetr_results(results, frame_idx)

    def process_frame(
        self,
        original_frame: np.ndarray,
        motion_frame: np.ndarray,
        frame_idx: int
    ) -> List[UnifiedTrack]:
        """
        Process a frame pair (original + motion video frame).

        Args:
            original_frame: Frame from original video (for RT-DETR)
            motion_frame: Frame from V4 background-subtracted video (for motion detection)
            frame_idx: Current frame index in the motion video
        """
        # RT-DETR on original
        rtdetr_detections = self.detect_rtdetr(original_frame, frame_idx)

        # Motion detection on pre-computed background-subtracted frame
        motion_candidates = self.detect_motion_from_frame(motion_frame, frame_idx)

        # Fuse
        unified_detections = fuse_detections(
            rtdetr_detections,
            motion_candidates,
            frame_idx,
            self.fusion_params
        )

        # Match to tracks
        self.active_tracks, unmatched = match_detections_to_tracks(
            unified_detections,
            self.active_tracks,
            self.tracking_params
        )

        # Create new tracks
        for detection in unmatched:
            new_track = UnifiedTrack(track_id=self.next_track_id)
            new_track.update(detection)
            self.active_tracks.append(new_track)
            self.next_track_id += 1

        return self.active_tracks

    def finalize(self) -> List[UnifiedTrack]:
        """Validate and return all completed tracks."""
        all_tracks = self.active_tracks + self.completed_tracks

        valid_tracks = []
        for track in all_tracks:
            if track.length >= self.tracking_params.min_track_length:
                if track.displacement >= self.tracking_params.min_displacement:
                    if self.tracking_params.min_speed <= track.avg_speed <= self.tracking_params.max_speed:
                        valid_tracks.append(track)

        return valid_tracks


def process_unified_v2(
    original_video_path: Path,
    motion_video_path: Path,
    output_dir: Path,
    rtdetr_model_path: Path,
    subsample_ratio: int = 3
) -> dict:
    """
    Process videos with unified RT-DETR + V5 motion detection.

    Args:
        original_video_path: Path to original video (for RT-DETR)
        motion_video_path: Path to V4 background-subtracted video (for motion)
        output_dir: Output directory
        rtdetr_model_path: Path to RT-DETR model
        subsample_ratio: Ratio of original frames to motion frames (typically 3)
    """
    print(f"\n{'='*80}")
    print("UNIFIED TRACKER V2 - RT-DETR + V5 Motion (Fixed)")
    print(f"{'='*80}")
    print(f"Original video (RT-DETR): {original_video_path}")
    print(f"Motion video (V5 detect): {motion_video_path}")
    print(f"Output: {output_dir}")

    start_time = datetime.now()
    output_dir.mkdir(parents=True, exist_ok=True)

    # Open both videos
    cap_original = cv2.VideoCapture(str(original_video_path))
    cap_motion = cv2.VideoCapture(str(motion_video_path))

    if not cap_original.isOpened():
        raise ValueError(f"Could not open original video: {original_video_path}")
    if not cap_motion.isOpened():
        raise ValueError(f"Could not open motion video: {motion_video_path}")

    # Video properties
    orig_fps = cap_original.get(cv2.CAP_PROP_FPS)
    orig_total = int(cap_original.get(cv2.CAP_PROP_FRAME_COUNT))
    motion_fps = cap_motion.get(cv2.CAP_PROP_FPS)
    motion_total = int(cap_motion.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap_motion.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap_motion.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Calculate actual subsample ratio
    actual_subsample = orig_total / motion_total if motion_total > 0 else subsample_ratio
    print(f"\nOriginal: {orig_total} frames @ {orig_fps:.1f} fps")
    print(f"Motion: {motion_total} frames @ {motion_fps:.1f} fps")
    print(f"Subsample ratio: {actual_subsample:.1f}x")

    # Initialize tracker
    tracker = UnifiedTrackerV2(rtdetr_model_path)

    # Output video
    output_video_path = output_dir / f"{motion_video_path.stem}_unified_v2.avi"
    fourcc = cv2.VideoWriter_fourcc(*'MJPG')
    writer = cv2.VideoWriter(str(output_video_path), fourcc, motion_fps, (width, height))

    # Statistics
    stats = {
        'rtdetr_only': 0,
        'motion_only': 0,
        'fused': 0,
        'total_detections': 0
    }

    print(f"\nProcessing {motion_total} frames...")

    motion_frame_idx = 0
    while True:
        # Read motion frame
        ret_motion, motion_frame = cap_motion.read()
        if not ret_motion:
            break

        # Calculate corresponding original frame
        orig_frame_num = int(motion_frame_idx * actual_subsample)
        cap_original.set(cv2.CAP_PROP_POS_FRAMES, orig_frame_num)
        ret_orig, original_frame = cap_original.read()

        if not ret_orig:
            print(f"  Warning: Could not read original frame {orig_frame_num}")
            original_frame = motion_frame  # Fallback

        # Process frame pair
        active_tracks = tracker.process_frame(original_frame, motion_frame, motion_frame_idx)

        # Render
        annotated = render_unified_frame(motion_frame, active_tracks, motion_frame_idx)

        # Add info overlay
        info_text = f"Frame {motion_frame_idx}/{motion_total} | Active: {len(active_tracks)}"
        cv2.putText(annotated, info_text, (10, 30),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

        writer.write(annotated)
        motion_frame_idx += 1

        if motion_frame_idx % 50 == 0:
            print(f"  Frame {motion_frame_idx}/{motion_total} - Active tracks: {len(active_tracks)}")

    cap_original.release()
    cap_motion.release()
    writer.release()

    # Finalize
    valid_tracks = tracker.finalize()

    duration = (datetime.now() - start_time).total_seconds()

    print(f"\n{'='*60}")
    print("UNIFIED V2 RESULTS")
    print(f"{'='*60}")
    print(f"Processing time: {duration:.1f}s")
    print(f"Valid tracks: {len(valid_tracks)}")
    print(f"Output: {output_video_path}")

    # Save results
    results = {
        'timestamp': datetime.now().isoformat(),
        'original_video': str(original_video_path),
        'motion_video': str(motion_video_path),
        'output_video': str(output_video_path),
        'valid_tracks': len(valid_tracks),
        'processing_time_s': duration,
        'detection_params': asdict(tracker.detection_params),
        'tracks': {
            str(t.track_id): {
                'track_id': t.track_id,
                'length': t.length,
                'displacement': t.displacement,
                'avg_speed': t.avg_speed,
                'quality': t.get_track_quality(),
                'most_likely_class': t.most_likely_class,
                'fused_ratio': sum(1 for s in t.sources if s == DetectionSource.BOTH_FUSED) / len(t.sources) if t.sources else 0,
                # Phase 3 data: full position history
                'positions': [
                    {'x': p[0], 'y': p[1], 'frame': f}
                    for p, f in zip(t.positions, t.frames)
                ],
                'sources': [s.value for s in t.sources],
                'primary_source': max(set(s.value for s in t.sources), key=lambda x: sum(1 for s in t.sources if s.value == x)) if t.sources else 'UNKNOWN'
            }
            for t in valid_tracks
        }
    }

    results_path = output_dir / f"{motion_video_path.stem}_unified_v2_results.json"
    with open(results_path, 'w') as f:
        json.dump(convert_to_native_types(results), f, indent=2)

    return results


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Unified Tracker V2')
    parser.add_argument('--original', type=str, required=True, help='Original video path')
    parser.add_argument('--motion', type=str, required=True, help='V4 background-subtracted video path')
    parser.add_argument('--output', type=str, required=True, help='Output directory')
    parser.add_argument('--model', type=str, required=True, help='RT-DETR model path')

    args = parser.parse_args()

    process_unified_v2(
        Path(args.original),
        Path(args.motion),
        Path(args.output),
        Path(args.model)
    )
