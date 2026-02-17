'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Upload, FileVideo, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

interface UploadedFile {
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
  videoId?: string;
}

interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
  speed: number; // bytes per second
  eta: number; // seconds remaining
}

interface VideoUploadSectionProps {
  onUploadComplete: () => void;
}

export default function VideoUploadSection({ onUploadComplete }: VideoUploadSectionProps) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const uploadStartTimeRef = useRef<number>(0);
  const lastLoadedRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    const videoFiles = droppedFiles.filter((file) =>
      file.type.startsWith('video/')
    );

    if (videoFiles.length === 0) {
      alert('Please drop video files only');
      return;
    }

    const newFiles = videoFiles.map((file) => ({
      file,
      status: 'pending' as const,
      progress: 0,
    }));

    setFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const videoFiles = selectedFiles.filter((file) =>
      file.type.startsWith('video/')
    );

    const newFiles = videoFiles.map((file) => ({
      file,
      status: 'pending' as const,
      progress: 0,
    }));

    setFiles((prev) => [...prev, ...newFiles]);
    e.target.value = ''; // Reset input
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  const uploadFiles = async () => {
    if (files.length === 0) return;

    setIsUploading(true);
    uploadStartTimeRef.current = Date.now();
    lastLoadedRef.current = 0;
    lastTimeRef.current = Date.now();

    const formData = new FormData();
    files.forEach((f) => formData.append('videos', f.file));

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const now = Date.now();
        const timeDiff = (now - lastTimeRef.current) / 1000; // seconds
        const bytesDiff = e.loaded - lastLoadedRef.current;

        // Calculate speed (use moving average for smoothing)
        const currentSpeed = timeDiff > 0 ? bytesDiff / timeDiff : 0;

        // Calculate ETA
        const remaining = e.total - e.loaded;
        const eta = currentSpeed > 0 ? remaining / currentSpeed : 0;

        setUploadProgress({
          loaded: e.loaded,
          total: e.total,
          percentage: Math.round((e.loaded / e.total) * 100),
          speed: currentSpeed,
          eta: eta,
        });

        // Update refs for next calculation
        lastLoadedRef.current = e.loaded;
        lastTimeRef.current = now;
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          if (result.success) {
            console.log(`Successfully uploaded ${result.uploaded} videos`);
            setFiles([]);
            setUploadProgress(null);
            onUploadComplete();
          } else {
            console.error('Upload failed:', result);
            console.error('Error details:', result.errors);
            // Show detailed error messages
            const errorMessages = result.errors?.map((e: any) =>
              `${e.filename}: ${e.error}`
            ).join('\n') || 'Unknown error';
            console.error('Formatted error messages:', errorMessages);
            alert(`Upload failed:\n\n${errorMessages}`);
          }
        } catch (e) {
          console.error('Failed to parse response:', e);
          alert('Failed to process server response. Check console for details.');
        }
      } else {
        console.error('Upload failed with status:', xhr.status, xhr.responseText);
        alert(`Upload failed with status ${xhr.status}. Please try again.`);
      }
      setIsUploading(false);
      setUploadProgress(null);
    });

    xhr.addEventListener('error', () => {
      console.error('Upload error');
      alert('Failed to upload videos. Please try again.');
      setIsUploading(false);
      setUploadProgress(null);
    });

    xhr.open('POST', '/api/motion-analysis/upload');
    xhr.send(formData);
  };

  const totalSize = files.reduce((sum, f) => sum + f.file.size, 0);
  const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Upload Videos</h2>

      {/* Drag-and-drop area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center transition-colors
          ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}
        `}
      >
        <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
        <p className="text-gray-600 mb-2">
          Drag and drop video files here, or{' '}
          <label className="text-blue-600 hover:text-blue-700 cursor-pointer font-medium">
            browse
            <input
              type="file"
              multiple
              accept="video/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </label>
        </p>
        <p className="text-sm text-gray-500">MP4, AVI, MOV supported</p>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-700">
              {files.length} file{files.length > 1 ? 's' : ''} selected ({totalSizeMB} MB)
            </p>
            <button
              onClick={() => setFiles([])}
              className="text-sm text-red-600 hover:text-red-700"
              disabled={isUploading}
            >
              Clear all
            </button>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto">
            {files.map((f, index) => (
              <div
                key={index}
                className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
              >
                <FileVideo className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {f.file.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {(f.file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                {f.status === 'pending' && !isUploading && (
                  <button
                    onClick={() => removeFile(index)}
                    className="p-1 text-gray-400 hover:text-gray-600"
                  >
                    <X size={18} />
                  </button>
                )}
                {f.status === 'success' && (
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                )}
                {f.status === 'error' && (
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                )}
              </div>
            ))}
          </div>

          {/* Upload progress bar */}
          {isUploading && uploadProgress && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-700 font-medium">
                  Uploading... {uploadProgress.percentage}%
                </span>
                <span className="text-gray-500">
                  {formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.total)}
                </span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-200 ease-out"
                  style={{ width: `${uploadProgress.percentage}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="font-medium">{formatBytes(uploadProgress.speed)}/s</span>
                </span>
                <span>
                  {uploadProgress.eta > 0 && `ETA: ${formatTime(uploadProgress.eta)}`}
                </span>
              </div>
            </div>
          )}

          <button
            onClick={uploadFiles}
            disabled={isUploading}
            className="mt-4 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center justify-center gap-2"
          >
            {isUploading && <Loader2 className="w-4 h-4 animate-spin" />}
            {isUploading
              ? `Uploading ${uploadProgress?.percentage || 0}%`
              : `Upload ${files.length} video${files.length > 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  );
}
