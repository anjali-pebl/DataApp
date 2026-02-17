/**
 * Estimation Accuracy Service
 * Manages prediction tracking and accuracy measurement for the adaptive learning system
 */

import { createServiceClient } from './server';

export interface VideoCharacteristics {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  totalFrames: number;
}

export interface ProcessingConfig {
  runType: 'local' | 'modal-t4' | 'modal-a10g' | 'modal-a100';
  targetFps: string;
  enableYolo: boolean;
  yoloModel?: string;
}

export interface EnhancedEstimate {
  predictedDurationSeconds: number;
  predictedFps: number;
  predictedCostUsd: number | null;
  confidence: 'high' | 'medium' | 'low';
  confidenceScore: number;
  durationRangeLow: number;
  durationRangeHigh: number;
  basedOnRuns: number;
  correctionApplied: number;
  algorithmVersion: string;
  timestamp?: string;
}

export interface EstimationAccuracy {
  id: string;
  run_id?: string;
  video_id: string;
  user_id: string;

  // Context
  estimation_timestamp: string;
  run_type: string;
  enable_yolo: boolean;
  video_width: number;
  video_height: number;
  video_total_frames: number;
  video_duration_seconds: number;

  // Prediction
  predicted_duration_seconds: number;
  predicted_fps: number;
  predicted_cost_usd: number | null;
  prediction_confidence: 'high' | 'medium' | 'low';
  prediction_based_on_runs: number;

  // Actuals
  actual_duration_seconds: number | null;
  actual_fps: number | null;
  actual_cost_usd: number | null;

  // Errors
  duration_error_seconds: number | null;
  duration_error_percentage: number | null;
  fps_error: number | null;
  fps_error_percentage: number | null;
  cost_error_usd: number | null;
  cost_error_percentage: number | null;

  overestimated: boolean | null;
  error_category: 'accurate' | 'slight' | 'moderate' | 'significant' | null;

  created_at: string;
  completed_at: string | null;
}

export interface EstimationPerformanceSummary {
  run_type: string;
  enable_yolo: boolean;
  prediction_confidence: string;
  total_predictions: number;
  completed_predictions: number;
  avg_error_pct: number;
  median_abs_error_pct: number;
  error_stddev: number;
  avg_bias_seconds: number;
  overestimate_rate: number;
  accurate_rate: number;
  slight_error_rate: number;
  moderate_error_rate: number;
  significant_error_rate: number;
  first_prediction: string;
  last_prediction: string;
}

/**
 * Record a new prediction when an estimate is requested
 */
