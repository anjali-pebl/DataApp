"""
Phase 3: Behavioral Clustering

Clusters tracks based on motion feature vectors to identify:
1. Similar movement patterns across organisms
2. Behavioral archetypes (forager, predator, prey, etc.)
3. Anomalous behaviors

Uses K-means and hierarchical clustering on the 20-dimensional feature vectors
from the motion feature extractor.

Author: Claude Code
Date: 2025-12-02
"""

import numpy as np
from pathlib import Path
import json
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass, asdict
from collections import defaultdict

try:
    from sklearn.cluster import KMeans, AgglomerativeClustering
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import silhouette_score
    from sklearn.decomposition import PCA
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False
    print("Warning: scikit-learn not available. Clustering will use simple heuristics.")


@dataclass
class BehavioralCluster:
    """Represents a cluster of similar behaviors."""
    cluster_id: int
    name: str
    description: str
    track_ids: List[int]
    centroid: List[float]

    # Cluster characteristics
    avg_speed: float
    avg_straightness: float
    avg_activity: float
    dominant_trajectory: str
    dominant_organism: str

    # Size metrics
    size: int
    percentage: float


@dataclass
class ClusteringResult:
    """Complete clustering analysis result."""
    n_clusters: int
    silhouette_score: float
    clusters: List[BehavioralCluster]
    track_assignments: Dict[int, int]  # track_id -> cluster_id

    # PCA for visualization
    pca_components: Optional[np.ndarray] = None
    explained_variance: Optional[List[float]] = None


def simple_cluster(feature_matrix: np.ndarray, n_clusters: int = 4) -> np.ndarray:
    """
    Simple clustering fallback when sklearn is not available.
    Uses K-means with Euclidean distance.
    """
    n_samples = feature_matrix.shape[0]
    if n_samples <= n_clusters:
        return np.arange(n_samples)

    # Initialize centroids randomly
    np.random.seed(42)
    centroid_indices = np.random.choice(n_samples, n_clusters, replace=False)
    centroids = feature_matrix[centroid_indices].copy()

    # Iterate
    for _ in range(100):
        # Assign samples to nearest centroid
        distances = np.zeros((n_samples, n_clusters))
        for i, centroid in enumerate(centroids):
            distances[:, i] = np.sqrt(np.sum((feature_matrix - centroid) ** 2, axis=1))
        labels = np.argmin(distances, axis=1)

        # Update centroids
        new_centroids = np.zeros_like(centroids)
        for i in range(n_clusters):
            mask = labels == i
            if np.any(mask):
                new_centroids[i] = feature_matrix[mask].mean(axis=0)
            else:
                new_centroids[i] = centroids[i]

        # Check convergence
        if np.allclose(centroids, new_centroids):
            break
        centroids = new_centroids

    return labels


def determine_optimal_clusters(feature_matrix: np.ndarray, max_k: int = 8) -> int:
    """
    Determine optimal number of clusters using silhouette score.
    """
    if not SKLEARN_AVAILABLE:
        return min(4, len(feature_matrix))

    n_samples = feature_matrix.shape[0]
    if n_samples < 4:
        return min(2, n_samples)

    # Scale features
    scaler = StandardScaler()
    scaled = scaler.fit_transform(feature_matrix)

    best_k = 2
    best_score = -1

    for k in range(2, min(max_k + 1, n_samples)):
        kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
        labels = kmeans.fit_predict(scaled)

        if len(set(labels)) < 2:
            continue

        score = silhouette_score(scaled, labels)
        if score > best_score:
            best_score = score
            best_k = k

    return best_k


def name_cluster(centroid: np.ndarray, dominant_trajectory: str,
                 dominant_organism: str, avg_speed: float) -> Tuple[str, str]:
    """
    Generate human-readable name and description for a cluster.

    Feature vector indices:
    0-4: Speed features
    5-9: Trajectory features
    10-13: Rest features
    14-17: Behavioral scores
    18-19: Track quality
    """
    # Extract key features from centroid
    speed_norm = centroid[0]  # normalized mean speed
    straightness = centroid[5]  # straightness index
    rest_ratio = centroid[11]  # rest ratio
    activity = centroid[13]  # activity level

    # Determine primary behavior
    if rest_ratio > 0.6:
        name = "Stationary Dwellers"
        desc = "Organisms that remain mostly stationary, possibly filter feeders or ambush predators"
    elif speed_norm > 0.5 and straightness > 0.6:
        name = "Fast Cruisers"
        desc = "Fast-moving organisms with linear trajectories, likely pelagic fish"
    elif speed_norm > 0.3 and straightness < 0.4:
        name = "Active Foragers"
        desc = "Moderately fast with meandering paths, likely searching for food"
    elif speed_norm < 0.2 and straightness < 0.5:
        name = "Slow Wanderers"
        desc = "Slow-moving organisms with irregular paths, possibly crabs or bottom dwellers"
    elif activity > 0.5 and rest_ratio > 0.3:
        name = "Burst Movers"
        desc = "Organisms with burst-and-rest movement patterns, possibly startled or hunting"
    else:
        name = f"Behavior Type {dominant_trajectory.title()}"
        desc = f"Mixed behavior pattern, primarily {dominant_organism}"

    return name, desc


