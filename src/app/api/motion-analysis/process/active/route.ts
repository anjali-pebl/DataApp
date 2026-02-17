import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/motion-analysis/process/active
 * Get any currently running processing runs for the user
 *
 * Used on page load to restore ProcessingStatusPanel after refresh
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find any running processing runs for this user
    const { data: activeRuns, error } = await supabase
      .from('processing_runs')
      .select('id, run_type, status, started_at, total_videos, videos_processed, videos_failed')
      .eq('user_id', user.id)
      .eq('status', 'running')
      .order('started_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Error fetching active runs:', error);
      return NextResponse.json({ error: 'Failed to fetch active runs' }, { status: 500 });
    }

    // Check if the run is actually still running (not stale)
    // A run is considered stale if it's been "running" for more than 30 minutes without completion
    const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

    let activeRun = null;
    if (activeRuns && activeRuns.length > 0) {
      const run = activeRuns[0];
      const startedAt = new Date(run.started_at).getTime();
      const now = Date.now();
      const elapsed = now - startedAt;

      if (elapsed < STALE_THRESHOLD_MS) {
        // Run is recent, consider it active
        activeRun = run;
      } else {
        // Run is stale - mark it as failed and reset stuck videos
        console.log(`Marking stale run ${run.id} as failed (started ${elapsed / 60000} minutes ago)`);

        await supabase
          .from('processing_runs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString()
          })
          .eq('id', run.id);

        // Reset any videos still in "processing" state for this run
        const { data: runData } = await supabase
          .from('processing_runs')
          .select('video_ids')
          .eq('id', run.id)
          .single();

        if (runData?.video_ids) {
          await supabase
            .from('uploaded_videos')
            .update({
              processing_status: 'failed',
              updated_at: new Date().toISOString()
            })
            .in('id', runData.video_ids)
            .eq('processing_status', 'processing');
        }
      }
    }

    // Also check for videos stuck in "processing" state without an active run
    const { data: stuckVideos } = await supabase
      .from('uploaded_videos')
      .select('id, filename, processing_status, updated_at')
      .eq('user_id', user.id)
      .eq('processing_status', 'processing');

    const stuckCount = stuckVideos?.length || 0;

    return NextResponse.json({
      success: true,
      activeRun,
      hasActiveRun: !!activeRun,
      stuckVideosCount: stuckCount,
      stuckVideos: stuckVideos?.map(v => ({ id: v.id, filename: v.filename })) || [],
    });
  } catch (error: any) {
    console.error('Error in active runs endpoint:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
