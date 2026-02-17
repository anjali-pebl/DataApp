CREATE TABLE IF NOT EXISTS estimation_accuracy (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    run_id UUID REFERENCES processing_runs(id) ON DELETE CASCADE,
    video_id UUID REFERENCES uploaded_videos(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    estimation_timestamp TIMESTAMPTZ NOT NULL,
    run_type TEXT NOT NULL CHECK (run_type IN ('local', 'modal-t4', 'modal-a10g', 'modal-a100')),
    enable_yolo BOOLEAN NOT NULL,
    video_width INTEGER NOT NULL,
    video_height INTEGER NOT NULL,
    video_total_frames INTEGER NOT NULL,
    video_duration_seconds FLOAT NOT NULL,

    predicted_duration_seconds FLOAT NOT NULL,
    predicted_fps FLOAT NOT NULL,
    predicted_cost_usd FLOAT,
    prediction_confidence TEXT NOT NULL CHECK (prediction_confidence IN ('high', 'medium', 'low')),
    prediction_based_on_runs INTEGER NOT NULL,

    actual_duration_seconds FLOAT,
    actual_fps FLOAT,
    actual_cost_usd FLOAT,

    duration_error_seconds FLOAT,
    duration_error_percentage FLOAT,
    fps_error FLOAT,
    fps_error_percentage FLOAT,
    cost_error_usd FLOAT,
    cost_error_percentage FLOAT,

    overestimated BOOLEAN,
    error_category TEXT CHECK (error_category IN ('accurate', 'slight', 'moderate', 'significant')),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_estimation_accuracy_learning
ON estimation_accuracy(run_type, enable_yolo, video_width, video_height, completed_at DESC)
WHERE actual_duration_seconds IS NOT NULL;

CREATE INDEX idx_estimation_accuracy_analysis
ON estimation_accuracy(estimation_timestamp, prediction_confidence, error_category);

CREATE INDEX idx_estimation_accuracy_video_id
ON estimation_accuracy(video_id);

CREATE INDEX idx_estimation_accuracy_user_id
ON estimation_accuracy(user_id);

ALTER TABLE estimation_accuracy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own estimation accuracy"
    ON estimation_accuracy FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service can insert estimation accuracy"
    ON estimation_accuracy FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Service can update estimation accuracy"
    ON estimation_accuracy FOR UPDATE
    USING (true);

COMMENT ON TABLE estimation_accuracy IS 'Tracks prediction accuracy to enable self-learning estimation algorithm';
COMMENT ON COLUMN estimation_accuracy.duration_error_percentage IS 'Positive = underestimated (actual > predicted), Negative = overestimated';
COMMENT ON COLUMN estimation_accuracy.error_category IS 'accurate: ≤10%, slight: 10-25%, moderate: 25-50%, significant: >50%';
