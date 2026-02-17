ALTER TABLE processing_runs
  ADD COLUMN IF NOT EXISTS enable_crab_detection BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS crab_detection_params_id UUID REFERENCES crab_detection_params(id) ON DELETE SET NULL;
