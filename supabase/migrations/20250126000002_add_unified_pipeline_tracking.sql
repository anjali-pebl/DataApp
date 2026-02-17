ALTER TABLE processing_metrics
ADD COLUMN IF NOT EXISTS pipeline_type TEXT DEFAULT 'legacy' CHECK (pipeline_type IN ('legacy', 'unified', 'parallel'));

ALTER TABLE processing_metrics
ADD COLUMN IF NOT EXISTS background_subtraction_seconds FLOAT;

ALTER TABLE processing_metrics
ADD COLUMN IF NOT EXISTS total_pipeline_seconds FLOAT;

ALTER TABLE processing_metrics
ADD COLUMN IF NOT EXISTS sample_rate INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_processing_metrics_pipeline_type
ON processing_metrics(pipeline_type);

DROP VIEW IF EXISTS processing_metrics_summary;

CREATE OR REPLACE VIEW processing_metrics_summary AS
SELECT
    run_type,
    pipeline_type,
    enable_yolo,
    target_fps,
    COUNT(*) as total_runs,
    COUNT(*) FILTER (WHERE success = true) as successful_runs,
    AVG(processing_fps) FILTER (WHERE success = true) as avg_processing_fps,
    AVG(total_duration_seconds) FILTER (WHERE success = true) as avg_total_duration,
    AVG(background_subtraction_seconds) FILTER (WHERE success = true AND background_subtraction_seconds IS NOT NULL) as avg_background_subtraction_duration,
    AVG(motion_analysis_seconds) FILTER (WHERE success = true) as avg_motion_duration,
    AVG(yolo_detection_seconds) FILTER (WHERE success = true AND enable_yolo = true) as avg_yolo_duration,
    AVG(total_pipeline_seconds) FILTER (WHERE success = true AND total_pipeline_seconds IS NOT NULL) as avg_pipeline_duration,
    AVG(actual_cost_usd) FILTER (WHERE success = true AND actual_cost_usd IS NOT NULL) as avg_cost,
    video_resolution,
    COUNT(*) FILTER (WHERE video_resolution = video_resolution) as runs_at_resolution,
    AVG(processing_fps) FILTER (WHERE success = true AND video_resolution = video_resolution) as avg_fps_at_resolution,
    MIN(created_at) as first_run,
    MAX(created_at) as last_run
FROM processing_metrics
WHERE success = true
GROUP BY run_type, pipeline_type, enable_yolo, target_fps, video_resolution;

GRANT SELECT ON processing_metrics_summary TO authenticated;

COMMENT ON COLUMN processing_metrics.pipeline_type IS 'Pipeline architecture: legacy (sequential), unified (single GPU session), or parallel (future optimization)';
COMMENT ON COLUMN processing_metrics.background_subtraction_seconds IS 'Time spent on background subtraction step (tracked separately in unified pipeline)';
COMMENT ON COLUMN processing_metrics.total_pipeline_seconds IS 'Total time for entire GPU pipeline (unified pipeline only)';
COMMENT ON COLUMN processing_metrics.sample_rate IS 'Frame sampling rate: 1 (all frames), 2 (15fps), 3 (10fps), 5 (5fps)';
