import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has completed setup
    const { data, error } = await supabase
      .from('user_preferences')
      .select('setup_completed, setup_completed_at')
      .eq('user_id', user.id)
      .single();

    if (error) {
      // User preferences don't exist yet - setup not complete
      return NextResponse.json({
        setupCompleted: false,
        setupCompletedAt: null,
      });
    }

    return NextResponse.json({
      setupCompleted: data.setup_completed || false,
      setupCompletedAt: data.setup_completed_at,
    });
  } catch (error: any) {
    console.error('Error checking setup status:', error);
    return NextResponse.json(
      { error: 'Failed to check setup status', details: error.message },
      { status: 500 }
    );
  }
}
