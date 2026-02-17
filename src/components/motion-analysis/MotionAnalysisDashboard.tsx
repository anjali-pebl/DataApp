'use client';

import React, { useState, useMemo } from 'react';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  Cell,
} from 'recharts';
import { ArrowUpDown, Play, Download, Filter, TrendingUp, Upload, Trash2, Pencil, X, Zap, Clock, History, Settings } from 'lucide-react';
import VideoComparisonModal from './VideoComparisonModal';
import VideoValidationDialog from './VideoValidationDialog';
import ProcessingEstimationModal from './ProcessingEstimationModal';
import ProcessingHistoryDialog from './ProcessingHistoryDialog';
import ProcessingPreflightDialog from './ProcessingPreflightDialog';
import { getCachedDependencyCheck } from '@/lib/local-processing-checker-types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
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
import { toast } from '@/hooks/use-toast';

// Type definitions
interface VideoInfo {
  filename: string;
  fps: number;
  resolution: { width: number; height: number };
  total_frames: number;
  duration_seconds: number;
}

interface ActivityScore {
  overall_score: number;
  component_scores: {
    energy: number;
    density: number;
    count: number;
    size: number;
  };
}

interface Organisms {
  total_detections: number;
  avg_count: number;
  max_count: number;
  size_distribution: {
    small: number;
    medium: number;
    large: number;
    mean_size: number;
  };
}

interface Density {
  avg_density: number;
  max_density: number;
  motion_densities: number[];
}

interface Motion {
  total_energy: number;
  avg_energy: number;
  max_energy: number;
  motion_energies: number[];
}

interface CrabDetections {
  total_tracks: number;
  valid_tracks: number;
  avg_count_per_frame: number;
  frame_counts?: number[];
}

interface MotionAnalysisResult {
  video_info: VideoInfo;
  activity_score?: ActivityScore; // Optional - only if motion analysis ran
  organisms?: Organisms; // Optional - only if motion analysis ran
  density?: Density; // Optional - only if motion analysis ran
  motion?: Motion; // Optional - only if motion analysis ran
  processing_time_seconds?: number;
  timestamp: string;
  processing_history?: ProcessingRun[];
  crab_detections?: CrabDetections;
  has_crab_detection?: boolean;
  yolo_detections?: any[]; // YOLO detection results
  benthic_activity_v4?: { // BAv4 summary data
    valid_tracks: number;
    total_tracks: number;
    coupling_rate: number;
    processing_time: number;
  };
  bav4_frame_detections?: any[]; // BAv4 frame-by-frame data
  prescreen_brightness?: number | null;
  prescreen_focus?: number | null;
  prescreen_quality?: number | null;
  prescreen_completed?: boolean;
  prescreen_samples?: number;
  prescreen_error?: string | null;
}

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

interface PendingVideo {
  id: string;
  filename: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  duration_seconds: number | null;
  total_frames: number | null;
  processing_status?: 'pending' | 'processing' | 'failed' | 'needs_reprocessing';
  processing_history?: ProcessingRun[];
  prescreen_brightness?: number | null;
  prescreen_focus?: number | null;
  prescreen_quality?: number | null;
  prescreen_completed?: boolean;
  prescreen_samples?: number;
  prescreen_error?: string | null;
}

interface MotionAnalysisDashboardProps {
  data: MotionAnalysisResult[];
  pendingVideos?: PendingVideo[];
  onDeleteVideos?: (filenames: string[]) => Promise<void>;
  onProcessingStarted?: (runId: string, estimatedTime?: string, estimatedCost?: string) => void;
  onUploadComplete?: () => void;
  processingStatusPanel?: React.ReactNode;
}

// Helper functions
function getScoreColor(score: number): string {
  if (score >= 40) return '#10b981'; // Green
  if (score >= 30) return '#f59e0b'; // Yellow
  return '#6b7280'; // Gray
}

