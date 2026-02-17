import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/motion-analysis/process/delete
 * Deletes processing run(s) by run_id or video_id
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Verify user is authenticated
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const runId = searchParams.get('runId');
    const videoId = searchParams.get('videoId');

    if (!runId && !videoId) {
      return NextResponse.json(
        { error: 'Either runId or videoId is required' },
        { status: 400 }
      );
    }

    // Delete by run_id (single run)
    if (runId) {
      const { error: deleteError, count } = await supabase
        .from('processing_runs')
        .delete()
        .eq('id', runId)
        .eq('user_id', user.id);

      if (deleteError) {
        console.error('Error deleting processing run:', deleteError);
        return NextResponse.json(
          { error: 'Failed to delete processing run', details: deleteError.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: 'Processing run deleted successfully',
        deletedCount: count || 0,
      });
    }

    // Delete by video_id (all runs for that video)
    if (videoId) {
      // First, get the video to verify ownership
      const { data: video, error: videoError } = await supabase
        .from('uploaded_videos')
        .select('id')
        .eq('id', videoId)
        .eq('user_id', user.id)
        .single();

      if (videoError || !video) {
        return NextResponse.json(
          { error: 'Video not found or unauthorized' },
          { status: 404 }
        );
      }

      // Delete all processing runs for this video
      const { error: deleteError, count } = await supabase
        .from('processing_runs')
        .delete()
        .eq('video_id', videoId)
        .eq('user_id', user.id);

      if (deleteError) {
        console.error('Error deleting processing runs:', deleteError);
        return NextResponse.json(
          { error: 'Failed to delete processing runs', details: deleteError.message },
          { status: 500 }
        );
      }

      // Also clear the processing_history from the video's motion_analysis JSON
      const { data: existingVideo } = await supabase
        .from('uploaded_videos')
        .select('motion_analysis')
        .eq('id', videoId)
        .single();

      if (existingVideo?.motion_analysis) {
        try {
          const analysisData = JSON.parse(existingVideo.motion_analysis);
          delete analysisData.processing_history;

          await supabase
            .from('uploaded_videos')
            .update({ motion_analysis: JSON.stringify(analysisData) })
            .eq('id', videoId);
        } catch (e) {
          console.error('Error updating motion_analysis:', e);
          // Non-fatal, continue
        }
      }

      return NextResponse.json({
        success: true,
        message: `Deleted ${count || 0} processing run(s) for video`,
        deletedCount: count || 0,
      });
    }

    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 }
    );

  } catch (error) {
    console.error('Error in DELETE /api/motion-analysis/process/delete:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
