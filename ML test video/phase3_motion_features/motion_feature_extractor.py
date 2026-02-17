"""
Phase 3: Motion Feature Extractor

Extracts behavioral features from unified tracker output for:
1. Speed/Velocity Analysis - Movement patterns over time
2. Trajectory Classification - Straight-line, meandering, stationary
3. Behavioral Clustering - Group similar movement patterns
4. Species Inference - Motion patterns to infer organism type

Input: Unified V2 tracker JSON results
Output: Per-track feature vectors for downstream analysis

Author: Claude Code
Date: 2025-12-02
"""

import numpy as np
from pathlib import Path
import json
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Tuple
from enum import Enum
from collections import defaultdict
import math


class TrajectoryType(Enum):
    """Classification of trajectory patterns."""
    STATIONARY = "stationary"       # Minimal movement, resting organism
    LINEAR = "linear"               # Straight-line movement
    MEANDERING = "meandering"       # Irregular, wandering movement
    CIRCULAR = "circular"           # Looping or circular patterns
    DARTING = "darting"             # Quick bursts followed by stops
    UNKNOWN = "unknown"


class OrganismType(Enum):
    """Inferred organism type based on motion patterns."""
    FISH_FAST = "fish_fast"         # Fast-moving fish (pelagic)
    FISH_SLOW = "fish_slow"         # Slow-moving fish (demersal)
    CRAB = "crab"                   # Crab-like movement
    SNAIL = "snail"                 # Very slow, continuous movement
    SHELLFISH = "shellfish"         # Minimal movement, mostly stationary
    UNKNOWN = "unknown"


@dataclass
class MotionMetrics:
    """Core motion metrics for a single track."""
    # Basic statistics
    total_frames: int = 0
    total_distance: float = 0.0
    displacement: float = 0.0       # Start to end distance

    # Speed metrics (pixels/frame at 8fps)
    mean_speed: float = 0.0
    max_speed: float = 0.0
    min_speed: float = 0.0
    speed_std: float = 0.0

    # Acceleration metrics
    mean_acceleration: float = 0.0
    max_acceleration: float = 0.0
    acceleration_events: int = 0    # Sudden speed changes

    # Direction metrics
    mean_direction_change: float = 0.0
    max_direction_change: float = 0.0
    direction_changes: int = 0      # Significant turns

    # Straightness (displacement / total_distance)
    straightness_index: float = 0.0

    # Rest periods
    rest_count: int = 0
    total_rest_frames: int = 0
    mean_rest_duration: float = 0.0

    # Movement bursts
    burst_count: int = 0
    mean_burst_speed: float = 0.0
    mean_burst_duration: float = 0.0


@dataclass
class BehavioralFeatures:
    """High-level behavioral features derived from motion metrics."""
    # Trajectory classification
    trajectory_type: str = "unknown"
    trajectory_confidence: float = 0.0

    # Organism inference
    inferred_organism: str = "unknown"
    organism_confidence: float = 0.0

    # Activity patterns
    activity_level: float = 0.0     # 0=stationary, 1=very active
    exploration_score: float = 0.0  # How much area covered
    regularity_score: float = 0.0   # How regular/predictable movement is

    # Behavioral flags
    is_foraging: bool = False       # Meandering with stops
    is_fleeing: bool = False        # Fast, linear movement
    is_resting: bool = False        # Mostly stationary
    is_patrolling: bool = False     # Regular back-and-forth


@dataclass
class TrackFeatures:
    """Complete feature set for a single track."""
    track_id: int
    detection_source: str           # RTDETR, MOTION, FUSED
    frame_range: Tuple[int, int]
    centroid_history: List[Tuple[float, float]] = field(default_factory=list)

    # Feature components
    motion_metrics: MotionMetrics = field(default_factory=MotionMetrics)
    behavioral_features: BehavioralFeatures = field(default_factory=BehavioralFeatures)

    # Raw feature vector for ML
    feature_vector: List[float] = field(default_factory=list)


