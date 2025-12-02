"""
Phase 3: Motion & Behavioral Features

This module provides tools for extracting behavioral features from
unified tracker output:

1. motion_feature_extractor.py - Core motion metrics extraction
2. behavioral_clustering.py - Clustering similar movement patterns
3. run_phase3_pipeline.py - Main pipeline runner

Usage:
    from phase3_motion_features import MotionFeatureExtractor, BehavioralClusterer

    # Extract features from track positions
    extractor = MotionFeatureExtractor(fps=8.0)
    track_features = extractor.process_from_positions(track_id, positions, source)

    # Cluster similar behaviors
    clusterer = BehavioralClusterer(n_clusters=None)
    results = clusterer.fit(track_features_dict)
"""

from .motion_feature_extractor import (
    MotionFeatureExtractor,
    MotionMetrics,
    BehavioralFeatures,
    TrackFeatures,
    TrajectoryType,
    OrganismType,
    extract_motion_metrics,
    classify_trajectory,
    calculate_behavioral_features,
    create_feature_vector
)

from .behavioral_clustering import (
    BehavioralClusterer,
    BehavioralCluster,
    ClusteringResult
)

__all__ = [
    # Feature extractor
    'MotionFeatureExtractor',
    'MotionMetrics',
    'BehavioralFeatures',
    'TrackFeatures',
    'TrajectoryType',
    'OrganismType',
    'extract_motion_metrics',
    'classify_trajectory',
    'calculate_behavioral_features',
    'create_feature_vector',
    # Clustering
    'BehavioralClusterer',
    'BehavioralCluster',
    'ClusteringResult',
]
