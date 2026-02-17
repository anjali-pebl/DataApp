'use client';

import React, { useState, useEffect } from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Settings,
  FolderPlus,
  Terminal,
  FileText,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import type { SystemRequirement, SystemSetupStatus } from '@/lib/system-setup-service';

interface SystemSetupWizardProps {
  onSetupComplete: () => void;
}

export default function SystemSetupWizard({ onSetupComplete }: SystemSetupWizardProps) {
  const [setupStatus, setSetupStatus] = useState<SystemSetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [fixing, setFixing] = useState(false);
  const [installingFFmpeg, setInstallingFFmpeg] = useState(false);
  const [expandedRequirement, setExpandedRequirement] = useState<string | null>(null);

  useEffect(() => {
    checkSetup();
  }, []);

  const checkSetup = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/system-setup/check');
      const data = await response.json();
      setSetupStatus(data);
    } catch (err) {
      console.error('Failed to check system setup:', err);
    } finally {
      setLoading(false);
    }
  };

  const autoFix = async () => {
    setFixing(true);
    try {
      const response = await fetch('/api/system-setup/fix', { method: 'POST' });
      const result = await response.json();

      if (result.success) {
        console.log('Auto-fixed:', result.fixed);
        // Re-check setup after fixing
        await checkSetup();
      }
    } catch (err) {
      console.error('Failed to auto-fix:', err);
    } finally {
      setFixing(false);
    }
  };

  const markSetupComplete = async () => {
    try {
      await fetch('/api/system-setup/complete', { method: 'POST' });
      onSetupComplete();
    } catch (err) {
      console.error('Failed to mark setup complete:', err);
    }
  };

  const installFFmpeg = async () => {
    setInstallingFFmpeg(true);
    try {
      const response = await fetch('/api/system-setup/install-ffmpeg', { method: 'POST' });
      const result = await response.json();

      if (result.success) {
        console.log('FFmpeg installed:', result.version);
        alert(`FFmpeg ${result.version} installed successfully using ${result.method}!`);
        // Re-check setup after installation
        await checkSetup();
      } else {
        console.error('FFmpeg installation failed:', result.error);
        let errorMsg = `Failed to install FFmpeg: ${result.error}`;
        if (result.suggestions && result.suggestions.length > 0) {
          errorMsg += '\n\nSuggestions:\n' + result.suggestions.join('\n');
        }
        alert(errorMsg);
      }
    } catch (err) {
      console.error('Failed to install FFmpeg:', err);
      alert('Failed to install FFmpeg. Please try manual installation.');
    } finally {
      setInstallingFFmpeg(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 max-w-md w-full">
          <div className="text-center">
            <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-600" />
            <h2 className="text-xl font-semibold mb-2">Checking System Setup</h2>
            <p className="text-gray-600">Verifying system requirements...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!setupStatus) return null;

  const requirementIcon = (req: SystemRequirement) => {
    switch (req.status) {
      case 'ok':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-600" />;
      case 'checking':
        return <Loader2 className="w-5 h-5 animate-spin text-blue-600" />;
      default:
        return <AlertTriangle className="w-5 h-5 text-gray-400" />;
    }
  };

  const requirementTypeIcon = (type: string) => {
    switch (type) {
      case 'directory':
        return <FolderPlus className="w-4 h-4" />;
      case 'dependency':
        return <Terminal className="w-4 h-4" />;
      case 'file':
        return <FileText className="w-4 h-4" />;
      default:
        return <Settings className="w-4 h-4" />;
    }
  };

  const hasAutoFixable = setupStatus.requirements.some(
    (req) => req.status === 'error' && req.autoFixable
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6">
          <div className="flex items-center gap-3">
            <Settings className="w-8 h-8" />
            <div>
              <h1 className="text-2xl font-bold">System Setup</h1>
              <p className="text-blue-100 mt-1">
                {setupStatus.isSetupComplete
                  ? 'All requirements met!'
                  : 'Initial configuration required'}
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Summary */}
          <div className="mb-6 p-4 rounded-lg bg-gray-50 border border-gray-200">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-green-600">
                  {setupStatus.requirements.filter((r) => r.status === 'ok').length}
                </div>
                <div className="text-sm text-gray-600">Ready</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">
                  {setupStatus.errors.length}
                </div>
                <div className="text-sm text-gray-600">Errors</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-yellow-600">
                  {setupStatus.warnings.length}
                </div>
                <div className="text-sm text-gray-600">Warnings</div>
              </div>
            </div>
          </div>

          {/* Requirements List */}
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900 mb-3">System Requirements</h3>
            {setupStatus.requirements.map((req, idx) => (
              <div
                key={idx}
                className={`border rounded-lg overflow-hidden transition-all ${
                  req.status === 'error'
                    ? 'border-red-200 bg-red-50'
                    : req.status === 'ok'
                    ? 'border-green-200 bg-green-50'
                    : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div
                  className="p-4 flex items-center gap-3 cursor-pointer hover:bg-opacity-70"
                  onClick={() =>
                    setExpandedRequirement(
                      expandedRequirement === req.name ? null : req.name
                    )
                  }
                >
                  {requirementIcon(req)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {requirementTypeIcon(req.type)}
                      <h4 className="font-medium text-gray-900">{req.name}</h4>
                      {!req.required && (
                        <span className="text-xs px-2 py-0.5 bg-gray-200 text-gray-600 rounded">
                          Optional
                        </span>
                      )}
                      {req.autoFixable && req.status === 'error' && (
                        <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                          Auto-fixable
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mt-0.5">{req.description}</p>
                    {req.path && (
                      <p className="text-xs text-gray-500 mt-1 font-mono">{req.path}</p>
                    )}
                  </div>
                </div>

                {/* Expanded details */}
                {expandedRequirement === req.name && req.status === 'error' && (
                  <div className="border-t px-4 py-3 bg-white">
                    <p className="text-sm text-red-700 mb-2">
                      <strong>Error:</strong> {req.error}
                    </p>
                    {!req.autoFixable && (
                      <div className="text-sm text-gray-700 mt-2">
                        {req.name === 'FFmpeg' ? (
                          <div>
                            <button
                              onClick={installFFmpeg}
                              disabled={installingFFmpeg}
                              className="mb-3 w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {installingFFmpeg ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Installing FFmpeg...
                                </>
                              ) : (
                                <>
                                  <Terminal className="w-4 h-4" />
                                  Install FFmpeg Automatically
                                </>
                              )}
                            </button>
                            <p className="text-xs text-gray-600 mb-2">
                              Or install manually:
                            </p>
                          </div>
                        ) : (
                          <strong>Manual Setup Required:</strong>
                        )}
                        <div className="mt-2 p-3 bg-gray-50 rounded border border-gray-200 whitespace-pre-wrap font-mono text-xs">
                          {getManualInstructions(req.name)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Errors & Warnings */}
          {setupStatus.errors.length > 0 && (
            <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <h4 className="font-semibold text-red-900 mb-2 flex items-center gap-2">
                <XCircle className="w-5 h-5" />
                Required Fixes
              </h4>
              <ul className="text-sm text-red-800 space-y-1 ml-7">
                {setupStatus.errors.map((error, idx) => (
                  <li key={idx}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          {setupStatus.warnings.length > 0 && (
            <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <h4 className="font-semibold text-yellow-900 mb-2 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                Optional Warnings
              </h4>
              <ul className="text-sm text-yellow-800 space-y-1 ml-7">
                {setupStatus.warnings.map((warning, idx) => (
                  <li key={idx}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t bg-gray-50 p-6">
          <div className="flex items-center justify-between gap-4">
            <button
              onClick={checkSetup}
              disabled={loading || fixing || installingFFmpeg}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Re-check
            </button>

            <div className="flex items-center gap-3">
              {hasAutoFixable && !setupStatus.isSetupComplete && (
                <button
                  onClick={autoFix}
                  disabled={fixing || installingFFmpeg}
                  className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {fixing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Fixing...
                    </>
                  ) : (
                    <>
                      <Settings className="w-4 h-4" />
                      Auto-Fix Issues
                    </>
                  )}
                </button>
              )}

              {setupStatus.isSetupComplete && (
                <button
                  onClick={markSetupComplete}
                  className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                >
                  <CheckCircle className="w-4 h-4" />
                  Continue to App
                </button>
              )}

              {!setupStatus.isSetupComplete && !hasAutoFixable && (
                <div className="text-sm text-gray-600">
                  Fix the issues above, then re-check
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getManualInstructions(requirementName: string): string {
  const instructions: Record<string, string> = {
    'Python Environment': `Please install Python 3.8 or later:
1. Download from https://www.python.org/downloads/
2. Run the installer
3. Check "Add Python to PATH" during installation
4. Restart your terminal/computer after installation
5. Verify by running: python --version`,

    FFmpeg: `FFmpeg is optional but recommended:
1. Windows: winget install ffmpeg
2. Mac: brew install ffmpeg
3. Linux: sudo apt install ffmpeg
4. Verify: ffmpeg -version`,

    'CV Scripts Directory': `The cv_scripts directory should be part of the codebase.
Please ensure you have cloned the complete repository.
Contact your administrator if this directory is missing.`,
  };

  return (
    instructions[requirementName] ||
    'Please contact your system administrator for setup instructions.'
  );
}
