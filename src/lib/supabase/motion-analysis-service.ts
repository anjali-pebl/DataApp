/**
 * Motion Analysis Service
 * Handles database operations for video uploads and processing runs
 * Related: MOTION_ANALYSIS_APP_SPEC.md, MOTION_ANALYSIS_IMPLEMENTATION_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

export interface UploadedVideo {
  id: string;
  user_id: string;
  filename: string;
  original_filename: string;
  file_size_bytes: number;
  filepath?: string;  // Optional - derived from filename as 'public/videos/' + filename
  upload_timestamp: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  duration_seconds: number | null;
  total_frames: number | null;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  has_yolo_output: boolean;
  has_motion_analysis: boolean;
  yolo_detections_count: number | null;
  motion_activity_score: number | null;
  prescreen_brightness?: number | null;
  prescreen_focus?: number | null;
  prescreen_quality?: number | null;
  prescreen_completed?: boolean;
  prescreen_samples?: number;
  prescreen_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessingRun {
  id: string;
  user_id: string;
  run_type: 'local' | 'modal-t4' | 'modal-a10g' | 'modal-a100';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  total_videos: number;
  videos_processed: number;
  videos_failed: number;
  current_video_filename: string | null;
  started_at: string;
  completed_at: string | null;
  estimated_duration_seconds: number | null;
  actual_duration_seconds: number | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  logs: LogEntry[];
  errors: ErrorEntry[];
  video_ids: string[];
  gpu_info: any;
  modal_job_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface ErrorEntry {
  timestamp: string;
  error: string;
  video_filename?: string;
}

export interface CreateVideoParams {
  filename: string;
  original_filename: string;
  file_size_bytes: number;
  filepath?: string;  // Optional - can be derived from filename
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  duration_seconds?: number | null;
  total_frames?: number | null;
}

export interface CreateProcessingRunParams {
  run_type: 'local' | 'modal-t4' | 'modal-a10g' | 'modal-a100';
  video_ids: string[];
  estimated_duration_seconds: number;
  estimated_cost_usd?: number;
  gpu_info?: any;
}

// ============================================================================
// Video Operations
// ============================================================================

/**
 * Get all uploaded videos for current user
 */
export async function getUploadedVideos(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('uploaded_videos')
    .select('*')
    .order('upload_timestamp', { ascending: false });

  return { videos: data as UploadedVideo[] | null, error };
}

/**
 * Get single video by ID
 */
export async function getVideoById(supabase: SupabaseClient, videoId: string) {
  const { data, error } = await supabase
    .from('uploaded_videos')
    .select('*')
    .eq('id', videoId)
    .single();

  return { video: data as UploadedVideo | null, error };
}

/**
 * Create uploaded video record
 */
export async function createUploadedVideo(
  supabase: SupabaseClient,
  params: CreateVideoParams
) {
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { video: null, error: authError || new Error('Not authenticated') };
  }

  const { data, error } = await supabase
    .from('uploaded_videos')
    .insert({
      user_id: user.id,
      ...params,
      processing_status: 'pending',
    })
    .select()
    .single();

  return { video: data as UploadedVideo | null, error };
}

/**
 * Update video processing status
 */
export async function updateVideoStatus(
  supabase: SupabaseClient,
  videoId: string,
  status: 'pending' | 'processing' | 'completed' | 'failed',
  additionalData?: {
    has_yolo_output?: boolean;
    has_motion_analysis?: boolean;
    yolo_detections_count?: number;
    motion_activity_score?: number;
  }
) {
  const { data, error } = await supabase
    .from('uploaded_videos')
    .update({
      processing_status: status,
      updated_at: new Date().toISOString(),
      ...additionalData,
    })
    .eq('id', videoId)
    .select()
    .single();

  return { video: data as UploadedVideo | null, error };
}

/**
 * Delete uploaded video
 */
export async function deleteUploadedVideo(supabase: SupabaseClient, videoId: string) {
  const { error } = await supabase
    .from('uploaded_videos')
    .delete()
    .eq('id', videoId);

  return { error };
}

// ============================================================================
// Processing Run Operations
// ============================================================================

/**
 * Get all processing runs for current user
 */
export async function getProcessingRuns(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('processing_runs')
    .select('*')
    .order('started_at', { ascending: false });

  return { runs: data as ProcessingRun[] | null, error };
}

/**
 * Get single processing run by ID
 */
export async function getProcessingRunById(supabase: SupabaseClient, runId: string) {
  const { data, error } = await supabase
    .from('processing_runs')
    .select('*')
    .eq('id', runId)
    .single();

  return { run: data as ProcessingRun | null, error };
}

/**
 * Create processing run
 */
export async function createProcessingRun(
  supabase: SupabaseClient,
  params: CreateProcessingRunParams
) {
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return { run: null, error: authError || new Error('Not authenticated') };
  }

  const { data, error } = await supabase
    .from('processing_runs')
    .insert({
      user_id: user.id,
      total_videos: params.video_ids.length,
      videos_processed: 0,
      videos_failed: 0,
      status: 'running',
      ...params,
    })
    .select()
    .single();

  return { run: data as ProcessingRun | null, error };
}

/**
 * Update processing run progress
 */
export async function updateProcessingRunProgress(
  supabase: SupabaseClient,
  runId: string,
  progress: {
    videos_processed?: number;
    videos_failed?: number;
    current_video_filename?: string;
    status?: 'running' | 'completed' | 'failed' | 'cancelled';
    completed_at?: string;
    actual_duration_seconds?: number;
    actual_cost_usd?: number;
  }
) {
  const { data, error } = await supabase
    .from('processing_runs')
    .update({
      ...progress,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .select()
    .single();

  return { run: data as ProcessingRun | null, error };
}

/**
 * Append log entry to processing run
 */
export async function appendProcessingLog(
  supabase: SupabaseClient,
  runId: string,
  logEntry: LogEntry
) {
  // First get current logs
  const { data: run, error: fetchError } = await supabase
    .from('processing_runs')
    .select('logs')
    .eq('id', runId)
    .single();

  if (fetchError || !run) {
    return { error: fetchError || new Error('Run not found') };
  }

  const currentLogs = (run.logs as LogEntry[]) || [];
  const updatedLogs = [...currentLogs, logEntry];

  const { error } = await supabase
    .from('processing_runs')
    .update({ logs: updatedLogs, updated_at: new Date().toISOString() })
    .eq('id', runId);

  return { error };
}

/**
 * Append error entry to processing run
 */
export async function appendProcessingError(
  supabase: SupabaseClient,
  runId: string,
  errorEntry: ErrorEntry
) {
  // First get current errors
  const { data: run, error: fetchError } = await supabase
    .from('processing_runs')
    .select('errors')
    .eq('id', runId)
    .single();

  if (fetchError || !run) {
    return { error: fetchError || new Error('Run not found') };
  }

  const currentErrors = (run.errors as ErrorEntry[]) || [];
  const updatedErrors = [...currentErrors, errorEntry];

  const { error } = await supabase
    .from('processing_runs')
    .update({ errors: updatedErrors, updated_at: new Date().toISOString() })
    .eq('id', runId);

  return { error };
}
