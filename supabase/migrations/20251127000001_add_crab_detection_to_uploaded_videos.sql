ALTER TABLE uploaded_videos
  ADD COLUMN IF NOT EXISTS has_crab_detection BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS crab_tracks_count INTEGER,
  ADD COLUMN IF NOT EXISTS crab_valid_tracks_count INTEGER;

CREATE INDEX IF NOT EXISTS idx_uploaded_videos_crab_detection ON uploaded_videos(has_crab_detection);
