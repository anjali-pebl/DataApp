import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/motion-analysis/process/reset
 * Reset stuck or failed videos back to pending state
 *
 * Request body:
 *   { videoIds?: string[], resetAll?: boolean }
 *
 * If videoIds provided, resets those specific videos
 * If resetAll is true, resets all stuck/failed videos for the user
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { videoIds, resetAll } = body;

    let resetCount = 0;

    if (resetAll) {
      // Reset all stuck videos (processing or failed status)
      const { data, error } = await supabase
        .from('uploaded_videos')
        .update({
          processing_status: 'pending',
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.id)
        .in('processing_status', ['processing', 'failed'])
        .select('id');

      if (error) {
        console.error('Error resetting all videos:', error);
        return NextResponse.json({ error: 'Failed to reset videos' }, { status: 500 });
      }

      resetCount = data?.length || 0;
      console.log(`Reset ${resetCount} videos to pending for user ${user.id}`);

    } else if (videoIds && Array.isArray(videoIds) && videoIds.length > 0) {
      // Reset specific videos
      const { data, error } = await supabase
        .from('uploaded_videos')
        .update({
          processing_status: 'pending',
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.id)
        .in('id', videoIds)
        .select('id');

      if (error) {
        console.error('Error resetting videos:', error);
        return NextResponse.json({ error: 'Failed to reset videos' }, { status: 500 });
      }

      resetCount = data?.length || 0;
      console.log(`Reset ${resetCount} specific videos to pending for user ${user.id}`);

    } else {
      return NextResponse.json(
        { error: 'Must provide videoIds array or resetAll: true' },
        { status: 400 }
      );
    }

    // Also mark any running processing runs as failed (cleanup)
    await supabase
      .from('processing_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString()
      })
      .eq('user_id', user.id)
      .eq('status', 'running');

    return NextResponse.json({
      success: true,
      resetCount,
      message: `Reset ${resetCount} video(s) to pending`
    });
  } catch (error: any) {
    console.error('Error in reset endpoint:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
