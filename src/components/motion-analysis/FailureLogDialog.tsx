'use client';

import React, { useState } from 'react';
import { X, Copy, CheckCircle, AlertTriangle, Download, Database } from 'lucide-react';

interface FailureLogDialogProps {
  runId: string;
  logs: string;
  onClose: () => void;
  onSaveToDatabase?: () => Promise<boolean>;
}

export default function FailureLogDialog({ runId, logs, onClose, onSaveToDatabase }: FailureLogDialogProps) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(logs);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy logs:', err);
      alert('Failed to copy logs to clipboard');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([logs], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `processing-${runId}-error.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    if (!onSaveToDatabase) return;

    setSaving(true);
    try {
      const success = await onSaveToDatabase();
      if (success) {
        setSaved(true);
      } else {
        alert('Failed to save logs to database');
      }
    } catch (err) {
      console.error('Error saving logs:', err);
      alert('Error saving logs to database');
    } finally {
      setSaving(false);
    }
  };

  // Extract error lines for quick summary
  const errorLines = logs.split('\n').filter(line =>
    line.includes('[ERROR]') ||
    line.includes('[STDERR]') ||
    line.includes('Traceback') ||
    line.includes('Error:')
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-red-50">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-red-600" />
            <div>
              <h2 className="text-lg font-semibold text-red-900">Processing Failed</h2>
              <p className="text-sm text-red-700">Run ID: {runId}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 transition-colors"
            title="Close"
          >
            <X size={24} />
          </button>
        </div>

        {/* Error Summary */}
        {errorLines.length > 0 && (
          <div className="px-6 py-4 bg-red-50 border-b border-red-200">
            <h3 className="text-sm font-semibold text-red-900 mb-2">Error Summary:</h3>
            <div className="bg-white rounded border border-red-200 p-3 max-h-32 overflow-y-auto">
              {errorLines.slice(0, 5).map((line, idx) => (
                <div key={idx} className="text-xs font-mono text-red-700 mb-1">
                  {line}
                </div>
              ))}
              {errorLines.length > 5 && (
                <div className="text-xs text-red-600 italic mt-2">
                  ... and {errorLines.length - 5} more error(s) in full log below
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors text-sm font-medium"
          >
            {copied ? (
              <>
                <CheckCircle size={16} />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <Copy size={16} />
                <span>Copy All Logs</span>
              </>
            )}
          </button>

          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors text-sm font-medium"
          >
            <Download size={16} />
            <span>Download Log File</span>
          </button>

          {onSaveToDatabase && (
            <button
              onClick={handleSave}
              disabled={saving || saved}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-green-300 disabled:cursor-not-allowed transition-colors text-sm font-medium"
            >
              {saved ? (
                <>
                  <CheckCircle size={16} />
                  <span>Saved to Database</span>
                </>
              ) : (
                <>
                  <Database size={16} />
                  <span>{saving ? 'Saving...' : 'Save to Database'}</span>
                </>
              )}
            </button>
          )}

          <div className="flex-1" />

          <div className="text-xs text-gray-600">
            {logs.split('\n').length} lines • {(logs.length / 1024).toFixed(1)} KB
          </div>
        </div>

        {/* Full Log Content */}
        <div className="flex-1 overflow-hidden px-6 py-4">
          <div className="h-full bg-gray-900 rounded border border-gray-700 overflow-auto">
            <pre className="p-4 text-xs font-mono text-gray-100 leading-relaxed">
              {logs.split('\n').map((line, idx) => {
                let lineClass = 'text-gray-300';
                if (line.includes('[ERROR]') || line.includes('[STDERR]')) {
                  lineClass = 'text-red-400 font-semibold';
                } else if (line.includes('[WARNING]')) {
                  lineClass = 'text-yellow-400 font-semibold';
                } else if (line.includes('[SUCCESS]')) {
                  lineClass = 'text-green-400 font-semibold';
                } else if (line.includes('Traceback')) {
                  lineClass = 'text-red-300 font-semibold';
                } else if (line.includes('Progress:')) {
                  lineClass = 'text-blue-400';
                }

                return (
                  <div key={idx} className={lineClass}>
                    {line || '\u00A0'}
                  </div>
                );
              })}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-between items-center">
          <p className="text-sm text-gray-600">
            Please copy this log and save it before closing this dialog.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors text-sm font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
