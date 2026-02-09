'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { X, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

interface VideoComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoFilename: string;
  videoInfo: {
    filename: string;
    fps: number;
    resolution: { width: number; height: number };
    total_frames: number;
    duration_seconds: number;
  };
  activityScore: number;
  organisms: number;
  motionDensities?: number[];
  avgDensity?: number;
  maxDensity?: number;
}

interface YOLOv8Detection {
  frame: number;
  timestamp: number;
  count: number;
  objects: Array<{
    class_id: number;
    class_name: string;
    confidence: number;
    bbox: { x1: number; y1: number; x2: number; y2: number };
  }>;
}

export default function VideoComparisonModal({
  isOpen,
  onClose,
  videoFilename,
  videoInfo,
  activityScore,
  organisms,
  motionDensities,
  avgDensity = 0,
  maxDensity = 0,
}: VideoComparisonModalProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [originalVideoLoaded, setOriginalVideoLoaded] = useState(false);
  const [motionVideoLoaded, setMotionVideoLoaded] = useState(false);
  const [yolov8VideoLoaded, setYolov8VideoLoaded] = useState(false);
  const [originalVideoError, setOriginalVideoError] = useState(false);
  const [motionVideoError, setMotionVideoError] = useState(false);
  const [yolov8VideoError, setYolov8VideoError] = useState(false);
  const [yolov8Detections, setYolov8Detections] = useState<YOLOv8Detection[]>([]);

  const originalVideoRef = useRef<HTMLVideoElement>(null);
  const motionVideoRef = useRef<HTMLVideoElement>(null);
  const yolov8VideoRef = useRef<HTMLVideoElement>(null);

  // Extract original filename (remove _background_subtracted suffix)
  const originalFilename = videoFilename.replace('_background_subtracted.mp4', '.mp4');
  const motionFilename = videoFilename;
  const yolov8Filename = originalFilename.replace('.mp4', '_yolov8.mp4');

  // Video paths
  const originalVideoPath = `/videos/${originalFilename}`;
  const motionVideoPath = `/videos/${motionFilename}`;
  const yolov8VideoPath = `/videos/${yolov8Filename}`;

  // Load YOLOv8 detection JSON data
  useEffect(() => {
    if (isOpen) {
      const detectionDataPath = `/motion-analysis-results/${originalFilename.replace('.mp4', '_yolov8.json')}`;

      fetch(detectionDataPath)
        .then(res => {
          if (!res.ok) throw new Error('YOLOv8 detection data not found');
          return res.json();
        })
        .then(data => {
          setYolov8Detections(data.detections || []);
          console.log('✅ YOLOV8 DETECTION DATA LOADED:', data.detections?.length || 0, 'frames');
        })
        .catch(err => {
          console.warn('⚠️ No YOLOv8 detection data found:', err.message);
          setYolov8Detections([]);
        });
    }
  }, [isOpen, originalFilename]);

  // Validation logging when modal opens
  useEffect(() => {
    if (isOpen) {
      console.group('🎬 VIDEO MODAL OPENED');
      console.log('📂 Original filename:', originalFilename);
      console.log('📂 Motion filename:', motionFilename);
      console.log('📂 YOLOv8 filename:', yolov8Filename);
      console.log('🔗 Original path:', originalVideoPath);
      console.log('🔗 Motion path:', motionVideoPath);
      console.log('🔗 YOLOv8 path:', yolov8VideoPath);
      console.log('📊 Video info:', videoInfo);
      console.groupEnd();
    }
  }, [isOpen, originalFilename, motionFilename, yolov8Filename, originalVideoPath, motionVideoPath, yolov8VideoPath, videoInfo]);

  // Video load/error event handlers
  useEffect(() => {
    if (!isOpen) return;

    const originalVideo = originalVideoRef.current;
    const motionVideo = motionVideoRef.current;
    const yolov8Video = yolov8VideoRef.current;

    const handleOriginalLoad = () => {
      console.log('✅ ORIGINAL VIDEO LOADED:', originalVideoPath);
      console.log('   Duration:', originalVideo?.duration, 'seconds');
      console.log('   Video width:', originalVideo?.videoWidth);
      console.log('   Video height:', originalVideo?.videoHeight);
      setOriginalVideoLoaded(true);
      setOriginalVideoError(false);
    };

    const handleOriginalError = (e: Event) => {
      console.error('❌ ORIGINAL VIDEO FAILED TO LOAD:', originalVideoPath);
      console.error('   Error event:', e);
      console.error('   Video element:', originalVideo);
      console.error('   🔍 Check: Does this file exist in public/videos/?');
      setOriginalVideoLoaded(false);
      setOriginalVideoError(true);
    };

    const handleMotionLoad = () => {
      console.log('✅ MOTION VIDEO LOADED:', motionVideoPath);
      console.log('   Duration:', motionVideo?.duration, 'seconds');
      console.log('   Video width:', motionVideo?.videoWidth);
      console.log('   Video height:', motionVideo?.videoHeight);
      setMotionVideoLoaded(true);
      setMotionVideoError(false);
    };

    const handleMotionError = (e: Event) => {
      console.error('❌ MOTION VIDEO FAILED TO LOAD:', motionVideoPath);
      console.error('   Error event:', e);
      console.error('   Video element:', motionVideo);
      console.error('   🔍 Check: Does this file exist in public/videos/?');
      setMotionVideoLoaded(false);
      setMotionVideoError(true);
    };

    const handleYolov8Load = () => {
      console.log('✅ YOLOV8 VIDEO LOADED:', yolov8VideoPath);
      console.log('   Duration:', yolov8Video?.duration, 'seconds');
      console.log('   Video width:', yolov8Video?.videoWidth);
      console.log('   Video height:', yolov8Video?.videoHeight);
      setYolov8VideoLoaded(true);
      setYolov8VideoError(false);
    };

    const handleYolov8Error = (e: Event) => {
      console.warn('⚠️ YOLOV8 VIDEO FAILED TO LOAD:', yolov8VideoPath);
      console.warn('   Run process_videos_yolov8.py to generate YOLOv8 videos');
      setYolov8VideoLoaded(false);
      setYolov8VideoError(true);
    };

    if (originalVideo) {
      originalVideo.addEventListener('loadeddata', handleOriginalLoad);
      originalVideo.addEventListener('error', handleOriginalError);
    }

    if (motionVideo) {
      motionVideo.addEventListener('loadeddata', handleMotionLoad);
      motionVideo.addEventListener('error', handleMotionError);
    }

    if (yolov8Video) {
      yolov8Video.addEventListener('loadeddata', handleYolov8Load);
      yolov8Video.addEventListener('error', handleYolov8Error);
    }

    return () => {
      if (originalVideo) {
        originalVideo.removeEventListener('loadeddata', handleOriginalLoad);
        originalVideo.removeEventListener('error', handleOriginalError);
      }
      if (motionVideo) {
        motionVideo.removeEventListener('loadeddata', handleMotionLoad);
        motionVideo.removeEventListener('error', handleMotionError);
      }
      if (yolov8Video) {
        yolov8Video.removeEventListener('loadeddata', handleYolov8Load);
        yolov8Video.removeEventListener('error', handleYolov8Error);
      }
    };
  }, [isOpen, originalVideoPath, motionVideoPath, yolov8VideoPath]);

  useEffect(() => {
    if (!isOpen) {
      // Reset state when modal closes
      setIsPlaying(false);
      setCurrentTime(0);
      setOriginalVideoLoaded(false);
      setMotionVideoLoaded(false);
      setYolov8VideoLoaded(false);
      setOriginalVideoError(false);
      setMotionVideoError(false);
      setYolov8VideoError(false);
      setYolov8Detections([]);
      if (originalVideoRef.current) originalVideoRef.current.currentTime = 0;
      if (motionVideoRef.current) motionVideoRef.current.currentTime = 0;
      if (yolov8VideoRef.current) yolov8VideoRef.current.currentTime = 0;
    }
  }, [isOpen]);

  useEffect(() => {
    // Sync video time updates
    const updateTime = () => {
      if (originalVideoRef.current) {
        setCurrentTime(originalVideoRef.current.currentTime);
        setDuration(originalVideoRef.current.duration);
      }
    };

    const originalVideo = originalVideoRef.current;
    if (originalVideo) {
      originalVideo.addEventListener('timeupdate', updateTime);
      originalVideo.addEventListener('loadedmetadata', updateTime);
    }

    return () => {
      if (originalVideo) {
        originalVideo.removeEventListener('timeupdate', updateTime);
        originalVideo.removeEventListener('loadedmetadata', updateTime);
      }
    };
  }, [isOpen]);

  const togglePlayPause = () => {
    if (isPlaying) {
      originalVideoRef.current?.pause();
      motionVideoRef.current?.pause();
      yolov8VideoRef.current?.pause();
    } else {
      // Sync time before playing
      if (originalVideoRef.current) {
        const targetTime = originalVideoRef.current.currentTime;
        if (motionVideoRef.current) {
          motionVideoRef.current.currentTime = targetTime;
        }
        if (yolov8VideoRef.current) {
          yolov8VideoRef.current.currentTime = targetTime;
        }
      }
      originalVideoRef.current?.play();
      motionVideoRef.current?.play();
      yolov8VideoRef.current?.play();
    }
    setIsPlaying(!isPlaying);
  };

  const toggleMute = () => {
    if (originalVideoRef.current) {
      originalVideoRef.current.muted = !isMuted;
    }
    if (motionVideoRef.current) {
      motionVideoRef.current.muted = !isMuted;
    }
    if (yolov8VideoRef.current) {
      yolov8VideoRef.current.muted = !isMuted;
    }
    setIsMuted(!isMuted);
  };

  const skipBackward = () => {
    const newTime = Math.max(0, currentTime - 5);
    if (originalVideoRef.current) originalVideoRef.current.currentTime = newTime;
    if (motionVideoRef.current) motionVideoRef.current.currentTime = newTime;
    if (yolov8VideoRef.current) yolov8VideoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const skipForward = () => {
    const newTime = Math.min(duration, currentTime + 5);
    if (originalVideoRef.current) originalVideoRef.current.currentTime = newTime;
    if (motionVideoRef.current) motionVideoRef.current.currentTime = newTime;
    if (yolov8VideoRef.current) yolov8VideoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    if (originalVideoRef.current) originalVideoRef.current.currentTime = newTime;
    if (motionVideoRef.current) motionVideoRef.current.currentTime = newTime;
    if (yolov8VideoRef.current) yolov8VideoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Parse activity data for motion chart
  // Scale motion density timeline to match original video duration
  const activityData = useMemo(() => {
    if (!motionDensities || !Array.isArray(motionDensities)) {
      return [];
    }

    // The motion analysis video is subsampled (e.g., 4 fps vs original 24 fps)
    // We need to scale the timeline to match the original video's full duration
    const numSamples = motionDensities.length;
    const videoDuration = duration || 120; // Use actual video duration, fallback to 120s

    return motionDensities.map((density, index) => ({
      frame: index,
      time: (index / Math.max(1, numSamples - 1)) * videoDuration, // Scale to full video duration
      density: density * 100, // Convert to percentage
    }));
  }, [motionDensities, duration]);

  // Parse YOLOv8 detection data for chart
  const yolov8Data = useMemo(() => {
    if (!yolov8Detections || yolov8Detections.length === 0) {
      return [];
    }

    return yolov8Detections.map(detection => ({
      frame: detection.frame,
      time: detection.timestamp,
      count: detection.count,
    }));
  }, [yolov8Detections]);

  // Handle click on activity chart to seek
  const handleChartClick = (data: any) => {
    if (data && data.activePayload && data.activePayload[0]) {
      const time = data.activePayload[0].payload.time;
      if (originalVideoRef.current) originalVideoRef.current.currentTime = time;
      if (motionVideoRef.current) motionVideoRef.current.currentTime = time;
      if (yolov8VideoRef.current) yolov8VideoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75">
      <div className="bg-card rounded-lg shadow-2xl w-[98vw] max-w-[2000px] max-h-[95vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-muted">
          <div>
            <h2 className="text-xl font-bold text-foreground">Video Comparison</h2>
            <p className="text-sm text-muted-foreground">
              {originalFilename} • Score: {activityScore.toFixed(1)} • Organisms: {organisms}
              {yolov8Detections.length > 0 && ` • YOLOv8 Detections: ${yolov8Detections.reduce((sum, d) => sum + d.count, 0)}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-full transition-colors"
            aria-label="Close modal"
          >
            <X size={24} />
          </button>
        </div>

        {/* Video Players - 3 Column Grid */}
        <div className="flex-1 grid grid-cols-3 gap-3 p-3 bg-gray-900 overflow-auto">
          {/* Original Video */}
          <div className="flex flex-col">
            <div className="bg-gray-800 rounded-t-lg p-2">
              <h3 className="text-white font-semibold text-center text-sm">Original Video</h3>
            </div>
            <div className="bg-black rounded-b-lg overflow-hidden flex items-center justify-center min-h-[300px] relative">
              <video
                ref={originalVideoRef}
                src={originalVideoPath}
                className="w-full h-auto max-h-[55vh]"
                muted={isMuted}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
              {originalVideoError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 bg-opacity-90 text-white p-4 text-center">
                  <X size={40} className="text-red-500 mb-3" />
                  <p className="font-bold mb-2 text-sm">Video Not Available</p>
                  <p className="text-xs text-gray-300">{originalFilename}</p>
                  <p className="text-xs text-gray-400 mt-1">Original video file not found</p>
                </div>
              )}
            </div>
          </div>

          {/* Motion Video */}
          <div className="flex flex-col">
            <div className="bg-gray-800 rounded-t-lg p-2">
              <h3 className="text-white font-semibold text-center text-sm">Motion Analysis</h3>
            </div>
            <div className="bg-black rounded-b-lg overflow-hidden flex items-center justify-center min-h-[300px] relative">
              <video
                ref={motionVideoRef}
                src={motionVideoPath}
                className="w-full h-auto max-h-[55vh]"
                muted={isMuted}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
              {motionVideoError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 bg-opacity-90 text-white p-4 text-center">
                  <X size={40} className="text-red-500 mb-3" />
                  <p className="font-bold mb-2 text-sm">Video Not Available</p>
                  <p className="text-xs text-gray-300">{motionFilename}</p>
                  <p className="text-xs text-gray-400 mt-1">Motion video incompatible with browser</p>
                  <p className="text-xs text-blue-400 mt-2">See FIX_VIDEO_CODECS.md</p>
                </div>
              )}
            </div>
          </div>

          {/* YOLOv8 Detection Video */}
          <div className="flex flex-col">
            <div className="bg-gray-800 rounded-t-lg p-2">
              <h3 className="text-white font-semibold text-center text-sm">YOLOv8 Detections</h3>
            </div>
            <div className="bg-black rounded-b-lg overflow-hidden flex items-center justify-center min-h-[300px] relative">
              <video
                ref={yolov8VideoRef}
                src={yolov8VideoPath}
                className="w-full h-auto max-h-[55vh]"
                muted={isMuted}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
              {yolov8VideoError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 bg-opacity-90 text-white p-4 text-center">
                  <X size={40} className="text-yellow-500 mb-3" />
                  <p className="font-bold mb-2 text-sm">YOLOv8 Video Not Available</p>
                  <p className="text-xs text-gray-300">{yolov8Filename}</p>
                  <p className="text-xs text-gray-400 mt-1">Run process_videos_yolov8.py to generate</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Timelines */}
        <div className="bg-gray-50 border-t">
          {/* Motion Activity Timeline */}
          {activityData.length > 0 && (
            <div className="px-4 pt-3 pb-2">
              <h3 className="text-xs font-semibold text-muted-foreground mb-1">
                Motion Density Timeline (click to jump)
              </h3>
              <div className="bg-card p-2 rounded border" style={{ cursor: 'pointer' }}>
                <ResponsiveContainer width="100%" height={70}>
                  <AreaChart data={activityData} onClick={handleChartClick}>
                    <defs>
                      <linearGradient id="activityGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.1}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="time"
                      type="number"
                      domain={[0, duration || 30]}
                      tickFormatter={(value) => `${Math.floor(value)}s`}
                      stroke="hsl(var(--muted-foreground))"
                      style={{ fontSize: '10px' }}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      style={{ fontSize: '10px' }}
                      tickFormatter={(value) => `${value.toFixed(0)}%`}
                    />
                    <Tooltip
                      formatter={(value: any) => [`${value.toFixed(2)}%`, 'Motion']}
                      labelFormatter={(value) => `${formatTime(value)}`}
                    />
                    <ReferenceLine
                      x={currentTime}
                      stroke="#10b981"
                      strokeWidth={2}
                      strokeDasharray="3 3"
                    />
                    <Area
                      type="monotone"
                      dataKey="density"
                      stroke="#10b981"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#activityGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* YOLOv8 Detection Timeline */}
          {yolov8Data.length > 0 && (
            <div className="px-4 pb-3">
              <h3 className="text-xs font-semibold text-muted-foreground mb-1">
                YOLOv8 Detection Timeline (click to jump)
              </h3>
              <div className="bg-card p-2 rounded border" style={{ cursor: 'pointer' }}>
                <ResponsiveContainer width="100%" height={70}>
                  <AreaChart data={yolov8Data} onClick={handleChartClick}>
                    <defs>
                      <linearGradient id="yolov8Gradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="time"
                      type="number"
                      domain={[0, duration || 30]}
                      tickFormatter={(value) => `${Math.floor(value)}s`}
                      stroke="hsl(var(--muted-foreground))"
                      style={{ fontSize: '10px' }}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      style={{ fontSize: '10px' }}
                      label={{ value: 'Count', angle: -90, position: 'insideLeft', style: { fontSize: '10px' } }}
                    />
                    <Tooltip
                      formatter={(value: any) => [`${value}`, 'Detections']}
                      labelFormatter={(value) => `${formatTime(value)}`}
                    />
                    <ReferenceLine
                      x={currentTime}
                      stroke="#3b82f6"
                      strokeWidth={2}
                      strokeDasharray="3 3"
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#yolov8Gradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        {/* Video Controls */}
        <div className="p-3 border-t bg-gray-50">
          {/* Timeline */}
          <div className="mb-3">
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={handleSeek}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between text-xs text-gray-600 mt-1">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Control Buttons */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={skipBackward}
              className="p-2 bg-gray-200 hover:bg-gray-300 rounded-full transition-colors"
              aria-label="Skip backward 5 seconds"
            >
              <SkipBack size={18} />
            </button>

            <button
              onClick={togglePlayPause}
              className="p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-full transition-colors"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>

            <button
              onClick={skipForward}
              className="p-2 bg-gray-200 hover:bg-gray-300 rounded-full transition-colors"
              aria-label="Skip forward 5 seconds"
            >
              <SkipForward size={18} />
            </button>

            <button
              onClick={toggleMute}
              className="p-2 bg-gray-200 hover:bg-gray-300 rounded-full transition-colors ml-3"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
          </div>

          {/* Video Info */}
          <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
            <div className="text-center p-2 bg-card rounded border">
              <p className="text-muted-foreground">Resolution</p>
              <p className="font-semibold">{videoInfo.resolution.width}×{videoInfo.resolution.height}</p>
            </div>
            <div className="text-center p-2 bg-card rounded border">
              <p className="text-muted-foreground">FPS</p>
              <p className="font-semibold">{videoInfo.fps.toFixed(1)}</p>
            </div>
            <div className="text-center p-2 bg-card rounded border">
              <p className="text-muted-foreground">Frames</p>
              <p className="font-semibold">{videoInfo.total_frames}</p>
            </div>
            <div className="text-center p-2 bg-card rounded border">
              <p className="text-muted-foreground">Duration</p>
              <p className="font-semibold">{videoInfo.duration_seconds.toFixed(1)}s</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
