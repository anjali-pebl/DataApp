import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/motion-analysis/benchmarks
 * Get historical processing benchmarks for time estimation
 *
 * Query params:
 *   runType?: 'local' | 'modal-t4' | 'modal-a10g' (optional, filter by run type)
 *
 * Response:
 *   {
 *     success: boolean,
 *     benchmarks: {
 *       local: { avgFps, sampleCount, recentBenchmarks },
 *       'modal-t4': { avgFps, sampleCount, recentBenchmarks },
 *       'modal-a10g': { avgFps, sampleCount, recentBenchmarks },
 *     }
 *   }
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const filterRunType = searchParams.get('runType');

    // Fetch completed processing runs with gpu_info containing benchmarks
    let query = supabase
      .from('processing_runs')
      .select('id, run_type, gpu_info, completed_at')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .not('gpu_info', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(20); // Get last 20 completed runs

    if (filterRunType) {
      query = query.eq('run_type', filterRunType);
    }

    const { data: runs, error } = await query;

    if (error) {
      console.error('Error fetching benchmarks:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch benchmarks' },
        { status: 500 }
      );
    }

    // Aggregate benchmarks by run type
    const aggregated: Record<string, {
      avgFps: number;
      avgMotionAnalysisSeconds: number;
      avgYoloDetectionSeconds: number;
      sampleCount: number;
      recentBenchmarks: any[];
    }> = {
      local: { avgFps: 0, avgMotionAnalysisSeconds: 0, avgYoloDetectionSeconds: 0, sampleCount: 0, recentBenchmarks: [] },
      'modal-t4': { avgFps: 0, avgMotionAnalysisSeconds: 0, avgYoloDetectionSeconds: 0, sampleCount: 0, recentBenchmarks: [] },
      'modal-a10g': { avgFps: 0, avgMotionAnalysisSeconds: 0, avgYoloDetectionSeconds: 0, sampleCount: 0, recentBenchmarks: [] },
    };

    // Extract all individual video benchmarks from runs
    for (const run of runs || []) {
      const gpuInfo = run.gpu_info as any;
      if (!gpuInfo?.benchmarks || !Array.isArray(gpuInfo.benchmarks)) continue;

      const runType = run.run_type as string;
      if (!aggregated[runType]) continue;

      for (const benchmark of gpuInfo.benchmarks) {
        if (benchmark.processing_fps > 0) {
          aggregated[runType].recentBenchmarks.push({
            ...benchmark,
            runId: run.id,
            completedAt: run.completed_at,
          });
        }
      }
    }

    // Calculate averages for each run type
    for (const runType of Object.keys(aggregated)) {
      const benchmarks = aggregated[runType].recentBenchmarks;
      if (benchmarks.length > 0) {
        aggregated[runType].sampleCount = benchmarks.length;
        aggregated[runType].avgFps =
          benchmarks.reduce((sum, b) => sum + (b.processing_fps || 0), 0) / benchmarks.length;
        aggregated[runType].avgMotionAnalysisSeconds =
          benchmarks.reduce((sum, b) => sum + (b.motion_analysis_seconds || 0), 0) / benchmarks.length;
        aggregated[runType].avgYoloDetectionSeconds =
          benchmarks.reduce((sum, b) => sum + (b.yolo_detection_seconds || 0), 0) / benchmarks.length;

        // Keep only the last 5 benchmarks for display
        aggregated[runType].recentBenchmarks = benchmarks.slice(0, 5);
      }
    }

    return NextResponse.json({
      success: true,
      benchmarks: aggregated,
      hasHistoricalData:
        aggregated.local.sampleCount > 0 ||
        aggregated['modal-t4'].sampleCount > 0 ||
        aggregated['modal-a10g'].sampleCount > 0,
    });
  } catch (error: any) {
    console.error('Error fetching benchmarks:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch benchmarks' },
      { status: 500 }
    );
  }
}
