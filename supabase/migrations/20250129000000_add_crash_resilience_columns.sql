-- Migration: Add crash resilience columns to processing_runs and uploaded_videos
-- Date: 2025-01-29
-- Purpose: Enable heartbeat tracking, resume capability, and output verification

-- ============================================================================
-- Update processing_runs table
-- ============================================================================

-- Add heartbeat tracking
ALTER TABLE processing_runs
ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMPTZ;

-- Add current video tracking for precise resume
ALTER TABLE processing_runs
ADD COLUMN IF NOT EXISTS current_video_id UUID REFERENCES uploaded_videos(id);

-- Add resume counter for debugging
ALTER TABLE processing_runs
ADD COLUMN IF NOT EXISTS resume_count INTEGER DEFAULT 0;

-- Add checkpoint data for storing processing state
ALTER TABLE processing_runs
ADD COLUMN IF NOT EXISTS checkpoint_data JSONB DEFAULT '{}'::jsonb;

-- Update status constraint to include new 'paused' state
ALTER TABLE processing_runs
DROP CONSTRAINT IF EXISTS processing_runs_status_check;

ALTER TABLE processing_runs
ADD CONSTRAINT processing_runs_status_check
CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'paused'));

-- Add index for heartbeat queries
CREATE INDEX IF NOT EXISTS idx_processing_runs_last_heartbeat
ON processing_runs(last_heartbeat)
WHERE status = 'running';

-- Add index for current video
CREATE INDEX IF NOT EXISTS idx_processing_runs_current_video
ON processing_runs(current_video_id)
WHERE current_video_id IS NOT NULL;

-- ============================================================================
-- Update uploaded_videos table
-- ============================================================================

-- Add processing timestamps
ALTER TABLE uploaded_videos
ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;

ALTER TABLE uploaded_videos
ADD COLUMN IF NOT EXISTS processing_completed_at TIMESTAMPTZ;

ALTER TABLE uploaded_videos
ADD COLUMN IF NOT EXISTS processing_duration_seconds FLOAT;

-- Add retry tracking
ALTER TABLE uploaded_videos
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

ALTER TABLE uploaded_videos
ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Add output file tracking
ALTER TABLE uploaded_videos
ADD COLUMN IF NOT EXISTS output_file_paths JSONB DEFAULT '[]'::jsonb;

ALTER TABLE uploaded_videos
ADD COLUMN IF NOT EXISTS output_files_verified BOOLEAN DEFAULT false;

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_uploaded_videos_processing_status_retry
ON uploaded_videos(processing_status, retry_count)
WHERE processing_status IN ('failed', 'processing');

CREATE INDEX IF NOT EXISTS idx_uploaded_videos_verified
ON uploaded_videos(output_files_verified)
WHERE processing_status = 'completed';

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON COLUMN processing_runs.last_heartbeat IS 'Timestamp of last heartbeat from Python process (updated every 10s)';
COMMENT ON COLUMN processing_runs.current_video_id IS 'Video currently being processed (for precise resume point)';
COMMENT ON COLUMN processing_runs.resume_count IS 'Number of times this run has been resumed after interruption';
COMMENT ON COLUMN processing_runs.checkpoint_data IS 'JSON data for resume (settings, state, etc)';

COMMENT ON COLUMN uploaded_videos.processing_started_at IS 'When processing started for this video';
COMMENT ON COLUMN uploaded_videos.processing_completed_at IS 'When processing completed for this video';
COMMENT ON COLUMN uploaded_videos.processing_duration_seconds IS 'How long processing took in seconds';
COMMENT ON COLUMN uploaded_videos.retry_count IS 'Number of retry attempts (max 3)';
COMMENT ON COLUMN uploaded_videos.last_error IS 'Last error message from Python processing';
COMMENT ON COLUMN uploaded_videos.output_file_paths IS 'List of output files that should exist';
COMMENT ON COLUMN uploaded_videos.output_files_verified IS 'Whether output files have been verified as valid';
