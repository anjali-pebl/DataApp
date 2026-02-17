'use client';

import React, { useState, useEffect } from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Play,
  RefreshCw,
  Video,
  FileJson,
  Cpu,
  X,
} from 'lucide-react';

export interface ValidationCheck {
  name: string;
  status: 'passed' | 'failed' | 'warning';
  exists: boolean;
  path: string;
  message: string;
  canRegenerate: boolean;
  regenerateAction?: 'reprocess_motion' | 'run_yolov8' | 'download';
}

export interface VideoValidationResult {
  videoFilename: string;
  originalFilename: string;
  checks: {
    originalVideo: ValidationCheck;
    motionVideo: ValidationCheck;
    yolov8Video: ValidationCheck;
    motionJson: ValidationCheck;
    yolov8Json: ValidationCheck;
  };
  allPassed: boolean;
  canProceed: boolean;
  summary: string;
}

interface VideoValidationDialogProps {
  isOpen: boolean;
  videoFilename: string;
  onClose: () => void;
  onProceed: () => void;
  onRunYolov8: (videoFilename: string) => void;
  onReprocessMotion: (videoFilename: string) => void;
}

type ValidationState = 'validating' | 'ready' | 'has_issues' | 'cannot_proceed' | 'error';

export default function VideoValidationDialog({
  isOpen,
  videoFilename,
  onClose,
  onProceed,
  onRunYolov8,
  onReprocessMotion,
}: VideoValidationDialogProps) {
  const [state, setState] = useState<ValidationState>('validating');
  const [validation, setValidation] = useState<VideoValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && videoFilename) {
      validateVideo();
    }
  }, [isOpen, videoFilename]);

  const validateVideo = async () => {
    setState('validating');
    setError(null);

    try {
      const response = await fetch('/api/motion-analysis/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoFilename }),
      });

      if (!response.ok) {
        throw new Error('Validation request failed');
      }

      const result: VideoValidationResult = await response.json();
      setValidation(result);

      if (result.allPassed) {
        setState('ready');
        // Auto-proceed if everything is ready
        setTimeout(() => onProceed(), 500);
      } else if (result.canProceed) {
        setState('has_issues');
      } else {
        setState('cannot_proceed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setState('error');
    }
  };

  const handleRegenerate = async (action: 'reprocess_motion' | 'run_yolov8') => {
    if (!validation) return;

    setIsRegenerating(action);

    if (action === 'run_yolov8') {
      onRunYolov8(validation.originalFilename);
    } else if (action === 'reprocess_motion') {
      onReprocessMotion(validation.originalFilename);
    }

    // The parent component will handle the actual processing
    // For now, we'll close this dialog
    onClose();
  };

  if (!isOpen) return null;

  const getStatusIcon = (status: 'passed' | 'failed' | 'warning') => {
    switch (status) {
      case 'passed':
        return <CheckCircle className="text-green-500" size={18} />;
      case 'failed':
        return <XCircle className="text-red-500" size={18} />;
      case 'warning':
        return <AlertTriangle className="text-yellow-500" size={18} />;
    }
  };

  const getCheckIcon = (checkName: string) => {
    if (checkName.toLowerCase().includes('video')) {
      return <Video size={16} className="text-gray-500" />;
    }
    if (checkName.toLowerCase().includes('json') || checkName.toLowerCase().includes('data')) {
      return <FileJson size={16} className="text-gray-500" />;
    }
    return <Cpu size={16} className="text-gray-500" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gray-50 px-4 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Video Pre-flight Check</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Validating State */}
          {state === 'validating' && (
            <div className="flex flex-col items-center py-8">
              <Loader2 size={40} className="text-blue-500 animate-spin mb-4" />
              <p className="text-gray-600">Checking video assets...</p>
              <p className="text-sm text-gray-400 mt-1">{videoFilename}</p>
            </div>
          )}

          {/* Error State */}
          {state === 'error' && (
            <div className="flex flex-col items-center py-8">
              <XCircle size={40} className="text-red-500 mb-4" />
              <p className="text-gray-900 font-medium">Validation Failed</p>
              <p className="text-sm text-red-600 mt-1">{error}</p>
              <button
                onClick={validateVideo}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
              >
                <RefreshCw size={16} />
                Retry
              </button>
            </div>
          )}

          {/* Ready State (auto-proceeds) */}
          {state === 'ready' && validation && (
            <div className="flex flex-col items-center py-8">
              <CheckCircle size={40} className="text-green-500 mb-4" />
              <p className="text-gray-900 font-medium">All files ready!</p>
              <p className="text-sm text-gray-500 mt-1">Opening video player...</p>
            </div>
          )}

          {/* Has Issues State */}
          {(state === 'has_issues' || state === 'cannot_proceed') && validation && (
            <div className="space-y-4">
              {/* Summary */}
              <div
                className={`p-3 rounded-lg ${
                  state === 'cannot_proceed'
                    ? 'bg-red-50 border border-red-200'
                    : 'bg-yellow-50 border border-yellow-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  {state === 'cannot_proceed' ? (
                    <XCircle className="text-red-500" size={20} />
                  ) : (
                    <AlertTriangle className="text-yellow-500" size={20} />
                  )}
                  <span
                    className={`font-medium ${
                      state === 'cannot_proceed' ? 'text-red-700' : 'text-yellow-700'
                    }`}
                  >
                    {validation.summary}
                  </span>
                </div>
              </div>

              {/* Check List */}
              <div className="space-y-2">
                {Object.entries(validation.checks).map(([key, check]) => (
                  <div
                    key={key}
                    className={`flex items-center justify-between p-2 rounded-lg ${
                      check.status === 'passed'
                        ? 'bg-green-50'
                        : check.status === 'warning'
                        ? 'bg-yellow-50'
                        : 'bg-red-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {getStatusIcon(check.status)}
                      <div className="flex items-center gap-1.5">
                        {getCheckIcon(check.name)}
                        <span className="text-sm font-medium text-gray-700">{check.name}</span>
                      </div>
                    </div>
                    {check.status === 'failed' && check.canRegenerate && check.regenerateAction && (
                      <button
                        onClick={() => handleRegenerate(check.regenerateAction!)}
                        disabled={isRegenerating !== null}
                        className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                          check.regenerateAction === 'run_yolov8'
                            ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                            : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        } disabled:opacity-50`}
                      >
                        {isRegenerating === check.regenerateAction ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RefreshCw size={12} />
                        )}
                        {check.regenerateAction === 'run_yolov8' ? 'Run YOLO' : 'Regenerate'}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                {state === 'has_issues' && (
                  <button
                    onClick={onProceed}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2"
                  >
                    <Play size={16} />
                    Open Anyway
                  </button>
                )}

                {/* Show Run YOLOv8 button prominently if YOLO files are missing */}
                {(validation.checks.yolov8Video.status === 'failed' ||
                  validation.checks.yolov8Json.status === 'failed') && (
                  <button
                    onClick={() => handleRegenerate('run_yolov8')}
                    disabled={isRegenerating !== null}
                    className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isRegenerating === 'run_yolov8' ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Cpu size={16} />
                    )}
                    Run YOLOv8 Inference
                  </button>
                )}

                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
