import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import * as fs from 'fs';
import * as path from 'path';
import { findPendingPrediction, recordActualResults } from '@/lib/supabase/estimation-accuracy-service';

// Helper to create compact log summary
function createCompactLogSummary(fullLog: string, maxLines: number = 50): string {
  const lines = fullLog.split('\n').filter(l => l.trim());

  // Keep important lines: errors, warnings, progress updates, completion status
  const importantPatterns = [
    /\[ERROR\]/i,
    /\[WARNING\]/i,
    /\[SUCCESS\]/i,
    /Progress:/,
    /Processing video/,
    /PROCESSING COMPLETE/,
    /Total time:/,
    /Successful:/,
    /Failed:/,
    /Started:/,
    /Batch Processing/,
  ];

  const importantLines = lines.filter(line =>
    importantPatterns.some(pattern => pattern.test(line))
  );

  // If we have too many important lines, keep start and end
  if (importantLines.length > maxLines) {
    const half = Math.floor(maxLines / 2);
    return [
      ...importantLines.slice(0, half),
      `... (${importantLines.length - maxLines} lines omitted) ...`,
      ...importantLines.slice(-half),
    ].join('\n');
  }

  return importantLines.join('\n');
}

/**
 * POST /api/motion-analysis/process/complete
 * Mark a video as complete in a processing run
 *
 * Request body:
 *   {
 *     runId: string,
 *     videoId: string,
 *     motionAnalysisPath: string,    // Path to motion analysis JSON (relative to public/)
 *     success: boolean,
 *     error?: string                  // Error message if failed
 *   }
 *
 * Response:
 *   { success: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    // Use service client for server-to-server calls (from Python script)
    // This bypasses RLS since the Python script doesn't have user auth
    const supabase = createServiceClient();
    const body = await request.json();
    const { runId, videoId, motionAnalysisPath, success, error, benchmarks } = body;

    console.log('='.repeat(80));
    console.log('[API-COMPLETE] Received request to mark video as complete');
    console.log(`  Run ID: ${runId}`);
    console.log(`  Video ID: ${videoId}`);
    console.log(`  Success: ${success}`);
    console.log(`  Motion analysis path: ${motionAnalysisPath}`);
    console.log(`  Has error: ${!!error}`);
    console.log(`  Has benchmarks: ${!!benchmarks}`);
    if (error) {
      console.log(`  Error message: ${error}`);
    }
    console.log('='.repeat(80));

    // Validate input
    if (!runId || !videoId || typeof success !== 'boolean') {
      console.error('[API-COMPLETE] Validation failed - missing required fields');
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Get current video state before update (including prescreen scores to preserve them)
    console.log('[DB-READ] Fetching current video state before update...');
    const { data: currentVideo, error: fetchError } = await supabase
      .from('uploaded_videos')
      .select('id, filename, processing_status, has_motion_analysis, motion_analysis, prescreen_brightness, prescreen_focus, prescreen_quality')
      .eq('id', videoId)
      .single();

    if (fetchError) {
      console.error('[DB-READ] Error fetching current video:', fetchError);
    } else if (currentVideo) {
      console.log('[DB-READ] Current video state:');
      console.log(`  Filename: ${currentVideo.filename}`);
      console.log(`  Status: ${currentVideo.processing_status}`);
      console.log(`  Has motion analysis: ${currentVideo.has_motion_analysis}`);
      console.log(`  Motion analysis path: ${currentVideo.motion_analysis || 'null'}`);
      console.log(`  Prescreen scores BEFORE update:`);
      console.log(`    brightness = ${currentVideo.prescreen_brightness !== null && currentVideo.prescreen_brightness !== undefined ? currentVideo.prescreen_brightness : 'NULL/UNDEFINED'}`);
      console.log(`    focus = ${currentVideo.prescreen_focus !== null && currentVideo.prescreen_focus !== undefined ? currentVideo.prescreen_focus : 'NULL/UNDEFINED'}`);
      console.log(`    quality = ${currentVideo.prescreen_quality !== null && currentVideo.prescreen_quality !== undefined ? currentVideo.prescreen_quality : 'NULL/UNDEFINED'}`);
    } else {
      console.warn('[DB-READ] Video not found in database!');
    }

    // Update the uploaded_videos table with motion analysis results
    // Explicitly preserve prescreening scores to prevent them from being cleared
    const videoUpdate: any = {
      processing_status: success ? 'completed' : 'failed',
      updated_at: new Date().toISOString(),
    };

    // Only include prescreen fields if they exist and have values
    // This prevents overwriting existing scores with undefined/null
    if (currentVideo) {
      if (currentVideo.prescreen_brightness !== null && currentVideo.prescreen_brightness !== undefined) {
        videoUpdate.prescreen_brightness = currentVideo.prescreen_brightness;
      }
      if (currentVideo.prescreen_focus !== null && currentVideo.prescreen_focus !== undefined) {
        videoUpdate.prescreen_focus = currentVideo.prescreen_focus;
      }
      if (currentVideo.prescreen_quality !== null && currentVideo.prescreen_quality !== undefined) {
        videoUpdate.prescreen_quality = currentVideo.prescreen_quality;
      }
    }

    if (success && motionAnalysisPath) {
      videoUpdate.motion_analysis = motionAnalysisPath;
      videoUpdate.processed_at = new Date().toISOString();
      videoUpdate.has_motion_analysis = true;
    }

    console.log('[DB-UPDATE] Updating uploaded_videos table...');
    console.log(`  Video ID: ${videoId}`);
    console.log(`  New status: ${videoUpdate.processing_status}`);
    console.log(`  Motion analysis: ${videoUpdate.motion_analysis || 'null'}`);
    console.log(`  Has motion analysis: ${videoUpdate.has_motion_analysis || false}`);
    console.log(`  Preserving prescreening scores:`);
    console.log(`    brightness = ${videoUpdate.prescreen_brightness !== undefined ? videoUpdate.prescreen_brightness : 'NOT INCLUDED (no value found)'}`);
    console.log(`    focus = ${videoUpdate.prescreen_focus !== undefined ? videoUpdate.prescreen_focus : 'NOT INCLUDED (no value found)'}`);
    console.log(`    quality = ${videoUpdate.prescreen_quality !== undefined ? videoUpdate.prescreen_quality : 'NOT INCLUDED (no value found)'}`);
    if (!currentVideo) {
      console.warn('[DB-UPDATE] ⚠️  WARNING: currentVideo is null/undefined - cannot preserve prescreen scores!');
    }

    const { error: videoUpdateError } = await supabase
      .from('uploaded_videos')
      .update(videoUpdate)
      .eq('id', videoId);

    if (videoUpdateError) {
      console.error('[DB-UPDATE] Error updating video:', videoUpdateError);
      return NextResponse.json(
        { success: false, error: 'Failed to update video record' },
        { status: 500 }
      );
    }

    console.log(`[DB-UPDATE] ✓ Successfully updated video ${videoId} status to: ${videoUpdate.processing_status}`);

    // Verify the update by reading the video again
    console.log('[DB-VERIFY] Reading video state after update...');
    const { data: updatedVideo, error: verifyError } = await supabase
      .from('uploaded_videos')
      .select('id, filename, processing_status, has_motion_analysis, motion_analysis, prescreen_brightness, prescreen_focus, prescreen_quality')
      .eq('id', videoId)
      .single();

    if (verifyError) {
      console.error('[DB-VERIFY] Error verifying update:', verifyError);
    } else if (updatedVideo) {
      console.log('[DB-VERIFY] Updated video state:');
      console.log(`  Filename: ${updatedVideo.filename}`);
      console.log(`  Status: ${updatedVideo.processing_status}`);
      console.log(`  Has motion analysis: ${updatedVideo.has_motion_analysis}`);
      console.log(`  Motion analysis path: ${updatedVideo.motion_analysis || 'null'}`);
      console.log(`  Prescreen scores AFTER update:`);
      console.log(`    brightness = ${updatedVideo.prescreen_brightness !== null && updatedVideo.prescreen_brightness !== undefined ? updatedVideo.prescreen_brightness : 'NULL/UNDEFINED ⚠️'}`);
      console.log(`    focus = ${updatedVideo.prescreen_focus !== null && updatedVideo.prescreen_focus !== undefined ? updatedVideo.prescreen_focus : 'NULL/UNDEFINED ⚠️'}`);
      console.log(`    quality = ${updatedVideo.prescreen_quality !== null && updatedVideo.prescreen_quality !== undefined ? updatedVideo.prescreen_quality : 'NULL/UNDEFINED ⚠️'}`);

      // Check if prescreen scores were lost
      const scoresMissing = (
        (currentVideo?.prescreen_brightness !== null && currentVideo?.prescreen_brightness !== undefined && (updatedVideo.prescreen_brightness === null || updatedVideo.prescreen_brightness === undefined)) ||
        (currentVideo?.prescreen_focus !== null && currentVideo?.prescreen_focus !== undefined && (updatedVideo.prescreen_focus === null || updatedVideo.prescreen_focus === undefined)) ||
        (currentVideo?.prescreen_quality !== null && currentVideo?.prescreen_quality !== undefined && (updatedVideo.prescreen_quality === null || updatedVideo.prescreen_quality === undefined))
      );

      if (scoresMissing) {
        console.error('[DB-VERIFY] ❌ ERROR: Prescreen scores were LOST during update!');
        console.error(`[DB-VERIFY] Before: brightness=${currentVideo?.prescreen_brightness}, focus=${currentVideo?.prescreen_focus}, quality=${currentVideo?.prescreen_quality}`);
        console.error(`[DB-VERIFY] After:  brightness=${updatedVideo.prescreen_brightness}, focus=${updatedVideo.prescreen_focus}, quality=${updatedVideo.prescreen_quality}`);
      } else if (currentVideo?.prescreen_quality !== null && currentVideo?.prescreen_quality !== undefined) {
        console.log('[DB-VERIFY] ✓ Prescreen scores successfully preserved!');
      }
    } else {
      console.warn('[DB-VERIFY] Video not found after update!');
    }

    // Save detailed processing metrics if benchmarks provided
    if (success && benchmarks) {
      try {
        // Get user ID from the processing run (since this is a service client call without auth)
        const { data: runForUserId } = await supabase
          .from('processing_runs')
          .select('user_id')
          .eq('id', runId)
          .single();
        const userId = runForUserId?.user_id;

        if (userId) {
          const metricsData = {
            run_id: runId,
            video_id: videoId,
            user_id: userId,

            // Configuration
            run_type: benchmarks.run_type || 'local',
            target_fps: benchmarks.target_fps || 'all',
            enable_motion_analysis: benchmarks.enable_motion_analysis !== false,
            enable_yolo: benchmarks.enable_yolo || false,
            yolo_model: benchmarks.yolo_model || null,

            // Video characteristics
            video_filename: benchmarks.video_filename || 'unknown',
            video_resolution: benchmarks.video_resolution || '0x0',
            video_width: benchmarks.video_width || 0,
            video_height: benchmarks.video_height || 0,
            video_fps: benchmarks.video_fps || 0,
            video_duration_seconds: benchmarks.video_duration_seconds || 0,
            video_total_frames: benchmarks.video_frames || 0,
            video_file_size_bytes: benchmarks.video_file_size_bytes || null,

            // Performance metrics
            total_duration_seconds: benchmarks.total_duration_seconds || 0,
            motion_analysis_seconds: benchmarks.motion_analysis_seconds || null,
            yolo_detection_seconds: benchmarks.yolo_detection_seconds || null,
            frames_processed: benchmarks.frames_processed || benchmarks.video_frames || 0,
            processing_fps: benchmarks.processing_fps || 0,

            // Hardware
            cpu_model: benchmarks.cpu_model || null,
            gpu_model: benchmarks.gpu_model || null,
            gpu_memory_gb: benchmarks.gpu_memory_gb || null,
            system_memory_gb: benchmarks.system_memory_gb || null,

            // Cost
            estimated_cost_usd: benchmarks.estimated_cost_usd || null,
            actual_cost_usd: benchmarks.actual_cost_usd || null,

            // Quality
            motion_activity_score: benchmarks.motion_activity_score || null,
            yolo_detections_count: benchmarks.yolo_detections_count || null,

            // Success tracking
            success: true,
            error_message: null,

            // Timestamps
            started_at: benchmarks.started_at || new Date().toISOString(),
            completed_at: benchmarks.completed_at || new Date().toISOString(),
          };

          const { error: metricsError } = await supabase
            .from('processing_metrics')
            .insert(metricsData);

          if (metricsError) {
            console.error('⚠️  Error saving processing metrics:', metricsError);
            // Don't fail the request if metrics save fails
          } else {
            console.log(`✓ Saved processing metrics: ${benchmarks.processing_fps} fps`);
          }
        }
      } catch (metricsError) {
        console.error('⚠️  Error saving processing metrics:', metricsError);
        // Don't fail the request if metrics save fails
      }
    }

    // Record estimation accuracy (Phase 3: Adaptive Learning)
    if (success && benchmarks) {
      try {
        console.log('[ESTIMATION] Looking for pending prediction...');
        const pendingPrediction = await findPendingPrediction(videoId);

        if (pendingPrediction) {
          console.log(`[ESTIMATION] Found pending prediction ${pendingPrediction.id}`);
          console.log(`  Predicted: ${pendingPrediction.predicted_duration_seconds}s at ${pendingPrediction.predicted_fps} fps`);
          console.log(`  Actual: ${benchmarks.total_duration_seconds}s at ${benchmarks.processing_fps} fps`);

          const accuracyResult = await recordActualResults({
            predictionId: pendingPrediction.id,
            actualDuration: benchmarks.total_duration_seconds,
            actualFps: benchmarks.processing_fps,
            actualCost: benchmarks.actual_cost_usd || null,
          });

          if (accuracyResult.success) {
            const errorPct = ((benchmarks.total_duration_seconds - pendingPrediction.predicted_duration_seconds) / pendingPrediction.predicted_duration_seconds) * 100;
            console.log(`[ESTIMATION] ✓ Recorded accuracy: ${Math.abs(errorPct).toFixed(1)}% error`);
          } else {
            console.error('[ESTIMATION] ⚠️  Failed to record accuracy:', accuracyResult.error);
          }
        } else {
          console.log('[ESTIMATION] No pending prediction found for this video');
        }
      } catch (estimationError: any) {
        console.error('[ESTIMATION] ⚠️  Error in estimation accuracy recording:', estimationError.message);
        // Don't fail the request if estimation recording fails
      }
    }

    // Update processing run statistics
    console.log('[DB-READ] Fetching current processing run state...');
    const { data: runData, error: runFetchError } = await supabase
      .from('processing_runs')
      .select('videos_processed, videos_failed, total_videos, status')
      .eq('id', runId)
      .single();

    if (runFetchError || !runData) {
      console.error('[DB-READ] Error fetching run data:', runFetchError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch run data' },
        { status: 500 }
      );
    }

    console.log('[DB-READ] Current run state:');
    console.log(`  Run ID: ${runId}`);
    console.log(`  Status: ${runData.status}`);
    console.log(`  Processed: ${runData.videos_processed}/${runData.total_videos}`);
    console.log(`  Failed: ${runData.videos_failed}`);

    // Increment counters
    const newProcessedCount = runData.videos_processed + (success ? 1 : 0);
    const newFailedCount = runData.videos_failed + (success ? 0 : 1);
    const isComplete = (newProcessedCount + newFailedCount) >= runData.total_videos;

    console.log('[DB-UPDATE] Updating processing run counters...');
    console.log(`  New processed count: ${newProcessedCount}/${runData.total_videos}`);
    console.log(`  New failed count: ${newFailedCount}`);
    console.log(`  Is complete: ${isComplete}`);

    const updateData: any = {
      videos_processed: newProcessedCount,
      videos_failed: newFailedCount,
    };

    // Save benchmarks to processing_runs gpu_info field
    if (benchmarks) {
      console.log(`[Complete] Benchmarks for video ${videoId}:`, JSON.stringify(benchmarks));

      // Fetch existing gpu_info to append benchmarks
      const { data: currentRun } = await supabase
        .from('processing_runs')
        .select('gpu_info')
        .eq('id', runId)
        .single();

      const existingBenchmarks = (currentRun?.gpu_info as any)?.benchmarks || [];
      const updatedBenchmarks = [
        ...existingBenchmarks,
        {
          videoId,
          ...benchmarks,
          timestamp: new Date().toISOString(),
        },
      ];

      // Update gpu_info with accumulated benchmarks
      updateData.gpu_info = {
        ...((currentRun?.gpu_info as any) || {}),
        benchmarks: updatedBenchmarks,
        // Calculate averages for quick access
        averageProcessingFps:
          updatedBenchmarks.reduce((sum: number, b: any) => sum + (b.processing_fps || 0), 0) /
          updatedBenchmarks.length,
        totalFramesProcessed: updatedBenchmarks.reduce(
          (sum: number, b: any) => sum + (b.video_frames || 0),
          0
        ),
        totalProcessingTime: updatedBenchmarks.reduce(
          (sum: number, b: any) => sum + (b.total_duration_seconds || 0),
          0
        ),
      };

      console.log(
        `[Complete] Updated benchmarks: ${updatedBenchmarks.length} videos, avg ${(updateData.gpu_info as any).averageProcessingFps.toFixed(1)} fps`
      );
    }

    if (isComplete) {
      updateData.status = 'completed';
      updateData.completed_at = new Date().toISOString();

      // Read and save compact log summary
      try {
        const projectRoot = process.cwd();
        const logFile = path.join(projectRoot, `processing-${runId}.log`);

        if (fs.existsSync(logFile)) {
          const fullLog = fs.readFileSync(logFile, 'utf-8');
          const compactLog = createCompactLogSummary(fullLog);

          // Save to logs JSONB column as array of log entries
          updateData.logs = compactLog.split('\n').map(line => ({
            timestamp: new Date().toISOString(),
            message: line,
          }));

          console.log(`Saved compact log (${updateData.logs.length} entries) for run ${runId}`);
        }
      } catch (logError) {
        console.error('Error saving log summary:', logError);
        // Continue without saving logs
      }

      console.log(`Processing run ${runId} completed`);
    }

    const { error: runUpdateError } = await supabase
      .from('processing_runs')
      .update(updateData)
      .eq('id', runId);

    if (runUpdateError) {
      console.error('[DB-UPDATE] Error updating run:', runUpdateError);
      return NextResponse.json(
        { success: false, error: 'Failed to update run record' },
        { status: 500 }
      );
    }

    console.log('[DB-UPDATE] ✓ Successfully updated processing run');

    // Verify the run update
    console.log('[DB-VERIFY] Reading processing run state after update...');
    const { data: verifiedRun, error: verifyRunError } = await supabase
      .from('processing_runs')
      .select('id, status, videos_processed, videos_failed, total_videos')
      .eq('id', runId)
      .single();

    if (verifyRunError) {
      console.error('[DB-VERIFY] Error verifying run update:', verifyRunError);
    } else if (verifiedRun) {
      console.log('[DB-VERIFY] Final run state:');
      console.log(`  Run ID: ${verifiedRun.id}`);
      console.log(`  Status: ${verifiedRun.status}`);
      console.log(`  Processed: ${verifiedRun.videos_processed}/${verifiedRun.total_videos}`);
      console.log(`  Failed: ${verifiedRun.videos_failed}`);
    } else {
      console.warn('[DB-VERIFY] Processing run not found after update!');
    }

    console.log('='.repeat(80));
    console.log('[API-COMPLETE] Request completed successfully');
    console.log(`  Video marked as: ${success ? 'completed' : 'failed'}`);
    console.log(`  Run complete: ${isComplete}`);
    console.log('='.repeat(80));

    return NextResponse.json({
      success: true,
      isComplete,
      stats: {
        processed: newProcessedCount,
        failed: newFailedCount,
        total: runData.total_videos,
      },
    });
  } catch (error: any) {
    console.error('='.repeat(80));
    console.error('[API-COMPLETE] ERROR - Exception occurred');
    console.error('Error marking video complete:', error);
    console.error('Stack trace:', error.stack);
    console.error('='.repeat(80));
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
