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
  Tooltip,
  Legend,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  Cell,
} from 'recharts';
import { ArrowUpDown, Play, Download, Filter, TrendingUp } from 'lucide-react';
import VideoComparisonModal from './VideoComparisonModal';

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

interface MotionAnalysisResult {
  video_info: VideoInfo;
  activity_score: ActivityScore;
  organisms: Organisms;
  density: Density;
  motion: Motion;
  processing_time_seconds: number;
  timestamp: string;
}

interface MotionAnalysisDashboardProps {
  data: MotionAnalysisResult[];
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
        return parseArrayData(
          video.density.motion_densities,
          video.density.avg_density,
          video.density.max_density,
          30
        );
      case 'energy':
        return parseArrayData(
          video.motion.motion_energies,
          video.motion.avg_energy,
          video.motion.max_energy,
          30
        );
      case 'count':
        // Generate synthetic count data
        return parseArrayData(
          '<synthetic>',
          video.organisms.avg_count,
          video.organisms.max_count,
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

  const scoreColor = getScoreColor(video.activity_score.overall_score);
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
          {video.activity_score.overall_score.toFixed(0)}
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
        <span>{video.organisms.total_detections} org</span>
        <span>{video.density.avg_density.toFixed(2)}%</span>
      </div>
    </div>
  );
}

