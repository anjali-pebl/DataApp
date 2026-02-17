-- Create processing_metrics table to track detailed performance data
-- This enables learning-based estimation that improves over time

CREATE TABLE IF NOT EXISTS processing_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to processing run and video
    run_id UUID NOT NULL REFERENCES processing_runs(id) ON DELETE CASCADE,
    video_id UUID NOT NULL REFERENCES uploaded_videos(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Processing configuration
    run_type TEXT NOT NULL CHECK (run_type IN ('local', 'modal-t4', 'modal-a10g')),
    target_fps TEXT NOT NULL,
    enable_motion_analysis BOOLEAN NOT NULL DEFAULT true,
    enable_yolo BOOLEAN NOT NULL DEFAULT false,
    yolo_model TEXT,

    -- Video characteristics
    video_filename TEXT NOT NULL,
    video_resolution TEXT NOT NULL,
    video_width INTEGER NOT NULL,
    video_height INTEGER NOT NULL,
    video_fps FLOAT NOT NULL,
    video_duration_seconds FLOAT NOT NULL,
    video_total_frames INTEGER NOT NULL,
    video_file_size_bytes BIGINT,

    -- Processing performance metrics
    total_duration_seconds FLOAT NOT NULL,
    motion_analysis_seconds FLOAT,
    yolo_detection_seconds FLOAT,

    -- Processing speed
    frames_processed INTEGER,
    processing_fps FLOAT,

    -- Resource usage (if available)
    cpu_model TEXT,
    gpu_model TEXT,
    gpu_memory_gb INTEGER,
    system_memory_gb INTEGER,

    -- Cost tracking (for cloud processing)
    estimated_cost_usd FLOAT,
    actual_cost_usd FLOAT,

    -- Quality metrics
    motion_activity_score FLOAT,
    yolo_detections_count INTEGER,

    -- Success tracking
    success BOOLEAN NOT NULL DEFAULT true,
    error_message TEXT,

    -- Timestamps
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_processing_metrics_run_id ON processing_metrics(run_id);
CREATE INDEX idx_processing_metrics_video_id ON processing_metrics(video_id);
CREATE INDEX idx_processing_metrics_user_id ON processing_metrics(user_id);
CREATE INDEX idx_processing_metrics_run_type ON processing_metrics(run_type);
CREATE INDEX idx_processing_metrics_created_at ON processing_metrics(created_at DESC);

-- Composite index for estimation queries
CREATE INDEX idx_processing_metrics_estimation
ON processing_metrics(run_type, enable_yolo, success, video_width, video_height);

-- RLS policies
ALTER TABLE processing_metrics ENABLE ROW LEVEL SECURITY;

-- Users can view their own metrics
CREATE POLICY "Users can view own processing metrics"
    ON processing_metrics
    FOR SELECT
    USING (auth.uid() = user_id);

-- Users can insert their own metrics
CREATE POLICY "Users can insert own processing metrics"
    ON processing_metrics
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Create view for aggregated statistics
CREATE OR REPLACE VIEW processing_metrics_summary AS
SELECT
    run_type,
    enable_yolo,
    target_fps,
    COUNT(*) as total_runs,
    COUNT(*) FILTER (WHERE success = true) as successful_runs,
    AVG(processing_fps) FILTER (WHERE success = true) as avg_processing_fps,
    AVG(total_duration_seconds) FILTER (WHERE success = true) as avg_total_duration,
    AVG(motion_analysis_seconds) FILTER (WHERE success = true) as avg_motion_duration,
    AVG(yolo_detection_seconds) FILTER (WHERE success = true AND enable_yolo = true) as avg_yolo_duration,
    AVG(actual_cost_usd) FILTER (WHERE success = true AND actual_cost_usd IS NOT NULL) as avg_cost,

    -- Resolution-based stats
    video_resolution,
    COUNT(*) FILTER (WHERE video_resolution = video_resolution) as runs_at_resolution,
    AVG(processing_fps) FILTER (WHERE success = true AND video_resolution = video_resolution) as avg_fps_at_resolution,

    MIN(created_at) as first_run,
    MAX(created_at) as last_run
FROM processing_metrics
WHERE success = true
GROUP BY run_type, enable_yolo, target_fps, video_resolution;

-- Grant access to the view
GRANT SELECT ON processing_metrics_summary TO authenticated;

-- Add comment for documentation
COMMENT ON TABLE processing_metrics IS 'Stores detailed performance metrics for each video processing run to enable learning-based estimation';
COMMENT ON COLUMN processing_metrics.processing_fps IS 'Frames processed per second - key metric for estimation';
COMMENT ON COLUMN processing_metrics.run_type IS 'Processing environment: local, modal-t4, or modal-a10g';
COMMENT ON COLUMN processing_metrics.target_fps IS 'Target frame rate for processing: all, 15, 10, 5';
