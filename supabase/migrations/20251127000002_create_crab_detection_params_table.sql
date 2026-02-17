CREATE TABLE IF NOT EXISTS crab_detection_params (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  is_preset BOOLEAN DEFAULT FALSE,

  threshold INTEGER NOT NULL,
  min_area INTEGER NOT NULL,
  max_area INTEGER NOT NULL,
  min_circularity FLOAT NOT NULL,
  max_aspect_ratio FLOAT NOT NULL,
  morph_kernel_size INTEGER NOT NULL,

  max_distance FLOAT NOT NULL,
  max_skip_frames INTEGER NOT NULL,

  min_track_length INTEGER NOT NULL,
  min_displacement FLOAT NOT NULL,
  min_speed FLOAT NOT NULL,
  max_speed FLOAT NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crab_detection_params_user_id ON crab_detection_params(user_id);
CREATE INDEX IF NOT EXISTS idx_crab_detection_params_preset ON crab_detection_params(is_preset);

ALTER TABLE crab_detection_params ADD CONSTRAINT check_user_id_for_non_presets
  CHECK (is_preset = TRUE OR user_id IS NOT NULL);

ALTER TABLE crab_detection_params ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own params and presets"
  ON crab_detection_params FOR SELECT
  USING (auth.uid() = user_id OR is_preset = TRUE);

CREATE POLICY "Users can insert their own params"
  ON crab_detection_params FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own params"
  ON crab_detection_params FOR UPDATE
  USING (auth.uid() = user_id AND is_preset = FALSE);

INSERT INTO crab_detection_params (name, is_preset, user_id, threshold, min_area, max_area, min_circularity, max_aspect_ratio, morph_kernel_size, max_distance, max_skip_frames, min_track_length, min_displacement, min_speed, max_speed)
VALUES
  ('Conservative', TRUE, NULL, 35, 50, 1500, 0.5, 2.5, 5, 40, 3, 20, 25, 0.8, 25),
  ('Balanced', TRUE, NULL, 30, 30, 2000, 0.3, 3.0, 5, 50, 5, 15, 20, 0.5, 30),
  ('Aggressive', TRUE, NULL, 25, 20, 3000, 0.2, 4.0, 7, 60, 7, 10, 15, 0.3, 40);