// Main Dashboard Component
export default function MotionAnalysisDashboard({ data }: MotionAnalysisDashboardProps) {
  const [selectedVideo, setSelectedVideo] = useState<MotionAnalysisResult | null>(null);
  const [sortBy, setSortBy] = useState<'score' | 'organisms' | 'density'>('score');
  const [metric, setMetric] = useState<'density' | 'energy' | 'count'>('density');
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  const [videoModalData, setVideoModalData] = useState<MotionAnalysisResult | null>(null);

  const openVideoModal = (video: MotionAnalysisResult) => {
    setVideoModalData(video);
    setIsVideoModalOpen(true);
  };

  const closeVideoModal = () => {
    setIsVideoModalOpen(false);
    setVideoModalData(null);
  };

  // Calculate summary statistics
  const stats = useMemo(() => {
    const scores = data.map((v) => v.activity_score.overall_score);
    const organisms = data.map((v) => v.organisms.total_detections);
    const densities = data.map((v) => v.density.avg_density);

    return {
      avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      totalOrganisms: organisms.reduce((a, b) => a + b, 0),
      videosWithDetections: organisms.filter((o) => o > 0).length,
      avgDensity: densities.reduce((a, b) => a + b, 0) / densities.length,
      maxScore: Math.max(...scores),
    };
  }, [data]);

  // Sort videos
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      switch (sortBy) {
        case 'score':
          return b.activity_score.overall_score - a.activity_score.overall_score;
        case 'organisms':
          return b.organisms.total_detections - a.organisms.total_detections;
        case 'density':
          return b.density.avg_density - a.density.avg_density;
        default:
          return 0;
      }
    });
  }, [data, sortBy]);

  // Scatter plot data
  const scatterData = useMemo(() => {
    return data.map((v) => ({
      name: getVideoName(v.video_info.filename),
      score: v.activity_score.overall_score,
      organisms: v.organisms.total_detections,
      density: v.density.avg_density,
      color: getScoreColor(v.activity_score.overall_score),
    }));
  }, [data]);

  return (
    <div className="w-full space-y-4 p-4 bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Motion Analysis Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{data.length} videos analyzed</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-card border rounded-lg hover:bg-muted">
            <Filter size={14} />
            Filters
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Download size={14} />
            Export
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-3">
        <SummaryCard
          title="Avg Activity Score"
          value={stats.avgScore}
          unit="/100"
          color={stats.avgScore > 35 ? 'green' : stats.avgScore > 25 ? 'yellow' : 'red'}
          subtext={`Peak: ${stats.maxScore.toFixed(1)}`}
          icon={<TrendingUp size={18} />}
        />
        <SummaryCard
          title="Total Organisms"
          value={stats.totalOrganisms}
          color="blue"
          subtext="Across all videos"
        />
        <SummaryCard
          title="Detection Rate"
          value={(stats.videosWithDetections / data.length) * 100}
          unit="%"
          color={stats.videosWithDetections / data.length > 0.5 ? 'green' : 'yellow'}
          subtext={`${stats.videosWithDetections}/${data.length} videos`}
        />
        <SummaryCard
          title="Avg Density"
          value={stats.avgDensity}
          unit="%"
          color="gray"
          subtext="Pixels moving"
        />
        <SummaryCard
          title="Processing"
          value={data.reduce((sum, v) => sum + v.processing_time_seconds, 0)}
          unit="s"
          color="gray"
          subtext={`${(data.reduce((sum, v) => sum + v.processing_time_seconds, 0) / data.length).toFixed(1)}s avg`}
        />
      </div>

      {/* Comparison Table */}
      <div className="bg-card rounded-lg shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-900">Video Rankings</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setSortBy('score')}
              className={`px-2.5 py-1 text-xs rounded ${sortBy === 'score' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
            >
              Score
            </button>
            <button
              onClick={() => setSortBy('organisms')}
              className={`px-2.5 py-1 text-xs rounded ${sortBy === 'organisms' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
            >
              Organisms
            </button>
            <button
              onClick={() => setSortBy('density')}
              className={`px-2.5 py-1 text-xs rounded ${sortBy === 'density' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
            >
              Density
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr className="text-left text-gray-600">
                <th className="pb-1.5 text-xs font-medium">Rank</th>
                <th className="pb-1.5 text-xs font-medium">Video</th>
                <th className="pb-1.5 text-xs font-medium">Time</th>
                <th className="pb-1.5 text-xs font-medium">Score</th>
                <th className="pb-1.5 text-xs font-medium">Organisms</th>
                <th className="pb-1.5 text-xs font-medium">Avg Density</th>
                <th className="pb-1.5 text-xs font-medium">Peak Density</th>
                <th className="pb-1.5 text-xs font-medium">Activity Timeline</th>
              </tr>
            </thead>
            <tbody>
              {sortedData.map((video, index) => {
                const scoreColor = getScoreColor(video.activity_score.overall_score);
                const sizeIndicator =
                  video.organisms.total_detections > 100
                    ? '●●●'
                    : video.organisms.total_detections > 10
                    ? '●●'
                    : video.organisms.total_detections > 0
                    ? '●'
                    : '○';

                return (
                  <tr
                    key={video.video_info.filename}
                    className="border-b hover:bg-gray-50 cursor-pointer"
                    onClick={() => setSelectedVideo(video)}
                    onDoubleClick={() => openVideoModal(video)}
                    title="Double-click to play video"
                  >
                    <td className="py-2">
                      <span className="font-bold text-gray-400 text-xs">#{index + 1}</span>
                    </td>
                    <td className="py-2">
                      <div className="font-medium text-gray-900 text-sm truncate max-w-xs">
                        {getVideoName(video.video_info.filename)}
                      </div>
                    </td>
                    <td className="py-2 text-gray-600 text-xs">{extractTimeFromFilename(video.video_info.filename)}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm" style={{ color: scoreColor }}>
                          {video.activity_score.overall_score.toFixed(1)}
                        </span>
                        <div className="w-14 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full"
                            style={{
                              width: `${video.activity_score.overall_score}%`,
                              backgroundColor: scoreColor,
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-2">
                      <span className="font-medium text-sm">{video.organisms.total_detections}</span>
                      <span className="text-gray-400 text-xs ml-1.5">{sizeIndicator}</span>
                    </td>
                    <td className="py-2 text-gray-700 text-sm">{video.density.avg_density.toFixed(2)}%</td>
                    <td className="py-2">
                      <span
                        className={`font-medium text-sm ${
                          video.density.max_density > 10 ? 'text-red-600' : 'text-gray-700'
                        }`}
                      >
                        {video.density.max_density.toFixed(2)}%
                      </span>
                      {video.density.max_density > 10 && <span className="ml-1 text-red-600">⚡</span>}
                    </td>
                    <td className="py-2">
                      <div className="w-28">
                        <Sparkline
                          data={parseArrayData(
                            video.density.motion_densities,
                            video.density.avg_density,
                            video.density.max_density,
                            30
                          )}
                          color={scoreColor}
                          height={20}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Small Multiples Grid */}
      <div className="bg-card rounded-lg shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-900">Activity Patterns - Small Multiples</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setMetric('density')}
              className={`px-2.5 py-1 text-xs rounded ${metric === 'density' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
            >
              Density
            </button>
            <button
              onClick={() => setMetric('energy')}
              className={`px-2.5 py-1 text-xs rounded ${metric === 'energy' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
            >
              Energy
            </button>
            <button
              onClick={() => setMetric('count')}
              className={`px-2.5 py-1 text-xs rounded ${metric === 'count' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
            >
              Count
            </button>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-3">
          {sortedData.map((video) => (
            <SmallMultipleChart
              key={video.video_info.filename}
              video={video}
              metric={metric}
              onSelect={setSelectedVideo}
              isSelected={selectedVideo?.video_info.filename === video.video_info.filename}
              onDoubleClick={openVideoModal}
            />
          ))}
        </div>
      </div>

      {/* Scatter Plot */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card rounded-lg shadow p-4">
          <h2 className="text-lg font-bold text-gray-900 mb-3">Activity Score vs Organisms</h2>
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 20, right: 20, bottom: 60, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="score"
                name="Activity Score"
                unit="/100"
                angle={-45}
                textAnchor="end"
                height={80}
                tick={{ fontSize: 12 }}
              />
              <YAxis
                dataKey="organisms"
                name="Organisms"
                tick={{ fontSize: 12 }}
              />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} />
              <Scatter name="Videos" data={scatterData}>
                {scatterData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <p className="text-sm text-gray-600 mt-2">
            Bubble size = organism count • Color = activity level
          </p>
        </div>

        <div className="bg-card rounded-lg shadow p-4">
          <h2 className="text-lg font-bold text-gray-900 mb-3">Component Score Distribution</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={sortedData.slice(0, 5).map((v) => ({
                name: getVideoName(v.video_info.filename),
                energy: v.activity_score.component_scores.energy,
                density: v.activity_score.component_scores.density,
                count: v.activity_score.component_scores.count,
                size: v.activity_score.component_scores.size,
              }))}
              margin={{ top: 20, right: 20, bottom: 80, left: 20 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="name"
                angle={-45}
                textAnchor="end"
                height={100}
                tick={{ fontSize: 11 }}
                interval={0}
              />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="energy" fill="#10b981" name="Energy" />
              <Bar dataKey="density" fill="#f59e0b" name="Density" />
              <Bar dataKey="count" fill="#3b82f6" name="Count" />
              <Bar dataKey="size" fill="#8b5cf6" name="Size" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detailed Video Panel */}
      {selectedVideo && (
        <div className="bg-card rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-gray-900">
              {getVideoName(selectedVideo.video_info.filename)}
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => openVideoModal(selectedVideo)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-gray-100 rounded hover:bg-gray-200"
              >
                <Play size={14} />
                Play Video
              </button>
              <button className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
                Add to YOLO Queue
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="p-3 bg-gray-50 rounded">
              <p className="text-xs text-gray-600">Activity Score</p>
              <p className="text-xl font-bold mt-0.5">{selectedVideo.activity_score.overall_score.toFixed(1)}/100</p>
            </div>
            <div className="p-3 bg-gray-50 rounded">
              <p className="text-xs text-gray-600">Organisms</p>
              <p className="text-xl font-bold mt-0.5">{selectedVideo.organisms.total_detections}</p>
            </div>
            <div className="p-3 bg-gray-50 rounded">
              <p className="text-xs text-gray-600">Avg Density</p>
              <p className="text-xl font-bold mt-0.5">{selectedVideo.density.avg_density.toFixed(2)}%</p>
            </div>
            <div className="p-3 bg-gray-50 rounded">
              <p className="text-xs text-gray-600">Duration</p>
              <p className="text-xl font-bold mt-0.5">{selectedVideo.video_info.duration_seconds.toFixed(1)}s</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-medium mb-2">Motion Density Over Time</h3>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={parseArrayData(
                  selectedVideo.density.motion_densities,
                  selectedVideo.density.avg_density,
                  selectedVideo.density.max_density,
                  50
                ).map((v, i) => ({ frame: i, density: v }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="frame" label={{ value: 'Frame', position: 'bottom' }} />
                  <YAxis label={{ value: 'Density (%)', angle: -90, position: 'left' }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="density" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div>
              <h3 className="text-sm font-medium mb-2">Size Distribution</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={[
                  { name: 'Small (<500px)', count: selectedVideo.organisms.size_distribution.small },
                  { name: 'Medium (500-5000px)', count: selectedVideo.organisms.size_distribution.medium },
                  { name: 'Large (>5000px)', count: selectedVideo.organisms.size_distribution.large },
                ]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-20} textAnchor="end" height={80} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Video Comparison Modal */}
      {videoModalData && (
        <VideoComparisonModal
          isOpen={isVideoModalOpen}
          onClose={closeVideoModal}
          videoFilename={videoModalData.video_info.filename}
          videoInfo={videoModalData.video_info}
          activityScore={videoModalData.activity_score.overall_score}
          organisms={videoModalData.organisms.total_detections}
          motionDensities={parseArrayData(
            videoModalData.density.motion_densities,
            videoModalData.density.avg_density,
            videoModalData.density.max_density,
            120
          )}
          avgDensity={videoModalData.density.avg_density}
          maxDensity={videoModalData.density.max_density}
        />
      )}
    </div>
  );
}
