import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Update user preferences to mark setup as complete
    const { error } = await supabase
      .from('user_preferences')
      .upsert(
        {
          user_id: user.id,
          setup_completed: true,
          setup_completed_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id',
        }
      );

    if (error) {
      console.error('Failed to update user preferences:', error);
      return NextResponse.json(
        { error: 'Failed to mark setup complete', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error marking setup complete:', error);
    return NextResponse.json(
      { error: 'Failed to mark setup complete', details: error.message },
      { status: 500 }
    );
  }
}
