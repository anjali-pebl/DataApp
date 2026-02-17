CREATE TABLE IF NOT EXISTS processing_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  run_type TEXT NOT NULL CHECK (run_type IN ('local', 'modal-t4', 'modal-a10g', 'modal-a100')),
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),

  total_videos INTEGER NOT NULL,
  videos_processed INTEGER DEFAULT 0,
  videos_failed INTEGER DEFAULT 0,
  current_video_filename TEXT,

  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  estimated_duration_seconds FLOAT,
  actual_duration_seconds FLOAT,

  estimated_cost_usd DECIMAL(10,4),
  actual_cost_usd DECIMAL(10,4),

  logs JSONB DEFAULT '[]'::jsonb,
  errors JSONB DEFAULT '[]'::jsonb,

  video_ids UUID[] NOT NULL,

  gpu_info JSONB,
  modal_job_id TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_processing_runs_user_id ON processing_runs(user_id);
CREATE INDEX idx_processing_runs_status ON processing_runs(status);
CREATE INDEX idx_processing_runs_started_at ON processing_runs(started_at DESC);

ALTER TABLE processing_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own processing runs"
  ON processing_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own processing runs"
  ON processing_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own processing runs"
  ON processing_runs FOR UPDATE
  USING (auth.uid() = user_id);
