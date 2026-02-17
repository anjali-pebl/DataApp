import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/motion-analysis/process/[id]
 * Fetch processing run status
 *
 * Response:
 *   {
 *     success: boolean,
 *     run: {
 *       id: string,
 *       run_type: string,
 *       total_videos: number,
 *       processed_videos: number,
 *       failed_videos: number,
 *       status: string,
 *       started_at: string,
 *       completed_at: string | null,
 *       created_at: string
 *     }
 *   }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Run ID is required' },
        { status: 400 }
      );
    }

    // Fetch processing run
    const { data: run, error } = await supabase
      .from('processing_runs')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !run) {
      console.error('Error fetching processing run:', error);
      return NextResponse.json(
        { success: false, error: 'Processing run not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      run: {
        id: run.id,
        run_type: run.run_type,
        total_videos: run.total_videos,
        videos_processed: run.videos_processed,
        videos_failed: run.videos_failed,
        status: run.status,
        started_at: run.started_at,
        completed_at: run.completed_at,
        created_at: run.created_at,
        current_video_filename: run.current_video_filename,
      },
    });
  } catch (error: any) {
    console.error('Error fetching processing run:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch processing run' },
      { status: 500 }
    );
  }
}
