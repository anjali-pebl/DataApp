CREATE TABLE IF NOT EXISTS user_hardware (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  gpu_name TEXT,
  gpu_vram_gb FLOAT,
  cpu_name TEXT,
  cpu_cores INTEGER,
  ram_gb FLOAT,
  platform TEXT,

  yolov8_benchmark_fps FLOAT,
  yolov8_benchmark_resolution TEXT,
  yolov8_benchmark_date TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id)
);

CREATE INDEX idx_user_hardware_user_id ON user_hardware(user_id);

ALTER TABLE user_hardware ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own hardware"
  ON user_hardware FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own hardware"
  ON user_hardware FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own hardware"
  ON user_hardware FOR UPDATE
  USING (auth.uid() = user_id);