def calculate_distance(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
    """Calculate Euclidean distance between two points."""
    return math.sqrt((p2[0] - p1[0])**2 + (p2[1] - p1[1])**2)


def calculate_direction(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
    """Calculate direction angle in radians from p1 to p2."""
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    return math.atan2(dy, dx)


def angle_difference(a1: float, a2: float) -> float:
    """Calculate absolute angle difference, handling wraparound."""
    diff = abs(a1 - a2)
    if diff > math.pi:
        diff = 2 * math.pi - diff
    return diff


def extract_motion_metrics(positions: List[Tuple[float, float]], fps: float = 8.0) -> MotionMetrics:
    """
    Extract motion metrics from a sequence of centroid positions.

    Args:
        positions: List of (x, y) centroid positions per frame
        fps: Frame rate of the tracking (default 8fps for motion video)

    Returns:
        MotionMetrics dataclass with all computed metrics
    """
    metrics = MotionMetrics()

    if len(positions) < 2:
        return metrics

    metrics.total_frames = len(positions)

    # Calculate frame-to-frame distances and speeds
    distances = []
    speeds = []
    directions = []

    for i in range(1, len(positions)):
        d = calculate_distance(positions[i-1], positions[i])
        distances.append(d)
        speeds.append(d)  # speed = distance / 1 frame

        if d > 0.5:  # Only calculate direction for actual movement
            directions.append(calculate_direction(positions[i-1], positions[i]))

    # Total distance traveled
    metrics.total_distance = sum(distances)

    # Displacement (start to end)
    metrics.displacement = calculate_distance(positions[0], positions[-1])

    # Speed statistics
    if speeds:
        metrics.mean_speed = np.mean(speeds)
        metrics.max_speed = max(speeds)
        metrics.min_speed = min(speeds)
        metrics.speed_std = np.std(speeds)

    # Straightness index (1.0 = perfectly straight, 0 = returned to start)
    if metrics.total_distance > 0:
        metrics.straightness_index = min(1.0, metrics.displacement / metrics.total_distance)

    # Acceleration (change in speed between frames)
    if len(speeds) >= 2:
        accelerations = [abs(speeds[i] - speeds[i-1]) for i in range(1, len(speeds))]
        metrics.mean_acceleration = np.mean(accelerations)
        metrics.max_acceleration = max(accelerations)
        # Count significant acceleration events (>2x mean)
        metrics.acceleration_events = sum(1 for a in accelerations if a > 2 * metrics.mean_acceleration)

    # Direction changes
    if len(directions) >= 2:
        direction_changes = []
        for i in range(1, len(directions)):
            change = angle_difference(directions[i-1], directions[i])
            direction_changes.append(change)

        metrics.mean_direction_change = np.mean(direction_changes)
        metrics.max_direction_change = max(direction_changes)
        # Count significant turns (> 45 degrees = pi/4)
        metrics.direction_changes = sum(1 for c in direction_changes if c > math.pi/4)

    # Rest detection (very slow movement)
    rest_threshold = 2.0  # pixels/frame
    resting = [s < rest_threshold for s in speeds]

    # Count rest periods (consecutive slow frames)
    rest_periods = []
    current_rest = 0
    for is_rest in resting:
        if is_rest:
            current_rest += 1
        elif current_rest > 0:
            rest_periods.append(current_rest)
            current_rest = 0
    if current_rest > 0:
        rest_periods.append(current_rest)

    metrics.rest_count = len(rest_periods)
    metrics.total_rest_frames = sum(rest_periods)
    if rest_periods:
        metrics.mean_rest_duration = np.mean(rest_periods)

    # Movement bursts (fast movement after rest)
    burst_threshold = metrics.mean_speed * 1.5 if metrics.mean_speed > 0 else 5.0
    bursts = []
    current_burst = []

    for i, s in enumerate(speeds):
        if s > burst_threshold:
            current_burst.append(s)
        elif current_burst:
            bursts.append(current_burst)
            current_burst = []
    if current_burst:
        bursts.append(current_burst)

    metrics.burst_count = len(bursts)
    if bursts:
        metrics.mean_burst_speed = np.mean([np.mean(b) for b in bursts])
        metrics.mean_burst_duration = np.mean([len(b) for b in bursts])

    return metrics


def classify_trajectory(metrics: MotionMetrics) -> Tuple[TrajectoryType, float]:
    """
    Classify trajectory type based on motion metrics.

    Returns:
        Tuple of (TrajectoryType, confidence 0-1)
    """
    # Stationary: minimal movement
    if metrics.mean_speed < 1.0 and metrics.total_distance < 50:
        return TrajectoryType.STATIONARY, 0.9

    # Darting: high acceleration events with rest periods
    if metrics.burst_count >= 3 and metrics.rest_count >= 2:
        return TrajectoryType.DARTING, 0.8

    # Linear: high straightness, low direction changes
    if metrics.straightness_index > 0.7 and metrics.direction_changes < 5:
        return TrajectoryType.LINEAR, 0.85

    # Circular: low straightness but regular movement
    if metrics.straightness_index < 0.3 and metrics.speed_std < metrics.mean_speed * 0.5:
        return TrajectoryType.CIRCULAR, 0.7

    # Meandering: moderate straightness, many direction changes
    if 0.2 < metrics.straightness_index < 0.7 and metrics.direction_changes >= 5:
        return TrajectoryType.MEANDERING, 0.75

    return TrajectoryType.UNKNOWN, 0.5


def infer_organism_type(metrics: MotionMetrics, trajectory: TrajectoryType) -> Tuple[OrganismType, float]:
    """
    Infer organism type based on motion patterns.

    This uses heuristics based on typical movement patterns:
    - Fish: Generally faster, more linear or darting
    - Crabs: Lateral movement, meandering, frequent stops
    - Snails: Very slow, continuous movement
    - Shellfish: Mostly stationary

    Returns:
        Tuple of (OrganismType, confidence 0-1)
    """
    # Shellfish: almost no movement
    if trajectory == TrajectoryType.STATIONARY:
        return OrganismType.SHELLFISH, 0.7

    # Snail: very slow but continuous movement
    if metrics.mean_speed < 3.0 and metrics.rest_count < 3 and metrics.straightness_index > 0.3:
        return OrganismType.SNAIL, 0.65

    # Crab: meandering with stops, moderate speed
    if trajectory in [TrajectoryType.MEANDERING, TrajectoryType.DARTING]:
        if 2.0 < metrics.mean_speed < 15.0 and metrics.rest_count >= 2:
            return OrganismType.CRAB, 0.7

    # Fast fish: high speed, linear or darting
    if metrics.mean_speed > 15.0 or (trajectory == TrajectoryType.LINEAR and metrics.mean_speed > 8.0):
        return OrganismType.FISH_FAST, 0.75

    # Slow fish: moderate speed, various trajectories
    if 5.0 < metrics.mean_speed < 15.0:
        return OrganismType.FISH_SLOW, 0.6

    return OrganismType.UNKNOWN, 0.4


def calculate_behavioral_features(metrics: MotionMetrics, trajectory: TrajectoryType) -> BehavioralFeatures:
    """Calculate high-level behavioral features."""
    features = BehavioralFeatures()

    # Trajectory
    traj_type, traj_conf = trajectory, 0.7
    features.trajectory_type = traj_type.value
    features.trajectory_confidence = traj_conf

    # Organism inference
    org_type, org_conf = infer_organism_type(metrics, trajectory)
    features.inferred_organism = org_type.value
    features.organism_confidence = org_conf

    # Activity level (0-1 scale based on speed and movement)
    max_expected_speed = 30.0  # pixels/frame
    features.activity_level = min(1.0, metrics.mean_speed / max_expected_speed)

    # Exploration score (based on total distance and area coverage)
    features.exploration_score = min(1.0, metrics.total_distance / 1000.0)

    # Regularity score (inverse of speed variance)
    if metrics.mean_speed > 0:
        cv = metrics.speed_std / metrics.mean_speed  # coefficient of variation
        features.regularity_score = max(0, 1.0 - cv)

    # Behavioral flags
    features.is_resting = trajectory == TrajectoryType.STATIONARY
    features.is_fleeing = (trajectory == TrajectoryType.LINEAR and
                          metrics.mean_speed > 15.0)
    features.is_foraging = (trajectory == TrajectoryType.MEANDERING and
                           metrics.rest_count >= 2)
    features.is_patrolling = (trajectory == TrajectoryType.LINEAR and
                             metrics.direction_changes >= 2 and
                             metrics.straightness_index < 0.5)

    return features


def create_feature_vector(metrics: MotionMetrics, features: BehavioralFeatures) -> List[float]:
    """
    Create a normalized feature vector for ML clustering/classification.

    Returns 20-dimensional feature vector:
    - Speed features (5): mean, max, std, normalized mean, burst ratio
    - Trajectory features (5): straightness, direction changes, displacement ratio, acceleration, regularity
    - Rest features (4): rest count, rest ratio, mean rest duration, activity level
    - Behavioral scores (4): exploration, regularity, foraging indicator, organism encoding
    - Track quality (2): total frames, total distance
    """
    vector = []

    # Speed features (normalized by max expected values)
    vector.append(metrics.mean_speed / 30.0)  # normalized mean speed
    vector.append(metrics.max_speed / 60.0)   # normalized max speed
    vector.append(metrics.speed_std / 15.0)   # normalized speed std
    vector.append(min(1.0, metrics.mean_speed / 20.0))  # activity indicator
    burst_ratio = metrics.burst_count / max(1, metrics.total_frames) * 100
    vector.append(min(1.0, burst_ratio))

    # Trajectory features
    vector.append(metrics.straightness_index)
    vector.append(min(1.0, metrics.direction_changes / 20.0))
    if metrics.total_distance > 0:
        vector.append(metrics.displacement / metrics.total_distance)
    else:
        vector.append(0.0)
    vector.append(min(1.0, metrics.mean_acceleration / 10.0))
    vector.append(features.regularity_score)

    # Rest features
    vector.append(min(1.0, metrics.rest_count / 10.0))
    rest_ratio = metrics.total_rest_frames / max(1, metrics.total_frames)
    vector.append(rest_ratio)
    vector.append(min(1.0, metrics.mean_rest_duration / 30.0))
    vector.append(features.activity_level)

    # Behavioral scores
    vector.append(features.exploration_score)
    vector.append(features.regularity_score)
    foraging_indicator = 1.0 if features.is_foraging else 0.0
    vector.append(foraging_indicator)

    # Organism type encoding (simple one-hot-ish)
    organism_map = {
        'fish_fast': 1.0, 'fish_slow': 0.8, 'crab': 0.6,
        'snail': 0.4, 'shellfish': 0.2, 'unknown': 0.0
    }
    vector.append(organism_map.get(features.inferred_organism, 0.0))

    # Track quality
    vector.append(min(1.0, metrics.total_frames / 160.0))  # normalized by video length
    vector.append(min(1.0, metrics.total_distance / 2000.0))

    return vector


class MotionFeatureExtractor:
    """
    Main class for extracting motion features from unified tracker results.
    """

    def __init__(self, fps: float = 8.0):
        """
        Initialize feature extractor.

        Args:
            fps: Frame rate of tracking data (default 8fps for motion video)
        """
        self.fps = fps
        self.track_features: Dict[int, TrackFeatures] = {}

    def process_unified_results(self, results_json: Path) -> Dict[int, TrackFeatures]:
        """
        Process unified tracker results JSON file.

        Args:
            results_json: Path to unified tracker results JSON

        Returns:
            Dictionary mapping track_id to TrackFeatures
        """
        with open(results_json, 'r') as f:
            data = json.load(f)

        self.track_features = {}

        # Get tracks from unified results
        tracks = data.get('tracks', {})

        for track_id_str, track_data in tracks.items():
            track_id = int(track_id_str)

            # Extract centroid history
            positions = track_data.get('positions', [])
            if not positions:
                continue

            # Convert to tuples
            centroid_history = [(p['x'], p['y']) for p in positions]

            # Get frame range
            frames = [p.get('frame', i) for i, p in enumerate(positions)]
            frame_range = (min(frames), max(frames))

            # Get detection source
            source = track_data.get('primary_source', 'UNKNOWN')

            # Extract motion metrics
            motion_metrics = extract_motion_metrics(centroid_history, self.fps)

            # Classify trajectory
            trajectory_type, _ = classify_trajectory(motion_metrics)

            # Calculate behavioral features
            behavioral_features = calculate_behavioral_features(motion_metrics, trajectory_type)

            # Create feature vector
            feature_vector = create_feature_vector(motion_metrics, behavioral_features)

            # Store complete track features
            self.track_features[track_id] = TrackFeatures(
                track_id=track_id,
                detection_source=source,
                frame_range=frame_range,
                centroid_history=centroid_history,
                motion_metrics=motion_metrics,
                behavioral_features=behavioral_features,
                feature_vector=feature_vector
            )

        return self.track_features

    def process_from_positions(self, track_id: int, positions: List[Tuple[float, float]],
                               source: str = "UNKNOWN") -> TrackFeatures:
        """
        Process a single track from position history.

        Args:
            track_id: Track identifier
            positions: List of (x, y) centroid positions
            source: Detection source (RTDETR, MOTION, FUSED)

        Returns:
            TrackFeatures for the track
        """
        if len(positions) < 2:
            return TrackFeatures(
                track_id=track_id,
                detection_source=source,
                frame_range=(0, len(positions)),
                centroid_history=positions
            )

        # Extract metrics
        motion_metrics = extract_motion_metrics(positions, self.fps)
        trajectory_type, _ = classify_trajectory(motion_metrics)
        behavioral_features = calculate_behavioral_features(motion_metrics, trajectory_type)
        feature_vector = create_feature_vector(motion_metrics, behavioral_features)

        return TrackFeatures(
            track_id=track_id,
            detection_source=source,
            frame_range=(0, len(positions)),
            centroid_history=positions,
            motion_metrics=motion_metrics,
            behavioral_features=behavioral_features,
            feature_vector=feature_vector
        )

    def get_summary_statistics(self) -> Dict:
        """Get summary statistics across all processed tracks."""
        if not self.track_features:
            return {}

        summary = {
            'total_tracks': len(self.track_features),
            'trajectory_distribution': defaultdict(int),
            'organism_distribution': defaultdict(int),
            'source_distribution': defaultdict(int),
            'avg_speed': 0.0,
            'avg_straightness': 0.0,
            'avg_activity': 0.0,
            'behavioral_flags': {
                'foraging': 0,
                'fleeing': 0,
                'resting': 0,
                'patrolling': 0
            }
        }

        speeds = []
        straightness = []
        activities = []

        for tf in self.track_features.values():
            # Distributions
            summary['trajectory_distribution'][tf.behavioral_features.trajectory_type] += 1
            summary['organism_distribution'][tf.behavioral_features.inferred_organism] += 1
            summary['source_distribution'][tf.detection_source] += 1

            # Averages
            speeds.append(tf.motion_metrics.mean_speed)
            straightness.append(tf.motion_metrics.straightness_index)
            activities.append(tf.behavioral_features.activity_level)

            # Behavioral flags
            if tf.behavioral_features.is_foraging:
                summary['behavioral_flags']['foraging'] += 1
            if tf.behavioral_features.is_fleeing:
                summary['behavioral_flags']['fleeing'] += 1
            if tf.behavioral_features.is_resting:
                summary['behavioral_flags']['resting'] += 1
            if tf.behavioral_features.is_patrolling:
                summary['behavioral_flags']['patrolling'] += 1

        summary['avg_speed'] = np.mean(speeds) if speeds else 0.0
        summary['avg_straightness'] = np.mean(straightness) if straightness else 0.0
        summary['avg_activity'] = np.mean(activities) if activities else 0.0

        # Convert defaultdicts to regular dicts
        summary['trajectory_distribution'] = dict(summary['trajectory_distribution'])
        summary['organism_distribution'] = dict(summary['organism_distribution'])
        summary['source_distribution'] = dict(summary['source_distribution'])

        return summary

    def export_features(self, output_path: Path) -> None:
        """Export all track features to JSON."""
        output = {
            'summary': self.get_summary_statistics(),
            'tracks': {}
        }

        for track_id, tf in self.track_features.items():
            output['tracks'][track_id] = {
                'track_id': tf.track_id,
                'detection_source': tf.detection_source,
                'frame_range': tf.frame_range,
                'position_count': len(tf.centroid_history),
                'motion_metrics': asdict(tf.motion_metrics),
                'behavioral_features': asdict(tf.behavioral_features),
                'feature_vector': tf.feature_vector
            }

        with open(output_path, 'w') as f:
            json.dump(output, f, indent=2)

        print(f"Exported features to: {output_path}")

    def export_feature_matrix(self, output_path: Path) -> np.ndarray:
        """
        Export feature vectors as numpy matrix for ML.

        Returns:
            numpy array of shape (n_tracks, n_features)
        """
        if not self.track_features:
            return np.array([])

        # Sort by track_id for consistency
        sorted_ids = sorted(self.track_features.keys())
        matrix = np.array([
            self.track_features[tid].feature_vector
            for tid in sorted_ids
        ])

        np.save(output_path, matrix)
        print(f"Exported feature matrix {matrix.shape} to: {output_path}")

        return matrix


def main():
    """Test the motion feature extractor."""
    print("="*60)
    print("PHASE 3: Motion Feature Extractor Test")
    print("="*60)

    # Create extractor
    extractor = MotionFeatureExtractor(fps=8.0)

    # Test with synthetic track data
    print("\nTesting with synthetic tracks...")

    # Track 1: Fast linear movement (fish)
    fast_linear = [(100 + i*5, 100 + i*2) for i in range(50)]
    tf1 = extractor.process_from_positions(1, fast_linear, "RTDETR")
    print(f"\nTrack 1 (Fast Linear):")
    print(f"  Trajectory: {tf1.behavioral_features.trajectory_type}")
    print(f"  Organism: {tf1.behavioral_features.inferred_organism}")
    print(f"  Mean speed: {tf1.motion_metrics.mean_speed:.2f} px/frame")
    print(f"  Straightness: {tf1.motion_metrics.straightness_index:.2f}")

    # Track 2: Slow meandering (crab)
    import random
    random.seed(42)
    meandering = [(100, 100)]
    for i in range(60):
        dx = random.uniform(-3, 3)
        dy = random.uniform(-3, 3)
        meandering.append((meandering[-1][0] + dx, meandering[-1][1] + dy))
    tf2 = extractor.process_from_positions(2, meandering, "MOTION")
    print(f"\nTrack 2 (Slow Meandering):")
    print(f"  Trajectory: {tf2.behavioral_features.trajectory_type}")
    print(f"  Organism: {tf2.behavioral_features.inferred_organism}")
    print(f"  Mean speed: {tf2.motion_metrics.mean_speed:.2f} px/frame")
    print(f"  Direction changes: {tf2.motion_metrics.direction_changes}")

    # Track 3: Stationary (shellfish)
    stationary = [(200 + random.uniform(-0.5, 0.5), 200 + random.uniform(-0.5, 0.5))
                  for _ in range(40)]
    tf3 = extractor.process_from_positions(3, stationary, "FUSED")
    print(f"\nTrack 3 (Stationary):")
    print(f"  Trajectory: {tf3.behavioral_features.trajectory_type}")
    print(f"  Organism: {tf3.behavioral_features.inferred_organism}")
    print(f"  Total distance: {tf3.motion_metrics.total_distance:.2f} px")

    # Store tracks
    extractor.track_features = {1: tf1, 2: tf2, 3: tf3}

    # Get summary
    print("\n" + "="*60)
    print("Summary Statistics")
    print("="*60)
    summary = extractor.get_summary_statistics()
    print(f"Total tracks: {summary['total_tracks']}")
    print(f"Trajectory distribution: {summary['trajectory_distribution']}")
    print(f"Organism distribution: {summary['organism_distribution']}")
    print(f"Average speed: {summary['avg_speed']:.2f} px/frame")
    print(f"Average activity: {summary['avg_activity']:.2f}")

    print("\n" + "="*60)
    print("Feature Vector Example (Track 1)")
    print("="*60)
    print(f"Vector length: {len(tf1.feature_vector)}")
    print(f"Vector: {[f'{v:.3f}' for v in tf1.feature_vector]}")

    print("\nPhase 3 Motion Feature Extractor ready!")


if __name__ == '__main__':
    main()
