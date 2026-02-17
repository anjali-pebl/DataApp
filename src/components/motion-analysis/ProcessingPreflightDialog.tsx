'use client';

import React, { useState, useEffect } from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Play,
  Terminal,
  Package,
  FolderOpen,
  RefreshCw,
  Download,
  ExternalLink,
  X,
} from 'lucide-react';
import type { ProcessingDependency, ProcessingCheckResult } from '@/lib/local-processing-checker-types';
import { getCachedDependencyCheck, cacheDependencyCheck, clearDependencyCache, getInstallationInstructions } from '@/lib/local-processing-checker-types';

interface ProcessingPreflightDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onProceed: () => void;
  skipCache?: boolean; // Force fresh check
}

export default function ProcessingPreflightDialog({
  isOpen,
  onClose,
  onProceed,
  skipCache = false,
}: ProcessingPreflightDialogProps) {
  const [checkResult, setCheckResult] = useState<ProcessingCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installingFFmpeg, setInstallingFFmpeg] = useState(false);
  const [expandedDep, setExpandedDep] = useState<string | null>(null);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [usingCache, setUsingCache] = useState(false);
  const logEndRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      checkDependencies();
    }
  }, [isOpen]);

  // Auto-scroll log to bottom when new messages appear
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [installLog]);

  const checkDependencies = async (forceRefresh = false) => {
    setLoading(true);
    setUsingCache(false);

    try {
      // Try to use cached result first (unless skipCache or forceRefresh is true)
      if (!skipCache && !forceRefresh) {
        const cached = getCachedDependencyCheck();
        if (cached) {
          console.log('[PREFLIGHT] Using cached dependency check');
          setUsingCache(true);

          // Create a minimal check result from cache
          const cachedResult: ProcessingCheckResult = {
            canProcess: cached.canProcess,
            dependencies: [], // We don't cache full dependencies
            errors: cached.canProcess ? [] : ['Some dependencies may be missing (cached result)'],
            warnings: [],
            suggestions: cached.canProcess ? [] : ['Click "Re-check" to verify current status'],
          };

          setCheckResult(cachedResult);
          setLoading(false);

          // If cache says we can process, close dialog immediately
          // User already saw this check before, so no need to show it again
          if (cached.canProcess) {
            console.log('[PREFLIGHT] Cached check passed - auto-proceeding immediately');
            onClose(); // Close FIRST
            setTimeout(() => {
              onProceed(); // Then proceed after dialog closes
            }, 100); // Minimal delay to let dialog close animation finish
          }

          return;
        }
      }

      // No cache or forced refresh - do full check
      console.log('[PREFLIGHT] Performing fresh dependency check...');
      const response = await fetch('/api/local-processing/check');
      const data = await response.json();
      setCheckResult(data);

      // Cache the result
      if (data.canProcess !== undefined) {
        const pythonVersion = data.dependencies?.find((d: ProcessingDependency) => d.name === 'Python 3.8+')?.version;
        cacheDependencyCheck(data.canProcess, pythonVersion);
      }

      // If all dependencies are met, auto-proceed after a short delay
      if (data.canProcess) {
        console.log('[PREFLIGHT] All dependencies met - auto-proceeding');
        setTimeout(() => {
          if (data.canProcess) {
            onClose(); // Close FIRST
            setTimeout(() => {
              onProceed(); // Then proceed after dialog closes
            }, 100);
          }
        }, 500); // Small delay to let user see the green checkmarks
      }
    } catch (err) {
      console.error('Failed to check dependencies:', err);
      setCheckResult({
        canProcess: false,
        dependencies: [],
        errors: ['Failed to check dependencies'],
        warnings: [],
        suggestions: ['Check your internet connection and try again'],
      });
    } finally {
      setLoading(false);
    }
  };

  const addLog = (message: string) => {
    setInstallLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const handleAutoInstall = async () => {
    console.log('[PREFLIGHT] Starting auto-install...');
    setInstallLog([]); // Clear previous logs
    addLog('🚀 Starting automatic installation...');
    setInstalling(true);

    // Get list of packages to install
    const toInstall = checkResult?.dependencies.filter(
      (dep) => dep.status === 'error' && dep.autoFixable
    ) || [];

    addLog(`📦 Found ${toInstall.length} package(s) to install`);
    toInstall.forEach(dep => addLog(`   • ${dep.name}`));

    let progressInterval: NodeJS.Timeout | null = null;
    try {
      addLog('📡 Calling installation API...');

      // Add a progress indicator while waiting for the API
      progressInterval = setInterval(() => {
        addLog('⏳ Installation in progress... (this may take 1-2 minutes)');
      }, 15000); // Every 15 seconds

      const response = await fetch('/api/local-processing/install', {
        method: 'POST',
      });

      if (progressInterval) clearInterval(progressInterval);

      const result = await response.json();
      console.log('[PREFLIGHT] Response data:', result);

      // Log each installed package
      if (result.installed && result.installed.length > 0) {
        addLog(`\n✅ Successfully installed ${result.installed.length} package(s):`);
        result.installed.forEach((pkg: string) => addLog(`   ✓ ${pkg}`));
      }

      // Log each failed package
      if (result.failed && result.failed.length > 0) {
        addLog(`\n❌ Failed to install ${result.failed.length} package(s):`);
        result.failed.forEach((pkg: string) => addLog(`   ✗ ${pkg}`));
        addLog('\n💡 Tip: Failed packages may be locked by another process.');
        addLog('   Try closing Python terminals and clicking "Re-check".');
      }

      if (result.success) {
        addLog('\n🎉 Installation completed successfully!');
        addLog('🔄 Re-checking dependencies...');
        // Clear cache and re-check dependencies
        clearDependencyCache();
        await checkDependencies(true); // Force refresh
        addLog('✅ Dependency check complete');
      } else {
        addLog('\n⚠️  Installation completed with errors');
        addLog('🔄 Re-checking dependencies...');
        // Re-check anyway to update status
        clearDependencyCache();
        await checkDependencies(true); // Force refresh
        addLog('✅ Dependency check complete');
      }
    } catch (err) {
      if (progressInterval) clearInterval(progressInterval);
      console.error('[PREFLIGHT] ✗ Failed to auto-install:', err);
      addLog(`\n❌ Error: ${err instanceof Error ? err.message : String(err)}`);
      addLog('💡 Please check the console for more details');
    } finally {
      console.log('[PREFLIGHT] Auto-install complete, resetting state');
      setInstalling(false);
    }
  };

  const handleProceed = () => {
    if (checkResult?.canProcess) {
      onProceed();
      onClose();
    }
  };

  const installFFmpeg = async () => {
    console.log('[PREFLIGHT] Starting FFmpeg installation...');
    addLog('🎬 Installing FFmpeg...');
    setInstallingFFmpeg(true);

    try {
      addLog('📡 Calling FFmpeg installation API...');
      const response = await fetch('/api/system-setup/install-ffmpeg', { method: 'POST' });
      const result = await response.json();

      if (result.success) {
        addLog(`✅ FFmpeg ${result.version} installed successfully using ${result.method}`);
        addLog('🔄 Re-checking dependencies...');
        clearDependencyCache();
        await checkDependencies(true); // Force refresh
        addLog('✅ Dependency check complete');
      } else {
        addLog(`❌ ${result.error}`);
        if (result.suggestions && result.suggestions.length > 0) {
          addLog('💡 Suggestions:');
          result.suggestions.forEach((s: string) => addLog(`   • ${s}`));
        }
      }
    } catch (err) {
      console.error('[PREFLIGHT] ✗ Failed to install FFmpeg:', err);
      addLog(`❌ Error: ${err instanceof Error ? err.message : String(err)}`);
      addLog('💡 Please try manual installation');
    } finally {
      console.log('[PREFLIGHT] FFmpeg installation complete');
      setInstallingFFmpeg(false);
    }
  };

  if (!isOpen) return null;

  const dependencyIcon = (dep: ProcessingDependency) => {
    switch (dep.status) {
      case 'ok':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
      case 'checking':
        return <Loader2 className="w-4 h-4 animate-spin text-blue-600" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-gray-400" />;
    }
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case 'python-package':
        return <Package className="w-3.5 h-3.5" />;
      case 'system-binary':
        return <Terminal className="w-3.5 h-3.5" />;
      case 'directory':
        return <FolderOpen className="w-3.5 h-3.5" />;
      default:
        return <Package className="w-3.5 h-3.5" />;
    }
  };

  const hasAutoFixable =
    checkResult?.dependencies.some(
      (dep) => dep.status === 'error' && dep.autoFixable
    ) || false;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Play className="w-5 h-5" />
              <div>
                <h1 className="text-lg font-semibold">
                  Pre-Flight Check
                  {usingCache && <span className="ml-2 text-xs font-normal text-purple-200">(cached)</span>}
                </h1>
                <p className="text-purple-100 text-sm mt-0.5">
                  {checkResult?.canProcess
                    ? usingCache
                      ? '✓ Ready (using cached result) - Starting in a moment...'
                      : 'Ready for local processing!'
                    : 'Checking local processing dependencies...'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-purple-100 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && !checkResult && (
            <div className="text-center py-8">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-purple-600" />
              <p className="text-sm text-gray-600">Checking dependencies...</p>
            </div>
          )}

          {checkResult && (
            <>
              {/* Summary */}
              <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="text-lg font-semibold text-green-600">
                      {checkResult.dependencies.filter((d) => d.status === 'ok').length}
                    </div>
                    <div className="text-xs text-gray-600">Ready</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-red-600">
                      {checkResult.errors.length}
                    </div>
                    <div className="text-xs text-gray-600">Missing</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold text-yellow-600">
                      {checkResult.warnings.length}
                    </div>
                    <div className="text-xs text-gray-600">Warnings</div>
                  </div>
                </div>
              </div>

              {/* Dependencies List */}
              <div className="space-y-2 mb-4">
                <h3 className="text-sm font-semibold text-gray-900">Required Dependencies</h3>
                {checkResult.dependencies.map((dep, idx) => (
                  <div
                    key={idx}
                    className={`border rounded-md overflow-hidden transition-all ${
                      dep.status === 'error'
                        ? 'border-red-200 bg-red-50'
                        : dep.status === 'warning'
                        ? 'border-yellow-200 bg-yellow-50'
                        : 'border-green-200 bg-green-50'
                    }`}
                  >
                    <div
                      className="p-3 flex items-center gap-2 cursor-pointer hover:bg-opacity-70"
                      onClick={() =>
                        setExpandedDep(expandedDep === dep.name ? null : dep.name)
                      }
                    >
                      {dependencyIcon(dep)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {typeIcon(dep.type)}
                          <h4 className="font-medium text-sm text-gray-900">{dep.name}</h4>
                          {!dep.required && (
                            <span className="text-xs px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">
                              Optional
                            </span>
                          )}
                          {dep.autoFixable && dep.status === 'error' && (
                            <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
                              Auto-installable
                            </span>
                          )}
                          {dep.version && (
                            <span className="text-xs text-gray-500">v{dep.version}</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 mt-0.5">{dep.description}</p>
                      </div>
                    </div>

                    {/* Expanded details */}
                    {expandedDep === dep.name && dep.status === 'error' && (
                      <div className="border-t px-3 py-2 bg-white">
                        <p className="text-xs text-red-700 mb-2">
                          <strong>Error:</strong> {dep.error}
                        </p>
                        {dep.name === 'FFmpeg' && (
                          <button
                            onClick={installFFmpeg}
                            disabled={installingFFmpeg}
                            className="mb-2 w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {installingFFmpeg ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Installing FFmpeg...
                              </>
                            ) : (
                              <>
                                <Download className="w-3.5 h-3.5" />
                                Install FFmpeg Automatically
                              </>
                            )}
                          </button>
                        )}
                        {dep.installCommand && (
                          <div className="text-xs text-gray-700 mt-2">
                            <strong>{dep.name === 'FFmpeg' ? 'Or install manually:' : 'Installation Command:'}</strong>
                            <div className="mt-1.5 p-2 bg-gray-900 text-green-400 rounded font-mono text-xs overflow-x-auto">
                              {dep.installCommand}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Errors */}
              {checkResult.errors.length > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md mb-3">
                  <h4 className="text-sm font-semibold text-red-900 mb-1.5 flex items-center gap-1.5">
                    <XCircle className="w-4 h-4" />
                    Missing Dependencies
                  </h4>
                  <ul className="text-xs text-red-800 space-y-0.5 ml-5">
                    {checkResult.errors.map((error, idx) => (
                      <li key={idx}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Suggestions */}
              {checkResult.suggestions.length > 0 && !installing && installLog.length === 0 && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                  <h4 className="text-sm font-semibold text-blue-900 mb-1.5 flex items-center gap-1.5">
                    <Download className="w-4 h-4" />
                    Installation Suggestions
                  </h4>
                  <ul className="text-xs text-blue-800 space-y-0.5 ml-5">
                    {checkResult.suggestions.map((suggestion, idx) => (
                      <li key={idx}>{suggestion}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Installation Log */}
              {(installing || installLog.length > 0) && (
                <div className="p-3 bg-gray-900 border border-gray-700 rounded-md">
                  <h4 className="text-sm font-semibold text-gray-100 mb-2 flex items-center gap-1.5">
                    <Terminal className="w-4 h-4" />
                    Installation Log
                    {installing && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                    )}
                  </h4>
                  <div className="bg-black rounded p-2 max-h-48 overflow-y-auto font-mono text-xs">
                    {installLog.length === 0 ? (
                      <div className="text-gray-500 italic text-xs">Waiting for installation to start...</div>
                    ) : (
                      <div className="space-y-0.5">
                        {installLog.map((log, idx) => (
                          <div
                            key={idx}
                            className={`${
                              log.includes('✅') || log.includes('✓')
                                ? 'text-green-400'
                                : log.includes('❌') || log.includes('✗')
                                ? 'text-red-400'
                                : log.includes('⚠️')
                                ? 'text-yellow-400'
                                : log.includes('💡')
                                ? 'text-blue-400'
                                : log.includes('🎉')
                                ? 'text-purple-400'
                                : 'text-gray-300'
                            }`}
                          >
                            {log}
                          </div>
                        ))}
                        <div ref={logEndRef} />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t bg-gray-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => checkDependencies(true)}
                disabled={loading || installing || installingFFmpeg}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Re-check
              </button>
              {usingCache && (
                <span className="text-xs text-gray-500 italic">
                  (using cached result)
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              >
                Cancel
              </button>

              {hasAutoFixable && !checkResult?.canProcess && (
                <button
                  onClick={handleAutoInstall}
                  disabled={installing || installingFFmpeg}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors disabled:opacity-50"
                >
                  {installing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Installing...
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5" />
                      Auto-Install Packages
                    </>
                  )}
                </button>
              )}

              {checkResult?.canProcess && (
                <button
                  onClick={handleProceed}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                >
                  <Play className="w-3.5 h-3.5" />
                  Start Processing
                </button>
              )}

              {!checkResult?.canProcess && !hasAutoFixable && (
                <div className="text-xs text-gray-600">
                  Install missing dependencies manually
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
