import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/motion-analysis/process/check-dead
 * Check for dead Python processes and mark runs as paused
 *
 * This endpoint is called periodically (every 60 seconds) by the frontend
 * to detect Python processes that have crashed or been killed.
 *
 * A run is considered "dead" if:
 * - Status is 'running'
 * - No heartbeat received for 60+ seconds
 *
 * Dead runs are marked as 'paused' (not 'failed') so they can be resumed.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const DEAD_THRESHOLD_MS = 60 * 1000; // 60 seconds without heartbeat
    const now = new Date();
    const deadlineTime = new Date(now.getTime() - DEAD_THRESHOLD_MS);

    console.log(`[Check Dead] Checking for processes without heartbeat since ${deadlineTime.toISOString()}`);

    // Find runs that are "running" but haven't sent heartbeat recently
    const { data: deadRuns, error: fetchError } = await supabase
      .from('processing_runs')
      .select('id, current_video_id, video_ids, last_heartbeat, started_at')
      .eq('status', 'running')
      .lt('last_heartbeat', deadlineTime.toISOString());

    if (fetchError) {
      console.error('[Check Dead] Error fetching runs:', fetchError);
      return NextResponse.json(
        { success: false, error: fetchError.message },
        { status: 500 }
      );
    }

    if (!deadRuns || deadRuns.length === 0) {
      // No dead runs - all good
      return NextResponse.json({
        success: true,
        deadRunsDetected: 0,
        message: 'All processes are alive'
      });
    }

    console.log(`[Check Dead] Found ${deadRuns.length} dead run(s):`);

    for (const run of deadRuns) {
      const lastHeartbeat = run.last_heartbeat ? new Date(run.last_heartbeat) : null;
      const timeSinceHeartbeat = lastHeartbeat
        ? Math.floor((now.getTime() - lastHeartbeat.getTime()) / 1000)
        : 'never';

      console.log(`  - Run ${run.id.substring(0, 8)}... (last heartbeat: ${timeSinceHeartbeat}s ago)`);

      // Mark run as 'paused' (can be resumed)
      const { error: updateRunError } = await supabase
        .from('processing_runs')
        .update({
          status: 'paused',
          updated_at: new Date().toISOString()
        })
        .eq('id', run.id);

      if (updateRunError) {
        console.error(`[Check Dead] Error updating run ${run.id}:`, updateRunError);
        continue;
      }

      // Mark current video as 'failed' if it was being processed
      if (run.current_video_id) {
        const { error: updateVideoError } = await supabase
          .from('uploaded_videos')
          .update({
            processing_status: 'failed',
            last_error: 'Processing interrupted (process died)',
            updated_at: new Date().toISOString()
          })
          .eq('id', run.current_video_id)
          .eq('processing_status', 'processing'); // Only if still marked as processing

        if (updateVideoError) {
          console.error(`[Check Dead] Error updating video ${run.current_video_id}:`, updateVideoError);
        } else {
          console.log(`    ✓ Marked video as failed`);
        }
      }

      console.log(`    ✓ Marked run as paused`);
    }

    return NextResponse.json({
      success: true,
      deadRunsDetected: deadRuns.length,
      deadRuns: deadRuns.map(r => ({
        id: r.id,
        lastHeartbeat: r.last_heartbeat,
        startedAt: r.started_at
      })),
      message: `Detected and paused ${deadRuns.length} dead process(es)`
    });

  } catch (error: any) {
    console.error('[Check Dead] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
