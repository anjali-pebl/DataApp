import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface DuplicateGroup {
  filename: string;
  count: number;
  ids: string[];
  kept: string;
  deleted: string[];
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find duplicate videos (same filename, same user)
    const { data: videos, error: fetchError } = await supabase
      .from('uploaded_videos')
      .select('id, filename, created_at, processing_status')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    // Group by filename to find duplicates
    const filenameGroups = new Map<string, typeof videos>();

    for (const video of videos || []) {
      const existing = filenameGroups.get(video.filename) || [];
      existing.push(video);
      filenameGroups.set(video.filename, existing);
    }

    // Filter to only groups with duplicates
    const duplicates: DuplicateGroup[] = [];

    for (const [filename, group] of filenameGroups) {
      if (group.length > 1) {
        // Keep the oldest one (first created) or the one that's completed
        const sorted = group.sort((a, b) => {
          // Prefer completed over other statuses
          if (a.processing_status === 'completed' && b.processing_status !== 'completed') return -1;
          if (b.processing_status === 'completed' && a.processing_status !== 'completed') return 1;
          // Otherwise sort by created_at (oldest first)
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });

        const kept = sorted[0];
        const toDelete = sorted.slice(1);

        duplicates.push({
          filename,
          count: group.length,
          ids: group.map(v => v.id),
          kept: kept.id,
          deleted: toDelete.map(v => v.id),
        });
      }
    }

    return NextResponse.json({
      hasDuplicates: duplicates.length > 0,
      duplicateCount: duplicates.reduce((sum, d) => sum + d.deleted.length, 0),
      duplicates,
    });

  } catch (error: any) {
    console.error('Error checking duplicates:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find duplicate videos (same filename, same user)
    const { data: videos, error: fetchError } = await supabase
      .from('uploaded_videos')
      .select('id, filename, created_at, processing_status')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    // Group by filename to find duplicates
    const filenameGroups = new Map<string, typeof videos>();

    for (const video of videos || []) {
      const existing = filenameGroups.get(video.filename) || [];
      existing.push(video);
      filenameGroups.set(video.filename, existing);
    }

    // Collect IDs to delete
    const idsToDelete: string[] = [];
    const deletedFiles: { filename: string; deletedCount: number; keptId: string }[] = [];

    for (const [filename, group] of filenameGroups) {
      if (group.length > 1) {
        // Keep the oldest one (first created) or the one that's completed
        const sorted = group.sort((a, b) => {
          // Prefer completed over other statuses
          if (a.processing_status === 'completed' && b.processing_status !== 'completed') return -1;
          if (b.processing_status === 'completed' && a.processing_status !== 'completed') return 1;
          // Otherwise sort by created_at (oldest first)
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });

        const kept = sorted[0];
        const toDelete = sorted.slice(1);

        idsToDelete.push(...toDelete.map(v => v.id));
        deletedFiles.push({
          filename,
          deletedCount: toDelete.length,
          keptId: kept.id,
        });
      }
    }

    if (idsToDelete.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No duplicates found',
        deletedCount: 0,
        deletedFiles: [],
      });
    }

    // Delete the duplicate entries
    const { error: deleteError } = await supabase
      .from('uploaded_videos')
      .delete()
      .in('id', idsToDelete);

    if (deleteError) {
      console.error('Error deleting duplicates:', deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    console.log(`[Cleanup] Deleted ${idsToDelete.length} duplicate video entries`);

    return NextResponse.json({
      success: true,
      message: `Removed ${idsToDelete.length} duplicate entries`,
      deletedCount: idsToDelete.length,
      deletedFiles,
    });

  } catch (error: any) {
    console.error('Error cleaning duplicates:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
