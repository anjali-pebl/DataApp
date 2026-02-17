-- Add Benthic Activity V4 columns to uploaded_videos table
-- This migration adds support for BAv4 tracking results

ALTER TABLE uploaded_videos
ADD COLUMN IF NOT EXISTS has_benthic_activity_v4 BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS benthic_activity_valid_tracks INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS benthic_activity_total_tracks INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS benthic_activity_coupling_rate DECIMAL(5,2) DEFAULT 0.0,
ADD COLUMN IF NOT EXISTS benthic_activity_processing_time DECIMAL(10,3);

-- Add index for filtering videos with BAv4 results
CREATE INDEX IF NOT EXISTS idx_uploaded_videos_has_benthic_activity_v4
ON uploaded_videos(has_benthic_activity_v4)
WHERE has_benthic_activity_v4 = TRUE;

-- Add comment for documentation
COMMENT ON COLUMN uploaded_videos.has_benthic_activity_v4 IS 'Whether this video has been processed with Benthic Activity Detection V4';
COMMENT ON COLUMN uploaded_videos.benthic_activity_valid_tracks IS 'Number of valid organism tracks detected by BAv4';
COMMENT ON COLUMN uploaded_videos.benthic_activity_total_tracks IS 'Total number of organism tracks detected by BAv4 (valid and invalid)';
COMMENT ON COLUMN uploaded_videos.benthic_activity_coupling_rate IS 'Percentage of detections that were shadow-reflection coupled (0-100)';
COMMENT ON COLUMN uploaded_videos.benthic_activity_processing_time IS 'BAv4 processing time in seconds';
