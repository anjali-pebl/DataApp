import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * POST /api/motion-analysis/process/progress
 * Update progress for a video in a processing run
 *
 * Request body:
 *   {
 *     runId: string,
 *     videoId: string,
 *     progress: number,         // 0-100
 *     status: string,           // Human-readable status message
 *     filename?: string         // Current video filename (optional)
 *   }
 *
 * Response:
 *   { success: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    // Use service client for server-to-server calls (from Python script)
    const supabase = createServiceClient();
    const body = await request.json();
    const { runId, videoId, progress, status, filename } = body;

    // Validate input
    if (!runId || !videoId || typeof progress !== 'number') {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Log progress
    console.log(`[Progress] Run: ${runId}, Video: ${videoId}, ${progress}% - ${status}`);

    // Update current_video_filename in processing_runs table
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (filename) {
      updateData.current_video_filename = filename;
    }

    const { error: updateError } = await supabase
      .from('processing_runs')
      .update(updateData)
      .eq('id', runId);

    if (updateError) {
      console.error('Error updating processing run:', updateError);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating progress:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