class BehavioralClusterer:
    """
    Clusters tracks based on behavioral features.
    """

    def __init__(self, n_clusters: Optional[int] = None, method: str = 'kmeans'):
        """
        Initialize clusterer.

        Args:
            n_clusters: Number of clusters. If None, determined automatically.
            method: Clustering method ('kmeans' or 'hierarchical')
        """
        self.n_clusters = n_clusters
        self.method = method
        self.scaler = StandardScaler() if SKLEARN_AVAILABLE else None
        self.result: Optional[ClusteringResult] = None

    def fit(self, track_features: Dict, feature_matrix: Optional[np.ndarray] = None) -> ClusteringResult:
        """
        Perform clustering on track features.

        Args:
            track_features: Dictionary of track_id -> TrackFeatures
            feature_matrix: Optional pre-computed feature matrix

        Returns:
            ClusteringResult with cluster assignments and characteristics
        """
        # Build feature matrix if not provided
        if feature_matrix is None:
            track_ids = sorted(track_features.keys())
            feature_matrix = np.array([
                track_features[tid].feature_vector
                for tid in track_ids
            ])
        else:
            track_ids = sorted(track_features.keys())

        n_samples = feature_matrix.shape[0]

        if n_samples < 2:
            print("Not enough tracks for clustering")
            return ClusteringResult(
                n_clusters=1,
                silhouette_score=0.0,
                clusters=[],
                track_assignments={track_ids[0]: 0} if track_ids else {}
            )

        # Determine number of clusters
        if self.n_clusters is None:
            self.n_clusters = determine_optimal_clusters(feature_matrix)

        self.n_clusters = min(self.n_clusters, n_samples)

        # Scale features
        if SKLEARN_AVAILABLE and self.scaler:
            scaled = self.scaler.fit_transform(feature_matrix)
        else:
            # Simple normalization
            scaled = (feature_matrix - feature_matrix.mean(axis=0)) / (feature_matrix.std(axis=0) + 1e-8)

        # Perform clustering
        if SKLEARN_AVAILABLE:
            if self.method == 'hierarchical':
                clusterer = AgglomerativeClustering(n_clusters=self.n_clusters)
                labels = clusterer.fit_predict(scaled)
            else:
                clusterer = KMeans(n_clusters=self.n_clusters, random_state=42, n_init=10)
                labels = clusterer.fit_predict(scaled)
        else:
            labels = simple_cluster(scaled, self.n_clusters)

        # Calculate silhouette score
        sil_score = 0.0
        if SKLEARN_AVAILABLE and len(set(labels)) > 1:
            sil_score = silhouette_score(scaled, labels)

        # Build cluster assignments
        track_assignments = {tid: int(labels[i]) for i, tid in enumerate(track_ids)}

        # Build cluster objects
        clusters = []
        for cluster_id in range(self.n_clusters):
            mask = labels == cluster_id
            cluster_track_ids = [tid for i, tid in enumerate(track_ids) if mask[i]]

            if not cluster_track_ids:
                continue

            # Calculate centroid
            centroid = feature_matrix[mask].mean(axis=0)

            # Get cluster characteristics
            cluster_tracks = [track_features[tid] for tid in cluster_track_ids]

            speeds = [t.motion_metrics.mean_speed for t in cluster_tracks]
            straightness = [t.motion_metrics.straightness_index for t in cluster_tracks]
            activities = [t.behavioral_features.activity_level for t in cluster_tracks]

            # Count trajectory and organism types
            traj_counts = defaultdict(int)
            org_counts = defaultdict(int)
            for t in cluster_tracks:
                traj_counts[t.behavioral_features.trajectory_type] += 1
                org_counts[t.behavioral_features.inferred_organism] += 1

            dominant_traj = max(traj_counts, key=traj_counts.get)
            dominant_org = max(org_counts, key=org_counts.get)

            avg_speed = np.mean(speeds)

            # Generate name and description
            name, description = name_cluster(centroid, dominant_traj, dominant_org, avg_speed)

            clusters.append(BehavioralCluster(
                cluster_id=cluster_id,
                name=name,
                description=description,
                track_ids=cluster_track_ids,
                centroid=centroid.tolist(),
                avg_speed=avg_speed,
                avg_straightness=np.mean(straightness),
                avg_activity=np.mean(activities),
                dominant_trajectory=dominant_traj,
                dominant_organism=dominant_org,
                size=len(cluster_track_ids),
                percentage=100 * len(cluster_track_ids) / n_samples
            ))

        # PCA for visualization
        pca_components = None
        explained_variance = None
        if SKLEARN_AVAILABLE and n_samples >= 3:
            pca = PCA(n_components=min(3, n_samples, feature_matrix.shape[1]))
            pca_components = pca.fit_transform(scaled)
            explained_variance = pca.explained_variance_ratio_.tolist()

        self.result = ClusteringResult(
            n_clusters=len(clusters),
            silhouette_score=sil_score,
            clusters=clusters,
            track_assignments=track_assignments,
            pca_components=pca_components,
            explained_variance=explained_variance
        )

        return self.result

    def get_cluster_for_track(self, track_id: int) -> Optional[BehavioralCluster]:
        """Get the cluster a track belongs to."""
        if self.result is None or track_id not in self.result.track_assignments:
            return None

        cluster_id = self.result.track_assignments[track_id]
        for cluster in self.result.clusters:
            if cluster.cluster_id == cluster_id:
                return cluster
        return None

    def export_results(self, output_path: Path) -> None:
        """Export clustering results to JSON."""
        if self.result is None:
            print("No clustering results to export")
            return

        output = {
            'n_clusters': self.result.n_clusters,
            'silhouette_score': self.result.silhouette_score,
            'track_assignments': self.result.track_assignments,
            'clusters': [asdict(c) for c in self.result.clusters],
            'explained_variance': self.result.explained_variance
        }

        with open(output_path, 'w') as f:
            json.dump(output, f, indent=2)

        print(f"Exported clustering results to: {output_path}")

    def print_summary(self) -> None:
        """Print clustering summary."""
        if self.result is None:
            print("No clustering results available")
            return

        print("\n" + "="*60)
        print("BEHAVIORAL CLUSTERING RESULTS")
        print("="*60)
        print(f"Number of clusters: {self.result.n_clusters}")
        print(f"Silhouette score: {self.result.silhouette_score:.3f}")

        if self.result.explained_variance:
            total_var = sum(self.result.explained_variance[:2]) * 100
            print(f"PCA variance (2D): {total_var:.1f}%")

        print("\nCluster Summary:")
        print("-"*60)

        for cluster in sorted(self.result.clusters, key=lambda c: c.size, reverse=True):
            print(f"\n[Cluster {cluster.cluster_id}] {cluster.name}")
            print(f"  Size: {cluster.size} tracks ({cluster.percentage:.1f}%)")
            print(f"  Description: {cluster.description}")
            print(f"  Avg Speed: {cluster.avg_speed:.2f} px/frame")
            print(f"  Avg Straightness: {cluster.avg_straightness:.2f}")
            print(f"  Avg Activity: {cluster.avg_activity:.2f}")
            print(f"  Dominant Trajectory: {cluster.dominant_trajectory}")
            print(f"  Dominant Organism: {cluster.dominant_organism}")


