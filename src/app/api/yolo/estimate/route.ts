import { NextRequest, NextResponse } from 'next/server';
import {
  estimateLocalInference,
  estimateModalInference,
  compareOptions,
  type VideoSpecs,
  type HardwareSpecs,
} from '@/lib/yolo-inference-estimator';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { video, hardware, mode } = body;

    if (!video || !video.totalFrames) {
      return NextResponse.json({
        success: false,
        error: 'Video specifications required',
      }, { status: 400 });
    }

    const videoSpecs: VideoSpecs = {
      width: video.width || 1920,
      height: video.height || 1080,
      fps: video.fps || 24,
      durationSeconds: video.durationSeconds,
      totalFrames: video.totalFrames,
    };

    const hardwareSpecs: HardwareSpecs = hardware || {
      gpuName: 'CPU',
      cpuCores: 4,
      ramGb: 8,
      platform: 'unknown',
    };

    // Try to get historical data-based estimates first
    let historicalEstimate: any = null;
    try {
      const metricsUrl = new URL('/api/motion-analysis/metrics/estimate', request.url);
      const metricsResponse = await fetch(metricsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoCharacteristics: videoSpecs,
          processingConfig: {
            runType: mode === 'local' ? 'local' : mode === 'modal-a10g' ? 'modal-a10g' : 'modal-t4',
            targetFps: 'all',
            enableYolo: true,
          },
        }),
      });

      if (metricsResponse.ok) {
        const metricsData = await metricsResponse.json();
        if (metricsData.success && metricsData.estimate.confidence !== 'low') {
          historicalEstimate = metricsData.estimate;
          console.log(`Using historical estimate (${historicalEstimate.confidence} confidence, ${historicalEstimate.basedOnRuns} runs)`);
        }
      }
    } catch (error) {
      console.warn('Could not fetch historical estimates, using fallback:', error);
    }

    let result;

    if (mode === 'local') {
      const fallback = estimateLocalInference(videoSpecs, hardwareSpecs);
      result = {
        local: historicalEstimate
          ? {
              ...fallback,
              estimatedTimeSeconds: historicalEstimate.estimatedDuration,
              framesPerSecond: historicalEstimate.estimatedFps,
              estimatedTimeFormatted: formatDuration(historicalEstimate.estimatedDuration),
              notes: [
                ...fallback.notes,
                `Based on ${historicalEstimate.basedOnRuns} previous runs (${historicalEstimate.confidence} confidence)`,
              ],
            }
          : fallback,
      };
    } else if (mode === 'modal-t4') {
      const fallback = estimateModalInference(videoSpecs, 'T4');
      result = {
        modal: historicalEstimate
          ? {
              ...fallback,
              estimatedTimeSeconds: historicalEstimate.estimatedDuration,
              framesPerSecond: historicalEstimate.estimatedFps,
              estimatedTimeFormatted: formatDuration(historicalEstimate.estimatedDuration),
              estimatedCostUSD: historicalEstimate.estimatedCost || fallback.estimatedCostUSD,
              notes: [
                ...fallback.notes,
                `Based on ${historicalEstimate.basedOnRuns} previous runs (${historicalEstimate.confidence} confidence)`,
              ],
            }
          : fallback,
      };
    } else if (mode === 'modal-a10g') {
      const fallback = estimateModalInference(videoSpecs, 'A10G');
      result = {
        modal: historicalEstimate
          ? {
              ...fallback,
              estimatedTimeSeconds: historicalEstimate.estimatedDuration,
              framesPerSecond: historicalEstimate.estimatedFps,
              estimatedTimeFormatted: formatDuration(historicalEstimate.estimatedDuration),
              estimatedCostUSD: historicalEstimate.estimatedCost || fallback.estimatedCostUSD,
              notes: [
                ...fallback.notes,
                `Based on ${historicalEstimate.basedOnRuns} previous runs (${historicalEstimate.confidence} confidence)`,
              ],
            }
          : fallback,
      };
    } else {
      // Compare all options - use historical data if available
      result = compareOptions(videoSpecs, hardwareSpecs);
    }

    return NextResponse.json({
      success: true,
      video: videoSpecs,
      hardware: hardwareSpecs,
      ...result,
      historicalData: historicalEstimate
        ? { confidence: historicalEstimate.confidence, basedOnRuns: historicalEstimate.basedOnRuns }
        : null,
    });
  } catch (error: any) {
    console.error('Estimation error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}

// Helper function to format duration
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
}
