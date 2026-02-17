ALTER TABLE uploaded_videos ADD COLUMN IF NOT EXISTS filepath TEXT;

UPDATE uploaded_videos SET filepath = 'public/videos/' || filename WHERE filepath IS NULL;

ALTER TABLE uploaded_videos ALTER COLUMN filepath SET NOT NULL;

COMMENT ON COLUMN uploaded_videos.filepath IS 'Full path to video file relative to project root (e.g., public/videos/video.mp4)';
