import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * POST /api/motion-analysis/process/cancel
 * Cancel a running video processing batch
 *
 * Request body:
 *   {
 *     runId: string  // Processing run ID to cancel
 *   }
 *
 * Response:
 *   {
 *     success: boolean,
 *     message: string,
 *     videosCompleted: number,  // Videos that finished before cancellation
 *     videosPending: number     // Videos reverted to pending
 *   }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { runId } = body;

    if (!runId) {
      return NextResponse.json(
        { success: false, error: 'Run ID is required' },
        { status: 400 }
      );
    }

    console.log(`[CANCEL] Attempting to cancel processing run: ${runId}`);

    // Fetch the processing run
    const { data: run, error: fetchError } = await supabase
      .from('processing_runs')
      .select('*')
      .eq('id', runId)
      .single();

    if (fetchError || !run) {
      console.error('[CANCEL] Run not found:', fetchError);
      return NextResponse.json(
        { success: false, error: 'Processing run not found' },
        { status: 404 }
      );
    }

    // Check if already completed or cancelled
    if (run.status === 'completed' || run.status === 'cancelled') {
      return NextResponse.json(
        {
          success: false,
          error: `Processing run is already ${run.status}`
        },
        { status: 400 }
      );
    }

    // Kill the Python process if PID exists
    if (run.process_pid) {
      console.log(`[CANCEL] Killing process with PID: ${run.process_pid}`);
      try {
        // Use taskkill on Windows, kill on Unix
        const isWindows = process.platform === 'win32';
        if (isWindows) {
          // /F = force, /T = terminate child processes
          await execAsync(`taskkill /F /T /PID ${run.process_pid}`);
        } else {
          // Kill process group to include children
          await execAsync(`kill -TERM -${run.process_pid}`);
        }
        console.log(`[CANCEL] ✓ Process killed successfully`);
      } catch (killError: any) {
        // Process might already be dead - that's okay
        console.warn(`[CANCEL] Warning: Could not kill process (might already be stopped): ${killError.message}`);
      }
    } else {
      console.warn('[CANCEL] No PID stored, cannot kill process');
    }

    // Get all video IDs from the run
    const videoIds = run.video_ids || [];

    // Fetch current status of all videos in this run
    const { data: videos, error: videosError } = await supabase
      .from('uploaded_videos')
      .select('id, filename, processing_status')
      .in('id', videoIds);

    if (videosError) {
      console.error('[CANCEL] Error fetching videos:', videosError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch video statuses' },
        { status: 500 }
      );
    }

    // Separate videos by status
    const completedVideos = videos?.filter(v => v.processing_status === 'completed') || [];
    const pendingVideos = videos?.filter(v => v.processing_status !== 'completed') || [];

    console.log(`[CANCEL] Videos status: ${completedVideos.length} completed, ${pendingVideos.length} incomplete`);

    // Revert incomplete videos to pending
    if (pendingVideos.length > 0) {
      const { error: revertError } = await supabase
        .from('uploaded_videos')
        .update({
          processing_status: 'pending',
          updated_at: new Date().toISOString()
        })
        .in('id', pendingVideos.map(v => v.id));

      if (revertError) {
        console.error('[CANCEL] Error reverting videos to pending:', revertError);
        // Non-fatal, continue
      } else {
        console.log(`[CANCEL] ✓ Reverted ${pendingVideos.length} videos to pending`);
      }
    }

    // Update the processing run to cancelled
    const { error: updateError } = await supabase
      .from('processing_runs')
      .update({
        status: 'cancelled',
        completed_at: new Date().toISOString(),
        videos_processed: completedVideos.length,
        videos_failed: run.videos_failed, // Keep existing failed count
        updated_at: new Date().toISOString()
      })
      .eq('id', runId);

    if (updateError) {
      console.error('[CANCEL] Error updating run status:', updateError);
      return NextResponse.json(
        { success: false, error: 'Failed to update run status' },
        { status: 500 }
      );
    }

    console.log(`[CANCEL] ✓ Processing run cancelled successfully`);
    console.log(`[CANCEL]   - Completed: ${completedVideos.length}`);
    console.log(`[CANCEL]   - Pending: ${pendingVideos.length}`);
    console.log(`[CANCEL]   - Failed: ${run.videos_failed}`);

    return NextResponse.json({
      success: true,
      message: 'Processing cancelled successfully',
      videosCompleted: completedVideos.length,
      videosPending: pendingVideos.length,
      videosFailed: run.videos_failed,
    });

  } catch (error: any) {
    console.error('[CANCEL] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to cancel processing' },
      { status: 500 }
    );
  }
}
