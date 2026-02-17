import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { data: params, error } = await supabase
      .from('crab_detection_params')
      .select('*')
      .or(`user_id.eq.${user.id},is_preset.eq.true`)
      .order('is_preset', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, params });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name, params } = body;

    if (!name || !params) {
      return NextResponse.json(
        { success: false, error: 'Name and params are required' },
        { status: 400 }
      );
    }

    const { data: newParams, error } = await supabase
      .from('crab_detection_params')
      .insert({
        user_id: user.id,
        name: name,
        is_preset: false,
        threshold: params.threshold,
        min_area: params.min_area,
        max_area: params.max_area,
        min_circularity: params.min_circularity,
        max_aspect_ratio: params.max_aspect_ratio,
        morph_kernel_size: params.morph_kernel_size,
        max_distance: params.max_distance,
        max_skip_frames: params.max_skip_frames,
        min_track_length: params.min_track_length,
        min_displacement: params.min_displacement,
        min_speed: params.min_speed,
        max_speed: params.max_speed,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, params: newParams });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
