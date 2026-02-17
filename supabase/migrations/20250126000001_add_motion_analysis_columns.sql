ALTER TABLE uploaded_videos ADD COLUMN IF NOT EXISTS motion_analysis TEXT;
ALTER TABLE uploaded_videos ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
