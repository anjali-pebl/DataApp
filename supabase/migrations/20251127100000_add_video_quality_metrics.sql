ALTER TABLE uploaded_videos
ADD COLUMN IF NOT EXISTS prescreen_brightness FLOAT,
ADD COLUMN IF NOT EXISTS prescreen_focus FLOAT,
ADD COLUMN IF NOT EXISTS prescreen_quality FLOAT,
ADD COLUMN IF NOT EXISTS prescreen_completed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS prescreen_samples INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS prescreen_error TEXT;

CREATE INDEX IF NOT EXISTS idx_uploaded_videos_quality ON uploaded_videos(prescreen_quality);

COMMENT ON COLUMN uploaded_videos.prescreen_brightness IS 'Normalized brightness score 0-1 (avg luminance)';
COMMENT ON COLUMN uploaded_videos.prescreen_focus IS 'Normalized focus score 0-1 (Laplacian variance)';
COMMENT ON COLUMN uploaded_videos.prescreen_quality IS 'Combined quality score 0-1';
COMMENT ON COLUMN uploaded_videos.prescreen_completed IS 'Whether prescreening has run';
COMMENT ON COLUMN uploaded_videos.prescreen_samples IS 'Number of frames sampled';
