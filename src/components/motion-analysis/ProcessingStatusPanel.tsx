'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Loader2, CheckCircle, XCircle, AlertCircle, RefreshCw, Terminal, ChevronDown, ChevronUp, StopCircle, X } from 'lucide-react';
import FailureLogDialog from './FailureLogDialog';

interface ProcessingRun {
  id: string;
  run_type: 'local' | 'modal-t4' | 'modal-a10g';
  total_videos: number;
  videos_processed: number;
  videos_failed: number;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
  created_at: string;
  current_video_filename?: string;
}

interface ProcessingStatusPanelProps {
  runId: string | null;
  onComplete?: () => void;
  onProgressUpdate?: (processed: number, failed: number, total: number) => void;
  onDismiss?: () => void;
  estimatedTime?: string;
  estimatedCost?: string;
}

export default function ProcessingStatusPanel({ runId, onComplete, onProgressUpdate, onDismiss, estimatedTime, estimatedCost }: ProcessingStatusPanelProps) {
  const [run, setRun] = useState<ProcessingRun | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>('');
  const [showLogs, setShowLogs] = useState(true); // Default to expanded
  const [isCancelling, setIsCancelling] = useState(false);
  const [showFailureDialog, setShowFailureDialog] = useState(false);
  const [autoDismissCountdown, setAutoDismissCountdown] = useState<number | null>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const hasCalledOnComplete = useRef(false);
  const lastLoggedStatus = useRef<string | null>(null);
  const lastLoggedProgress = useRef<number>(-1);
  const consecutiveErrors = useRef(0);
  const lastErrorTime = useRef(0);
  const hasShownFailureDialog = useRef(false);
  const autoDismissTimer = useRef<NodeJS.Timeout | null>(null);

  // Fetch processing run status
  const fetchStatus = async () => {
    if (!runId) {
      console.warn('[StatusPanel] ⚠️ fetchStatus called but runId is null');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const fetchStartTime = Date.now();
      console.log(`[StatusPanel] 📡 Fetching status for run: ${runId}`);

      const response = await fetch(`/api/motion-analysis/process/${runId}`);
      const fetchDuration = Date.now() - fetchStartTime;

      console.log(`[StatusPanel] Response: ${response.status} ${response.statusText} (${fetchDuration}ms)`);

      if (!response.ok) {
        console.error(`[StatusPanel] ❌ HTTP error ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`[StatusPanel] Result:`, result);

      if (result.success && result.run) {
        consecutiveErrors.current = 0; // Reset error counter on success

        // Only log when status or progress changes (not every poll)
        const statusChanged = result.run.status !== lastLoggedStatus.current;
        const progressChanged = result.run.videos_processed !== lastLoggedProgress.current;

        if (statusChanged || progressChanged) {
          console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #3b82f6');
          console.log(`%c[Processing Status Update]`, 'color: #3b82f6; font-weight: bold; font-size: 12px');
          console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #3b82f6');
          console.log(`  🆔 Run ID: ${runId}`);
          console.log(`  📊 Status: ${result.run.status.toUpperCase()}`);
          console.log(`  ✅ Processed: ${result.run.videos_processed}/${result.run.total_videos}`);
          console.log(`  ❌ Failed: ${result.run.videos_failed}`);
          console.log(`  🎬 Current video: ${result.run.current_video_filename || 'N/A'}`);
          console.log(`  ⏱️  Started: ${result.run.started_at}`);
          if (result.run.completed_at) {
            console.log(`  🏁 Completed: ${result.run.completed_at}`);
          }
          console.log(`  ⚡ Fetch time: ${fetchDuration}ms`);
          console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #3b82f6');

          lastLoggedStatus.current = result.run.status;
          lastLoggedProgress.current = result.run.videos_processed;

          // Notify parent of progress change so it can refresh video list
          if (progressChanged && onProgressUpdate) {
            console.log(`[StatusPanel] 🔄 Triggering parent refresh (progress changed)`);
            onProgressUpdate(result.run.videos_processed, result.run.videos_failed, result.run.total_videos);
          }
        }

        setRun(result.run);

        // If failed, show the failure dialog (only once)
        if (result.run.status === 'failed' && !hasShownFailureDialog.current) {
          console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #ef4444');
          console.log(`%c[Processing FAILED]`, 'color: #ef4444; font-weight: bold; font-size: 14px');
          console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #ef4444');
          console.log(`  ✅ Processed: ${result.run.videos_processed}`);
          console.log(`  ❌ Failed: ${result.run.videos_failed}`);
          console.log(`  📋 Showing failure log dialog...`);
          console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #ef4444');

          hasShownFailureDialog.current = true;
          setShowFailureDialog(true);

          // Call onComplete for failed runs so parent can refresh
          if (onComplete && !hasCalledOnComplete.current) {
            hasCalledOnComplete.current = true;
            setTimeout(() => {
              console.log(`[StatusPanel] 🔄 Executing onComplete callback for failed run`);
              onComplete();
            }, 1000);
          }
        }

        // If completed successfully, notify parent (only once)
        if (result.run.status === 'completed' && onComplete && !hasCalledOnComplete.current) {
          console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #10b981');
          console.log(`%c[Processing COMPLETED]`, 'color: #10b981; font-weight: bold; font-size: 14px');
          console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #10b981');
          console.log(`  ✅ Processed: ${result.run.videos_processed}`);
          console.log(`  ❌ Failed: ${result.run.videos_failed}`);
          console.log(`  ⏱️  Calling onComplete in 3 seconds to ensure files are saved...`);
          console.log(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #10b981');

          hasCalledOnComplete.current = true;
          // Wait 3 seconds to ensure JSON files are fully written to disk
          setTimeout(() => {
            console.log(`[StatusPanel] 🎉 Executing onComplete callback now`);
            onComplete();
          }, 3000);
        }
      } else {
        console.error(`[StatusPanel] ❌ Failed response:`, result);
        setError(result.error || 'Failed to fetch status');
      }
    } catch (err: any) {
      // Throttle error logging - only log every 10 seconds or first 3 errors
      const now = Date.now();
      consecutiveErrors.current++;
      if (consecutiveErrors.current <= 3 || now - lastErrorTime.current > 10000) {
        console.error(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #ef4444');
        console.error(`%c[StatusPanel ERROR]`, 'color: #ef4444; font-weight: bold; font-size: 12px');
        console.error(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #ef4444');
        console.error(`  🆔 Run ID: ${runId}`);
        console.error(`  ❌ Error: ${err.message || err}`);
        console.error(`  🔁 Consecutive errors: ${consecutiveErrors.current}`);
        console.error(`  📡 Network: ${navigator.onLine ? 'Online' : 'OFFLINE'}`);
        console.error(`%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'color: #ef4444');
        lastErrorTime.current = now;
      }
      setError(err.message || 'Connection lost');
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch logs
  const fetchLogs = async () => {
    if (!runId) {
      console.warn('[StatusPanel] ⚠️ fetchLogs called but runId is null');
      return;
    }

    try {
      const fetchStartTime = Date.now();
      const response = await fetch(`/api/motion-analysis/process/log?runId=${runId}`);
      const fetchDuration = Date.now() - fetchStartTime;

      if (!response.ok) {
        console.error(`[StatusPanel] ❌ Log fetch HTTP ${response.status}: ${response.statusText} (${fetchDuration}ms)`);
      }

      const result = await response.json();

      if (result.success) {
        const newLogs = result.logs || '';
        const previousLength = logs.length;
        const newLength = newLogs.length;

        // Only log if logs have changed
        if (newLogs !== logs && newLength > previousLength) {
          const addedContent = newLogs.substring(previousLength);
          const newLines = addedContent.split('\n').filter(line => line.trim());

          console.log(`%c[Logs Updated]`, 'color: #8b5cf6; font-weight: bold');
          console.log(`  📝 Added ${newLength - previousLength} chars (${newLines.length} lines)`);
          console.log(`  ⏱️  Fetch time: ${fetchDuration}ms`);

          // Show new log lines
          if (newLines.length > 0) {
            console.log(`  📄 New content:`);
            newLines.slice(-10).forEach(line => {
              const color = line.includes('[ERROR]') ? '#ef4444' :
                           line.includes('[WARNING]') ? '#f59e0b' :
                           line.includes('[SUCCESS]') ? '#10b981' :
                           line.includes('Progress:') ? '#3b82f6' : '#6b7280';
              console.log(`%c    ${line}`, `color: ${color}`);
            });
          }
        }

        setLogs(newLogs);
        consecutiveErrors.current = 0; // Reset on success
      } else {
        console.error('[StatusPanel] ❌ Failed to fetch logs:', result.error || 'Unknown error');
      }
    } catch (err: any) {
      console.error(`[StatusPanel] ❌ Error fetching logs: ${err.message || err}`);
      // Silently fail - status fetch already handles error display
    }
  };

  // Cancel processing
  const handleCancel = async () => {
    if (!runId || isCancelling) return;

    const confirmCancel = window.confirm(
      'Are you sure you want to cancel processing?\n\n' +
      'Videos that have finished will be kept.\n' +
      'Videos in progress will be stopped and marked as pending.'
    );

    if (!confirmCancel) return;

    setIsCancelling(true);
    try {
      console.log(`[Cancel] Cancelling processing run: ${runId}`);
      const response = await fetch('/api/motion-analysis/process/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });

      const result = await response.json();

      if (result.success) {
        console.log(`[Cancel] ✓ Processing cancelled successfully`);
        console.log(`  - Completed: ${result.videosCompleted}`);
        console.log(`  - Pending: ${result.videosPending}`);
        console.log(`  - Failed: ${result.videosFailed || 0}`);

        // Refresh status to show cancelled state
        await fetchStatus();

        // Notify parent to refresh the video list
        if (onComplete) {
          onComplete();
        }
      } else {
        console.error('[Cancel] Error:', result.error);
        alert(`Failed to cancel: ${result.error}`);
      }
    } catch (err: any) {
      console.error('[Cancel] Error cancelling processing:', err);
      alert(`Failed to cancel: ${err.message}`);
    } finally {
      setIsCancelling(false);
    }
  };

  // Auto-scroll to bottom when logs change or panel is expanded
  useEffect(() => {
    if (showLogs && logsContainerRef.current) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (logsContainerRef.current) {
          logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
        }
      });
    }
  }, [logs, showLogs]);

  // Save logs to database handler
  const handleSaveLogsToDatabase = async (): Promise<boolean> => {
    if (!runId) return false;

    try {
      console.log(`[StatusPanel] Saving logs to database for run: ${runId}`);
      const response = await fetch('/api/motion-analysis/process/save-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, logs }),
      });

      const result = await response.json();

      if (result.success) {
        console.log(`[StatusPanel] ✓ Logs saved to database:`, result.stats);
        return true;
      } else {
        console.error(`[StatusPanel] ❌ Failed to save logs:`, result.error);
        return false;
      }
    } catch (error: any) {
      console.error(`[StatusPanel] ❌ Error saving logs:`, error);
      return false;
    }
  };

  // Auto-refresh while running
  useEffect(() => {
    if (!runId) {
      console.log('[StatusPanel] 🔴 No runId, skipping auto-refresh');
      return;
    }

    console.log(`[StatusPanel] 🟢 Starting auto-refresh for run: ${runId}`);
    hasCalledOnComplete.current = false;
    hasShownFailureDialog.current = false;
    fetchStatus();
    fetchLogs();

    const interval = setInterval(() => {
      if (run?.status === 'completed' || run?.status === 'failed') {
        console.log(`[StatusPanel] ⏸️  Stopping auto-refresh, status is ${run.status}`);
        return;
      }
      console.log('[StatusPanel] 🔄 Auto-refresh tick');
      fetchStatus();
      fetchLogs();
    }, 2000);

    return () => {
      console.log('[StatusPanel] 🛑 Clearing auto-refresh interval');
      clearInterval(interval);
      // Clear auto-dismiss timer if component unmounts
      if (autoDismissTimer.current) {
        clearTimeout(autoDismissTimer.current);
        autoDismissTimer.current = null;
      }
    };
  }, [runId, run?.status]);

  // Auto-dismiss 10 seconds after completion or failure
  useEffect(() => {
    // Only set timer when status changes to completed, failed, or cancelled
    if (!run || !onDismiss) return;

    const isFinished = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';

    if (isFinished && !autoDismissTimer.current) {
      console.log(`[StatusPanel] ⏲️  Starting 10-second auto-dismiss timer (status: ${run.status})`);

      // Start countdown
      setAutoDismissCountdown(10);

      // Update countdown every second
      const countdownInterval = setInterval(() => {
        setAutoDismissCountdown((prev) => {
          if (prev === null || prev <= 1) {
            clearInterval(countdownInterval);
            return null;
          }
          return prev - 1;
        });
      }, 1000);

      // Auto-dismiss after 10 seconds
      autoDismissTimer.current = setTimeout(() => {
        console.log(`[StatusPanel] 🗑️  Auto-dismissing panel after 10 seconds`);
        clearInterval(countdownInterval);
        setAutoDismissCountdown(null);
        onDismiss();
      }, 10000); // 10 seconds
    }

    return () => {
      // Don't clear timer on status changes, only on unmount
    };
  }, [run?.status, onDismiss]);

  if (!runId) return null;

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle size={14} />
          <span>Error: {error}</span>
        </div>
        <button
          onClick={fetchStatus}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
        >
          <RefreshCw size={12} />
          Retry
        </button>
      </div>
    );
  }

  if (!run && isLoading) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
        <span className="text-blue-800 text-sm">Loading...</span>
      </div>
    );
  }

  if (!run) return null;

  // Calculate values
  const totalProcessed = run.videos_processed + run.videos_failed;
  const progressPercent = run.total_videos > 0 ? (totalProcessed / run.total_videos) * 100 : 0;
  const isComplete = run.status === 'completed';
  const isFailed = run.status === 'failed';
  const isCancelled = run.status === 'cancelled';
  const isRunning = run.status === 'running';
  const remaining = run.total_videos - totalProcessed;

  // Format elapsed time
  const startTime = new Date(run.started_at).getTime();
  const endTime = run.completed_at ? new Date(run.completed_at).getTime() : Date.now();
  const elapsedSeconds = Math.floor((endTime - startTime) / 1000);
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  const elapsedDisplay = elapsedMinutes > 0 ? `${elapsedMinutes}m ${elapsedSeconds % 60}s` : `${elapsedSeconds}s`;

  // Run type display (short)
  const runTypeShort = {
    local: 'Local',
    'modal-t4': 'T4 GPU',
    'modal-a10g': 'A10G GPU',
  }[run.run_type];

  // Status color
  const statusBg = isComplete
    ? 'bg-green-50 border-green-200'
    : isFailed
    ? 'bg-red-50 border-red-200'
    : isCancelled
    ? 'bg-orange-50 border-orange-200'
    : 'bg-blue-50 border-blue-200';
  const progressColor = isComplete
    ? 'bg-green-500'
    : isFailed
    ? 'bg-red-500'
    : isCancelled
    ? 'bg-orange-500'
    : 'bg-blue-500';

  return (
    <div className={`border rounded-lg ${statusBg} shadow bg-white`}>
      {/* Single line status bar */}
      <div className="px-4 py-2.5 flex items-center gap-3 text-sm text-gray-700">
        {/* Status icon */}
        {isRunning && <Loader2 className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />}
        {isComplete && <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />}
        {isFailed && <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />}
        {isCancelled && <StopCircle className="w-4 h-4 text-orange-600 flex-shrink-0" />}

        {/* GPU Type */}
        <span className="font-medium">{runTypeShort}</span>

        <span className="text-gray-300">|</span>

        {/* Success count */}
        <span className="text-green-700">
          <span className="font-medium">{run.videos_processed}</span> done
        </span>

        {/* Remaining (only if running) */}
        {isRunning && remaining > 0 && (
          <>
            <span className="text-gray-300">|</span>
            <span className="text-blue-700">
              <span className="font-medium">{remaining}</span> left
            </span>
          </>
        )}

        {/* Failed (only if any) */}
        {run.videos_failed > 0 && (
          <>
            <span className="text-gray-300">|</span>
            <span className="text-red-700">
              <span className="font-medium">{run.videos_failed}</span> failed
            </span>
          </>
        )}

        <span className="text-gray-300">|</span>

        {/* Elapsed time */}
        <span className="text-gray-600">{elapsedDisplay}</span>

        {/* Estimated time (if provided and still running) */}
        {isRunning && estimatedTime && (
          <>
            <span className="text-gray-400">/</span>
            <span className="text-gray-500">~{estimatedTime}</span>
          </>
        )}

        {/* Estimated cost (if provided) */}
        {estimatedCost && (
          <>
            <span className="text-gray-300">|</span>
            <span className="text-gray-600">~{estimatedCost}</span>
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Logs toggle */}
        <button
          onClick={() => setShowLogs(!showLogs)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          <Terminal size={14} />
          <span>Logs</span>
          {showLogs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {/* View Error button - only show when failed */}
        {isFailed && (
          <button
            onClick={() => setShowFailureDialog(true)}
            className="ml-2 flex items-center gap-1 px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            title="View error logs"
          >
            <AlertCircle size={14} />
            <span>View Error</span>
          </button>
        )}

        {/* Dismiss button - only show when completed (not failed) */}
        {(isComplete || isCancelled) && onDismiss && (
          <button
            onClick={() => {
              // Cancel auto-dismiss timer and dismiss immediately
              if (autoDismissTimer.current) {
                clearTimeout(autoDismissTimer.current);
                autoDismissTimer.current = null;
              }
              setAutoDismissCountdown(null);
              onDismiss();
            }}
            className="ml-2 flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
            title="Clear logs"
          >
            <X size={14} />
            <span>Clear{autoDismissCountdown !== null ? ` (${autoDismissCountdown}s)` : ''}</span>
          </button>
        )}
      </div>

      {/* Progress bar with cancel button */}
      <div className="px-3 pb-2 flex items-center gap-2">
        <div className="flex-1 bg-gray-200 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${progressColor}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        {/* Cancel button - only show when running */}
        {isRunning && (
          <button
            onClick={handleCancel}
            disabled={isCancelling}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Cancel processing"
          >
            {isCancelling ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Cancelling...</span>
              </>
            ) : (
              <>
                <StopCircle size={12} />
                <span>Cancel</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Expandable logs section */}
      {showLogs && (
        <div className="border-t border-gray-200">
          <div
            ref={logsContainerRef}
            className="m-2 bg-gray-50 border border-gray-200 rounded p-2 font-mono text-xs overflow-y-auto"
            style={{ height: '100px' }} // ~5 lines at text-xs
          >
            {logs ? (
              logs.split('\n').map((line, idx) => {
                let lineClass = 'text-gray-700';
                if (line.includes('[ERROR]') || line.includes('[STDERR]')) {
                  lineClass = 'text-red-600 font-medium';
                } else if (line.includes('[WARNING]')) {
                  lineClass = 'text-yellow-700 font-medium';
                } else if (line.includes('[SUCCESS]')) {
                  lineClass = 'text-green-600 font-medium';
                } else if (line.includes('Progress:') || line.includes('Processed')) {
                  lineClass = 'text-blue-600';
                }
                return (
                  <div key={idx} className={`${lineClass} leading-tight whitespace-pre-wrap`}>
                    {line || '\u00A0'}
                  </div>
                );
              })
            ) : (
              <div className="text-gray-500 italic">Waiting for logs...</div>
            )}
          </div>
        </div>
      )}

      {/* Failure Log Dialog */}
      {showFailureDialog && isFailed && (
        <FailureLogDialog
          runId={runId || ''}
          logs={logs}
          onClose={() => setShowFailureDialog(false)}
          onSaveToDatabase={handleSaveLogsToDatabase}
        />
      )}
    </div>
  );
}
