"""
Robust Tracker V5 - Position-Only Tracking on V4 Detections

Builds ON TOP of V4 by:
1. Using V4's detection functions (dark/bright blob detection)
2. Replacing tracking with unified deviation detection + position-only matching
3. Merging adjacent dark+light blobs into single organism candidates
4. Handling color changes, rest periods, and direction changes robustly

Key Insight:
- V4 detects dark blobs (shadows) and bright blobs (reflections) separately
- An organism can appear as dark, light, or BOTH - and this changes RANDOMLY
- This tracker merges all deviations and tracks by POSITION ONLY

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
import argparse
import sys

# Import V4's detection functions
sys.path.insert(0, str(Path(__file__).parent))
from benthic_activity_detection_v4 import (
    DetectionParams,
    preprocess_frame,
    detect_dark_blobs,
    detect_bright_blobs,
    convert_to_native_types
)


@dataclass
class OrganismCandidate:
    """
    A unified organism candidate that may contain:
    - One dark blob only
    - One bright blob only
    - Multiple adjacent dark+bright blobs merged together

    Color is recorded for visualization but NOT used for tracking.
    """
    frame_idx: int
    centroid: Tuple[float, float]
    bbox: Tuple[int, int, int, int]  # Combined bounding box
    total_area: float

    # Component blobs (for visualization)
    dark_blobs: List[dict] = field(default_factory=list)
    bright_blobs: List[dict] = field(default_factory=list)

    # Classification (for info only, NOT used in tracking)
    candidate_type: str = 'unknown'  # 'dark_only', 'bright_only', 'coupled', 'multi'

    @property
    def component_count(self) -> int:
        return len(self.dark_blobs) + len(self.bright_blobs)


@dataclass
class RobustTrack:
    """
    Track that persists through color changes, rest periods, direction changes.

    Key differences from V4:
    - No color-based matching penalty
    - Longer rest tolerance (90 frames vs 60)
    - Expanding rest zone during long rests
    - Position-only tracking
    """
    track_id: int

    # Position history (for trailing visualization)
    positions: List[Tuple[float, float]] = field(default_factory=list)

    # Per-frame data
    frames: List[int] = field(default_factory=list)
    bboxes: List[Tuple[int, int, int, int]] = field(default_factory=list)
    areas: List[float] = field(default_factory=list)
    candidate_types: List[str] = field(default_factory=list)  # History of dark/bright/coupled

    # Rest tracking
    last_seen_frame: int = 0
    frames_since_detection: int = 0
    is_resting: bool = False
    rest_zone_center: Optional[Tuple[float, float]] = None
    rest_zone_radius: float = 100.0

    # Validation
    is_valid: bool = False

    @property
    def length(self) -> int:
        return len(self.frames)

    @property
    def last_position(self) -> Optional[Tuple[float, float]]:
        return self.positions[-1] if self.positions else None

    @property
    def displacement(self) -> float:
        if len(self.positions) < 2:
            return 0.0
        total = 0.0
        for i in range(1, len(self.positions)):
            dx = self.positions[i][0] - self.positions[i-1][0]
            dy = self.positions[i][1] - self.positions[i-1][1]
            total += np.sqrt(dx**2 + dy**2)
        return total

    @property
    def avg_speed(self) -> float:
        if len(self.positions) < 2:
            return 0.0
        return self.displacement / (len(self.positions) - 1)

    @property
    def total_duration(self) -> int:
        if len(self.frames) == 0:
            return 0
        return self.frames[-1] - self.frames[0] + 1

    def predicted_position(self) -> Tuple[float, float]:
        """Predict where organism should be next."""
        if self.is_resting and self.rest_zone_center:
            return self.rest_zone_center
        elif len(self.positions) >= 2:
            # Use velocity prediction
            vx = self.positions[-1][0] - self.positions[-2][0]
            vy = self.positions[-1][1] - self.positions[-2][1]
            return (self.positions[-1][0] + vx, self.positions[-1][1] + vy)
        elif self.positions:
            return self.positions[-1]
        else:
            return (0, 0)

    def enter_rest_mode(self):
        """Mark track as resting with a search zone."""
        self.is_resting = True
        if self.positions:
            self.rest_zone_center = self.positions[-1]
        self.rest_zone_radius = 100.0

    def expand_rest_zone(self, max_radius: float = 200.0):
        """Gradually expand search area during long rests."""
        self.rest_zone_radius = min(max_radius, self.rest_zone_radius + 10)

    def update(self, candidate: OrganismCandidate, frame_idx: int):
        """Update track with new detection."""
        self.frames.append(frame_idx)
        self.positions.append(candidate.centroid)
        self.bboxes.append(candidate.bbox)
        self.areas.append(candidate.total_area)
        self.candidate_types.append(candidate.candidate_type)
        self.last_seen_frame = frame_idx
        self.frames_since_detection = 0
        self.is_resting = False
        self.rest_zone_center = None


@dataclass
class RobustTrackingParams:
    """Parameters for robust position-only tracking."""
    # Association
    max_distance: float = 60.0  # Max pixels for track association

    # Rest handling (ENHANCED vs V4)
    max_skip_frames: int = 90  # ~11 seconds at 8fps (vs 60 in V4)
    initial_rest_radius: float = 100.0
    max_rest_radius: float = 200.0
    rest_expand_rate: float = 10.0  # Pixels per frame during rest

    # Validation
    min_track_length: int = 5
    min_displacement: float = 10.0
    min_speed: float = 0.1
    max_speed: float = 30.0


@dataclass
class MergeParams:
    """Parameters for merging adjacent dark+bright blobs."""
    merge_radius: float = 80.0  # Max distance to merge dark+bright into one candidate
    min_separation: float = 10.0  # Min distance between separate organisms


def merge_blobs_into_candidates(
    dark_blobs: List[dict],
    bright_blobs: List[dict],
    frame_idx: int,
    params: MergeParams
) -> List[OrganismCandidate]:
    """
    Merge adjacent dark and bright blobs into unified organism candidates.

    Key insight: An organism can appear as:
    - Just a dark blob (shadow)
    - Just a bright blob (reflection)
    - Dark + bright adjacent (both visible)

    This function groups adjacent blobs into single candidates.
    """
    candidates = []
    used_dark = set()
    used_bright = set()

    # Convert to numpy for distance calculation
    if dark_blobs and bright_blobs:
        dark_centroids = np.array([b['centroid'] for b in dark_blobs])
        bright_centroids = np.array([b['centroid'] for b in bright_blobs])
        distances = cdist(dark_centroids, bright_centroids, metric='euclidean')

        # Find all dark-bright pairs within merge radius
        pairs = []
        for d_idx in range(len(dark_blobs)):
            for b_idx in range(len(bright_blobs)):
                if distances[d_idx, b_idx] <= params.merge_radius:
                    pairs.append((d_idx, b_idx, distances[d_idx, b_idx]))

        # Sort by distance (closest first)
        pairs.sort(key=lambda x: x[2])

        # Greedy matching for coupled blobs
        for d_idx, b_idx, dist in pairs:
            if d_idx not in used_dark and b_idx not in used_bright:
                dark_blob = dark_blobs[d_idx]
                bright_blob = bright_blobs[b_idx]

                # Calculate combined centroid (weighted by area)
                total_area = dark_blob['area'] + bright_blob['area']
                cx = (dark_blob['centroid'][0] * dark_blob['area'] +
                      bright_blob['centroid'][0] * bright_blob['area']) / total_area
                cy = (dark_blob['centroid'][1] * dark_blob['area'] +
                      bright_blob['centroid'][1] * bright_blob['area']) / total_area

                # Combined bounding box
                x1 = min(dark_blob['bbox'][0], bright_blob['bbox'][0])
                y1 = min(dark_blob['bbox'][1], bright_blob['bbox'][1])
                x2 = max(dark_blob['bbox'][0] + dark_blob['bbox'][2],
                        bright_blob['bbox'][0] + bright_blob['bbox'][2])
                y2 = max(dark_blob['bbox'][1] + dark_blob['bbox'][3],
                        bright_blob['bbox'][1] + bright_blob['bbox'][3])

                candidate = OrganismCandidate(
                    frame_idx=frame_idx,
                    centroid=(cx, cy),
                    bbox=(x1, y1, x2 - x1, y2 - y1),
                    total_area=total_area,
                    dark_blobs=[dark_blob],
                    bright_blobs=[bright_blob],
                    candidate_type='coupled'
                )
                candidates.append(candidate)
                used_dark.add(d_idx)
                used_bright.add(b_idx)

    # Add uncoupled dark blobs
    for d_idx, dark_blob in enumerate(dark_blobs):
        if d_idx not in used_dark:
            candidate = OrganismCandidate(
                frame_idx=frame_idx,
                centroid=dark_blob['centroid'],
                bbox=dark_blob['bbox'],
                total_area=dark_blob['area'],
                dark_blobs=[dark_blob],
                bright_blobs=[],
                candidate_type='dark_only'
            )
            candidates.append(candidate)

    # Add uncoupled bright blobs
    for b_idx, bright_blob in enumerate(bright_blobs):
        if b_idx not in used_bright:
            candidate = OrganismCandidate(
                frame_idx=frame_idx,
                centroid=bright_blob['centroid'],
                bbox=bright_blob['bbox'],
                total_area=bright_blob['area'],
                dark_blobs=[],
                bright_blobs=[bright_blob],
                candidate_type='bright_only'
            )
            candidates.append(candidate)

    return candidates


def match_candidates_to_tracks(
    candidates: List[OrganismCandidate],
    tracks: List[RobustTrack],
    frame_idx: int,
    params: RobustTrackingParams
) -> Tuple[List[RobustTrack], List[OrganismCandidate]]:
    """
    Match candidates to tracks using POSITION ONLY.

    Key difference from V4: NO color penalty. Pure spatial matching.
    """
    if not tracks:
        return [], candidates

    if not candidates:
        # Update all tracks for missed detection
        updated_tracks = []
        for track in tracks:
            track.frames_since_detection += 1

            if track.frames_since_detection <= params.max_skip_frames:
                if not track.is_resting:
                    track.enter_rest_mode()
                else:
                    track.expand_rest_zone(params.max_rest_radius)
                updated_tracks.append(track)

        return updated_tracks, []

    # Calculate distances between candidates and track predictions
    candidate_centroids = np.array([c.centroid for c in candidates])
    track_predictions = np.array([t.predicted_position() for t in tracks])

    distances = cdist(candidate_centroids, track_predictions, metric='euclidean')

    # Adjust distances for resting tracks (boost matches in rest zone)
    for t_idx, track in enumerate(tracks):
        if track.is_resting and track.rest_zone_center:
            for c_idx, candidate in enumerate(candidates):
                dist_to_rest = np.sqrt(
                    (candidate.centroid[0] - track.rest_zone_center[0])**2 +
                    (candidate.centroid[1] - track.rest_zone_center[1])**2
                )
                if dist_to_rest <= track.rest_zone_radius:
                    distances[c_idx, t_idx] *= 0.5  # Boost rest zone matches

    # Greedy matching by distance
    matched_candidates = set()
    matched_tracks = set()
    updated_tracks = []

    pairs = []
    for c_idx in range(len(candidates)):
        for t_idx in range(len(tracks)):
            # Use larger max_distance for resting tracks
            max_dist = params.max_distance
            if tracks[t_idx].is_resting:
                max_dist = tracks[t_idx].rest_zone_radius

            if distances[c_idx, t_idx] <= max_dist:
                pairs.append((c_idx, t_idx, distances[c_idx, t_idx]))

    pairs.sort(key=lambda x: x[2])  # Sort by distance

    for c_idx, t_idx, dist in pairs:
        if c_idx not in matched_candidates and t_idx not in matched_tracks:
            track = tracks[t_idx]
            candidate = candidates[c_idx]
            track.update(candidate, frame_idx)
            matched_candidates.add(c_idx)
            matched_tracks.add(t_idx)

    # Update unmatched tracks
    for t_idx, track in enumerate(tracks):
        if t_idx not in matched_tracks:
            track.frames_since_detection += 1

            if track.frames_since_detection <= params.max_skip_frames:
                if not track.is_resting:
                    track.enter_rest_mode()
                else:
                    track.expand_rest_zone(params.max_rest_radius)
                updated_tracks.append(track)

    # Add matched tracks
    for t_idx in matched_tracks:
        updated_tracks.append(tracks[t_idx])

    # Unmatched candidates
    unmatched = [candidates[i] for i in range(len(candidates)) if i not in matched_candidates]

    return updated_tracks, unmatched


def validate_track(track: RobustTrack, params: RobustTrackingParams) -> bool:
    """Validate if track meets minimum quality criteria."""
    if track.length < params.min_track_length:
        return False

    if track.displacement < params.min_displacement:
        return False

    if track.avg_speed < params.min_speed:
        return False

    if track.avg_speed > params.max_speed:
        return False

    return True


def draw_robust_trail(
    frame: np.ndarray,
    track: RobustTrack,
    base_color: Tuple[int, int, int]
) -> np.ndarray:
    """Draw track trail with color indicating candidate type history."""
    if len(track.positions) < 2:
        return frame

    # Draw polyline trail
    points = np.array([(int(x), int(y)) for x, y in track.positions], dtype=np.int32)
    cv2.polylines(frame, [points], False, base_color, 2, lineType=cv2.LINE_AA)

    # Draw small circles at each position
    for i, (x, y) in enumerate(track.positions):
        alpha = (i + 1) / len(track.positions)
        radius = max(1, int(3 * alpha))

        # Color based on candidate type at this position (for visualization)
        if i < len(track.candidate_types):
            ctype = track.candidate_types[i]
            if ctype == 'dark_only':
                color = (100, 100, 100)  # Gray for dark
            elif ctype == 'bright_only':
                color = (200, 200, 255)  # Light for bright
            else:
                color = base_color  # Coupled uses track color
        else:
            color = base_color

        cv2.circle(frame, (int(x), int(y)), radius, color, -1)

    return frame


def render_robust_frame(
    frame: np.ndarray,
    tracks: List[RobustTrack],
    current_frame: int,
    show_trails: bool = True
) -> np.ndarray:
    """Render frame with robust tracking annotations."""
    annotated = frame.copy()

    # Draw trails first
    for track in tracks:
        color = (0, 255, 0) if track.is_valid else (0, 165, 255)
        if show_trails:
            annotated = draw_robust_trail(annotated, track, color)

    # Draw current detections
    for track in tracks:
        if current_frame not in track.frames:
            # Draw rest zone if resting
            if track.is_resting and track.rest_zone_center:
                cx, cy = track.rest_zone_center
                cv2.circle(annotated, (int(cx), int(cy)), int(track.rest_zone_radius),
                          (128, 128, 128), 1, lineType=cv2.LINE_AA)
                cv2.putText(annotated, f"REST:{track.track_id}", (int(cx)-20, int(cy)-5),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.3, (128, 128, 128), 1)
            continue

        idx = track.frames.index(current_frame)
        bbox = track.bboxes[idx]
        centroid = track.positions[idx] if idx < len(track.positions) else track.positions[-1]
        ctype = track.candidate_types[idx] if idx < len(track.candidate_types) else 'unknown'

        x, y, w, h = bbox
        cx, cy = centroid

        color = (0, 255, 0) if track.is_valid else (0, 165, 255)

        # Bounding box
        cv2.rectangle(annotated, (x, y), (x+w, y+h), color, 2)

        # Centroid
        cv2.circle(annotated, (int(cx), int(cy)), 4, color, -1)

        # Label
        label = f"ID:{track.track_id} [{ctype[:1].upper()}]"
        cv2.putText(annotated, label, (x, y-5),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)

    return annotated


def process_video_robust(
    video_path: Path,
    output_dir: Path,
    detection_params: DetectionParams,
    merge_params: MergeParams,
    tracking_params: RobustTrackingParams
) -> dict:
    """
    Main processing pipeline for robust V5 tracking.

    Uses V4's detection functions but with unified candidate merging
    and position-only tracking.
    """
    print(f"\n{'='*80}")
    print("ROBUST TRACKER V5 - Position-Only Tracking")
    print(f"{'='*80}")
    print(f"Input: {video_path}")
    print(f"Output: {output_dir}")
    print(f"\nV5 Enhancements over V4:")
    print(f"  - Unified deviation detection (dark+bright merged)")
    print(f"  - Position-only tracking (color changes ignored)")
    print(f"  - Extended rest handling: {tracking_params.max_skip_frames} frames (~11 sec)")
    print(f"  - Expanding rest zone: {tracking_params.initial_rest_radius} -> {tracking_params.max_rest_radius}px")
    print(f"\nMerge Parameters:")
    print(f"  - Merge radius: {merge_params.merge_radius}px")
    print(f"\nDetection Parameters (from V4):")
    print(f"  - Dark threshold: {detection_params.dark_threshold}")
    print(f"  - Bright threshold: {detection_params.bright_threshold}")

    start_time = datetime.now()
    output_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    print(f"\nVideo Info:")
    print(f"  FPS: {fps:.2f}")
    print(f"  Frames: {total_frames}")
    print(f"  Resolution: {width}x{height}")

    output_video_path = output_dir / f"{video_path.stem}_robust_v5.avi"
    fourcc = cv2.VideoWriter_fourcc(*'MJPG')
    writer = cv2.VideoWriter(str(output_video_path), fourcc, fps, (width, height))

    active_tracks = []
    completed_tracks = []
    next_track_id = 1

    # Statistics
    total_candidates = 0
    type_counts = {'dark_only': 0, 'bright_only': 0, 'coupled': 0}

    print(f"\nProcessing {total_frames} frames...")

    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        gray = preprocess_frame(frame)

        # Use V4's detection functions
        dark_blobs = detect_dark_blobs(gray, frame_idx, detection_params)
        bright_blobs = detect_bright_blobs(gray, frame_idx, detection_params)

        # Convert to dicts for merging
        dark_dicts = [{'centroid': b.centroid, 'bbox': b.bbox, 'area': b.area} for b in dark_blobs]
        bright_dicts = [{'centroid': b.centroid, 'bbox': b.bbox, 'area': b.area} for b in bright_blobs]

        # Merge into organism candidates
        candidates = merge_blobs_into_candidates(dark_dicts, bright_dicts, frame_idx, merge_params)

        # Track statistics
        for c in candidates:
            total_candidates += 1
            type_counts[c.candidate_type] = type_counts.get(c.candidate_type, 0) + 1

        # Match to tracks (position-only)
        active_tracks, unmatched = match_candidates_to_tracks(
            candidates, active_tracks, frame_idx, tracking_params
        )

        # Create new tracks for unmatched candidates
        for candidate in unmatched:
            new_track = RobustTrack(track_id=next_track_id)
            new_track.update(candidate, frame_idx)
            active_tracks.append(new_track)
            next_track_id += 1

        # Render
        annotated = render_robust_frame(frame, active_tracks, frame_idx, show_trails=True)
        writer.write(annotated)

        if (frame_idx + 1) % 50 == 0:
            resting = sum(1 for t in active_tracks if t.is_resting)
            print(f"  Frame {frame_idx+1}/{total_frames} - {len(active_tracks)} tracks ({resting} resting)")

        frame_idx += 1

    cap.release()
    writer.release()

    # Validate tracks
    print(f"\nValidating {len(active_tracks)} tracks...")
    for track in active_tracks:
        track.is_valid = validate_track(track, tracking_params)
        completed_tracks.append(track)

    valid_tracks = [t for t in completed_tracks if t.is_valid]
    print(f"  Valid tracks: {len(valid_tracks)}/{len(completed_tracks)}")

    # Print track details
    for track in valid_tracks:
        rest_periods = sum(1 for i in range(1, len(track.frames)) if track.frames[i] - track.frames[i-1] > 1)
        color_changes = sum(1 for i in range(1, len(track.candidate_types))
                          if track.candidate_types[i] != track.candidate_types[i-1])
        print(f"  Track {track.track_id}: {track.length} detections, {track.total_duration} frames, "
              f"{rest_periods} rests, {color_changes} color changes")

    # Build results
    results = {
        'video_info': {
            'filename': video_path.name,
            'fps': fps,
            'total_frames': total_frames,
            'resolution': {'width': width, 'height': height}
        },
        'parameters': {
            'detection': asdict(detection_params),
            'merge': asdict(merge_params),
            'tracking': asdict(tracking_params)
        },
        'tracks': [
            {
                'track_id': t.track_id,
                'frames': t.frames,
                'positions': t.positions,
                'bboxes': t.bboxes,
                'areas': t.areas,
                'candidate_types': t.candidate_types,
                'is_valid': t.is_valid,
                'length': t.length,
                'displacement': t.displacement,
                'avg_speed': t.avg_speed,
                'total_duration': t.total_duration,
                'rest_periods': sum(1 for i in range(1, len(t.frames)) if t.frames[i] - t.frames[i-1] > 1),
                'color_changes': sum(1 for i in range(1, len(t.candidate_types))
                                    if t.candidate_types[i] != t.candidate_types[i-1])
            }
            for t in completed_tracks
        ],
        'summary': {
            'total_tracks': len(completed_tracks),
            'valid_tracks': len(valid_tracks),
            'total_candidates': total_candidates,
            'candidate_types': type_counts,
            'processing_time': (datetime.now() - start_time).total_seconds()
        },
        'version': 'v5_robust',
        'timestamp': datetime.now().isoformat(),
        'output_paths': {
            'annotated_video': str(output_video_path),
            'results_json': str(output_dir / f"{video_path.stem}_robust_v5.json")
        }
    }

    results_path = output_dir / f"{video_path.stem}_robust_v5.json"
    with open(results_path, 'w') as f:
        json.dump(convert_to_native_types(results), f, indent=2)

    print(f"\n{'='*80}")
    print("ROBUST TRACKING COMPLETE")
    print(f"{'='*80}")
    print(f"Processing time: {results['summary']['processing_time']:.1f}s")
    print(f"Valid tracks: {len(valid_tracks)}")
    print(f"Candidate types: {type_counts}")
    print(f"Annotated video: {output_video_path}")
    print(f"Results JSON: {results_path}")
    print(f"{'='*80}")

    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description="Robust Tracker V5: Position-only tracking on V4 detections"
    )
    parser.add_argument('--input', '-i', required=True, help='Input motion video path')
    parser.add_argument('--output', '-o', default='results/', help='Output directory')

    # Detection parameters (passed to V4 functions)
    parser.add_argument('--dark-threshold', type=int, default=10)
    parser.add_argument('--bright-threshold', type=int, default=25)
    parser.add_argument('--min-area', type=int, default=30)
    parser.add_argument('--max-area', type=int, default=2000)

    # Merge parameters
    parser.add_argument('--merge-radius', type=float, default=80.0,
                       help='Max distance to merge dark+bright into one candidate')

    # Tracking parameters
    parser.add_argument('--max-distance', type=float, default=60.0,
                       help='Max distance for track association')
    parser.add_argument('--max-skip-frames', type=int, default=90,
                       help='Frames to track during rest (~11 sec at 8fps)')
    parser.add_argument('--initial-rest-radius', type=float, default=100.0)
    parser.add_argument('--max-rest-radius', type=float, default=200.0)

    # Validation parameters
    parser.add_argument('--min-track-length', type=int, default=5)
    parser.add_argument('--min-displacement', type=float, default=10.0)

    args = parser.parse_args()

    detection_params = DetectionParams(
        dark_threshold=args.dark_threshold,
        bright_threshold=args.bright_threshold,
        min_area=args.min_area,
        max_area=args.max_area
    )

    merge_params = MergeParams(
        merge_radius=args.merge_radius
    )

    tracking_params = RobustTrackingParams(
        max_distance=args.max_distance,
        max_skip_frames=args.max_skip_frames,
        initial_rest_radius=args.initial_rest_radius,
        max_rest_radius=args.max_rest_radius,
        min_track_length=args.min_track_length,
        min_displacement=args.min_displacement
    )

    process_video_robust(
        Path(args.input),
        Path(args.output),
        detection_params,
        merge_params,
        tracking_params
    )