def main():
    """Test behavioral clustering with synthetic data."""
    print("="*60)
    print("PHASE 3: Behavioral Clustering Test")
    print("="*60)

    # Import feature extractor
    from motion_feature_extractor import (
        MotionFeatureExtractor, TrackFeatures,
        extract_motion_metrics, classify_trajectory,
        calculate_behavioral_features, create_feature_vector
    )

    # Create test tracks
    import random
    random.seed(42)

    extractor = MotionFeatureExtractor(fps=8.0)

    # Generate diverse synthetic tracks
    tracks = {}

    # Group 1: Fast linear (fish)
    for i in range(5):
        speed = random.uniform(15, 25)
        positions = [(100 + j*speed + random.uniform(-2, 2),
                     100 + j*speed*0.3 + random.uniform(-2, 2))
                    for j in range(50)]
        tracks[i] = extractor.process_from_positions(i, positions, "RTDETR")

    # Group 2: Slow meandering (crab)
    for i in range(5, 10):
        positions = [(200, 200)]
        for j in range(60):
            dx = random.uniform(-4, 4)
            dy = random.uniform(-4, 4)
            positions.append((positions[-1][0] + dx, positions[-1][1] + dy))
        tracks[i] = extractor.process_from_positions(i, positions, "MOTION")

    # Group 3: Stationary (shellfish)
    for i in range(10, 14):
        positions = [(300 + random.uniform(-1, 1), 300 + random.uniform(-1, 1))
                    for _ in range(40)]
        tracks[i] = extractor.process_from_positions(i, positions, "FUSED")

    # Group 4: Burst movement (startled fish)
    for i in range(14, 18):
        positions = []
        x, y = 400, 400
        for j in range(50):
            if j % 10 < 3:  # Burst
                x += random.uniform(10, 20)
                y += random.uniform(-5, 5)
            else:  # Rest
                x += random.uniform(-1, 1)
                y += random.uniform(-1, 1)
            positions.append((x, y))
        tracks[i] = extractor.process_from_positions(i, positions, "RTDETR")

    extractor.track_features = tracks

    # Perform clustering
    print(f"\nClustering {len(tracks)} tracks...")
    clusterer = BehavioralClusterer(n_clusters=None, method='kmeans')
    result = clusterer.fit(tracks)

    # Print results
    clusterer.print_summary()

    print("\n" + "="*60)
    print("Track Assignments")
    print("="*60)
    for tid in sorted(tracks.keys()):
        cluster = clusterer.get_cluster_for_track(tid)
        if cluster:
            print(f"Track {tid}: Cluster {cluster.cluster_id} ({cluster.name})")


if __name__ == '__main__':
    main()
