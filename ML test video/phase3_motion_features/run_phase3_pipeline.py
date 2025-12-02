"""
Phase 3: Motion & Behavioral Features Pipeline

Processes unified tracker output to extract:
1. Motion metrics (speed, acceleration, direction changes)
2. Trajectory classification (linear, meandering, stationary)
3. Behavioral clustering (grouping similar movement patterns)
4. Species inference based on motion patterns

Input: Unified V2 tracker results from Phase 2.5
Output: Feature vectors, behavioral clusters, and analysis reports

Author: Claude Code
Date: 2025-12-02
"""

import cv2
import numpy as np
from pathlib import Path
import json
from datetime import datetime
from typing import Dict, List, Tuple, Optional
from collections import defaultdict

from motion_feature_extractor import (
    MotionFeatureExtractor,
    TrackFeatures,
    extract_motion_metrics,
    classify_trajectory,
    calculate_behavioral_features,
    create_feature_vector
)

from behavioral_clustering import BehavioralClusterer


def load_unified_results(results_path: Path) -> Tuple[Dict, Dict]:
    """
    Load unified tracker results and extract track positions.

    Returns:
        Tuple of (raw_data dict, tracks dict with positions)
    """
    with open(results_path, 'r') as f:
        data = json.load(f)

    tracks = {}

    # Handle different result formats
    if 'tracks' in data:
        # Direct tracks format
        tracks = data['tracks']
    elif 'unified_tracks' in data:
        # Unified V2 format
        tracks = data['unified_tracks']

    return data, tracks


def extract_positions_from_unified_json(json_path: Path) -> Dict[int, List[Tuple[float, float]]]:
    """
    Extract track positions from unified tracker JSON output.

    The unified tracker stores track history in a specific format.
    This function extracts centroid positions for each track.
    """
    with open(json_path, 'r') as f:
        data = json.load(f)

    positions = {}

    # Handle various output formats
    if 'tracks' in data:
        for track_id_str, track_data in data['tracks'].items():
            track_id = int(track_id_str)

            if isinstance(track_data, dict):
                if 'positions' in track_data:
                    positions[track_id] = [
                        (p['x'], p['y']) for p in track_data['positions']
                    ]
                elif 'history' in track_data:
                    positions[track_id] = [
                        (h['centroid'][0], h['centroid'][1])
                        for h in track_data['history']
                    ]
                elif 'centroids' in track_data:
                    positions[track_id] = track_data['centroids']
            elif isinstance(track_data, list):
                # Direct list of positions
                if track_data and isinstance(track_data[0], (list, tuple)):
                    positions[track_id] = [(p[0], p[1]) for p in track_data]

    return positions


def process_video_for_tracks(
    video_path: Path,
    unified_json_path: Optional[Path] = None
) -> Dict[int, List[Tuple[float, float]]]:
    """
    Extract track positions from video annotations or JSON.

    If JSON is available, uses that. Otherwise, could process video
    directly (placeholder for future implementation).
    """
    if unified_json_path and unified_json_path.exists():
        return extract_positions_from_unified_json(unified_json_path)

    # Placeholder: In future, could re-run tracking on video
    print(f"Warning: No JSON found, cannot extract tracks from {video_path}")
    return {}


