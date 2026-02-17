import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { recordPrediction, type VideoCharacteristics, type ProcessingConfig } from '@/lib/supabase/estimation-accuracy-service';

/**
 * GET /api/motion-analysis/metrics
 * Fetch historical processing metrics for estimation and analytics
 *
 * Query parameters:
 *   - runType: 'local' | 'modal-t4' | 'modal-a10g' | 'all'
 *   - enableYolo: 'true' | 'false' | 'all'
 *   - resolution: '1920x1080' | 'all'
 *   - limit: number (default: 100)
 *
 * Response:
 *   {
 *     success: boolean,
 *     metrics: ProcessingMetric[],
 *     summary: {
 *       avgProcessingFps: number,
 *       avgTotalDuration: number,
 *       avgMotionDuration: number,
 *       avgYoloDuration: number,
 *       totalRuns: number,
 *       successRate: number
 *     }
 *   }
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const searchParams = request.nextUrl.searchParams;

    // Parse query parameters
    const runType = searchParams.get('runType') || 'all';
    const enableYolo = searchParams.get('enableYolo') || 'all';
    const resolution = searchParams.get('resolution') || 'all';
    const limit = parseInt(searchParams.get('limit') || '100');

    // Build query
    let query = supabase
      .from('processing_metrics')
      .select('*')
      .eq('success', true) // Only successful runs
      .order('created_at', { ascending: false })
      .limit(limit);

    // Apply filters
    if (runType !== 'all') {
      query = query.eq('run_type', runType);
    }

    if (enableYolo !== 'all') {
      query = query.eq('enable_yolo', enableYolo === 'true');
    }

    if (resolution !== 'all') {
      query = query.eq('video_resolution', resolution);
    }

    const { data: metrics, error } = await query;

    if (error) {
      console.error('Error fetching processing metrics:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch metrics' },
        { status: 500 }
      );
    }

    // Calculate summary statistics
    const summary = {
      totalRuns: metrics?.length || 0,
      avgProcessingFps: 0,
      avgTotalDuration: 0,
      avgMotionDuration: 0,
      avgYoloDuration: 0,
      medianProcessingFps: 0,
      minProcessingFps: 0,
      maxProcessingFps: 0,
      successRate: 100, // Already filtered for success=true
    };

    if (metrics && metrics.length > 0) {
      // Calculate averages
      summary.avgProcessingFps =
        metrics.reduce((sum, m) => sum + (m.processing_fps || 0), 0) / metrics.length;

      summary.avgTotalDuration =
        metrics.reduce((sum, m) => sum + (m.total_duration_seconds || 0), 0) / metrics.length;

      summary.avgMotionDuration =
        metrics.reduce((sum, m) => sum + (m.motion_analysis_seconds || 0), 0) / metrics.length;

      const yoloMetrics = metrics.filter((m) => m.enable_yolo && m.yolo_detection_seconds);
      if (yoloMetrics.length > 0) {
        summary.avgYoloDuration =
          yoloMetrics.reduce((sum, m) => sum + (m.yolo_detection_seconds || 0), 0) /
          yoloMetrics.length;
      }

      // Calculate median, min, max for processing FPS
      const fpsSorted = metrics
        .map((m) => m.processing_fps || 0)
        .filter((fps) => fps > 0)
        .sort((a, b) => a - b);

      if (fpsSorted.length > 0) {
        summary.medianProcessingFps = fpsSorted[Math.floor(fpsSorted.length / 2)];
        summary.minProcessingFps = fpsSorted[0];
        summary.maxProcessingFps = fpsSorted[fpsSorted.length - 1];
      }
    }

    return NextResponse.json({
      success: true,
      metrics: metrics || [],
      summary,
      filters: {
        runType,
        enableYolo,
        resolution,
        limit,
      },
    });
  } catch (error: any) {
    console.error('Error in metrics API:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/motion-analysis/metrics/estimate
 * Get estimated processing time based on historical data
 *
 * Request body:
 *   {
 *     videoCharacteristics: {
 *       width: number,
 *       height: number,
 *       fps: number,
 *       durationSeconds: number,
 *       totalFrames: number
 *     },
 *     processingConfig: {
 *       runType: 'local' | 'modal-t4' | 'modal-a10g',
 *       targetFps: 'all' | '15' | '10' | '5',
 *       enableYolo: boolean
 *     }
 *   }
 *
 * Response:
 *   {
 *     success: boolean,
 *     estimate: {
 *       estimatedDuration: number,
 *       estimatedFps: number,
 *       confidence: 'high' | 'medium' | 'low',
 *       basedOnRuns: number,
 *       estimatedCost: number | null
 *     }
 *   }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { videoCharacteristics, processingConfig, videoId } = body;

    if (!videoCharacteristics || !processingConfig) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Get user for prediction recording
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    const userId = user?.id || null;

    const { width, height, totalFrames, durationSeconds } = videoCharacteristics;
    const { runType, enableYolo } = processingConfig;

    // Calculate resolution bucket (round to nearest 100 pixels)
    const resolutionBucket = `${Math.round(width / 100) * 100}x${Math.round(height / 100) * 100}`;

    // Query historical metrics for similar videos
    let query = supabase
      .from('processing_metrics')
      .select('*')
      .eq('success', true)
      .eq('run_type', runType)
      .eq('enable_yolo', enableYolo)
      .order('created_at', { ascending: false })
      .limit(50);

    const { data: metrics, error } = await query;

    if (error) {
      console.error('Error fetching metrics for estimation:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch historical metrics' },
        { status: 500 }
      );
    }

    // Filter metrics for similar resolutions (±20%)
    const similarMetrics = metrics?.filter((m) => {
      const widthDiff = Math.abs(m.video_width - width) / width;
      const heightDiff = Math.abs(m.video_height - height) / height;
      return widthDiff < 0.2 && heightDiff < 0.2;
    }) || [];

    let estimatedFps = 0;
    let confidence: 'high' | 'medium' | 'low' = 'low';
    let basedOnRuns = similarMetrics.length;

    if (similarMetrics.length >= 10) {
      // High confidence: 10+ similar runs
      confidence = 'high';
      // Use median FPS to avoid outliers
      const fpsSorted = similarMetrics
        .map((m) => m.processing_fps || 0)
        .filter((fps) => fps > 0)
        .sort((a, b) => a - b);
      estimatedFps = fpsSorted[Math.floor(fpsSorted.length / 2)];
    } else if (similarMetrics.length >= 3) {
      // Medium confidence: 3-9 similar runs
      confidence = 'medium';
      estimatedFps =
        similarMetrics.reduce((sum, m) => sum + (m.processing_fps || 0), 0) /
        similarMetrics.length;
    } else if (metrics && metrics.length > 0) {
      // Low confidence: Use all metrics for this run type
      confidence = 'low';
      basedOnRuns = metrics.length;
      estimatedFps =
        metrics.reduce((sum, m) => sum + (m.processing_fps || 0), 0) / metrics.length;
    } else {
      // No historical data - use fallback estimates
      confidence = 'low';
      basedOnRuns = 0;
      if (runType === 'local') {
        estimatedFps = enableYolo ? 3 : 10;
      } else if (runType === 'modal-t4') {
        estimatedFps = enableYolo ? 15 : 50;
      } else if (runType === 'modal-a10g') {
        estimatedFps = enableYolo ? 30 : 100;
      }
    }

    // Calculate estimated duration
    const estimatedDuration = totalFrames / estimatedFps;

    // Estimate cost for cloud processing
    let estimatedCost = null;
    if (runType === 'modal-t4') {
      // T4 GPU: ~$0.60/hour
      estimatedCost = (estimatedDuration / 3600) * 0.6;
    } else if (runType === 'modal-a10g') {
      // A10G GPU: ~$1.10/hour
      estimatedCost = (estimatedDuration / 3600) * 1.1;
    }

    const estimate = {
      estimatedDuration: Math.round(estimatedDuration),
      estimatedFps: Math.round(estimatedFps * 10) / 10,
      confidence,
      basedOnRuns,
      estimatedCost: estimatedCost ? Math.round(estimatedCost * 100) / 100 : null,
      notes: [] as string[],
      predictionId: null as string | null,
    };

    // Add helpful notes
    if (confidence === 'low') {
      estimate.notes.push('Limited historical data - estimate may vary');
    }
    if (basedOnRuns === 0) {
      estimate.notes.push('No historical data - using default estimates');
    }
    if (similarMetrics.length < metrics.length) {
      estimate.notes.push(
        `Based on ${similarMetrics.length} similar videos out of ${metrics.length} total runs`
      );
    }

    // Save prediction for adaptive learning (Phase 2)
    if (userId && videoId) {
      try {
        const enhancedEstimate = {
          predictedDurationSeconds: estimate.estimatedDuration,
          predictedFps: estimate.estimatedFps,
          predictedCostUsd: estimate.estimatedCost,
          confidence: estimate.confidence,
          confidenceScore: estimate.confidence === 'high' ? 80 : estimate.confidence === 'medium' ? 50 : 20,
          durationRangeLow: 0,
          durationRangeHigh: 0,
          basedOnRuns: estimate.basedOnRuns,
          correctionApplied: 1.0,
          algorithmVersion: '1.0.0',
          timestamp: new Date().toISOString(),
        };

        const result = await recordPrediction({
          videoId,
          userId,
          videoCharacteristics: {
            width,
            height,
            fps: videoCharacteristics.fps,
            durationSeconds,
            totalFrames,
          },
          prediction: enhancedEstimate,
          processingConfig: {
            runType,
            targetFps: processingConfig.targetFps || 'all',
            enableYolo,
          },
        });

        if (result.success && result.predictionId) {
          estimate.predictionId = result.predictionId;
          console.log(`✓ Saved prediction ${result.predictionId} for video ${videoId}`);
        }
      } catch (predictionError: any) {
        // Don't fail the estimate if prediction recording fails
        console.error('⚠️  Failed to record prediction:', predictionError.message);
      }
    }

    return NextResponse.json({
      success: true,
      estimate,
    });
  } catch (error: any) {
    console.error('Error in estimation API:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
