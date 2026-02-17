import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { filenames } = await request.json();

    console.log('='.repeat(60));
    console.log('[DELETE] ========== DELETE REQUEST RECEIVED ==========');
    console.log('[DELETE] Raw filenames received:', JSON.stringify(filenames, null, 2));
    console.log('[DELETE] CWD:', process.cwd());

    // Validate input
    if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No filenames provided' },
        { status: 400 }
      );
    }

    // Initialize Supabase client and check authentication
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - please log in' },
        { status: 401 }
      );
    }

    console.log(`[DELETE] User: ${user.email} (ID: ${user.id})`);
    console.log(`[DELETE] Requesting deletion of ${filenames.length} video(s)`);

    const results: {
      filename: string;
      success: boolean;
      filesDeleted: number;
      dbDeleted: boolean;
      error?: string;
    }[] = [];

    const publicDir = path.join(process.cwd(), 'public');
    const videosDir = path.join(publicDir, 'videos');
    const resultsDir = path.join(publicDir, 'motion-analysis-results');

    console.log('[DELETE] Directories:');
    console.log('[DELETE]   publicDir:', publicDir);
    console.log('[DELETE]   videosDir:', videosDir);
    console.log('[DELETE]   resultsDir:', resultsDir);

    // List files in videos directory for debugging
    try {
      const videoFiles = fsSync.readdirSync(videosDir);
      console.log(`[DELETE] Files in videos/ (${videoFiles.length} total):`, videoFiles.slice(0, 20));
      if (videoFiles.length > 20) console.log(`[DELETE]   ... and ${videoFiles.length - 20} more`);
    } catch (e) {
      console.log('[DELETE] Could not list videos directory:', e);
    }

    for (const filename of filenames) {
      const fileResult = {
        filename,
        success: false,
        filesDeleted: 0,
        dbDeleted: false,
        error: undefined as string | undefined
      };

      try {
        // Sanitize filename to prevent path traversal
        const sanitizedFilename = path.basename(filename);

        console.log('-'.repeat(50));
        console.log(`[DELETE] Processing file: "${filename}"`);
        console.log(`[DELETE]   Sanitized to: "${sanitizedFilename}"`);

        // Normalize filename - handle both original and _background_subtracted variants
        const baseFilename = sanitizedFilename
          .replace('_background_subtracted.mp4', '.mp4')
          .replace('_background_subtracted_motion_analysis.json', '_motion_analysis.json');

        // Get filename stem (without .mp4)
        const filenameStem = baseFilename.replace('.mp4', '');

        console.log(`[DELETE]   Base filename: "${baseFilename}"`);
        console.log(`[DELETE]   Filename stem: "${filenameStem}"`);

        // Build comprehensive list of related files to delete
        // Includes BOTH old flat structure and new subdirectory structure
        const filesToDelete = [
          // === VIDEO FILES ===
          // Original video
          path.join(publicDir, 'videos', baseFilename),
          // Background subtracted video (flat)
          path.join(publicDir, 'videos', `${filenameStem}_background_subtracted.mp4`),
          // YOLOv8 annotated video (flat)
          path.join(publicDir, 'videos', `${filenameStem}_yolov8.mp4`),
          // Videos in subdirectory (new format)
          path.join(publicDir, 'motion-analysis-results', filenameStem, baseFilename),
          path.join(publicDir, 'motion-analysis-results', filenameStem, `${filenameStem}_background_subtracted.mp4`),
          path.join(publicDir, 'motion-analysis-results', filenameStem, `${filenameStem}_yolov8.mp4`),

          // === JSON FILES ===
          // Motion analysis JSON (old flat format)
          path.join(publicDir, 'motion-analysis-results', `${filenameStem}_background_subtracted_motion_analysis.json`),
          // Motion analysis JSON (new subdirectory format)
          path.join(publicDir, 'motion-analysis-results', filenameStem, `${filenameStem}_motion_analysis.json`),
          // YOLOv8 results JSON (flat)
          path.join(publicDir, 'motion-analysis-results', `${filenameStem}_yolov8.json`),
          // YOLOv8 results JSON (subdirectory)
          path.join(publicDir, 'motion-analysis-results', filenameStem, `${filenameStem}_yolov8.json`),
        ];

        console.log(`[DELETE]   Files to check/delete:`);
        filesToDelete.forEach((f, i) => {
          const exists = fsSync.existsSync(f);
          console.log(`[DELETE]     ${i + 1}. ${exists ? '✓ EXISTS' : '✗ NOT FOUND'}: ${f}`);
        });

        const errors: string[] = [];
        let deletedFiles: string[] = [];

        // Delete all related files
        for (const filePath of filesToDelete) {
          try {
            await fs.access(filePath);
            await fs.unlink(filePath);
            fileResult.filesDeleted++;
            deletedFiles.push(path.basename(filePath));
            console.log(`[DELETE]   ✓ DELETED: ${filePath}`);
          } catch (err: any) {
            if (err.code === 'ENOENT') {
              // File doesn't exist - not an error
              // Already logged above, skip here
            } else {
              // Actual error
              const errorMsg = `Failed to delete ${path.basename(filePath)}: ${err.message} (code: ${err.code})`;
              errors.push(errorMsg);
              console.error(`[DELETE]   ✗ ERROR: ${errorMsg}`);
            }
          }
        }

        console.log(`[DELETE]   Files deleted: ${fileResult.filesDeleted} (${deletedFiles.join(', ') || 'none'})`);

        // Try to delete the subdirectory if it exists and is empty
        const subDir = path.join(resultsDir, filenameStem);
        try {
          if (fsSync.existsSync(subDir)) {
            const remaining = fsSync.readdirSync(subDir);
            if (remaining.length === 0) {
              await fs.rmdir(subDir);
              console.log(`[DELETE]   ✓ DELETED empty directory: ${subDir}`);
            } else {
              console.log(`[DELETE]   ⊘ Directory not empty (${remaining.length} files remain): ${subDir}`);
            }
          }
        } catch (err: any) {
          console.log(`[DELETE]   ⊘ Could not delete directory: ${err.message}`);
        }

        // Delete from database - try both possible filename formats
        const dbFilenames = [
          baseFilename,
          baseFilename.replace('.mp4', '_background_subtracted.mp4')
        ];

        console.log(`[DELETE]   Database lookup for: ${dbFilenames.join(' OR ')}`);

        let dbDeleted = false;
        for (const dbFilename of dbFilenames) {
          try {
            console.log(`[DELETE]     Querying DB for: "${dbFilename}"`);

            // Use select without maybeSingle to handle duplicate filenames
            // maybeSingle() fails when multiple records match!
            const { data: matchingVideos, error: fetchError } = await supabase
              .from('uploaded_videos')
              .select('id, user_id, filename, filepath')
              .eq('filename', dbFilename);

            if (fetchError) {
              console.error(`[DELETE]     ✗ Database fetch error:`, fetchError);
              continue;
            }

            if (!matchingVideos || matchingVideos.length === 0) {
              console.log(`[DELETE]     ⊘ No record found for: "${dbFilename}"`);
              continue;
            }

            console.log(`[DELETE]     ✓ Found ${matchingVideos.length} record(s) for: "${dbFilename}"`);

            // Delete ALL matching records (handles duplicates)
            for (const existingVideo of matchingVideos) {
              console.log(`[DELETE]       Processing record:`, {
                id: existingVideo.id,
                user_id: existingVideo.user_id,
                filename: existingVideo.filename,
                filepath: existingVideo.filepath
              });

              // Verify user owns this video
              if (existingVideo.user_id !== user.id) {
                errors.push(`Access denied: video belongs to different user`);
                console.error(`[DELETE]       ✗ Access denied - video user_id=${existingVideo.user_id}, request user_id=${user.id}`);
                continue;
              }

              // Delete from database
              console.log(`[DELETE]       Deleting record ID: ${existingVideo.id}...`);
              const { error: dbError } = await supabase
                .from('uploaded_videos')
                .delete()
                .eq('id', existingVideo.id);

              if (!dbError) {
                dbDeleted = true;
                fileResult.dbDeleted = true;
                console.log(`[DELETE]       ✓ DELETED from database: ${dbFilename} (ID: ${existingVideo.id})`);
              } else {
                errors.push(`Database deletion failed: ${dbError.message}`);
                console.error(`[DELETE]       ✗ Database deletion error:`, dbError);
              }
            }

            if (dbDeleted) {
              break; // Found and deleted at least one, no need to try other filename variants
            }
          } catch (dbErr: any) {
            errors.push(`Database error: ${dbErr.message}`);
            console.error(`[DELETE]     ✗ Database exception:`, dbErr);
          }
        }

        console.log(`[DELETE]   Database deleted: ${fileResult.dbDeleted}`);

        // Determine success
        // Success if:
        // 1. We deleted something (files or DB records) with no errors, OR
        // 2. Nothing existed to delete (no files, no DB records) - end state is correct
        const hasDeletedSomething = fileResult.filesDeleted > 0 || fileResult.dbDeleted;
        const hasErrors = errors.length > 0;
        const nothingExisted = !hasDeletedSomething && !hasErrors;

        fileResult.success = (hasDeletedSomething && !hasErrors) || nothingExisted;
        fileResult.error = errors.length > 0 ? errors.join('; ') : undefined;

        if (fileResult.success && hasDeletedSomething) {
          console.log(`[DELETE] ✓ Success for ${sanitizedFilename}: ${fileResult.filesDeleted} files + DB=${fileResult.dbDeleted}`);
        } else if (fileResult.success && nothingExisted) {
          console.log(`[DELETE] ✓ Already gone: ${sanitizedFilename} (no files or DB records found)`);
        } else if (hasDeletedSomething) {
          console.warn(`[DELETE] ⚠ Partial success for ${sanitizedFilename}: ${fileResult.filesDeleted} files, DB=${fileResult.dbDeleted}, errors: ${fileResult.error}`);
        } else {
          console.error(`[DELETE] ✗ Failed for ${sanitizedFilename}: ${fileResult.error || 'Unknown error'}`);
        }

      } catch (err: any) {
        fileResult.error = err.message;
        console.error(`[DELETE] ✗ Exception processing ${filename}:`, err);
      }

      results.push(fileResult);
    }

    // Calculate summary
    const successCount = results.filter(r => r.success).length;
    const partialCount = results.filter(r => !r.success && (r.filesDeleted > 0 || r.dbDeleted)).length;
    const failCount = results.filter(r => !r.success && r.filesDeleted === 0 && !r.dbDeleted).length;
    const totalFilesDeleted = results.reduce((sum, r) => sum + r.filesDeleted, 0);
    const totalDbDeleted = results.filter(r => r.dbDeleted).length;

    const overallSuccess = failCount === 0 && partialCount === 0;

    let message = '';
    if (overallSuccess) {
      message = `Successfully deleted ${successCount} video(s) (${totalFilesDeleted} files, ${totalDbDeleted} DB records)`;
    } else {
      message = `Deleted ${successCount} video(s), ${partialCount} partial${partialCount !== 1 ? 's' : ''}, ${failCount} failed`;
    }

    console.log(`[DELETE] Summary: ${message}`);

    return NextResponse.json({
      success: overallSuccess,
      message,
      summary: {
        total: filenames.length,
        succeeded: successCount,
        partial: partialCount,
        failed: failCount,
        filesDeleted: totalFilesDeleted,
        dbRecordsDeleted: totalDbDeleted
      },
      results
    });

  } catch (error: any) {
    console.error('[DELETE] Fatal error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to delete videos',
        message: 'An unexpected error occurred during deletion'
      },
      { status: 500 }
    );
  }
}
