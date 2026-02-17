'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import MotionAnalysisDashboard from '@/components/motion-analysis/MotionAnalysisDashboard';
import ProcessingStatusPanel from '@/components/motion-analysis/ProcessingStatusPanel';
import { Loader2, AlertTriangle, RefreshCw, CheckCircle, X, Trash2 } from 'lucide-react';

// Helper function to add timeout to fetch requests
async function fetchWithTimeout(url: string, timeoutMs: number = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms. The server might be slow or unreachable.`);
    }
    throw error;
  }
}

// Load motion analysis data from database API
async function loadMotionAnalysisData() {
  console.log('[PAGE] Loading motion analysis data...');
  const startTime = Date.now();

  try {
    const response = await fetchWithTimeout('/api/motion-analysis/videos', 20000);

    console.log(`[PAGE] API response received after ${Date.now() - startTime}ms (status: ${response.status})`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || errorData.details || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[PAGE] Loaded ${data.videos?.length || 0} videos`);
    return data.videos || [];

  } catch (error: any) {
    console.error(`[PAGE] Failed to load videos after ${Date.now() - startTime}ms:`, error);
    throw error;
  }
}

// Check for active processing runs (for page refresh recovery)
async function checkActiveRuns() {
  try {
    const response = await fetch('/api/motion-analysis/process/active');
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// Reset stuck videos to pending
async function resetStuckVideos(videoIds?: string[]) {
  const response = await fetch('/api/motion-analysis/process/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(videoIds ? { videoIds } : { resetAll: true }),
  });
  return response.json();
}

// Check for and clean duplicate video entries
async function cleanupDuplicates() {
  try {
    // First check for duplicates
    const checkResponse = await fetch('/api/motion-analysis/cleanup-duplicates');
    if (!checkResponse.ok) return null;

    const checkResult = await checkResponse.json();

    if (!checkResult.hasDuplicates) {
      return null;
    }

    // Delete the duplicates
    const deleteResponse = await fetch('/api/motion-analysis/cleanup-duplicates', {
      method: 'DELETE',
    });

    if (!deleteResponse.ok) return null;

    return await deleteResponse.json();
  } catch (error) {
    console.error('Error cleaning duplicates:', error);
    return null;
  }
}

interface CleanupNotification {
  deletedCount: number;
  deletedFiles: { filename: string; deletedCount: number }[];
}

export default function MotionAnalysisPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [estimatedTime, setEstimatedTime] = useState<string | undefined>(undefined);
  const [estimatedCost, setEstimatedCost] = useState<string | undefined>(undefined);
  const [stuckVideos, setStuckVideos] = useState<Array<{ id: string; filename: string }>>([]);
  const [isResetting, setIsResetting] = useState(false);
  const [cleanupNotification, setCleanupNotification] = useState<CleanupNotification | null>(null);
  const hasCheckedDuplicates = useRef(false);

  // Check for active runs on mount (handles page refresh)
  useEffect(() => {
    checkActiveRuns().then((result) => {
      if (result?.hasActiveRun && result.activeRun) {
        console.log('🔄 Restored active processing run:', result.activeRun.id);
        setCurrentRunId(result.activeRun.id);
      }
      if (result?.stuckVideosCount > 0) {
        console.log(`⚠️ Found ${result.stuckVideosCount} stuck videos`);
        setStuckVideos(result.stuckVideos || []);
      }
    });
  }, []);

  // Check for and clean duplicates on mount (only once)
  useEffect(() => {
    if (hasCheckedDuplicates.current) return;
    hasCheckedDuplicates.current = true;

    cleanupDuplicates().then((result) => {
      if (result?.success && result.deletedCount > 0) {
        console.log(`🧹 Cleaned up ${result.deletedCount} duplicate video entries`);
        setCleanupNotification({
          deletedCount: result.deletedCount,
          deletedFiles: result.deletedFiles,
        });

        // Auto-dismiss after 10 seconds
        setTimeout(() => {
          setCleanupNotification(null);
        }, 10000);
      }
    });
  }, []);

  const loadData = useCallback(async () => {
    const loadStartTime = Date.now();
    console.log('[PAGE] Starting data load...');

    try {
      setLoading(true);
      setError(null);
      const results = await loadMotionAnalysisData();
      const loadTime = Date.now() - loadStartTime;
      console.log(`[PAGE] Data load completed in ${loadTime}ms`);

      const processedCount = results.filter((v: any) => v.processing_status === 'completed' && v.motion_analysis).length;
      const pendingCount = results.filter((v: any) => v.processing_status !== 'completed' || !v.motion_analysis).length;

      console.log(`📊 Loaded ${results.length} videos (${processedCount} processed, ${pendingCount} pending)`);

      setData(results);

      // Check for stuck videos after loading
      const activeResult = await checkActiveRuns();
      if (activeResult?.stuckVideosCount > 0 && !activeResult?.hasActiveRun) {
        setStuckVideos(activeResult.stuckVideos || []);
      } else {
        setStuckVideos([]);
      }
    } catch (err: any) {
      const loadTime = Date.now() - loadStartTime;
      console.error(`[PAGE] ❌ Failed to load videos after ${loadTime}ms:`, err);

      // Provide more helpful error messages
      let errorMessage = err.message || 'Failed to load motion analysis data';

      if (err.message?.includes('timed out')) {
        errorMessage = 'Request timed out. The server is taking too long to respond. Please check your internet connection and try again.';
      } else if (err.message?.includes('fetch')) {
        errorMessage = 'Network error. Please check your internet connection and try again.';
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Dead process detection - check every 60 seconds
  useEffect(() => {
    const checkDeadProcesses = async () => {
      try {
        await fetch('/api/motion-analysis/process/check-dead');
      } catch (err) {
        // Silently fail - this is a background health check
        console.error('[Dead Process Check] Failed:', err);
      }
    };

    // Check immediately on mount
    checkDeadProcesses();

    // Then check every 60 seconds
    const interval = setInterval(checkDeadProcesses, 60000);

    return () => clearInterval(interval);
  }, []);

  const handleResetStuckVideos = async () => {
    setIsResetting(true);
    try {
      const result = await resetStuckVideos();
      if (result.success) {
        console.log(`✓ Reset ${result.resetCount} stuck videos`);
        setStuckVideos([]);
        await loadData();
      }
    } catch (err) {
      console.error('Failed to reset stuck videos:', err);
    } finally {
      setIsResetting(false);
    }
  };

  const handleUploadComplete = () => {
    console.log('📤 Upload complete');
    loadData();
  };

  const handleDeleteVideos = async (deletedFilenames: string[]) => {
    console.log(`🗑️  Deleted ${deletedFilenames.length} video(s)`);

    // Reload data first
    await loadData();

    // After reloading, check if we need to clear the current processing run
    if (currentRunId) {
      try {
        // Fetch videos still in database after deletion
        const videosResponse = await fetch('/api/motion-analysis/videos');
        const videosResult = await videosResponse.json();
        const remainingVideos = videosResult.videos || [];

        // If no videos remain at all, clear the processing run panel
        if (remainingVideos.length === 0) {
          console.log('🗑️  All videos deleted, clearing processing run panel');
          setCurrentRunId(null);
          setEstimatedTime(undefined);
          setEstimatedCost(undefined);
        } else {
          // Check if the videos that were being processed are gone
          // If the remaining videos don't include any that match the processing run, clear it
          const remainingFilenames = remainingVideos.map((v: any) => v.filename);
          const allDeletedFilesWereRemoved = deletedFilenames.every(
            (filename) => !remainingFilenames.includes(filename)
          );

          // If we deleted all videos that exist, clear the panel
          if (allDeletedFilesWereRemoved && deletedFilenames.length >= remainingVideos.length) {
            console.log('🗑️  All videos from processing run deleted, clearing processing run panel');
            setCurrentRunId(null);
            setEstimatedTime(undefined);
            setEstimatedCost(undefined);
          }
        }
      } catch (err) {
        console.error('Error checking processing run after deletion:', err);
      }
    }
  };

  const handleProcessingStarted = (runId: string, estTime?: string, estCost?: string) => {
    console.log(`▶️  Processing started | ${estTime || 'N/A'} | ${estCost || 'N/A'}`);
    setCurrentRunId(runId);
    setEstimatedTime(estTime);
    setEstimatedCost(estCost);
  };

  const handleProcessingComplete = () => {
    console.log('✓ Processing complete, refreshing data');
    setCurrentRunId(null);
    setEstimatedTime(undefined);
    setEstimatedCost(undefined);
    loadData();
  };

  const handleDismissProcessingPanel = () => {
    console.log('🗑️  Processing panel dismissed by user');
    setCurrentRunId(null);
    setEstimatedTime(undefined);
    setEstimatedCost(undefined);
  };

  // Handle progress updates from ProcessingStatusPanel - refresh video list immediately
  const handleProgressUpdate = useCallback(async (processed: number, failed: number, total: number) => {
    console.log(`📊 Progress update: ${processed}/${total} completed, ${failed} failed - refreshing video list`);
    try {
      const results = await loadMotionAnalysisData();
      setData(results);
    } catch (err) {
      console.warn('Failed to refresh video list on progress update:', err);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-gray-600">Loading motion analysis data...</p>
        </div>
      </div>
    );
  }

  // Separate videos by processing_status:
  // - 'completed' with motion analysis data (motion_analysis, benthic_activity_v4, or yolo_analysis) -> processed
  // - 'pending' or 'processing' or 'failed' without data -> pending/needs attention

  // Debug logging
  console.log('[FILTER] Filtering videos:', data);
  console.log('[FILTER] Video details:', data.map(v => ({
    filename: v.filename,
    status: v.processing_status,
    has_motion: !!v.motion_analysis,
    has_bav4: !!v.benthic_activity_v4,
    has_yolo: !!v.yolo_analysis,
    motion_keys: v.motion_analysis ? Object.keys(v.motion_analysis) : null,
    bav4_keys: v.benthic_activity_v4 ? Object.keys(v.benthic_activity_v4) : null,
    yolo_keys: v.yolo_analysis ? Object.keys(v.yolo_analysis) : null,
  })));

  // FIX: Videos should only show as processed if they have ACTUAL meaningful analysis data
  // Videos marked as "completed" but without real data should be shown as pending for reprocessing
  // Check for actual data content, not just presence of objects with zero values
  const hasRealAnalysisData = (v: any) => {
    // Check motion_analysis - must have activity_score with actual data
    const hasMotionAnalysis = v.motion_analysis &&
      v.motion_analysis.activity_score &&
      typeof v.motion_analysis.activity_score.overall_score === 'number';

    // Check benthic_activity_v4 - must have actual detections (valid_tracks > 0)
    const hasBav4 = v.benthic_activity_v4 &&
      (v.benthic_activity_v4.valid_tracks > 0 || v.benthic_activity_v4.total_tracks > 0);

    // Check yolo_analysis - must have actual detections
    const hasYolo = v.yolo_analysis &&
      Array.isArray(v.yolo_analysis) &&
      v.yolo_analysis.length > 0;

    return hasMotionAnalysis || hasBav4 || hasYolo;
  };

  const processedVideos = data.filter((v) => {
    // Only show as processed if it has actual analysis data with real results
    return hasRealAnalysisData(v);
  });

  const pendingVideos = data.filter((v) => {
    // Show as pending if it has NO real analysis data (regardless of database status)
    // This includes:
    // - Newly uploaded videos (status: pending)
    // - Videos being processed (status: processing)
    // - Videos marked "completed" but with 0 detections or missing result files
    // - Failed videos (status: failed)
    return !hasRealAnalysisData(v);
  });

  console.log('[FILTER] Processed videos:', processedVideos.length, processedVideos);
  console.log('[FILTER] Pending videos:', pendingVideos.length, pendingVideos);
  console.log('[FILTER] data.length:', data.length);
  console.log('[FILTER] Will render:', {
    emptyDashboard: data.length === 0 && !error,
    fullDashboard: (processedVideos.length > 0 || pendingVideos.length > 0) && data.length > 0
  });

  // Log first video in detail
  if (data.length > 0) {
    console.log('[FILTER] First video sample:', JSON.stringify(data[0], null, 2));
  }

  // Map pending videos to dashboard format (include processing_status and prescreen data for display)
  // Note: Videos marked as "completed" but without analysis data will show as "needs_reprocessing"
  const pendingVideosList = pendingVideos.map((v) => {
    // If status is "completed" but video has no analysis data, mark as needs_reprocessing
    const effectiveStatus = v.processing_status === 'completed'
      ? 'needs_reprocessing'
      : (v.processing_status as 'pending' | 'processing' | 'failed' | undefined);

    return {
      id: v.id,
      filename: v.filename,
      width: v.width,
      height: v.height,
      fps: v.fps,
      duration_seconds: v.duration_seconds,
      total_frames: v.total_frames,
      processing_status: effectiveStatus,
      prescreen_brightness: v.prescreen_brightness,
      prescreen_focus: v.prescreen_focus,
      prescreen_quality: v.prescreen_quality,
      prescreen_completed: v.prescreen_completed,
      prescreen_samples: v.prescreen_samples,
      prescreen_error: v.prescreen_error,
    };
  });

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Show duplicate cleanup notification */}
        {cleanupNotification && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-start gap-3">
              <Trash2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-emerald-800 font-medium">
                  Cleaned up {cleanupNotification.deletedCount} duplicate database {cleanupNotification.deletedCount === 1 ? 'entry' : 'entries'}
                </p>
                <p className="text-sm text-emerald-700 mt-1">
                  Duplicate video entries were automatically removed. Original files were kept.
                </p>
                <div className="mt-2 text-xs text-emerald-600">
                  {cleanupNotification.deletedFiles.map(f =>
                    `${f.filename} (${f.deletedCount} duplicate${f.deletedCount > 1 ? 's' : ''} removed)`
                  ).join(', ')}
                </div>
              </div>
              <button
                onClick={() => setCleanupNotification(null)}
                className="text-emerald-600 hover:text-emerald-800 transition-colors"
                title="Dismiss"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Show stuck videos warning with reset option */}
        {stuckVideos.length > 0 && !currentRunId && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-amber-800 font-medium">
                  {stuckVideos.length} video{stuckVideos.length > 1 ? 's' : ''} stuck in processing
                </p>
                <p className="text-sm text-amber-700 mt-1">
                  Processing was interrupted (page refresh, error, or timeout). Reset to try again.
                </p>
                <div className="mt-2 text-xs text-amber-600">
                  {stuckVideos.map(v => v.filename).join(', ')}
                </div>
              </div>
              <button
                onClick={handleResetStuckVideos}
                disabled={isResetting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-100 text-amber-800 rounded-md hover:bg-amber-200 disabled:opacity-50 transition-colors"
              >
                {isResetting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Reset
              </button>
            </div>
          </div>
        )}

        {data.length === 0 && !error && (
          <MotionAnalysisDashboard
            data={[]}
            pendingVideos={[]}
            onDeleteVideos={handleDeleteVideos}
            onProcessingStarted={handleProcessingStarted}
            onUploadComplete={handleUploadComplete}
            processingStatusPanel={currentRunId ? (
              <ProcessingStatusPanel
                runId={currentRunId}
                onComplete={handleProcessingComplete}
                onProgressUpdate={handleProgressUpdate}
                onDismiss={handleDismissProcessingPanel}
                estimatedTime={estimatedTime}
                estimatedCost={estimatedCost}
              />
            ) : undefined}
          />
        )}

        {(processedVideos.length > 0 || pendingVideos.length > 0) && data.length > 0 && (
          <MotionAnalysisDashboard
            data={processedVideos.map(v => {
              // Unified pipeline JSON structure from database:
              // v.motion_analysis = {
              //   video_info: {...},
              //   motion_analysis: { activity_score, motion, density, organisms },
              //   yolo_detection: { detections: [...] },
              //   processing: {...}
              // }
              const motionData = v.motion_analysis || {};
              const nestedMotionAnalysis = motionData.motion_analysis || {};

              // Create video_info from available sources (motion_analysis or video metadata)
              const video_info = motionData.video_info || {
                filename: v.filename,
                fps: v.fps || 0,
                resolution: { width: v.width || 0, height: v.height || 0 },
                total_frames: v.total_frames || 0,
                duration_seconds: v.duration_seconds || 0,
              };

              return {
                // Root-level fields
                video_info,
                // Nested motion_analysis fields (may be undefined if only BAv4/YOLO ran)
                activity_score: nestedMotionAnalysis.activity_score,
                motion: nestedMotionAnalysis.motion,
                density: nestedMotionAnalysis.density,
                organisms: nestedMotionAnalysis.organisms,
                // YOLO detections array
                yolo_detections: motionData.yolo_detection?.detections || [],
                // BAv4 data (from summary)
                benthic_activity_v4: v.benthic_activity_v4,
                bav4_frame_detections: v.bav4_frame_detections,
                processing_time_seconds: nestedMotionAnalysis.processing_time_seconds,
                timestamp: motionData.processing?.timestamp || new Date().toISOString(),
                processing_history: v.processing_history || [],
                // Prescreen quality metrics (preserved from upload)
                prescreen_brightness: v.prescreen_brightness,
                prescreen_focus: v.prescreen_focus,
                prescreen_quality: v.prescreen_quality,
                prescreen_completed: v.prescreen_completed,
                prescreen_samples: v.prescreen_samples,
                prescreen_error: v.prescreen_error,
              };
            })}
            pendingVideos={pendingVideosList.map(v => ({
              ...v,
              processing_history: data.find(d => d.id === v.id)?.processing_history || [],
            }))}
            onDeleteVideos={handleDeleteVideos}
            onProcessingStarted={handleProcessingStarted}
            onUploadComplete={handleUploadComplete}
            processingStatusPanel={currentRunId ? (
              <ProcessingStatusPanel
                runId={currentRunId}
                onComplete={handleProcessingComplete}
                onProgressUpdate={handleProgressUpdate}
                onDismiss={handleDismissProcessingPanel}
                estimatedTime={estimatedTime}
                estimatedCost={estimatedCost}
              />
            ) : undefined}
          />
        )}
      </div>
    </div>
  );
}
