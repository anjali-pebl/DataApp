CREATE TABLE IF NOT EXISTS crab_detection_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES uploaded_videos(id) ON DELETE CASCADE,
  processing_run_id UUID REFERENCES processing_runs(id) ON DELETE SET NULL,

  params_id UUID REFERENCES crab_detection_params(id) ON DELETE SET NULL,
  params_snapshot JSONB NOT NULL,

  total_tracks INTEGER NOT NULL,
  valid_tracks INTEGER NOT NULL,
  total_detections INTEGER NOT NULL,

  annotated_video_path TEXT,
  results_json_path TEXT,

  processing_time_seconds FLOAT,
  frames_processed INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crab_detection_results_video_id ON crab_detection_results(video_id);
CREATE INDEX IF NOT EXISTS idx_crab_detection_results_user_id ON crab_detection_results(user_id);
CREATE INDEX IF NOT EXISTS idx_crab_detection_results_run_id ON crab_detection_results(processing_run_id);

ALTER TABLE crab_detection_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own crab detection results"
  ON crab_detection_results FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own crab detection results"
  ON crab_detection_results FOR INSERT
  WITH CHECK (auth.uid() = user_id);
