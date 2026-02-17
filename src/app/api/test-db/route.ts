import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    console.log('[TEST-DB] Starting database connection test...');

    // Test 1: Create client
    console.log('[TEST-DB] Creating Supabase client...');
    const supabase = await createClient();
    console.log('[TEST-DB] ✓ Client created');

    // Test 2: Get user
    console.log('[TEST-DB] Getting authenticated user...');
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError) {
      console.error('[TEST-DB] ✗ Auth error:', authError);
      return NextResponse.json({
        success: false,
        step: 'auth',
        error: authError.message,
      });
    }

    if (!user) {
      console.log('[TEST-DB] ⚠ No authenticated user');
      return NextResponse.json({
        success: false,
        step: 'auth',
        error: 'Not authenticated',
      });
    }

    console.log('[TEST-DB] ✓ User authenticated:', user.email);

    // Test 3: Check if uploaded_videos table exists
    console.log('[TEST-DB] Checking uploaded_videos table...');
    const { data: videos, error: videosError } = await supabase
      .from('uploaded_videos')
      .select('id, filename')
      .limit(1);

    if (videosError) {
      console.error('[TEST-DB] ✗ uploaded_videos error:', videosError);
      return NextResponse.json({
        success: false,
        step: 'uploaded_videos_table',
        error: videosError.message,
        hint: videosError.hint,
        details: videosError.details,
      });
    }

    console.log('[TEST-DB] ✓ uploaded_videos table exists');

    // Test 4: Check if processing_runs table exists
    console.log('[TEST-DB] Checking processing_runs table...');
    const { data: runs, error: runsError } = await supabase
      .from('processing_runs')
      .select('id, run_type')
      .limit(1);

    if (runsError) {
      console.error('[TEST-DB] ✗ processing_runs error:', runsError);
      return NextResponse.json({
        success: false,
        step: 'processing_runs_table',
        error: runsError.message,
        hint: runsError.hint,
        details: runsError.details,
      });
    }

    console.log('[TEST-DB] ✓ processing_runs table exists');

    // All tests passed
    console.log('[TEST-DB] ✓ All tests passed!');
    return NextResponse.json({
      success: true,
      user: user.email,
      tables: {
        uploaded_videos: { exists: true, count: videos?.length || 0 },
        processing_runs: { exists: true, count: runs?.length || 0 },
      },
    });

  } catch (error: any) {
    console.error('[TEST-DB] ✗ Unexpected error:', error);
    return NextResponse.json({
      success: false,
      step: 'unknown',
      error: error.message,
      stack: error.stack,
    }, { status: 500 });
  }
}
