ALTER TABLE processing_metrics ADD COLUMN IF NOT EXISTS
    video_bitrate_kbps INTEGER;

ALTER TABLE processing_metrics ADD COLUMN IF NOT EXISTS
    video_codec TEXT;

ALTER TABLE processing_metrics ADD COLUMN IF NOT EXISTS
    motion_complexity_score FLOAT;

ALTER TABLE processing_metrics ADD COLUMN IF NOT EXISTS
    prediction_accuracy_id UUID REFERENCES estimation_accuracy(id);

COMMENT ON COLUMN processing_metrics.motion_complexity_score IS 'Video complexity metric (0-1 scale, higher = more motion)';
COMMENT ON COLUMN processing_metrics.video_codec IS 'Video codec used (e.g., h264, hevc, vp9)';
COMMENT ON COLUMN processing_metrics.video_bitrate_kbps IS 'Video bitrate in kilobits per second';

CREATE OR REPLACE VIEW estimation_performance_summary AS
SELECT
    run_type,
    enable_yolo,
    prediction_confidence,

    COUNT(*) as total_predictions,
    COUNT(*) FILTER (WHERE actual_duration_seconds IS NOT NULL) as completed_predictions,

    AVG(duration_error_percentage) as avg_error_pct,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ABS(duration_error_percentage)) as median_abs_error_pct,
    STDDEV(duration_error_percentage) as error_stddev,

    AVG(duration_error_seconds) as avg_bias_seconds,
    COUNT(*) FILTER (WHERE overestimated = true) * 100.0 / NULLIF(COUNT(*), 0) as overestimate_rate,

    COUNT(*) FILTER (WHERE error_category = 'accurate') * 100.0 / NULLIF(COUNT(*), 0) as accurate_rate,
    COUNT(*) FILTER (WHERE error_category = 'slight') * 100.0 / NULLIF(COUNT(*), 0) as slight_error_rate,
    COUNT(*) FILTER (WHERE error_category = 'moderate') * 100.0 / NULLIF(COUNT(*), 0) as moderate_error_rate,
    COUNT(*) FILTER (WHERE error_category = 'significant') * 100.0 / NULLIF(COUNT(*), 0) as significant_error_rate,

    MIN(estimation_timestamp) as first_prediction,
    MAX(estimation_timestamp) as last_prediction

FROM estimation_accuracy
WHERE actual_duration_seconds IS NOT NULL
GROUP BY run_type, enable_yolo, prediction_confidence;

GRANT SELECT ON estimation_performance_summary TO authenticated;

COMMENT ON VIEW estimation_performance_summary IS 'Aggregated estimation accuracy metrics by run type and confidence level';