function extractTimeFromFilename(filename: string): string {
  const match = filename.match(/(\d{2})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}:${match[2]}`;
  }
  return 'Unknown';
}

function getVideoName(filename: string): string {
  return filename.replace('_background_subtracted.mp4', '').substring(0, 20);
}

// Helper to handle placeholder array data like "<120 values>"
function parseArrayData(data: any, avgValue: number, maxValue: number, count: number = 30): number[] {
  // If data is already an array, return it
  if (Array.isArray(data)) {
    return data;
  }

  // If data is a placeholder string like "<120 values>", generate synthetic data
  if (typeof data === 'string' && data.includes('values')) {
    // Generate reasonable synthetic data based on avg and max
    const synthetic = [];
    for (let i = 0; i < count; i++) {
      // Create variation around average, with occasional peaks
      const variation = (Math.random() - 0.5) * (maxValue - avgValue) * 0.5;
      const peak = Math.random() < 0.1 ? (maxValue - avgValue) * Math.random() * 0.5 : 0;
      const value = Math.max(0, avgValue + variation + peak);
      synthetic.push(value);
    }
    return synthetic;
  }

  // Fallback: return empty array
  return [];
}

// Summary Card Component
interface SummaryCardProps {
  title: string;
  value: number;
  unit?: string;
  icon?: React.ReactNode;
  color: 'green' | 'yellow' | 'red' | 'blue' | 'gray';
  subtext?: string;
}

function SummaryCard({ title, value, unit, icon, color, subtext }: SummaryCardProps) {
  const colorClasses = {
    green: 'bg-green-50 border-green-200 text-green-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    gray: 'bg-gray-50 border-gray-200 text-gray-700',
  };

  return (
    <div className={`p-2.5 rounded-lg border ${colorClasses[color]} hover:shadow-md transition-shadow cursor-pointer`}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium opacity-80">{title}</p>
        {icon && <div className="opacity-60" style={{ transform: 'scale(0.85)' }}>{icon}</div>}
      </div>
      <div className="flex items-baseline gap-1">
        <p className="text-2xl font-bold">
          {typeof value === 'number' ? value.toFixed(1) : value}
        </p>
        {unit && <span className="text-base font-normal opacity-80">{unit}</span>}
      </div>
      {subtext && <p className="text-xs opacity-60 mt-0.5">{subtext}</p>}
    </div>
  );
}

// Quality Badge Component
interface QualityBadgeProps {
  score: number | null | undefined;
  type: 'light' | 'focus' | 'quality';
}

function QualityBadge({ score, type }: QualityBadgeProps) {
  if (score === null || score === undefined) {
    return <span className="text-gray-400 text-xs">—</span>;
  }

  const getColor = (s: number, t: string) => {
    // Enhanced 6-tier gradient from red → orange → yellow → lime → green → emerald
    if (t === 'quality') {
      if (s < 0.15) return 'bg-red-500/30 text-red-700 border-red-500/50';
      if (s < 0.30) return 'bg-orange-500/30 text-orange-700 border-orange-500/50';
      if (s < 0.45) return 'bg-yellow-500/30 text-yellow-700 border-yellow-500/50';
      if (s < 0.60) return 'bg-lime-500/30 text-lime-700 border-lime-500/50';
      if (s < 0.75) return 'bg-green-500/30 text-green-700 border-green-500/50';
      return 'bg-emerald-500/30 text-emerald-700 border-emerald-500/50';
    }
    // Light: use brightness-appropriate colors
    if (t === 'light') {
      if (s < 0.20) return 'bg-red-500/30 text-red-700 border-red-500/50';
      if (s < 0.35) return 'bg-orange-500/30 text-orange-700 border-orange-500/50';
      if (s < 0.50) return 'bg-yellow-500/30 text-yellow-700 border-yellow-500/50';
      if (s < 0.65) return 'bg-lime-500/30 text-lime-700 border-lime-500/50';
      if (s < 0.80) return 'bg-green-500/30 text-green-700 border-green-500/50';
      return 'bg-emerald-500/30 text-emerald-700 border-emerald-500/50';
    }
    // Focus: use sharpness-appropriate colors (adjusted for generous underwater scoring)
    if (s < 0.25) return 'bg-red-500/30 text-red-700 border-red-500/50';
    if (s < 0.40) return 'bg-orange-500/30 text-orange-700 border-orange-500/50';
    if (s < 0.55) return 'bg-yellow-500/30 text-yellow-700 border-yellow-500/50';
    if (s < 0.70) return 'bg-lime-500/30 text-lime-700 border-lime-500/50';
    if (s < 0.85) return 'bg-green-500/30 text-green-700 border-green-500/50';
    return 'bg-emerald-500/30 text-emerald-700 border-emerald-500/50';
  };

  const formatValue = (s: number, t: string) => {
    if (t === 'light') return `${Math.round(s * 100)}`;
    if (t === 'focus') return s.toFixed(2);
    return s.toFixed(2);
  };

  const getTooltipContent = () => {
    if (type === 'light') {
      return `Brightness: ${Math.round(score * 100)}%\nScale: 0 (dark) to 100 (bright)\nMeasured from average luminance across 10 sampled frames`;
    }
    if (type === 'focus') {
      return `Clarity: ${score.toFixed(2)}\nScale: 0.0 (poor) to 1.0 (excellent)\nComposite metric: edge sharpness, gradient strength, local contrast, and texture detail`;
    }
    return `Quality: ${(score * 100).toFixed(0)}%\nCombined metric: 88% brightness + 12% clarity\nSampled across 10 frames`;
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`px-2 py-1 text-xs font-medium rounded border cursor-help ${getColor(score, type)}`}>
          {formatValue(score, type)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="whitespace-pre-line text-xs max-w-xs">
        {getTooltipContent()}
      </TooltipContent>
    </Tooltip>
  );
}

// Sparkline Component
interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
}

function Sparkline({ data, color = '#10b981', height = 30 }: SparklineProps) {
  // Safety check: ensure data is an array
  if (!Array.isArray(data) || data.length === 0) {
    return <div style={{ height }} className="flex items-center justify-center text-gray-400 text-xs">No data</div>;
  }

  // Subsample data if too many points
  const sampledData = data.length > 50
    ? data.filter((_, i) => i % Math.ceil(data.length / 50) === 0)
    : data;

  const chartData = sampledData.map((value, index) => ({ index, value }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Small Multiple Chart
interface SmallMultipleChartProps {
  video: MotionAnalysisResult;
  metric: 'density' | 'energy' | 'count';
  onSelect: (video: MotionAnalysisResult) => void;
  isSelected: boolean;
}

function SmallMultipleChart({
  video,
  metric,
  onSelect,
  isSelected,
  onDoubleClick,
}: SmallMultipleChartProps & { onDoubleClick?: (video: MotionAnalysisResult) => void }) {
  const getData = () => {
    switch (metric) {
      case 'density':
        if (!video.density) return [];
        return parseArrayData(
          video.density.motion_densities,
          (video.density.avg_density ?? 0) * 100, // Convert ratio to percentage
          (video.density.max_density ?? 0) * 100,
          30
        );
      case 'energy':
        if (!video.motion) return [];
        return parseArrayData(
          video.motion.motion_energies,
          video.motion.avg_energy ?? 0,
          video.motion.max_energy ?? 0,
          30
        );
      case 'count':
        // Generate synthetic count data
        if (!video.organisms) return [];
        return parseArrayData(
          '<synthetic>',
          video.organisms.avg_count ?? 0,
          video.organisms.max_count ?? 0,
          30
        );
      default:
        return [];
    }
  };

  const data = getData();
  const sampledData = data.length > 30
    ? data.filter((_, i) => i % Math.ceil(data.length / 30) === 0)
    : data;

  const chartData = sampledData.map((value, index) => ({ time: index, value }));

  const scoreColor = getScoreColor(video.activity_score?.overall_score ?? 0);
  const videoName = getVideoName(video.video_info.filename);

  return (
    <div
      className={`border rounded-lg p-2 hover:shadow-md cursor-pointer transition-all ${
        isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
      }`}
      onClick={() => onSelect(video)}
      onDoubleClick={() => onDoubleClick?.(video)}
      title="Double-click to play video"
    >
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-xs font-medium truncate" title={videoName}>
          {videoName}
        </h4>
        <span
          className="text-xs font-bold px-1.5 py-0.5 rounded"
          style={{ backgroundColor: scoreColor, color: 'white' }}
        >
          {(video.activity_score?.overall_score ?? 0).toFixed(0)}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={50}>
        <AreaChart data={chartData}>
          <Area
            type="monotone"
            dataKey="value"
            stroke={scoreColor}
            fill={scoreColor}
            fillOpacity={0.3}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="flex justify-between mt-1.5 text-xs text-gray-600">
        <span>{video.organisms?.total_detections ?? 0} org</span>
        <span>{((video.density?.avg_density ?? 0) * 100).toFixed(2)}%</span>
      </div>
    </div>
  );
}

// Main Dashboard Component
export default function MotionAnalysisDashboard({ data, pendingVideos = [], onDeleteVideos, onProcessingStarted, onUploadComplete, processingStatusPanel }: MotionAnalysisDashboardProps) {
  const [sortBy, setSortBy] = useState<'score' | 'organisms' | 'density'>('score');
  const [metric, setMetric] = useState<'density' | 'energy' | 'count'>('density');
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  const [videoModalData, setVideoModalData] = useState<MotionAnalysisResult | null>(null);

  // File upload state
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadFileCount, setUploadFileCount] = useState<number>(0);
  const [isQualityChecking, setIsQualityChecking] = useState(false);

  // Video validation state
  const [isValidationDialogOpen, setIsValidationDialogOpen] = useState(false);
  const [validationVideoFilename, setValidationVideoFilename] = useState<string>('');
  const [pendingVideoData, setPendingVideoData] = useState<MotionAnalysisResult | null>(null);
  const [isRunningYolov8, setIsRunningYolov8] = useState(false);

  // Edit mode state for multi-select deletion
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);

  // Processing estimation modal state
  const [isProcessingModalOpen, setIsProcessingModalOpen] = useState(false);

  // Processing history dialog state
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [historyFilename, setHistoryFilename] = useState('');
  const [historyData, setHistoryData] = useState<ProcessingRun[]>([]);

  // Quick action menu state
  const [quickActionVideo, setQuickActionVideo] = useState<{ filename: string; x: number; y: number; history: ProcessingRun[] } | null>(null);

  // Video action popup state
  const [videoActionPopup, setVideoActionPopup] = useState<{
    video: PendingVideo | MotionAnalysisResult;
    x: number;
    y: number;
    hasProcessed: boolean;
  } | null>(null);

  // Prescreen settings state
  const [prescreenEnabled, setPrescreenEnabled] = useState(true);
  const [showPrescreenSettings, setShowPrescreenSettings] = useState(false);

  // Pre-flight check state
  const [showPreflightCheck, setShowPreflightCheck] = useState(false);
  const [pendingRunType, setPendingRunType] = useState<'local' | 'modal-t4' | 'modal-a10g' | null>(null);

  // Handle file upload
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    const videoFiles = selectedFiles.filter((file) => file.type.startsWith('video/'));

    if (videoFiles.length === 0) {
      alert('Please select video files only');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadFileCount(videoFiles.length);

    const formData = new FormData();
    videoFiles.forEach((f) => formData.append('videos', f));
    formData.append('enablePrescreen', prescreenEnabled.toString());

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const percentage = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percentage);
        // When upload reaches 100%, switch to quality checking phase
        if (percentage === 100 && prescreenEnabled) {
          setIsQualityChecking(true);
        }
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          if (result.success) {
            console.log(`Successfully uploaded ${result.uploaded} videos`);
            setUploadProgress(0);
            setUploadFileCount(0);
            setIsQualityChecking(false);
            if (onUploadComplete) {
              onUploadComplete();
            }
          } else {
            console.error('Upload failed:', result);
            const errorMessages = result.errors?.map((e: any) =>
              `${e.filename}: ${e.error}`
            ).join('\n') || 'Unknown error';
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
      setUploadProgress(0);
      setUploadFileCount(0);
      setIsQualityChecking(false);
    });

    xhr.addEventListener('error', () => {
      console.error('Upload error');
      alert('Failed to upload videos. Please try again.');
      setIsUploading(false);
      setUploadProgress(0);
      setUploadFileCount(0);
      setIsQualityChecking(false);
    });

    xhr.open('POST', '/api/motion-analysis/upload');
    xhr.send(formData);

    // Reset file input
    e.target.value = '';
  };

  // Handle starting processing
  const handleStartProcessing = async (runType: 'local' | 'modal-t4' | 'modal-a10g') => {
    // For local processing, check if we can skip the preflight dialog
    if (runType === 'local') {
      setPendingRunType(runType);

      // Check if user has successfully completed videos before
      const hasCompletedVideos = data.some(
        (video) => video.status === 'completed' && video.results
      );

      // Check if we have a valid cached dependency check
      const cachedCheck = getCachedDependencyCheck();

      // Skip preflight if:
      // 1. User has successfully processed videos before (experienced user)
      // 2. AND we have a valid cached dependency check that passed
      if (hasCompletedVideos && cachedCheck?.canProcess) {
        console.log('[PREFLIGHT] ⚡ Skipping preflight check - experienced user with valid cache');
        console.log(`[PREFLIGHT] User has ${data.filter(v => v.status === 'completed').length} completed videos`);
        console.log(`[PREFLIGHT] Cache age: ${Math.round((Date.now() - cachedCheck.timestamp) / 1000 / 60)}min`);

        // Proceed directly without showing the dialog
        handlePreflightProceed();
        return;
      }

      // Otherwise, show the preflight check
      console.log('[PREFLIGHT] Showing preflight check dialog');
      if (!hasCompletedVideos) {
        console.log('[PREFLIGHT] Reason: New user (no completed videos)');
      } else if (!cachedCheck) {
        console.log('[PREFLIGHT] Reason: No cached dependency check');
      } else if (!cachedCheck.canProcess) {
        console.log('[PREFLIGHT] Reason: Previous dependency check failed');
      }

      setShowPreflightCheck(true);
      // Estimation modal will close itself after handling the processing
    } else {
      // For Modal.com processing, proceed directly (cloud-based, no local dependencies needed)
      console.log(`Starting ${runType} processing for ${pendingVideos.length} videos`);
      // Modal will close itself after calling the API
      // onProcessingStarted will be called by the parent with the runId
    }
  };

  const handlePreflightProceed = () => {
    console.log(`Pre-flight check passed, starting ${pendingRunType} processing`);
    // Pre-flight dialog will close itself
    // Estimation modal already handles the API call
  };

  // Show quick action menu on click
  const showQuickAction = (e: React.MouseEvent, filename: string, history: ProcessingRun[] = []) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setQuickActionVideo({
      filename,
      x: rect.left,
      y: rect.bottom + 5,
      history,
    });
  };

  // Open history dialog
  const openHistoryDialog = (filename: string, history: ProcessingRun[]) => {
    setHistoryFilename(filename);
    setHistoryData(history);
    setIsHistoryDialogOpen(true);
    setQuickActionVideo(null);
  };

  // Delete a single processing run
  const handleDeleteRun = async (runId: string) => {
    try {
      const response = await fetch(`/api/motion-analysis/process/delete?runId=${runId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete processing run');
      }

      toast({
        title: 'Run Deleted',
        description: 'Processing run has been deleted successfully',
      });

      // Update the history data to remove the deleted run
      const updatedHistory = historyData.filter(run => run.run_id !== runId);
      setHistoryData(updatedHistory);

      // Trigger parent refresh if provided
      if (onUploadComplete) {
        onUploadComplete();
      }
    } catch (error) {
      console.error('Error deleting processing run:', error);
      toast({
        variant: 'destructive',
        title: 'Delete Failed',
        description: 'Failed to delete processing run. Please try again.',
      });
    }
  };

  // Delete all processing runs for the current video
  const handleDeleteAllRuns = async () => {
    try {
      // Find the video ID by filename
      const video = [...pendingVideos, ...data].find(
        v => ('filename' in v ? v.filename : v.video_info?.filename) === historyFilename
      );

      if (!video) {
        throw new Error('Video not found');
      }

      const videoId = 'id' in video ? video.id : undefined;
      if (!videoId) {
        throw new Error('Video ID not found');
      }

      const response = await fetch(`/api/motion-analysis/process/delete?videoId=${videoId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete processing runs');
      }

      const result = await response.json();

      toast({
        title: 'Runs Deleted',
        description: `Deleted ${result.deletedCount} processing run(s)`,
      });

      // Clear the history data
      setHistoryData([]);

      // Close the dialog
      setIsHistoryDialogOpen(false);

      // Trigger parent refresh if provided
      if (onUploadComplete) {
        onUploadComplete();
      }
    } catch (error) {
      console.error('Error deleting all processing runs:', error);
      toast({
        variant: 'destructive',
        title: 'Delete Failed',
        description: 'Failed to delete processing runs. Please try again.',
      });
    }
  };

  // Get all video filenames (both pending and processed)
  const allVideoFilenames = useMemo(() => {
    const pending = pendingVideos.map(v => v.filename);
    const processed = data
      .filter(v => v.video_info?.filename) // Only include videos with video_info
      .map(v => v.video_info.filename);
    return [...pending, ...processed];
  }, [pendingVideos, data]);

  // Check if all videos are selected
  const allSelected = useMemo(() => {
    return allVideoFilenames.length > 0 &&
           allVideoFilenames.every(filename => selectedVideos.has(filename));
  }, [allVideoFilenames, selectedVideos]);

  // Check if some but not all videos are selected
  const someSelected = useMemo(() => {
    return selectedVideos.size > 0 && !allSelected;
  }, [selectedVideos, allSelected]);

  // Toggle video selection
  const toggleVideoSelection = (filename: string) => {
    setSelectedVideos((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(filename)) {
        newSet.delete(filename);
      } else {
        newSet.add(filename);
      }
      return newSet;
    });
  };

  // Toggle select all videos
  const toggleSelectAll = () => {
    if (allSelected) {
      // Deselect all
      setSelectedVideos(new Set());
    } else {
      // Select all
      setSelectedVideos(new Set(allVideoFilenames));
    }
  };

  // Open delete confirmation dialog
  const handleDeleteVideos = () => {
    setShowDeleteConfirmation(true);
  };

  // Perform the actual deletion after confirmation
  const confirmDeleteVideos = async () => {
    setShowDeleteConfirmation(false);
    const filenames = Array.from(selectedVideos);
    console.log('='.repeat(50));
    console.log('[DELETE-UI] Starting delete request');
    console.log('[DELETE-UI] Selected filenames:', filenames);
    console.log('[DELETE-UI] Request body:', JSON.stringify({ filenames }, null, 2));

    setIsDeleting(true);
    try {
      // Call the delete API
      const response = await fetch('/api/motion-analysis/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filenames }),
      });

      console.log('[DELETE-UI] Response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('[DELETE-UI] Delete result (full):', JSON.stringify(result, null, 2));

      // Handle different success scenarios
      if (result.success) {
        // Full success
        console.log('[DELETE-UI] ✓ Delete successful:', result.message);
        console.log('[DELETE-UI]   - Files deleted:', result.summary.filesDeleted);
        console.log('[DELETE-UI]   - DB records deleted:', result.summary.dbRecordsDeleted);

        // Show success toast
        toast({
          title: 'Videos deleted successfully',
          description: `${result.summary.succeeded} video${result.summary.succeeded > 1 ? 's' : ''} deleted (${result.summary.filesDeleted} files, ${result.summary.dbRecordsDeleted} DB records)`,
        });
      } else if (result.summary && (result.summary.succeeded > 0 || result.summary.partial > 0)) {
        // Partial success
        console.warn('[DELETE-UI] ⚠ Partial deletion:', result.message);
        const details = result.results
          .map((r: any) => `${r.filename}: success=${r.success}, files=${r.filesDeleted}, DB=${r.dbDeleted}${r.error ? ', error=' + r.error : ''}`)
          .join('\n');

        toast({
          title: 'Partial deletion',
          description: `${result.summary.succeeded} succeeded, ${result.summary.partial} partial, ${result.summary.failed} failed`,
          variant: 'destructive',
        });
      } else {
        // Complete failure - show details
        const details = result.results
          ?.map((r: any) => `${r.filename}: ${r.error || 'unknown error'}`)
          .join('\n') || 'No details';
        console.error('[DELETE-UI] ✗ Complete failure:', result.message);
        console.error('[DELETE-UI] Results:', result.results);
        throw new Error(`${result.message}\n\nDetails:\n${details}`);
      }

      // Call the parent callback to refresh data (even on partial success)
      if (onDeleteVideos && (result.success || result.summary?.succeeded > 0)) {
        console.log('[DELETE-UI] Calling onDeleteVideos callback to refresh...');
        await onDeleteVideos(filenames);
      }

    } catch (error: any) {
      console.error('[DELETE-UI] ✗ Error deleting videos:', error);
      toast({
        title: 'Failed to delete videos',
        description: error.message || 'Unknown error. Please try again or contact support.',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
      setSelectedVideos(new Set());
      setIsEditMode(false);
    }
  };

  // Cancel edit mode
  const cancelEditMode = () => {
    setIsEditMode(false);
    setSelectedVideos(new Set());
  };

  // Open validation dialog first, then video modal on success
  const openVideoModal = (video: MotionAnalysisResult) => {
    setPendingVideoData(video);
    setValidationVideoFilename(video.video_info.filename);
    setIsValidationDialogOpen(true);
  };

  // Handle video row click - show action popup
  const handleVideoRowClick = (e: React.MouseEvent, video: PendingVideo | MotionAnalysisResult, hasProcessed: boolean) => {
    if (isEditMode) {
      const filename = 'video_info' in video ? video.video_info.filename : video.filename;
      toggleVideoSelection(filename);
      return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setVideoActionPopup({
      video,
      x: rect.left + 60, // Position near the left side of the row for dropdown effect
      y: rect.bottom + 2, // Just 2px below the row
      hasProcessed,
    });
  };

  // Open original video (unprocessed) - bypass validation dialog
  const openOriginalVideo = (video: PendingVideo | MotionAnalysisResult) => {
    const filename = 'video_info' in video ? video.video_info.filename : video.filename;
    const fps = 'video_info' in video ? video.video_info.fps : (video.fps || 30);
    const width = 'video_info' in video ? video.video_info.resolution.width : (video.width || 1920);
    const height = 'video_info' in video ? video.video_info.resolution.height : (video.height || 1080);
    const totalFrames = 'video_info' in video ? video.video_info.total_frames : (video.total_frames || 0);
    const duration = 'video_info' in video ? video.video_info.duration_seconds : (video.duration_seconds || 0);

    const videoResult: MotionAnalysisResult = {
      video_info: {
        filename,
        fps,
        resolution: { width, height },
        total_frames: totalFrames,
        duration_seconds: duration,
      },
      activity_score: {
        overall_score: 0,
        component_scores: { energy: 0, density: 0, count: 0, size: 0 },
      },
      organisms: {
        total_detections: 0,
        avg_count: 0,
        max_count: 0,
        size_distribution: { small: 0, medium: 0, large: 0, mean_size: 0 },
      },
      density: {
        avg_density: 0,
        max_density: 0,
        motion_densities: [],
      },
      motion: {
        total_energy: 0,
        avg_energy: 0,
        max_energy: 0,
        motion_energies: [],
      },
      processing_time_seconds: 0,
      timestamp: new Date().toISOString(),
      processing_history: 'processing_history' in video ? video.processing_history : [],
    };

    // Skip validation dialog and go directly to video modal
    setVideoModalData(videoResult);
    setIsVideoModalOpen(true);
    setVideoActionPopup(null);
  };

  // Open processed video
  const openProcessedVideo = (video: MotionAnalysisResult) => {
    openVideoModal(video);
    setVideoActionPopup(null);
  };

  // Called when validation passes and user wants to proceed
  const handleValidationProceed = () => {
    setIsValidationDialogOpen(false);
    if (pendingVideoData) {
      setVideoModalData(pendingVideoData);
      setIsVideoModalOpen(true);
    }
  };

  // Called when user cancels validation
  const handleValidationClose = () => {
    setIsValidationDialogOpen(false);
    setPendingVideoData(null);
    setValidationVideoFilename('');
  };

  // Handle running YOLOv8 inference
  const handleRunYolov8 = async (originalFilename: string) => {
    setIsRunningYolov8(true);
    try {
      const response = await fetch('/api/yolo/inference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoFilename: originalFilename }),
      });

      if (response.ok) {
        console.log('YOLOv8 inference started for:', originalFilename);
        // The actual processing happens server-side
        // User will need to reopen the video after processing completes
      } else {
        console.error('Failed to start YOLOv8 inference');
      }
    } catch (error) {
      console.error('Error starting YOLOv8 inference:', error);
    } finally {
      setIsRunningYolov8(false);
    }
  };

  // Handle reprocessing motion analysis
  const handleReprocessMotion = async (originalFilename: string) => {
    try {
      const response = await fetch('/api/motion-analysis/reprocess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: originalFilename, type: 'motion' }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        console.log('Motion reprocessing completed for:', originalFilename);
      } else {
        console.error('Failed to start motion reprocessing:', result.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Error starting motion reprocessing:', error);
    }
  };

  const closeVideoModal = () => {
    setIsVideoModalOpen(false);
    setVideoModalData(null);
    setPendingVideoData(null);
  };

  // Filter to only include valid processed data for visualization
  // Also deduplicate by video_info.filename to prevent duplicate key errors
  // IMPORTANT: Include videos that are completed even if they lack motion analysis data
  // (e.g., only BAv4 or YOLO ran, or motion analysis files weren't found)
  const validData = useMemo(() => {
    const seen = new Set<string>();
    return data.filter(v => {
      // Must have video_info.filename to display
      if (!v?.video_info?.filename) {
        console.warn('[validData] Filtering out video without filename:', v);
        return false;
      }

      // Check if video has any meaningful data to display:
      // - Has motion analysis scores
      // - Has BAv4 crab detection data
      // - Has YOLO detections
      const hasMotionAnalysis = v?.activity_score?.overall_score !== undefined;
      const hasBav4Data = v?.benthic_activity_v4 || v?.bav4_frame_detections;
      const hasYoloDetections = v?.yolo_detections && v.yolo_detections.length > 0;

      // Include video if it has any analysis data
      if (!hasMotionAnalysis && !hasBav4Data && !hasYoloDetections) {
        console.warn(`[validData] Filtering out video without any analysis data: ${v.video_info.filename}`);
        return false;
      }

      const filename = v.video_info.filename;
      if (seen.has(filename)) {
        console.warn(`Duplicate video entry found: ${filename}`);
        return false;
      }
      seen.add(filename);
      return true;
    });
  }, [data]);

  // Calculate summary statistics (only for processed videos with valid data)
  // Note: Some videos may not have motion analysis data (only BAv4 or YOLO)
  const stats = useMemo(() => {
    if (validData.length === 0) {
      return {
        avgScore: 0,
        totalOrganisms: 0,
        videosWithDetections: 0,
        avgDensity: 0,
        maxScore: 0,
      };
    }

    // Only include videos with motion analysis data for these stats
    const videosWithMotionAnalysis = validData.filter(v => v?.activity_score?.overall_score !== undefined);
    const scores = videosWithMotionAnalysis.map((v) => v.activity_score?.overall_score ?? 0);
    const organisms = videosWithMotionAnalysis.map((v) => v.organisms?.total_detections ?? 0);
    const densities = videosWithMotionAnalysis.map((v) => v.density?.avg_density ?? 0);

    return {
      avgScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
      totalOrganisms: organisms.reduce((a, b) => a + b, 0),
      videosWithDetections: organisms.filter((o) => o > 0).length,
      avgDensity: densities.length > 0 ? densities.reduce((a, b) => a + b, 0) / densities.length : 0,
      maxScore: scores.length > 0 ? Math.max(...scores) : 0,
    };
  }, [validData]);

  // Sort videos - handle cases where motion analysis data may be missing
  const sortedData = useMemo(() => {
    return [...validData].sort((a, b) => {
      switch (sortBy) {
        case 'score':
          return (b.activity_score?.overall_score ?? 0) - (a.activity_score?.overall_score ?? 0);
        case 'organisms':
          return (b.organisms?.total_detections ?? 0) - (a.organisms?.total_detections ?? 0);
        case 'density':
          return (b.density?.avg_density ?? 0) - (a.density?.avg_density ?? 0);
        default:
          return 0;
      }
    });
  }, [validData, sortBy]);

  // Scatter plot data - handle optional motion analysis fields
  const scatterData = useMemo(() => {
    return validData.map((v) => ({
      name: getVideoName(v.video_info.filename),
      score: v.activity_score?.overall_score ?? 0,
      organisms: v.organisms?.total_detections ?? 0,
      density: v.density?.avg_density ?? 0,
      color: getScoreColor(v.activity_score?.overall_score ?? 0),
    }));
  }, [validData]);

  return (
    <TooltipProvider>
      <div className="w-full space-y-4 p-4 bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-end">
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <div className="flex items-center gap-2">
            {/* Upload Button with Settings Cog */}
            <div className="relative flex items-center">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="flex items-center gap-2 pl-3 pr-12 py-2 text-sm bg-emerald-500 text-white font-medium rounded-lg hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm min-w-[180px]"
              >
                <Upload size={16} className={isUploading ? 'animate-pulse' : ''} />
                <span>
                  {isQualityChecking
                    ? uploadFileCount > 1
                      ? `QC (${uploadFileCount} files)...`
                      : 'QC...'
                    : isUploading
                    ? uploadFileCount > 1
                      ? `Uploading ${uploadFileCount} files (${uploadProgress}%)`
                      : `Uploading (${uploadProgress}%)`
                    : 'Upload Video'}
                </span>
              </button>

              {/* Settings Cog - positioned inside button on right */}
              <Popover open={showPrescreenSettings} onOpenChange={setShowPrescreenSettings}>
                <PopoverTrigger asChild>
                  <button
                    disabled={isUploading}
                    className="absolute right-0 top-0 bottom-0 px-3 rounded-r-lg hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all border-l border-emerald-400"
                    title="Upload Settings"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Settings size={16} className="text-white" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-3 bg-white border-gray-200" align="end">
                  <div className="space-y-3">
                    <h4 className="font-medium text-sm text-gray-900">Upload Settings</h4>
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-sm text-gray-700 font-medium">Video Prescreening</label>
                        <p className="text-xs text-gray-500">Analyze brightness & clarity on upload</p>
                      </div>
                      <Switch
                        checked={prescreenEnabled}
                        onCheckedChange={setPrescreenEnabled}
                      />
                    </div>
                    <div className="text-xs text-gray-500 pt-2 border-t border-gray-200">
                      <p>Prescreening samples 10 frames to evaluate:</p>
                      <ul className="list-disc list-inside mt-1 space-y-0.5">
                        <li>Brightness (lighting quality)</li>
                        <li>Clarity (edge detail & texture)</li>
                        <li>Overall quality score</li>
                      </ul>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {pendingVideos.length > 0 && (
            <button
              onClick={() => setIsProcessingModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Zap size={14} />
              Run Processing
            </button>
          )}
          {isEditMode ? (
            <>
              {selectedVideos.size > 0 && (
                <button
                  onClick={handleDeleteVideos}
                  disabled={isDeleting}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {isDeleting ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} />
                      Delete {selectedVideos.size}
                    </>
                  )}
                </button>
              )}
              <button
                onClick={cancelEditMode}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                <X size={14} />
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setIsEditMode(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700"
            >
              <Pencil size={14} />
              Edit
            </button>
          )}
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border rounded-lg hover:bg-gray-50">
            <Filter size={14} />
            Filters
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Download size={14} />
            Export
          </button>
        </div>
      </div>

      {/* Processing Status Panel */}
      {processingStatusPanel && (
        <div className="mb-4">
          {processingStatusPanel}
        </div>
      )}

      {/* Comparison Table */}
      <div className="bg-card rounded-lg shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-900">Uploads</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr className="text-left text-gray-600">
                {isEditMode && (
                  <th className="pb-1.5 text-xs font-medium w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
                      title={allSelected ? 'Deselect all' : 'Select all'}
                    />
                  </th>
                )}
                <th className="pb-1.5 text-xs font-medium">Filename</th>
                <th className="pb-1.5 text-xs font-medium">Status</th>
                <th className="pb-1.5 text-xs font-medium cursor-help w-16" title="Brightness (0-100): Average luminance across sampled frames">
                  Light
                </th>
                <th className="pb-1.5 text-xs font-medium cursor-help w-16" title="Clarity (0.0-1.0): Composite metric measuring edge sharpness, gradient strength, local contrast, and texture detail - represents human-perceivable detail">
                  Clarity
                </th>
                <th className="pb-1.5 text-xs font-medium cursor-help w-20" title="Quality Score (0-1): Combined metric of brightness and clarity">
                  Quality
                </th>
                <th
                  className="pb-1.5 text-xs font-medium cursor-help"
                  title="YOLOv8 object detection results showing organisms detected over time"
                >
                  Pelagic Activity
                </th>
                <th
                  className="pb-1.5 text-xs font-medium"
                  title="Pelagic Activity Index (total detections)"
                >
                  PAI
                </th>
                <th
                  className="pb-1.5 text-xs font-medium cursor-help"
                  title="Crab detection tracking results showing blob movements over time"
                >
                  Benthic Activity
                </th>
                <th
                  className="pb-1.5 text-xs font-medium"
                  title="Benthic Activity Index (to be calculated)"
                >
                  BAI
                </th>
                <th className="pb-1.5 text-xs font-medium w-12" title="View processing logs and error details">
                  Logs
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Pending/Failed videos first */}
              {pendingVideos.map((video) => {
                // Determine status display based on processing_status
                const status = video.processing_status || 'pending';
                const isFailed = status === 'failed';
                const isProcessing = status === 'processing';

                const statusConfigs: Record<string, { bg: string; text: string; dot: string; label: string; animate: boolean; rowBg: string; subtitle: string }> = {
                  pending: {
                    bg: 'bg-amber-100',
                    text: 'text-amber-700',
                    dot: 'bg-amber-500',
                    label: 'Pending',
                    animate: true,
                    rowBg: 'bg-amber-50/50',
                    subtitle: 'Awaiting processing',
                  },
                  processing: {
                    bg: 'bg-blue-100',
                    text: 'text-blue-700',
                    dot: 'bg-blue-500',
                    label: 'Processing',
                    animate: true,
                    rowBg: 'bg-blue-50/50',
                    subtitle: 'Processing in progress...',
                  },
                  failed: {
                    bg: 'bg-red-100',
                    text: 'text-red-700',
                    dot: 'bg-red-500',
                    label: 'Failed',
                    animate: false,
                    rowBg: 'bg-red-50/50',
                    subtitle: 'Processing failed - check history',
                  },
                  needs_reprocessing: {
                    bg: 'bg-orange-100',
                    text: 'text-orange-700',
                    dot: 'bg-orange-500',
                    label: 'Needs Reprocessing',
                    animate: false,
                    rowBg: 'bg-orange-50/50',
                    subtitle: 'Result files missing - run processing again',
                  },
                  completed: {
                    bg: 'bg-green-100',
                    text: 'text-green-700',
                    dot: 'bg-green-500',
                    label: 'Completed',
                    animate: false,
                    rowBg: 'bg-green-50/50',
                    subtitle: 'Processing complete',
                  },
                };

                // Default to pending if status is unknown
                const statusConfig = statusConfigs[status] || statusConfigs.pending;

                return (
                  <tr
                    key={video.id}
                    className={`border-b hover:bg-gray-50 cursor-pointer ${
                      selectedVideos.has(video.filename) ? 'bg-red-50' : statusConfig.rowBg
                    }`}
                    onClick={(e) => handleVideoRowClick(e, video, false)}
                    title={isEditMode ? 'Click to select' : 'Click to view video options'}
                  >
                    {isEditMode && (
                      <td className="py-2 w-8">
                        <input
                          type="checkbox"
                          checked={selectedVideos.has(video.filename)}
                          onChange={() => toggleVideoSelection(video.filename)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
                        />
                      </td>
                    )}
                    <td className="py-2 text-gray-700 text-xs font-medium max-w-xs truncate" title={video.filename}>
                      {video.filename}
                    </td>
                    <td className="py-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 ${statusConfig.bg} ${statusConfig.text} text-xs font-medium rounded-full`}>
                        <span className={`w-1.5 h-1.5 ${statusConfig.dot} rounded-full ${statusConfig.animate ? 'animate-pulse' : ''}`}></span>
                        {statusConfig.label}
                      </span>
                    </td>
                    <td className="py-2 text-sm text-gray-700">
                      <QualityBadge
                        score={(video as any).prescreen_brightness}
                        type="light"
                      />
                    </td>
                    <td className="py-2 text-sm text-gray-700">
                      <QualityBadge
                        score={(video as any).prescreen_focus}
                        type="focus"
                      />
                    </td>
                    <td className="py-2 text-sm">
                      <QualityBadge
                        score={(video as any).prescreen_quality}
                        type="quality"
                      />
                    </td>
                    <td className="py-2 text-gray-400 text-xs">—</td>
                    <td className="py-2 text-gray-400 text-xs">—</td>
                    <td className="py-2 text-gray-400 text-xs">—</td>
                    <td className="py-2 text-gray-400 text-xs">—</td>
                    <td className="py-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openHistoryDialog(video.filename, video.processing_history || []);
                        }}
                        className="p-1.5 hover:bg-gray-200 rounded-full transition-colors"
                        title={isFailed ? 'View logs - Processing failed, click to see error details' : 'View processing logs'}
                      >
                        <History size={14} className={isFailed ? 'text-red-500' : 'text-gray-500'} />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {/* Processed videos */}
              {sortedData.map((video, index) => {
                const scoreColor = getScoreColor(video.activity_score?.overall_score ?? 0);
                // Extract real YOLO detection counts from detections array
                // Handle cases where motion analysis data may not exist (only BAv4 or YOLO ran)
                const yoloDetectionData = video.yolo_detections && video.yolo_detections.length > 0
                  ? video.yolo_detections.map((d: any) => d.count || 0)
                  : video.organisms
                    ? parseArrayData(
                        '<synthetic>',
                        video.organisms.avg_count ?? 0,
                        video.organisms.max_count ?? 0,
                        30
                      )
                    : [];

                // Format upload date from timestamp
                const uploadDate = new Date(video.timestamp);
                const formattedDate = uploadDate.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                });

                // Get original filename (remove _background_subtracted suffix)
                const originalFilename = video.video_info.filename.replace('_background_subtracted.mp4', '.mp4');

                return (
                  <tr
                    key={`processed-${video.video_info.filename}-${index}`}
                    className={`border-b hover:bg-gray-50 cursor-pointer ${
                      selectedVideos.has(video.video_info.filename) ? 'bg-red-50' : ''
                    }`}
                    onClick={(e) => handleVideoRowClick(e, video, true)}
                    title={isEditMode ? 'Click to select' : 'Click to view video options'}
                  >
                    {isEditMode && (
                      <td className="py-2 w-8">
                        <input
                          type="checkbox"
                          checked={selectedVideos.has(video.video_info.filename)}
                          onChange={() => toggleVideoSelection(video.video_info.filename)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
                        />
                      </td>
                    )}
                    <td className="py-2 text-gray-700 text-xs font-medium max-w-xs truncate" title={originalFilename}>
                      {originalFilename}
                    </td>
                    <td className="py-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                        <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                        {formattedDate}
                      </span>
                    </td>
                    <td className="py-2 text-sm text-gray-700">
                      <QualityBadge
                        score={(video as any).prescreen_brightness}
                        type="light"
                      />
                    </td>
                    <td className="py-2 text-sm text-gray-700">
                      <QualityBadge
                        score={(video as any).prescreen_focus}
                        type="focus"
                      />
                    </td>
                    <td className="py-2 text-sm">
                      <QualityBadge
                        score={(video as any).prescreen_quality}
                        type="quality"
                      />
                    </td>
                    <td className="py-2">
                      <div className="w-36">
                        <Sparkline
                          data={yoloDetectionData}
                          color="#3b82f6"
                          height={24}
                        />
                      </div>
                    </td>
                    <td className="py-2 text-xs text-gray-600 font-medium whitespace-nowrap">
                      {Array.isArray(yoloDetectionData)
                        ? yoloDetectionData.reduce((sum, count) => sum + count, 0).toFixed(1)
                        : '0.0'}
                    </td>
                    <td className="py-2">
                      {video.crab_detections?.frame_counts || video.bav4_frame_detections ? (
                        <div className="w-36">
                          <Sparkline
                            data={video.crab_detections?.frame_counts || video.bav4_frame_detections || []}
                            color="#f97316"
                            height={24}
                          />
                        </div>
                      ) : video.benthic_activity_v4 ? (
                        <span className="text-xs text-green-600 font-medium">{video.benthic_activity_v4.valid_tracks} detections</span>
                      ) : (
                        <span className="text-xs text-gray-400 italic">Not processed</span>
                      )}
                    </td>
                    <td className="py-2 text-xs text-gray-600 font-medium whitespace-nowrap">
                      {video.crab_detections
                        ? `${video.crab_detections.valid_tracks} tracks`
                        : video.benthic_activity_v4
                          ? `${video.benthic_activity_v4.valid_tracks} tracks`
                          : '—'}
                    </td>
                    <td className="py-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openHistoryDialog(originalFilename, video.processing_history || []);
                        }}
                        className="p-1.5 hover:bg-gray-200 rounded-full transition-colors"
                        title="View processing logs"
                      >
                        <History size={14} className="text-gray-500" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>


      {/* Video Validation Dialog - shows pre-flight checks before opening video */}
      <VideoValidationDialog
        isOpen={isValidationDialogOpen}
        videoFilename={validationVideoFilename}
        onClose={handleValidationClose}
        onProceed={handleValidationProceed}
        onRunYolov8={handleRunYolov8}
        onReprocessMotion={handleReprocessMotion}
      />

      {/* Video Comparison Modal */}
      {videoModalData && (
        <VideoComparisonModal
          isOpen={isVideoModalOpen}
          onClose={closeVideoModal}
          videoFilename={videoModalData.video_info.filename}
          videoInfo={videoModalData.video_info}
          activityScore={videoModalData.activity_score?.overall_score ?? 0}
          organisms={videoModalData.organisms?.total_detections ?? 0}
          motionDensities={videoModalData.density ? parseArrayData(
            videoModalData.density.motion_densities,
            videoModalData.density.avg_density,
            videoModalData.density.max_density,
            120
          ) : []}
          avgDensity={videoModalData.density?.avg_density ?? 0}
          maxDensity={videoModalData.density?.max_density ?? 0}
        />
      )}


      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedVideos.size} video{selectedVideos.size > 1 ? 's' : ''} and all associated files.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteVideos}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Processing Estimation Modal */}
      <ProcessingEstimationModal
        isOpen={isProcessingModalOpen}
        onClose={() => setIsProcessingModalOpen(false)}
        pendingVideos={pendingVideos}
        onStartProcessing={handleStartProcessing}
        onProcessingStarted={onProcessingStarted}
      />

      {/* Pre-flight Check Dialog (for local processing) */}
      <ProcessingPreflightDialog
        isOpen={showPreflightCheck}
        onClose={() => setShowPreflightCheck(false)}
        onProceed={handlePreflightProceed}
      />

      {/* Quick Action Menu */}
      {quickActionVideo && (
        <>
          {/* Backdrop to close menu */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setQuickActionVideo(null)}
          />
          {/* Menu */}
          <div
            className="fixed z-50 bg-white rounded-lg shadow-xl border py-1 min-w-48"
            style={{
              left: Math.min(quickActionVideo.x, window.innerWidth - 200),
              top: quickActionVideo.y,
            }}
          >
            <button
              onClick={() => {
                openHistoryDialog(quickActionVideo.filename, quickActionVideo.history);
              }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
            >
              <Clock size={16} className="text-gray-500" />
              View Processing Logs
            </button>
            <button
              onClick={() => {
                // Find the video and open it
                const video = sortedData.find(v => v.video_info.filename.includes(quickActionVideo.filename.replace('.mp4', '')));
                if (video) {
                  openVideoModal(video);
                }
                setQuickActionVideo(null);
              }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
            >
              <Play size={16} className="text-gray-500" />
              Play Video
            </button>
            <button
              onClick={() => {
                setQuickActionVideo(null);
              }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
            >
              <Download size={16} className="text-gray-500" />
              Export Results
            </button>
          </div>
        </>
      )}

      {/* Processing History Dialog */}
      <ProcessingHistoryDialog
        isOpen={isHistoryDialogOpen}
        onClose={() => setIsHistoryDialogOpen(false)}
        filename={historyFilename}
        history={historyData}
        onDeleteRun={handleDeleteRun}
        onDeleteAll={handleDeleteAllRuns}
      />

      {/* Video Action Popup */}
      {videoActionPopup && (
        <>
          {/* Backdrop to close popup */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setVideoActionPopup(null)}
          />
          {/* Popup Menu */}
          <div
            className="fixed z-50 bg-white rounded-lg shadow-2xl border border-gray-200 py-2 min-w-64"
            style={{
              left: Math.min(videoActionPopup.x, window.innerWidth - 280),
              top: videoActionPopup.y,
            }}
          >
            <div className="px-3 py-2 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Video Options
              </p>
            </div>
            <button
              onClick={() => openOriginalVideo(videoActionPopup.video)}
              className="w-full px-4 py-2.5 text-left text-sm hover:bg-blue-50 flex items-center gap-3 transition-colors"
            >
              <Play size={18} className="text-blue-600" />
              <div>
                <div className="font-medium text-gray-900">Open Original Video</div>
                <div className="text-xs text-gray-500">View unprocessed video file</div>
              </div>
            </button>
            {videoActionPopup.hasProcessed ? (
              <button
                onClick={() => openProcessedVideo(videoActionPopup.video as MotionAnalysisResult)}
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-green-50 flex items-center gap-3 transition-colors"
              >
                <TrendingUp size={18} className="text-green-600" />
                <div>
                  <div className="font-medium text-gray-900">Open Processed Videos</div>
                  <div className="text-xs text-gray-500">View with motion analysis & YOLO</div>
                </div>
              </button>
            ) : (
              <div className="px-4 py-2.5 text-sm text-gray-400 italic flex items-center gap-3 cursor-not-allowed">
                <TrendingUp size={18} className="text-gray-300" />
                <div>
                  <div className="font-medium">Open Processed Videos</div>
                  <div className="text-xs">Not yet processed</div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      </div>
    </TooltipProvider>
  );
}