export async function recordPrediction(params: {
  runId?: string;
  videoId: string;
  userId: string;
  videoCharacteristics: VideoCharacteristics;
  prediction: EnhancedEstimate;
  processingConfig: ProcessingConfig;
}): Promise<{ success: boolean; predictionId?: string; error?: string }> {
  try {
    const supabase = createServiceClient();

    const record = {
      run_id: params.runId || null,
      video_id: params.videoId,
      user_id: params.userId,

      // Context
      estimation_timestamp: params.prediction.timestamp || new Date().toISOString(),
      run_type: params.processingConfig.runType,
      enable_yolo: params.processingConfig.enableYolo,
      video_width: params.videoCharacteristics.width,
      video_height: params.videoCharacteristics.height,
      video_total_frames: params.videoCharacteristics.totalFrames,
      video_duration_seconds: params.videoCharacteristics.durationSeconds,

      // Prediction
      predicted_duration_seconds: params.prediction.predictedDurationSeconds,
      predicted_fps: params.prediction.predictedFps,
      predicted_cost_usd: params.prediction.predictedCostUsd,
      prediction_confidence: params.prediction.confidence,
      prediction_based_on_runs: params.prediction.basedOnRuns,

      // Actuals (null initially)
      actual_duration_seconds: null,
      actual_fps: null,
      actual_cost_usd: null,
    };

    const { data, error } = await supabase
      .from('estimation_accuracy')
      .insert(record)
      .select('id')
      .single();

    if (error) {
      console.error('Error recording prediction:', error);
      return { success: false, error: error.message };
    }

    return { success: true, predictionId: data.id };
  } catch (error: any) {
    console.error('Error in recordPrediction:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Update prediction with actual results and calculate discrepancy
 */
export async function recordActualResults(params: {
  predictionId: string;
  actualDuration: number;
  actualFps: number;
  actualCost: number | null;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createServiceClient();

    // First, get the prediction to calculate errors
    const { data: prediction, error: fetchError } = await supabase
      .from('estimation_accuracy')
      .select('*')
      .eq('id', params.predictionId)
      .single();

    if (fetchError || !prediction) {
      console.error('Error fetching prediction:', fetchError);
      return { success: false, error: 'Prediction not found' };
    }

    // Calculate errors
    const durationError = params.actualDuration - prediction.predicted_duration_seconds;
    const durationErrorPct = (durationError / prediction.predicted_duration_seconds) * 100;

    const fpsError = params.actualFps - prediction.predicted_fps;
    const fpsErrorPct = (fpsError / prediction.predicted_fps) * 100;

    let costError = null;
    let costErrorPct = null;
    if (params.actualCost !== null && prediction.predicted_cost_usd !== null) {
      costError = params.actualCost - prediction.predicted_cost_usd;
      costErrorPct = (costError / prediction.predicted_cost_usd) * 100;
    }

    // Categorize error severity based on duration error
    let errorCategory: 'accurate' | 'slight' | 'moderate' | 'significant';
    const absErrorPct = Math.abs(durationErrorPct);
    if (absErrorPct <= 10) {
      errorCategory = 'accurate';
    } else if (absErrorPct <= 25) {
      errorCategory = 'slight';
    } else if (absErrorPct <= 50) {
      errorCategory = 'moderate';
    } else {
      errorCategory = 'significant';
    }

    // Update the record
    const { error: updateError } = await supabase
      .from('estimation_accuracy')
      .update({
        actual_duration_seconds: params.actualDuration,
        actual_fps: params.actualFps,
        actual_cost_usd: params.actualCost,

        duration_error_seconds: durationError,
        duration_error_percentage: durationErrorPct,
        fps_error: fpsError,
        fps_error_percentage: fpsErrorPct,
        cost_error_usd: costError,
        cost_error_percentage: costErrorPct,

        overestimated: durationError < 0,
        error_category: errorCategory,
        completed_at: new Date().toISOString(),
      })
      .eq('id', params.predictionId);

    if (updateError) {
      console.error('Error updating actual results:', updateError);
      return { success: false, error: updateError.message };
    }

    console.log(`✓ Recorded estimation accuracy: ${Math.abs(durationErrorPct).toFixed(1)}% error (${errorCategory})`);
    return { success: true };
  } catch (error: any) {
    console.error('Error in recordActualResults:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get recent accuracy records for bias correction
 */
export async function getRecentAccuracy(params: {
  runType: string;
  enableYolo: boolean;
  limit?: number;
}): Promise<EstimationAccuracy[]> {
  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('estimation_accuracy')
      .select('*')
      .eq('run_type', params.runType)
      .eq('enable_yolo', params.enableYolo)
      .not('actual_duration_seconds', 'is', null)
      .order('estimation_timestamp', { ascending: false })
      .limit(params.limit || 50);

    if (error) {
      console.error('Error fetching recent accuracy:', error);
      return [];
    }

    return data as EstimationAccuracy[];
  } catch (error: any) {
    console.error('Error in getRecentAccuracy:', error);
    return [];
  }
}

/**
 * Find pending prediction for a video (most recent)
 */
export async function findPendingPrediction(
  videoId: string
): Promise<EstimationAccuracy | null> {
  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('estimation_accuracy')
      .select('*')
      .eq('video_id', videoId)
      .is('actual_duration_seconds', null)
      .order('estimation_timestamp', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      // No pending prediction found is not an error
      if (error.code === 'PGRST116') {
        return null;
      }
      console.error('Error finding pending prediction:', error);
      return null;
    }

    return data as EstimationAccuracy;
  } catch (error: any) {
    console.error('Error in findPendingPrediction:', error);
    return null;
  }
}

/**
 * Get performance summary for analytics
 */
export async function getPerformanceSummary(): Promise<{
  success: boolean;
  summary?: EstimationPerformanceSummary[];
  error?: string;
}> {
  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('estimation_performance_summary')
      .select('*');

    if (error) {
      console.error('Error fetching performance summary:', error);
      return { success: false, error: error.message };
    }

    return { success: true, summary: data as EstimationPerformanceSummary[] };
  } catch (error: any) {
    console.error('Error in getPerformanceSummary:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get detailed accuracy records for analysis
 */
export async function getAccuracyRecords(params: {
  runType?: string;
  enableYolo?: boolean;
  confidence?: 'high' | 'medium' | 'low';
  errorCategory?: 'accurate' | 'slight' | 'moderate' | 'significant';
  limit?: number;
}): Promise<{ success: boolean; records?: EstimationAccuracy[]; error?: string }> {
  try {
    const supabase = createServiceClient();

    let query = supabase
      .from('estimation_accuracy')
      .select('*')
      .not('actual_duration_seconds', 'is', null)
      .order('estimation_timestamp', { ascending: false });

    if (params.runType) {
      query = query.eq('run_type', params.runType);
    }

    if (params.enableYolo !== undefined) {
      query = query.eq('enable_yolo', params.enableYolo);
    }

    if (params.confidence) {
      query = query.eq('prediction_confidence', params.confidence);
    }

    if (params.errorCategory) {
      query = query.eq('error_category', params.errorCategory);
    }

    query = query.limit(params.limit || 100);

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching accuracy records:', error);
      return { success: false, error: error.message };
    }

    return { success: true, records: data as EstimationAccuracy[] };
  } catch (error: any) {
    console.error('Error in getAccuracyRecords:', error);
    return { success: false, error: error.message };
  }
}
