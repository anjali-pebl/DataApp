CREATE TABLE IF NOT EXISTS uploaded_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_size_bytes BIGINT,

  upload_timestamp TIMESTAMPTZ DEFAULT NOW(),

  width INTEGER,
  height INTEGER,
  fps FLOAT,
  duration_seconds FLOAT,
  total_frames INTEGER,

  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),

  has_yolo_output BOOLEAN DEFAULT FALSE,
  has_motion_analysis BOOLEAN DEFAULT FALSE,

  yolo_detections_count INTEGER,
  motion_activity_score FLOAT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_uploaded_videos_user_id ON uploaded_videos(user_id);
CREATE INDEX idx_uploaded_videos_status ON uploaded_videos(processing_status);
CREATE INDEX idx_uploaded_videos_upload_timestamp ON uploaded_videos(upload_timestamp DESC);

ALTER TABLE uploaded_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own videos"
  ON uploaded_videos FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own videos"
  ON uploaded_videos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own videos"
  ON uploaded_videos FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own videos"
  ON uploaded_videos FOR DELETE
  USING (auth.uid() = user_id);
