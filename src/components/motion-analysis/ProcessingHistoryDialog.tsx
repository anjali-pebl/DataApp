'use client';

import React, { useState } from 'react';
import { X, Clock, CheckCircle, XCircle, Terminal, ChevronDown, ChevronUp, Cpu, Cloud, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ProcessingRun {
  run_id: string;
  run_type: 'local' | 'modal-t4' | 'modal-a10g' | 'modal-a100';
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
  logs?: Array<{ timestamp: string; message: string }>;
  videos_processed: number;
  videos_failed: number;
  total_videos: number;
}

interface ProcessingHistoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  filename: string;
  history: ProcessingRun[];
  onDeleteRun?: (runId: string) => Promise<void>;
  onDeleteAll?: () => Promise<void>;
}

export default function ProcessingHistoryDialog({
  isOpen,
  onClose,
  filename,
  history,
  onDeleteRun,
  onDeleteAll,
}: ProcessingHistoryDialogProps) {
  const [expandedRun, setExpandedRun] = useState<string | null>(
    history.length > 0 ? history[0].run_id : null
  );
  const [deleteConfirmRunId, setDeleteConfirmRunId] = useState<string | null>(null);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Log to console when dialog opens
  React.useEffect(() => {
    if (isOpen && history.length > 0) {
      console.log('='.repeat(80));
      console.log(`PROCESSING LOGS FOR: ${filename}`);
      console.log('='.repeat(80));
      history.forEach((run, idx) => {
        console.log(`\n[RUN ${idx + 1}] ${run.run_type.toUpperCase()} - ${run.status.toUpperCase()}`);
        console.log(`Started: ${run.started_at}`);
        if (run.completed_at) console.log(`Completed: ${run.completed_at}`);
        console.log(`Progress: ${run.videos_processed}/${run.total_videos} (${run.videos_failed} failed)`);
        if (run.logs && run.logs.length > 0) {
          console.log('\nLogs:');
          run.logs.forEach((log) => {
            if (log.message.includes('[ERROR]')) {
              console.error(log.message);
            } else if (log.message.includes('[WARNING]')) {
              console.warn(log.message);
            } else {
              console.log(log.message);
            }
          });
        } else {
          console.log('No logs captured for this run');
        }
        console.log('-'.repeat(80));
      });
    }
  }, [isOpen, history, filename]);

  const handleDeleteRun = async (runId: string) => {
    if (!onDeleteRun) return;

    setIsDeleting(true);
    try {
      await onDeleteRun(runId);
      setDeleteConfirmRunId(null);
      if (expandedRun === runId) {
        setExpandedRun(null);
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteAll = async () => {
    if (!onDeleteAll) return;

    setIsDeleting(true);
    try {
      await onDeleteAll();
      setShowDeleteAllConfirm(false);
      setExpandedRun(null);
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isOpen) return null;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (startedAt: string, completedAt?: string) => {
    const start = new Date(startedAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : Date.now();
    const seconds = Math.floor((end - start) / 1000);

    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const getRunTypeIcon = (runType: string) => {
    if (runType === 'local') return <Cpu size={14} className="text-gray-600" />;
    return <Cloud size={14} className="text-blue-600" />;
  };

  const getRunTypeLabel = (runType: string) => {
    switch (runType) {
      case 'local':
        return 'Local GPU';
      case 'modal-t4':
        return 'Modal T4';
      case 'modal-a10g':
        return 'Modal A10G';
      case 'modal-a100':
        return 'Modal A100';
      default:
        return runType;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
            <CheckCircle size={12} />
            Completed
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 text-xs font-medium rounded-full">
            <XCircle size={12} />
            Failed
          </span>
        );
      case 'running':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
            <Clock size={12} className="animate-spin" />
            Running
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Processing Logs</h2>
            <p className="text-sm text-gray-600 truncate max-w-md" title={filename}>
              {filename}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {history.length > 0 && onDeleteAll && (
              <button
                onClick={() => setShowDeleteAllConfirm(true)}
                className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 border border-red-200 rounded transition-colors flex items-center gap-1.5"
                disabled={isDeleting}
              >
                <Trash2 size={14} />
                Delete All
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {history.length === 0 ? (
            <div className="text-center py-8">
              <Terminal size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-600">No processing logs available</p>
              <p className="text-sm text-gray-500 mt-1">
                This video hasn't been processed yet.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((run) => (
                <div
                  key={run.run_id}
                  className="border rounded-lg overflow-hidden"
                >
                  {/* Run Header */}
                  <div className="flex items-center p-3 hover:bg-gray-50 transition-colors">
                    <button
                      onClick={() =>
                        setExpandedRun(expandedRun === run.run_id ? null : run.run_id)
                      }
                      className="flex-1 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        {getRunTypeIcon(run.run_type)}
                        <div className="text-left">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              {getRunTypeLabel(run.run_type)}
                            </span>
                            {getStatusBadge(run.status)}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                            <Clock size={12} />
                            <span>{formatDate(run.started_at)}</span>
                            <span className="text-gray-400">|</span>
                            <span>Duration: {formatDuration(run.started_at, run.completed_at)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500">
                          {run.videos_processed}/{run.total_videos} processed
                        </span>
                        {expandedRun === run.run_id ? (
                          <ChevronUp size={16} className="text-gray-400" />
                        ) : (
                          <ChevronDown size={16} className="text-gray-400" />
                        )}
                      </div>
                    </button>
                    {onDeleteRun && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmRunId(run.run_id);
                        }}
                        className="ml-2 p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                        disabled={isDeleting}
                        title="Delete this run"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>

                  {/* Run Logs */}
                  {expandedRun === run.run_id && (
                    <div className="border-t bg-gray-900 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <Terminal size={12} />
                          <span>Processing Log</span>
                        </div>
                        <button
                          onClick={() => {
                            const logText = run.logs?.map(l => l.message).join('\n') || 'No logs';
                            navigator.clipboard.writeText(logText);
                            console.log('Copied to clipboard:', logText);
                          }}
                          className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                          title="Copy logs to clipboard"
                        >
                          Copy
                        </button>
                      </div>
                      <div className="font-mono text-xs max-h-96 overflow-y-auto">
                        {run.logs && run.logs.length > 0 ? (
                          <>
                            {/* Show summary of errors first if any exist */}
                            {run.logs.some(log => log.message.includes('[ERROR]')) && (
                              <div className="mb-3 p-2 bg-red-900/30 border border-red-500/50 rounded">
                                <div className="text-red-400 font-bold mb-1">⚠ ERRORS DETECTED:</div>
                                {run.logs
                                  .filter(log => log.message.includes('[ERROR]'))
                                  .map((log, idx) => (
                                    <div key={`error-${idx}`} className="text-red-300 text-xs leading-relaxed">
                                      {log.message}
                                    </div>
                                  ))}
                              </div>
                            )}

                            {/* Full log output */}
                            <div className="text-xs text-gray-400 mb-1">Full Log:</div>
                            {run.logs.map((log, idx) => {
                              let lineClass = 'text-gray-300';
                              let bgClass = '';
                              if (log.message.includes('[ERROR]')) {
                                lineClass = 'text-red-400 font-semibold';
                                bgClass = 'bg-red-900/20';
                              } else if (log.message.includes('[WARNING]')) {
                                lineClass = 'text-yellow-400';
                                bgClass = 'bg-yellow-900/20';
                              } else if (log.message.includes('[SUCCESS]')) {
                                lineClass = 'text-green-400';
                              } else if (log.message.includes('Progress:')) {
                                lineClass = 'text-cyan-400';
                              }

                              return (
                                <div
                                  key={idx}
                                  className={`${lineClass} ${bgClass} leading-relaxed whitespace-pre-wrap py-0.5 px-1 rounded-sm`}
                                >
                                  {log.message}
                                </div>
                              );
                            })}
                          </>
                        ) : (
                          <div className="text-yellow-400 bg-yellow-900/20 p-3 rounded">
                            ⚠ No logs captured for this run. This may indicate:
                            <ul className="list-disc list-inside mt-2 text-xs text-gray-400">
                              <li>The processing script did not write to stdout/stderr</li>
                              <li>Log capture failed during execution</li>
                              <li>The process crashed before logging started</li>
                            </ul>
                            <div className="mt-2 text-xs text-gray-500">
                              Check the server console for uncaptured errors.
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-4 bg-gray-50">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
          >
            Close
          </button>
        </div>
      </div>

      {/* Delete Single Run Confirmation */}
      <AlertDialog open={deleteConfirmRunId !== null} onOpenChange={(open) => !open && setDeleteConfirmRunId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Processing Run?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this processing run and its logs. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmRunId && handleDeleteRun(deleteConfirmRunId)}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete All Runs Confirmation */}
      <AlertDialog open={showDeleteAllConfirm} onOpenChange={setShowDeleteAllConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Processing Runs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {history.length} processing run{history.length > 1 ? 's' : ''} and their logs for this video. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAll}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? 'Deleting...' : 'Delete All'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