def create_track_visualization(
    track_features: Dict[int, TrackFeatures],
    output_path: Path,
    video_size: Tuple[int, int] = (1920, 1080)
):
    """
    Create visualization of all tracks colored by their classification.
    """
    img = np.zeros((video_size[1], video_size[0], 3), dtype=np.uint8)

    # Color mapping for trajectory types
    traj_colors = {
        'stationary': (128, 128, 128),   # Gray
        'linear': (0, 255, 0),            # Green
        'meandering': (0, 165, 255),      # Orange
        'circular': (255, 0, 255),        # Magenta
        'darting': (0, 255, 255),         # Yellow
        'unknown': (255, 255, 255)        # White
    }

    for tf in track_features.values():
        if len(tf.centroid_history) < 2:
            continue

        color = traj_colors.get(tf.behavioral_features.trajectory_type, (255, 255, 255))

        # Draw trajectory
        for i in range(1, len(tf.centroid_history)):
            pt1 = (int(tf.centroid_history[i-1][0]), int(tf.centroid_history[i-1][1]))
            pt2 = (int(tf.centroid_history[i][0]), int(tf.centroid_history[i][1]))
            cv2.line(img, pt1, pt2, color, 2)

        # Draw start point (circle)
        start = (int(tf.centroid_history[0][0]), int(tf.centroid_history[0][1]))
        cv2.circle(img, start, 5, color, -1)

        # Draw end point (arrow)
        if len(tf.centroid_history) >= 2:
            end = (int(tf.centroid_history[-1][0]), int(tf.centroid_history[-1][1]))
            prev = (int(tf.centroid_history[-2][0]), int(tf.centroid_history[-2][1]))
            cv2.arrowedLine(img, prev, end, color, 2, tipLength=0.3)

    # Add legend
    y = 30
    for traj_type, color in traj_colors.items():
        cv2.putText(img, f"- {traj_type}", (20, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
        y += 25

    cv2.imwrite(str(output_path), img)
    print(f"Saved trajectory visualization: {output_path}")


def create_cluster_visualization(
    track_features: Dict[int, TrackFeatures],
    clustering_result,
    output_path: Path,
    video_size: Tuple[int, int] = (1920, 1080)
):
    """
    Create visualization of tracks colored by cluster.
    """
    img = np.zeros((video_size[1], video_size[0], 3), dtype=np.uint8)

    # Generate colors for clusters
    cluster_colors = [
        (255, 0, 0),     # Blue
        (0, 255, 0),     # Green
        (0, 0, 255),     # Red
        (255, 255, 0),   # Cyan
        (255, 0, 255),   # Magenta
        (0, 255, 255),   # Yellow
        (128, 0, 255),   # Purple
        (0, 128, 255),   # Orange
    ]

    for track_id, tf in track_features.items():
        if len(tf.centroid_history) < 2:
            continue

        cluster_id = clustering_result.track_assignments.get(track_id, 0)
        color = cluster_colors[cluster_id % len(cluster_colors)]

        # Draw trajectory
        for i in range(1, len(tf.centroid_history)):
            pt1 = (int(tf.centroid_history[i-1][0]), int(tf.centroid_history[i-1][1]))
            pt2 = (int(tf.centroid_history[i][0]), int(tf.centroid_history[i][1]))
            cv2.line(img, pt1, pt2, color, 2)

    # Add legend
    y = 30
    for cluster in clustering_result.clusters:
        color = cluster_colors[cluster.cluster_id % len(cluster_colors)]
        cv2.putText(img, f"C{cluster.cluster_id}: {cluster.name} ({cluster.size})",
                   (20, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
        y += 25

    cv2.imwrite(str(output_path), img)
    print(f"Saved cluster visualization: {output_path}")


def generate_phase3_report(
    clip_name: str,
    track_features: Dict[int, TrackFeatures],
    clustering_result,
    output_path: Path
):
    """Generate a detailed Phase 3 analysis report."""
    report = []
    report.append(f"# Phase 3 Motion Analysis Report: {clip_name}")
    report.append(f"\nGenerated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # Summary statistics
    report.append("## Summary Statistics\n")
    report.append(f"- **Total Tracks Analyzed:** {len(track_features)}")

    if track_features:
        speeds = [tf.motion_metrics.mean_speed for tf in track_features.values()]
        straight = [tf.motion_metrics.straightness_index for tf in track_features.values()]
        activities = [tf.behavioral_features.activity_level for tf in track_features.values()]

        report.append(f"- **Average Speed:** {np.mean(speeds):.2f} px/frame")
        report.append(f"- **Average Straightness:** {np.mean(straight):.2f}")
        report.append(f"- **Average Activity Level:** {np.mean(activities):.2f}")

    # Trajectory distribution
    report.append("\n## Trajectory Distribution\n")
    traj_counts = defaultdict(int)
    for tf in track_features.values():
        traj_counts[tf.behavioral_features.trajectory_type] += 1

    report.append("| Trajectory Type | Count | Percentage |")
    report.append("|----------------|-------|------------|")
    for traj, count in sorted(traj_counts.items(), key=lambda x: -x[1]):
        pct = 100 * count / len(track_features) if track_features else 0
        report.append(f"| {traj.title()} | {count} | {pct:.1f}% |")

    # Organism inference
    report.append("\n## Inferred Organism Types\n")
    org_counts = defaultdict(int)
    for tf in track_features.values():
        org_counts[tf.behavioral_features.inferred_organism] += 1

    report.append("| Organism Type | Count | Percentage |")
    report.append("|--------------|-------|------------|")
    for org, count in sorted(org_counts.items(), key=lambda x: -x[1]):
        pct = 100 * count / len(track_features) if track_features else 0
        report.append(f"| {org.replace('_', ' ').title()} | {count} | {pct:.1f}% |")

    # Clustering results
    report.append("\n## Behavioral Clusters\n")
    if clustering_result:
        report.append(f"- **Number of Clusters:** {clustering_result.n_clusters}")
        report.append(f"- **Silhouette Score:** {clustering_result.silhouette_score:.3f}")
        report.append("")

        for cluster in clustering_result.clusters:
            report.append(f"### Cluster {cluster.cluster_id}: {cluster.name}")
            report.append(f"- **Size:** {cluster.size} tracks ({cluster.percentage:.1f}%)")
            report.append(f"- **Description:** {cluster.description}")
            report.append(f"- **Avg Speed:** {cluster.avg_speed:.2f} px/frame")
            report.append(f"- **Avg Straightness:** {cluster.avg_straightness:.2f}")
            report.append(f"- **Dominant Trajectory:** {cluster.dominant_trajectory}")
            report.append(f"- **Dominant Organism:** {cluster.dominant_organism}")
            report.append("")

    # Behavioral flags
    report.append("\n## Behavioral Flags\n")
    flags = {
        'foraging': sum(1 for tf in track_features.values() if tf.behavioral_features.is_foraging),
        'fleeing': sum(1 for tf in track_features.values() if tf.behavioral_features.is_fleeing),
        'resting': sum(1 for tf in track_features.values() if tf.behavioral_features.is_resting),
        'patrolling': sum(1 for tf in track_features.values() if tf.behavioral_features.is_patrolling)
    }

    report.append("| Behavior | Count |")
    report.append("|----------|-------|")
    for behavior, count in flags.items():
        report.append(f"| {behavior.title()} | {count} |")

    # Top tracks by activity
    report.append("\n## Top 5 Most Active Tracks\n")
    sorted_tracks = sorted(track_features.values(),
                          key=lambda x: x.motion_metrics.mean_speed,
                          reverse=True)[:5]

    report.append("| Track ID | Speed | Straightness | Trajectory | Organism |")
    report.append("|----------|-------|--------------|------------|----------|")
    for tf in sorted_tracks:
        report.append(f"| {tf.track_id} | {tf.motion_metrics.mean_speed:.2f} | "
                     f"{tf.motion_metrics.straightness_index:.2f} | "
                     f"{tf.behavioral_features.trajectory_type} | "
                     f"{tf.behavioral_features.inferred_organism} |")

    # Write report
    with open(output_path, 'w') as f:
        f.write('\n'.join(report))

    print(f"Saved analysis report: {output_path}")


def process_clip_phase3(
    clip_name: str,
    unified_results_dir: Path,
    output_dir: Path,
    fps: float = 8.0
) -> Dict:
    """
    Process a single clip through Phase 3 pipeline.

    Args:
        clip_name: Name of clip (e.g., 'clip011')
        unified_results_dir: Directory containing Unified V2 results
        output_dir: Output directory for Phase 3 results
        fps: Frame rate of tracking data

    Returns:
        Dictionary with processing results
    """
    print(f"\n{'='*60}")
    print(f"PHASE 3: Processing {clip_name}")
    print(f"{'='*60}")

    output_dir.mkdir(parents=True, exist_ok=True)

    # Find unified tracker results
    unified_json = unified_results_dir / clip_name / f"{clip_name}_background_subtracted_unified_v2.json"
    if not unified_json.exists():
        # Try alternative filename
        unified_json = unified_results_dir / clip_name / f"{clip_name}_comparison_results.json"

    if not unified_json.exists():
        print(f"  [SKIP] No unified results found for {clip_name}")
        return {'clip': clip_name, 'status': 'skipped', 'reason': 'no_unified_results'}

    print(f"  Loading unified results: {unified_json.name}")

    # Extract positions from JSON
    positions = extract_positions_from_unified_json(unified_json)

    if not positions:
        # Try to extract from comparison results
        with open(unified_json, 'r') as f:
            data = json.load(f)

        # Look for track data in various formats
        print(f"  Unified JSON structure: {list(data.keys())}")

        # The comparison_results.json might not have position data
        # We need to look at the actual unified tracker output
        unified_output_json = unified_results_dir / clip_name / f"{clip_name}_background_subtracted_unified_v2_tracks.json"
        if unified_output_json.exists():
            positions = extract_positions_from_unified_json(unified_output_json)

    if not positions:
        print(f"  [WARNING] No track positions found, generating from video...")
        # For now, skip - in future could re-process video
        return {'clip': clip_name, 'status': 'skipped', 'reason': 'no_positions'}

    print(f"  Found {len(positions)} tracks with position data")

    # Initialize feature extractor
    extractor = MotionFeatureExtractor(fps=fps)

    # Process each track
    for track_id, track_positions in positions.items():
        tf = extractor.process_from_positions(track_id, track_positions, "UNIFIED")
        extractor.track_features[track_id] = tf

    print(f"  Extracted features for {len(extractor.track_features)} tracks")

    # Get summary statistics
    summary = extractor.get_summary_statistics()
    print(f"\n  Motion Summary:")
    print(f"    Avg Speed: {summary['avg_speed']:.2f} px/frame")
    print(f"    Avg Activity: {summary['avg_activity']:.2f}")
    print(f"    Trajectories: {dict(summary['trajectory_distribution'])}")
    print(f"    Organisms: {dict(summary['organism_distribution'])}")

    # Perform behavioral clustering
    print(f"\n  Running behavioral clustering...")
    clusterer = BehavioralClusterer(n_clusters=None, method='kmeans')
    clustering_result = clusterer.fit(extractor.track_features)

    print(f"    Found {clustering_result.n_clusters} clusters")
    print(f"    Silhouette score: {clustering_result.silhouette_score:.3f}")

    # Export results
    clip_output_dir = output_dir / clip_name
    clip_output_dir.mkdir(exist_ok=True)

    # Export feature JSON
    features_json = clip_output_dir / f"{clip_name}_motion_features.json"
    extractor.export_features(features_json)

    # Export feature matrix
    feature_matrix_npy = clip_output_dir / f"{clip_name}_feature_matrix.npy"
    extractor.export_feature_matrix(feature_matrix_npy)

    # Export clustering results
    clustering_json = clip_output_dir / f"{clip_name}_clusters.json"
    clusterer.export_results(clustering_json)

    # Create visualizations
    trajectory_viz = clip_output_dir / f"{clip_name}_trajectories.png"
    create_track_visualization(extractor.track_features, trajectory_viz)

    cluster_viz = clip_output_dir / f"{clip_name}_clusters.png"
    create_cluster_visualization(extractor.track_features, clustering_result, cluster_viz)

    # Generate report
    report_path = clip_output_dir / f"{clip_name}_phase3_report.md"
    generate_phase3_report(clip_name, extractor.track_features, clustering_result, report_path)

    return {
        'clip': clip_name,
        'status': 'success',
        'tracks_processed': len(extractor.track_features),
        'clusters': clustering_result.n_clusters,
        'silhouette_score': clustering_result.silhouette_score,
        'summary': summary,
        'output_dir': str(clip_output_dir)
    }


def main():
    """Run Phase 3 pipeline on all available clips."""
    print("="*80)
    print("PHASE 3: Motion & Behavioral Features Pipeline")
    print("="*80)
    print("\nThis pipeline extracts:")
    print("  1. Motion metrics (speed, acceleration, direction)")
    print("  2. Trajectory classification (linear, meandering, stationary)")
    print("  3. Behavioral clustering (grouping similar patterns)")
    print("  4. Species inference (fish, crab, snail, shellfish)")

    base_dir = Path(__file__).parent.parent
    unified_results_dir = base_dir / "phase2.5_testing" / "unified_comparison_v2"
    output_dir = Path(__file__).parent / "outputs"

    # Find all clips with unified results
    test_clips = ['clip011', 'clip021', 'clip031', 'clip041']

    all_results = {}

    for clip_name in test_clips:
        result = process_clip_phase3(clip_name, unified_results_dir, output_dir)
        all_results[clip_name] = result

    # Save summary
    summary_path = output_dir / "phase3_summary.json"
    with open(summary_path, 'w') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'clips': all_results
        }, f, indent=2, default=str)

    # Print final summary
    print("\n" + "="*80)
    print("PHASE 3 COMPLETE")
    print("="*80)

    print("\nResults Summary:")
    print("-"*60)
    print(f"{'Clip':<10} {'Status':<10} {'Tracks':<10} {'Clusters':<10} {'Silhouette':<10}")
    print("-"*60)

    for clip, result in all_results.items():
        status = result.get('status', 'unknown')
        tracks = result.get('tracks_processed', 'N/A')
        clusters = result.get('clusters', 'N/A')
        sil = result.get('silhouette_score', 'N/A')
        if isinstance(sil, float):
            sil = f"{sil:.3f}"
        print(f"{clip:<10} {status:<10} {str(tracks):<10} {str(clusters):<10} {str(sil):<10}")

    print("-"*60)
    print(f"\nResults saved to: {output_dir}")


if __name__ == '__main__':
    main()
