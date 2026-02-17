import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/motion-analysis/process/heartbeat
 * Receive heartbeat from Python process to signal it's still alive
 *
 * Request body:
 *   {
 *     runId: string  // Processing run ID
 *   }
 *
 * Response:
 *   {
 *     success: boolean
 *   }
 *
 * This endpoint is called every 10 seconds by the Python process
 * to update the last_heartbeat timestamp in the database.
 *
 * If heartbeats stop, the dead process detection cron job will
 * mark the run as 'paused' for later resume.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { runId } = body;

    if (!runId) {
      return NextResponse.json(
        { success: false, error: 'Missing runId' },
        { status: 400 }
      );
    }

    // Update last_heartbeat timestamp
    const { error } = await supabase
      .from('processing_runs')
      .update({
        last_heartbeat: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId);

    if (error) {
      console.error(`[Heartbeat] Failed to update run ${runId}:`, error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    // Success - return minimal response to keep heartbeat fast
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('[Heartbeat] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
