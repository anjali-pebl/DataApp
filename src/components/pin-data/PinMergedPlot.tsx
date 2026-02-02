"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { HexColorPicker } from 'react-colorful';
import { Split, ArrowLeft, ArrowRight, X, Loader2, AlertCircle, Settings, ChevronLeft, ChevronRight, Circle, Filter, BarChart3, Sparkles, Ruler } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Brush
} from 'recharts';
import { Slider } from '@/components/ui/slider';
import { format, parseISO, isValid } from 'date-fns';
import { parseMultipleCSVFiles, type ParseResult, type ParsedDataPoint } from './csvParser';
import { fetchCombinedDataAction } from '@/app/om-marine-explorer/actions';
import type { CombinedDataPoint } from '@/app/om-marine-explorer/shared';
import { getParameterLabelWithUnit } from '@/lib/units';

// Mapping from display names to camelCase parameter keys (for marine data)
const DISPLAY_NAME_TO_KEY: Record<string, string> = {
  'Wave Height': 'waveHeight',
  'Wind Speed (10m)': 'windSpeed10m',
  'Wind Direction (10m)': 'windDirection10m',
  'Sea Level (MSL)': 'seaLevelHeightMsl',
  'Wave Period': 'wavePeriod',
  'Wave Direction': 'waveDirection',
  'Air Temperature (2m)': 'temperature2m',
  'Sea Surface Temp (0m)': 'seaSurfaceTemperature',
  'Global Horizontal Irradiance (GHI)': 'ghi',
};

// Reverse mapping: camelCase to display name (for chart rendering)
const KEY_TO_DISPLAY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(DISPLAY_NAME_TO_KEY).map(([display, key]) => [key, display])
);

interface ParameterSettings {
  timeFilter?: {
    enabled: boolean;
    excludeStart: string;
    excludeEnd: string;
  };
  movingAverage?: {
    enabled: boolean;
    windowDays: number;
    showLine: boolean;
  };
  yAxisRange?: {
    enabled: boolean;
    min: number;
    max: number;
  };
}

interface MergedParameterConfig {
  parameter: string;
  sourceType: 'GP' | 'FPOD' | 'Subcam' | 'marine';
  sourceLabel: string;
  color: string;
  axis: 'left' | 'right';

  // Device data context
  fileType?: 'GP' | 'FPOD' | 'Subcam';
  files?: File[];

  // Marine data context
  location?: { lat: number; lon: number };
  timeRange?: { startDate: string; endDate: string };

  // Smoothing metadata
  isSmoothed?: boolean;
  originalObsCount?: number;
  smoothedObsCount?: number;

  // Parameter-specific settings (time filter, MA, y-axis range)
  settings?: ParameterSettings;
}

interface PinMergedPlotProps {
  instanceId: string;
  leftParam: MergedParameterConfig;
  rightParam: MergedParameterConfig;
  timeAxisMode?: 'separate' | 'common';
  globalTimeRange?: { min: Date | null; max: Date | null };
  globalBrushRange?: { startIndex: number; endIndex: number | undefined };
  onBrushChange?: (brushData: { startIndex?: number; endIndex?: number }) => void;
  isLastPlot?: boolean;
  onRemovePlot?: (id: string) => void;
  onUnmerge?: (id: string) => void;
  onSettingsChange?: (instanceId: string, leftSettings: ParameterSettings, rightSettings: ParameterSettings) => void;
}

// Format date for X-axis ticks
const formatDateTick = (timeValue: string | number): string => {
  try {
    const dateObj = typeof timeValue === 'string' ? parseISO(timeValue) : new Date(timeValue);
    if (!isValid(dateObj)) return String(timeValue);
    return format(dateObj, 'dd/MM');
  } catch (e) {
    return String(timeValue);
  }
};

// Y-axis formatter
const formatYAxisTick = (value: number, dataRange: number, dataMax: number): string => {
  if (!isFinite(value) || isNaN(value)) return '0';

  const absMax = Math.abs(dataMax);
  let decimals = 0;

  if (absMax >= 1000) {
    decimals = 0;
  } else if (absMax >= 100) {
    decimals = dataRange < 10 ? 1 : 0;
  } else if (absMax >= 10) {
    decimals = dataRange < 1 ? 2 : 1;
  } else if (absMax >= 1) {
    decimals = dataRange < 0.5 ? 2 : 1;
  } else if (absMax >= 0.1) {
    decimals = 2;
  } else {
    decimals = 3;
  }

  return value.toFixed(decimals);
};

// Helper to get color value (supports both CSS vars and hex)
const getColorValue = (colorString: string): string => {
  if (colorString.startsWith('#')) {
    return colorString;
  }
  return `hsl(var(${colorString}))`;
};

// CSS var to hex converter (Paul Tol colorblind-friendly palette)
const cssVarToHex = (cssVar: string): string => {
  if (cssVar.startsWith('#')) return cssVar;
  // Default colors for common chart variables (colorblind-friendly)
  const colorMap: Record<string, string> = {
    '--chart-1': '#4477AA', // Blue
    '--chart-2': '#EE6677', // Red/pink
    '--chart-3': '#228833', // Green
    '--chart-4': '#CCBB44', // Olive yellow
    '--chart-5': '#66CCEE', // Cyan
  };
  return colorMap[cssVar] || '#4477AA';
};

// Helper to extract time range from parsed data
const getTimeRangeFromData = (data: ParsedDataPoint[]): { startDate: string; endDate: string } | null => {
  if (data.length === 0) return null;

  const times = data.map(d => new Date(d.time)).filter(d => !isNaN(d.getTime()));
  if (times.length === 0) return null;

  const minTime = new Date(Math.min(...times.map(t => t.getTime())));
  const maxTime = new Date(Math.max(...times.map(t => t.getTime())));

  return {
    startDate: format(minTime, 'yyyy-MM-dd'),
    endDate: format(maxTime, 'yyyy-MM-dd')
  };
};

// Helper to check if a time falls within an exclusion range
const isTimeExcluded = (timeStr: string, excludeStart: string, excludeEnd: string): boolean => {
  try {
    const date = parseISO(timeStr);
    if (!isValid(date)) return false;

    const hours = date.getHours();
    const minutes = date.getMinutes();
    const timeInMinutes = hours * 60 + minutes;

    const [startH, startM] = excludeStart.split(':').map(Number);
    const [endH, endM] = excludeEnd.split(':').map(Number);
    const startInMinutes = startH * 60 + startM;
    const endInMinutes = endH * 60 + endM;

    // Handle ranges that cross midnight
    if (startInMinutes <= endInMinutes) {
      return timeInMinutes >= startInMinutes && timeInMinutes <= endInMinutes;
    } else {
      return timeInMinutes >= startInMinutes || timeInMinutes <= endInMinutes;
    }
  } catch {
    return false;
  }
};

export function PinMergedPlot({
  instanceId,
  leftParam,
  rightParam,
  timeAxisMode = 'separate',
  globalTimeRange,
  globalBrushRange,
  onBrushChange,
  isLastPlot = true,
  onRemovePlot,
  onUnmerge,
  onSettingsChange
}: PinMergedPlotProps) {
  // Generate auto title
  const autoTitle = `${leftParam.parameter} + ${rightParam.parameter}`;
  const [plotTitle, setPlotTitle] = useState(autoTitle);

  // Parameter panel expansion state
  const [isParameterPanelExpanded, setIsParameterPanelExpanded] = useState(true);

  // Y-axis mode state
  const [yAxisMode, setYAxisMode] = useState<'single' | 'multi'>('multi');

  // Chart styling state
  const [chartHeight, setChartHeight] = useState(200);
  const [yAxisWidth, setYAxisWidth] = useState(80);

  // Color states (allow user to change colors)
  const [leftColor, setLeftColor] = useState(leftParam.color);
  const [rightColor, setRightColor] = useState(rightParam.color);

  // Visibility states (allow user to show/hide parameters)
  const [leftVisible, setLeftVisible] = useState(true);
  const [rightVisible, setRightVisible] = useState(true);

  // Parameter settings states (time filter, MA, and y-axis range)
  // Initialize from props if available, otherwise empty
  const [leftSettings, setLeftSettings] = useState<ParameterSettings>(leftParam.settings || {});
  const [rightSettings, setRightSettings] = useState<ParameterSettings>(rightParam.settings || {});

  // Notify parent when settings change (for saving plot views)
  useEffect(() => {
    if (onSettingsChange) {
      onSettingsChange(instanceId, leftSettings, rightSettings);
    }
  }, [leftSettings, rightSettings, instanceId, onSettingsChange]);

  // Local brush state (for separate mode)
  const [localBrushStart, setLocalBrushStart] = useState(0);
  const [localBrushEnd, setLocalBrushEnd] = useState<number | undefined>(undefined);

  // Track if we've already aligned time ranges (to prevent infinite loops)
  const [timeRangeAligned, setTimeRangeAligned] = useState(false);

  // Data loading states
  const [leftData, setLeftData] = useState<ParsedDataPoint[]>([]);
  const [rightData, setRightData] = useState<ParsedDataPoint[]>([]);
  const [isLoadingLeft, setIsLoadingLeft] = useState(true);
  const [isLoadingRight, setIsLoadingRight] = useState(true);
  const [leftError, setLeftError] = useState<string | null>(null);
  const [rightError, setRightError] = useState<string | null>(null);

  // Determine loading order: load device data first, then marine data
  const loadDeviceFirst = leftParam.sourceType !== 'marine' && rightParam.sourceType === 'marine';
  const loadMarineFirst = leftParam.sourceType === 'marine' && rightParam.sourceType !== 'marine';

  // Load left parameter data
  useEffect(() => {
    const loadLeftData = async () => {
      setIsLoadingLeft(true);
      setLeftError(null);
      try {
        if (leftParam.sourceType === 'marine') {
          // Convert display name to camelCase key if needed
          const paramKey = DISPLAY_NAME_TO_KEY[leftParam.parameter] || leftParam.parameter;

          // Use original time range (should already match device data)
          let startDate = leftParam.timeRange!.startDate;
          let endDate = leftParam.timeRange!.endDate;

          // Fetch marine data
          const result = await fetchCombinedDataAction({
            latitude: leftParam.location!.lat,
            longitude: leftParam.location!.lon,
            startDate,
            endDate,
            parameters: [paramKey]
          });

          if (result.success && result.data) {
            // Convert to ParsedDataPoint format
            // Store using the DISPLAY NAME as key (so merge can find it)
            const parsed: ParsedDataPoint[] = result.data.map(point => {
              const value = point[paramKey as keyof CombinedDataPoint];
              return {
                time: point.time,
                [leftParam.parameter]: value  // Use display name as key
              };
            });

            setLeftData(parsed);
          } else {
            setLeftError(result.error || 'Failed to fetch marine data');
            setLeftData([]);
          }
        } else {
          // Parse CSV files
          if (leftParam.files && leftParam.files.length > 0) {
            const parseResult = await parseMultipleCSVFiles(
              leftParam.files,
              leftParam.fileType!
            );
            setLeftData(parseResult.data);
          }
        }
      } catch (error) {
        console.error('Error loading left parameter data:', error);
        setLeftError(error instanceof Error ? error.message : 'Unknown error');
        setLeftData([]);
      } finally {
        setIsLoadingLeft(false);
      }
    };

    loadLeftData();
  }, [leftParam]); // Only depend on leftParam

  // Load right parameter data
  useEffect(() => {
    const loadRightData = async () => {
      setIsLoadingRight(true);
      setRightError(null);
      try {
        if (rightParam.sourceType === 'marine') {
          // Convert display name to camelCase key if needed
          const paramKey = DISPLAY_NAME_TO_KEY[rightParam.parameter] || rightParam.parameter;

          // If left is device data and loaded, use its exact time range (only once)
          let startDate = rightParam.timeRange!.startDate;
          let endDate = rightParam.timeRange!.endDate;

          if (leftParam.sourceType !== 'marine' && leftData.length > 0 && !timeRangeAligned) {
            const deviceTimeRange = getTimeRangeFromData(leftData);
            if (deviceTimeRange) {
              startDate = deviceTimeRange.startDate;
              endDate = deviceTimeRange.endDate;
              setTimeRangeAligned(true); // Mark as aligned to prevent re-fetching
            }
          }

          // Fetch marine data
          const result = await fetchCombinedDataAction({
            latitude: rightParam.location!.lat,
            longitude: rightParam.location!.lon,
            startDate,
            endDate,
            parameters: [paramKey]
          });

          if (result.success && result.data) {
            // Convert to ParsedDataPoint format
            // Store using the DISPLAY NAME as key (so merge can find it)
            const parsed: ParsedDataPoint[] = result.data.map(point => {
              const value = point[paramKey as keyof CombinedDataPoint];
              return {
                time: point.time,
                [rightParam.parameter]: value  // Use display name as key
              };
            });

            setRightData(parsed);
          } else {
            setRightError(result.error || 'Failed to fetch marine data');
            setRightData([]);
          }
        } else {
          // Parse CSV files
          if (rightParam.files && rightParam.files.length > 0) {
            const parseResult = await parseMultipleCSVFiles(
              rightParam.files,
              rightParam.fileType!
            );
            setRightData(parseResult.data);
          }
        }
      } catch (error) {
        console.error('Error loading right parameter data:', error);
        setRightError(error instanceof Error ? error.message : 'Unknown error');
        setRightData([]);
      } finally {
        setIsLoadingRight(false);
      }
    };

    loadRightData();
  }, [rightParam, leftData, leftParam.sourceType]); // Reload when leftData changes (if merging with device data)

  // Merge data by time (UNION - include all timestamps)
  const mergedData = useMemo(() => {
    if (leftData.length === 0 && rightData.length === 0) {
      return [];
    }

    // Create time-to-data maps
    const leftMap = new Map(leftData.map(d => [d.time, d]));
    const rightMap = new Map(rightData.map(d => [d.time, d]));

    // Get UNION of all timestamps (sorted)
    const allTimestamps = Array.from(
      new Set([...leftData.map(d => d.time), ...rightData.map(d => d.time)])
    ).sort();

    // Merge data at each timestamp
    const merged = allTimestamps.map(time => {
      const leftPoint = leftMap.get(time);
      const rightPoint = rightMap.get(time);

      const mergedPoint = {
        time,
        [leftParam.parameter]: leftPoint?.[leftParam.parameter] ?? null,
        [rightParam.parameter]: rightPoint?.[rightParam.parameter] ?? null
      };

      return mergedPoint;
    });

    return merged;
  }, [leftData, rightData, leftParam.parameter, rightParam.parameter]);

  // Initialize local brush end index
  useEffect(() => {
    if (mergedData.length > 0 && localBrushEnd === undefined) {
      setLocalBrushEnd(mergedData.length - 1);
    }
  }, [mergedData.length, localBrushEnd]);

  // Determine active brush indices based on mode
  const activeBrushStart = timeAxisMode === 'common' && globalBrushRange
    ? globalBrushRange.startIndex
    : localBrushStart;
  const activeBrushEnd = timeAxisMode === 'common' && globalBrushRange
    ? globalBrushRange.endIndex
    : localBrushEnd;


  // Apply brush/time filtering, time-of-day filters, and MA calculation
  const displayData = useMemo(() => {
    if (mergedData.length === 0) return [];

    // Step 1: Get base data based on brush/time range
    let baseData: typeof mergedData;

    // In common mode with global time range, filter by time
    if (timeAxisMode === 'common' && globalTimeRange?.min && globalTimeRange?.max) {
      baseData = mergedData.filter(d => {
        const pointTime = new Date(d.time);
        return pointTime >= globalTimeRange.min! && pointTime <= globalTimeRange.max!;
      });
    } else {
      // Use brush indices (works for both common and separate modes)
      const start = Math.max(0, activeBrushStart);
      const end = Math.min(mergedData.length - 1, activeBrushEnd ?? mergedData.length - 1);
      baseData = mergedData.slice(start, end + 1);
    }

    // Step 2: Apply time-of-day filters
    const hasTimeFilters = leftSettings.timeFilter?.enabled || rightSettings.timeFilter?.enabled;

    let filteredData = baseData;
    if (hasTimeFilters) {
      filteredData = baseData.map(point => {
        const newPoint = { ...point };

        // Apply left parameter filter
        if (leftSettings.timeFilter?.enabled && leftSettings.timeFilter.excludeStart && leftSettings.timeFilter.excludeEnd) {
          if (isTimeExcluded(point.time, leftSettings.timeFilter.excludeStart, leftSettings.timeFilter.excludeEnd)) {
            newPoint[leftParam.parameter] = null;
          }
        }

        // Apply right parameter filter
        if (rightSettings.timeFilter?.enabled && rightSettings.timeFilter.excludeStart && rightSettings.timeFilter.excludeEnd) {
          if (isTimeExcluded(point.time, rightSettings.timeFilter.excludeStart, rightSettings.timeFilter.excludeEnd)) {
            newPoint[rightParam.parameter] = null;
          }
        }

        return newPoint;
      });
    }

    // Step 3: Calculate moving averages
    const hasMovingAverages = leftSettings.movingAverage?.enabled || rightSettings.movingAverage?.enabled;

    if (!hasMovingAverages) {
      return filteredData;
    }

    return filteredData.map((point, index) => {
      const newPoint = { ...point };

      // Calculate MA for left parameter
      if (leftSettings.movingAverage?.enabled) {
        const windowDays = leftSettings.movingAverage.windowDays || 1;
        const windowSize = windowDays * 24;
        const windowStart = Math.max(0, index - windowSize + 1);
        const windowValues: number[] = [];

        for (let i = windowStart; i <= index; i++) {
          const value = filteredData[i][leftParam.parameter];
          if (typeof value === 'number' && !isNaN(value) && value !== null) {
            windowValues.push(value);
          }
        }

        if (windowValues.length > 0) {
          const sum = windowValues.reduce((a, b) => a + b, 0);
          newPoint[`${leftParam.parameter}_ma`] = sum / windowValues.length;
        } else {
          newPoint[`${leftParam.parameter}_ma`] = null;
        }
      }

      // Calculate MA for right parameter
      if (rightSettings.movingAverage?.enabled) {
        const windowDays = rightSettings.movingAverage.windowDays || 1;
        const windowSize = windowDays * 24;
        const windowStart = Math.max(0, index - windowSize + 1);
        const windowValues: number[] = [];

        for (let i = windowStart; i <= index; i++) {
          const value = filteredData[i][rightParam.parameter];
          if (typeof value === 'number' && !isNaN(value) && value !== null) {
            windowValues.push(value);
          }
        }

        if (windowValues.length > 0) {
          const sum = windowValues.reduce((a, b) => a + b, 0);
          newPoint[`${rightParam.parameter}_ma`] = sum / windowValues.length;
        } else {
          newPoint[`${rightParam.parameter}_ma`] = null;
        }
      }

      return newPoint;
    });
  }, [mergedData, timeAxisMode, globalTimeRange, activeBrushStart, activeBrushEnd, leftSettings, rightSettings, leftParam.parameter, rightParam.parameter]);

  // Calculate domain for left parameter
  const leftDomain = useMemo((): [number, number] => {
    // Use custom y-axis range if enabled
    if (leftSettings.yAxisRange?.enabled &&
        leftSettings.yAxisRange.min !== undefined &&
        leftSettings.yAxisRange.max !== undefined) {
      return [leftSettings.yAxisRange.min, leftSettings.yAxisRange.max];
    }

    const values = displayData
      .map(d => d[leftParam.parameter])
      .filter((v): v is number => typeof v === 'number' && !isNaN(v));

    if (values.length === 0) return [0, 100];

    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = (max - min) * 0.1 || 1;

    return [min - padding, max + padding];
  }, [displayData, leftParam.parameter, leftSettings.yAxisRange]);

  // Calculate domain for right parameter
  const rightDomain = useMemo((): [number, number] => {
    // Use custom y-axis range if enabled
    if (rightSettings.yAxisRange?.enabled &&
        rightSettings.yAxisRange.min !== undefined &&
        rightSettings.yAxisRange.max !== undefined) {
      return [rightSettings.yAxisRange.min, rightSettings.yAxisRange.max];
    }

    const values = displayData
      .map(d => d[rightParam.parameter])
      .filter((v): v is number => typeof v === 'number' && !isNaN(v));

    if (values.length === 0) return [0, 100];

    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = (max - min) * 0.1 || 1;

    return [min - padding, max + padding];
  }, [displayData, rightParam.parameter, rightSettings.yAxisRange]);

  // Calculate combined domain for single y-axis mode
  const combinedDomain = useMemo((): [number, number] => {
    if (yAxisMode === 'multi') return [0, 100]; // Not used in multi mode

    // Collect all values from both parameters
    const allValues: number[] = [];

    displayData.forEach(d => {
      const leftVal = d[leftParam.parameter];
      const rightVal = d[rightParam.parameter];

      if (typeof leftVal === 'number' && !isNaN(leftVal)) {
        allValues.push(leftVal);
      }
      if (typeof rightVal === 'number' && !isNaN(rightVal)) {
        allValues.push(rightVal);
      }
    });

    if (allValues.length === 0) return [0, 100];

    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const padding = (max - min) * 0.1 || 1;

    return [min - padding, max + padding];
  }, [displayData, leftParam.parameter, rightParam.parameter, yAxisMode]);

  // Calculate ranges for Y-axis formatters
  const leftRange = Math.abs(leftDomain[1] - leftDomain[0]);
  const leftMax = Math.max(Math.abs(leftDomain[0]), Math.abs(leftDomain[1]));
  const rightRange = Math.abs(rightDomain[1] - rightDomain[0]);
  const rightMax = Math.max(Math.abs(rightDomain[0]), Math.abs(rightDomain[1]));
  const combinedRange = Math.abs(combinedDomain[1] - combinedDomain[0]);
  const combinedMax = Math.max(Math.abs(combinedDomain[0]), Math.abs(combinedDomain[1]));

  const isLoading = isLoadingLeft || isLoadingRight;
  const leftColorValue = getColorValue(leftColor);
  const rightColorValue = getColorValue(rightColor);

  // Get source abbreviation
  const getSourceAbbr = (sourceType: string) => {
    return sourceType === 'marine' ? 'OM' : sourceType;
  };

  // Format parameter with source label
  const formatParameterWithSource = (parameter: string, sourceType: string, isSmoothed?: boolean): string => {
    const baseLabel = getParameterLabelWithUnit(parameter);
    const sourceLabel = getSourceAbbr(sourceType);
    const smoothedIndicator = isSmoothed ? ' ~' : '';
    return `${baseLabel} [${sourceLabel}]${smoothedIndicator}`;
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between mb-2">
          {/* Editable Title */}
          <Input
            value={plotTitle}
            onChange={(e) => setPlotTitle(e.target.value)}
            className="font-semibold text-base max-w-md"
          />

          {/* Action Buttons */}
          <div className="flex gap-2">
            {onUnmerge && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onUnmerge(instanceId)}
              >
                <Split className="h-4 w-4 mr-2" />
                Unmerge
              </Button>
            )}
            {onRemovePlot && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRemovePlot(instanceId)}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

      </CardHeader>

      <CardContent>
        {/* Main layout: Chart on left, Parameters on right */}
        <div className="flex gap-4">
          {/* Chart and Brush Column */}
          <div className="flex-1 space-y-3">
            {/* Chart Container */}
            <div style={{ height: `${chartHeight}px` }}>
            {leftError || rightError ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-2">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <p className="text-sm font-medium">Error loading data</p>
                {leftError && (
                  <p className="text-xs text-muted-foreground">Left: {leftError}</p>
                )}
                {rightError && (
                  <p className="text-xs text-muted-foreground">Right: {rightError}</p>
                )}
              </div>
            ) : isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading data...</span>
              </div>
            ) : displayData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-center">
                <p className="text-sm text-muted-foreground">No data available</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
            <LineChart data={displayData} margin={{ top: 5, right: yAxisMode === 'single' ? 20 : yAxisWidth, left: yAxisWidth, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />

              {/* X-Axis */}
              <XAxis
                dataKey="time"
                tick={{ fontSize: '0.65rem', fill: 'hsl(var(--muted-foreground))', angle: -45, textAnchor: 'end', dy: 8 }}
                stroke="hsl(var(--border))"
                tickFormatter={formatDateTick}
                height={45}
              />

              {/* Conditional Y-Axis Rendering based on mode */}
              {yAxisMode === 'single' ? (
                // SINGLE Y-AXIS MODE: Both parameters share left axis
                <YAxis
                  yAxisId="left"
                  orientation="left"
                  domain={combinedDomain}
                  tick={{ fontSize: '0.65rem', fill: 'hsl(var(--muted-foreground))' }}
                  stroke="hsl(var(--border))"
                  tickFormatter={(value) => formatYAxisTick(value, combinedRange, combinedMax)}
                  label={{
                    value: formatParameterWithSource(leftParam.parameter, leftParam.sourceType, leftParam.isSmoothed),
                    angle: -90,
                    position: 'insideLeft',
                    offset: 10,
                    style: {
                      fill: 'hsl(var(--muted-foreground))',
                      fontSize: '0.65rem',
                      fontWeight: 500,
                      textAnchor: 'middle'
                    }
                  }}
                />
              ) : (
                // MULTI Y-AXIS MODE: Separate left and right axes - built from single mode structure
                <>
                  {/* Left Y-Axis - duplicate of single mode with left parameter color */}
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    domain={leftDomain}
                    tick={{ fontSize: '0.65rem', fill: leftColorValue }}
                    stroke={leftColorValue}
                    tickFormatter={(value) => formatYAxisTick(value, leftRange, leftMax)}
                    label={{
                      value: formatParameterWithSource(leftParam.parameter, leftParam.sourceType, leftParam.isSmoothed),
                      angle: -90,
                      position: 'insideLeft',
                      offset: 10,
                      style: {
                        fill: leftColorValue,
                        fontSize: '0.65rem',
                        fontWeight: 500,
                        textAnchor: 'middle'
                      }
                    }}
                  />

                  {/* Right Y-Axis - duplicate of single mode with right parameter color */}
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={rightDomain}
                    tick={{ fontSize: '0.65rem', fill: rightColorValue }}
                    stroke={rightColorValue}
                    tickFormatter={(value) => formatYAxisTick(value, rightRange, rightMax)}
                    label={{
                      value: formatParameterWithSource(rightParam.parameter, rightParam.sourceType, rightParam.isSmoothed),
                      angle: 90,
                      position: 'insideRight',
                      offset: 10,
                      style: {
                        fill: rightColorValue,
                        fontSize: '0.65rem',
                        fontWeight: 500,
                        textAnchor: 'middle'
                      }
                    }}
                  />
                </>
              )}

              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: '0.75rem'
                }}
                labelFormatter={formatDateTick}
              />

              <Legend
                wrapperStyle={{ fontSize: '0.75rem' }}
                formatter={(value) => {
                  if (value === leftParam.parameter) {
                    return `${value} (${getSourceAbbr(leftParam.sourceType)})`;
                  }
                  return `${value} (${getSourceAbbr(rightParam.sourceType)})`;
                }}
              />

              {/* Left Parameter Line */}
              {leftVisible && (
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey={leftParam.parameter}
                  stroke={leftColorValue}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls={true}
                  name={leftParam.parameter}
                  isAnimationActive={false}
                />
              )}

              {/* Right Parameter Line */}
              {rightVisible && (
                <Line
                  yAxisId={yAxisMode === 'single' ? 'left' : 'right'}
                  type="monotone"
                  dataKey={rightParam.parameter}
                  stroke={rightColorValue}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls={true}
                  name={rightParam.parameter}
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
            )}
            </div>

            {/* Time Range Brush - separate container matching unmerged mode */}
            {mergedData.length > 10 && (timeAxisMode === 'separate' || isLastPlot) && !isLoading && (
              <div className="h-10 w-full border rounded-md bg-card p-1">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={mergedData} margin={{ top: 2, right: 15, left: 15, bottom: 0 }}>
                    <XAxis
                      dataKey="time"
                      tickFormatter={formatDateTick}
                      stroke="hsl(var(--muted-foreground))"
                      tick={{ fontSize: '0.6rem' }}
                      height={10}
                      interval="preserveStartEnd"
                    />
                    <Brush
                      data={mergedData}
                      dataKey="time"
                      height={16}
                      stroke="hsl(var(--primary))"
                      fill="transparent"
                      tickFormatter={() => ""}
                      travellerWidth={10}
                      startIndex={activeBrushStart}
                      endIndex={activeBrushEnd}
                      onChange={(range) => {
                        if ('startIndex' in range && 'endIndex' in range) {
                          if (timeAxisMode === 'common' && onBrushChange) {
                            // In common mode, propagate to parent
                            onBrushChange({
                              startIndex: range.startIndex ?? 0,
                              endIndex: range.endIndex
                            });
                          } else {
                            // In separate mode, update local state
                            setLocalBrushStart(range.startIndex ?? 0);
                            setLocalBrushEnd(range.endIndex);
                          }
                        }
                      }}
                      y={12}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Parameter Panel on the right */}
          <div className={cn("space-y-2 transition-all duration-300", isParameterPanelExpanded ? "w-56" : "w-40")}>
            {/* Chart Height Control */}
            <div className="space-y-1.5 pb-2 border-b">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Chart Height</Label>
                <span className="text-xs text-muted-foreground">{chartHeight}px</span>
              </div>
              <Slider
                value={[chartHeight]}
                onValueChange={(values) => setChartHeight(values[0])}
                min={150}
                max={600}
                step={10}
                className="w-full"
              />
            </div>

            {/* Y-Axis Width Control */}
            <div className="space-y-1.5 pb-2 border-b">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Y-Axis Width</Label>
                <span className="text-xs text-muted-foreground">{yAxisWidth}px</span>
              </div>
              <Slider
                value={[yAxisWidth]}
                onValueChange={(values) => setYAxisWidth(values[0])}
                min={40}
                max={120}
                step={5}
                className="w-full"
              />
            </div>

            {/* Y-Axis Mode Toggle */}
            <div className="flex items-center justify-center gap-2 pb-2 border-b">
              <span className="text-xs text-muted-foreground">Single</span>
              <Switch
                checked={yAxisMode === 'multi'}
                onCheckedChange={(checked) => setYAxisMode(checked ? 'multi' : 'single')}
                className="h-5 w-9"
              />
              <span className="text-xs text-muted-foreground">Multi</span>
            </div>

            {/* Header with expand button */}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 hover:bg-accent/50"
                onClick={() => setIsParameterPanelExpanded(!isParameterPanelExpanded)}
                title={isParameterPanelExpanded ? "Collapse panel" : "Expand panel"}
              >
                {isParameterPanelExpanded ? (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                ) : (
                  <ChevronLeft className="h-3 w-3 text-muted-foreground" />
                )}
              </Button>

              <p className="text-xs font-medium">
                Parameters (2 merged)
                {yAxisMode === 'single' && (
                  <span className="text-muted-foreground font-normal ml-1">- Single Axis</span>
                )}
              </p>
            </div>

            {/* Parameter List */}
            <div className="space-y-1">
              {/* Left Parameter */}
              <div className="flex items-center justify-between p-1.5 rounded border bg-card/50">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Checkbox
                    id="left-param"
                    checked={leftVisible}
                    onCheckedChange={(checked) => setLeftVisible(checked as boolean)}
                    className="h-3 w-3"
                  />

                  {/* Solo button - shows only this parameter */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-4 w-4 p-0 rounded-full hover:bg-accent",
                      !rightVisible && leftVisible && "bg-primary/20 hover:bg-primary/30"
                    )}
                    onClick={() => {
                      if (!rightVisible && leftVisible) {
                        // Currently solo, show both
                        setRightVisible(true);
                      } else {
                        // Make this one solo
                        setLeftVisible(true);
                        setRightVisible(false);
                      }
                    }}
                    title={(!rightVisible && leftVisible) ? "Exit solo mode" : "Show only this parameter"}
                  >
                    <Circle className={cn(
                      "h-2.5 w-2.5",
                      !rightVisible && leftVisible ? "fill-primary text-primary" : "text-muted-foreground"
                    )} />
                  </Button>

                  <Label
                    htmlFor="left-param"
                    className="text-xs cursor-pointer truncate flex-1"
                    title={formatParameterWithSource(leftParam.parameter, leftParam.sourceType, leftParam.isSmoothed)}
                  >
                    {formatParameterWithSource(leftParam.parameter, leftParam.sourceType, leftParam.isSmoothed)}
                    {leftParam.isSmoothed && (
                      <Sparkles className="h-2.5 w-2.5 text-primary inline ml-1" title={`Smoothed from ${leftParam.originalObsCount} to ${leftParam.smoothedObsCount} observations`} />
                    )}
                  </Label>
                  <span
                    className="text-[0.6rem] font-semibold px-1 rounded"
                    style={{ color: leftColorValue, backgroundColor: `${leftColorValue}1a` }}
                  >
                    L
                  </span>

                  {/* Colored circle with color picker */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <div
                        className="w-3 h-3 rounded-full border cursor-pointer hover:ring-2 hover:ring-offset-1 transition-all"
                        style={{
                          backgroundColor: leftColorValue,
                          '--tw-ring-color': leftColorValue
                        } as React.CSSProperties}
                        title="Change color"
                      />
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-3" align="end" onClick={(e) => e.stopPropagation()}>
                      <div className="space-y-2">
                        <p className="text-xs font-medium">Pick Color</p>
                        <div className="relative">
                          <HexColorPicker
                            color={leftColor.startsWith('#') ? leftColor : cssVarToHex(leftColor)}
                            onChange={(hex) => setLeftColor(hex)}
                            style={{ width: '200px', height: '150px' }}
                          />
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>

                  {/* Settings popover for time filter and MA */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-5 w-5 p-0 hover:bg-accent",
                          (leftSettings.timeFilter?.enabled || leftSettings.movingAverage?.enabled || leftSettings.yAxisRange?.enabled) && "text-primary"
                        )}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Settings className="h-3 w-3" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-3" align="end" onClick={(e) => e.stopPropagation()}>
                      <div className="space-y-4">
                        <p className="text-xs font-semibold border-b pb-2">Settings - {leftParam.parameter}</p>

                        {/* Time Filter Section */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium">Data Filter</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id="left-filter"
                              checked={leftSettings.timeFilter?.enabled || false}
                              onCheckedChange={(checked) =>
                                setLeftSettings({
                                  ...leftSettings,
                                  timeFilter: {
                                    enabled: checked as boolean,
                                    excludeStart: leftSettings.timeFilter?.excludeStart || '05:00',
                                    excludeEnd: leftSettings.timeFilter?.excludeEnd || '20:00'
                                  }
                                })
                              }
                              className="h-3 w-3"
                            />
                            <Label htmlFor="left-filter" className="text-xs cursor-pointer">
                              Enable time filter
                            </Label>
                          </div>
                          {leftSettings.timeFilter?.enabled && (
                            <div className="pl-5 space-y-2">
                              <p className="text-xs text-muted-foreground">Hide data between:</p>
                              <div className="flex items-center gap-2">
                                <Label className="text-xs w-12">From:</Label>
                                <Input
                                  type="time"
                                  value={leftSettings.timeFilter?.excludeStart || '05:00'}
                                  onChange={(e) =>
                                    setLeftSettings({
                                      ...leftSettings,
                                      timeFilter: {
                                        ...leftSettings.timeFilter!,
                                        excludeStart: e.target.value
                                      }
                                    })
                                  }
                                  className="h-7 text-xs"
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <Label className="text-xs w-12">To:</Label>
                                <Input
                                  type="time"
                                  value={leftSettings.timeFilter?.excludeEnd || '20:00'}
                                  onChange={(e) =>
                                    setLeftSettings({
                                      ...leftSettings,
                                      timeFilter: {
                                        ...leftSettings.timeFilter!,
                                        excludeEnd: e.target.value
                                      }
                                    })
                                  }
                                  className="h-7 text-xs"
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Moving Average Section */}
                        <div className="space-y-2 border-t pt-3">
                          <div className="flex items-center gap-2">
                            <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium">Moving Average</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id="left-ma"
                              checked={leftSettings.movingAverage?.enabled || false}
                              onCheckedChange={(checked) =>
                                setLeftSettings({
                                  ...leftSettings,
                                  movingAverage: {
                                    enabled: checked as boolean,
                                    windowDays: leftSettings.movingAverage?.windowDays || 7,
                                    showLine: leftSettings.movingAverage?.showLine !== false
                                  }
                                })
                              }
                              className="h-3 w-3"
                            />
                            <Label htmlFor="left-ma" className="text-xs cursor-pointer">
                              Enable moving average
                            </Label>
                          </div>
                          {leftSettings.movingAverage?.enabled && (
                            <div className="pl-5 space-y-2">
                              <div className="flex items-center gap-2">
                                <Label className="text-xs w-16">Window:</Label>
                                <Input
                                  type="number"
                                  min="1"
                                  max="365"
                                  value={leftSettings.movingAverage?.windowDays || 7}
                                  onChange={(e) =>
                                    setLeftSettings({
                                      ...leftSettings,
                                      movingAverage: {
                                        ...leftSettings.movingAverage!,
                                        windowDays: parseInt(e.target.value) || 7
                                      }
                                    })
                                  }
                                  className="h-7 text-xs w-20"
                                />
                                <span className="text-xs text-muted-foreground">days</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  id="left-ma-show"
                                  checked={leftSettings.movingAverage?.showLine !== false}
                                  onCheckedChange={(checked) =>
                                    setLeftSettings({
                                      ...leftSettings,
                                      movingAverage: {
                                        ...leftSettings.movingAverage!,
                                        showLine: checked as boolean
                                      }
                                    })
                                  }
                                  className="h-3 w-3"
                                />
                                <Label htmlFor="left-ma-show" className="text-xs cursor-pointer">
                                  Show MA line on chart
                                </Label>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Y-Axis Range Section */}
                        <div className="space-y-2 border-t pt-3">
                          <div className="flex items-center gap-2">
                            <Ruler className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium">Y-Axis Range</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id="left-yaxis"
                              checked={leftSettings.yAxisRange?.enabled || false}
                              onCheckedChange={(checked) =>
                                setLeftSettings({
                                  ...leftSettings,
                                  yAxisRange: {
                                    enabled: checked as boolean,
                                    min: leftSettings.yAxisRange?.min ?? leftDomain[0],
                                    max: leftSettings.yAxisRange?.max ?? leftDomain[1]
                                  }
                                })
                              }
                              className="h-3 w-3"
                            />
                            <Label htmlFor="left-yaxis" className="text-xs cursor-pointer">
                              Custom Y-axis range
                            </Label>
                          </div>
                          {leftSettings.yAxisRange?.enabled && (
                            <div className="pl-5 space-y-2">
                              <div className="flex items-center gap-2">
                                <Label className="text-xs w-12">Min:</Label>
                                <Input
                                  type="number"
                                  step="any"
                                  value={leftSettings.yAxisRange?.min ?? ''}
                                  onChange={(e) =>
                                    setLeftSettings({
                                      ...leftSettings,
                                      yAxisRange: {
                                        ...leftSettings.yAxisRange!,
                                        min: parseFloat(e.target.value)
                                      }
                                    })
                                  }
                                  className="h-7 text-xs"
                                  placeholder="Min value"
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <Label className="text-xs w-12">Max:</Label>
                                <Input
                                  type="number"
                                  step="any"
                                  value={leftSettings.yAxisRange?.max ?? ''}
                                  onChange={(e) =>
                                    setLeftSettings({
                                      ...leftSettings,
                                      yAxisRange: {
                                        ...leftSettings.yAxisRange!,
                                        max: parseFloat(e.target.value)
                                      }
                                    })
                                  }
                                  className="h-7 text-xs"
                                  placeholder="Max value"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Right Parameter */}
              <div className="flex items-center justify-between p-1.5 rounded border bg-card/50">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Checkbox
                    id="right-param"
                    checked={rightVisible}
                    onCheckedChange={(checked) => setRightVisible(checked as boolean)}
                    className="h-3 w-3"
                  />

                  {/* Solo button - shows only this parameter */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-4 w-4 p-0 rounded-full hover:bg-accent",
                      !leftVisible && rightVisible && "bg-primary/20 hover:bg-primary/30"
                    )}
                    onClick={() => {
                      if (!leftVisible && rightVisible) {
                        // Currently solo, show both
                        setLeftVisible(true);
                      } else {
                        // Make this one solo
                        setLeftVisible(false);
                        setRightVisible(true);
                      }
                    }}
                    title={(!leftVisible && rightVisible) ? "Exit solo mode" : "Show only this parameter"}
                  >
                    <Circle className={cn(
                      "h-2.5 w-2.5",
                      !leftVisible && rightVisible ? "fill-primary text-primary" : "text-muted-foreground"
                    )} />
                  </Button>

                  <Label
                    htmlFor="right-param"
                    className="text-xs cursor-pointer truncate flex-1"
                    title={formatParameterWithSource(rightParam.parameter, rightParam.sourceType, rightParam.isSmoothed)}
                  >
                    {formatParameterWithSource(rightParam.parameter, rightParam.sourceType, rightParam.isSmoothed)}
                    {rightParam.isSmoothed && (
                      <Sparkles className="h-2.5 w-2.5 text-primary inline ml-1" title={`Smoothed from ${rightParam.originalObsCount} to ${rightParam.smoothedObsCount} observations`} />
                    )}
                  </Label>
                  <span
                    className="text-[0.6rem] font-semibold px-1 rounded"
                    style={{ color: rightColorValue, backgroundColor: `${rightColorValue}1a` }}
                  >
                    R
                  </span>

                  {/* Colored circle with color picker */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <div
                        className="w-3 h-3 rounded-full border cursor-pointer hover:ring-2 hover:ring-offset-1 transition-all"
                        style={{
                          backgroundColor: rightColorValue,
                          '--tw-ring-color': rightColorValue
                        } as React.CSSProperties}
                        title="Change color"
                      />
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-3" align="end" onClick={(e) => e.stopPropagation()}>
                      <div className="space-y-2">
                        <p className="text-xs font-medium">Pick Color</p>
                        <div className="relative">
                          <HexColorPicker
                            color={rightColor.startsWith('#') ? rightColor : cssVarToHex(rightColor)}
                            onChange={(hex) => setRightColor(hex)}
                            style={{ width: '200px', height: '150px' }}
                          />
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>

                  {/* Settings popover for time filter and MA */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-5 w-5 p-0 hover:bg-accent",
                          (rightSettings.timeFilter?.enabled || rightSettings.movingAverage?.enabled || rightSettings.yAxisRange?.enabled) && "text-primary"
                        )}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Settings className="h-3 w-3" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-3" align="end" onClick={(e) => e.stopPropagation()}>
                      <div className="space-y-4">
                        <p className="text-xs font-semibold border-b pb-2">Settings - {rightParam.parameter}</p>

                        {/* Time Filter Section */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium">Data Filter</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id="right-filter"
                              checked={rightSettings.timeFilter?.enabled || false}
                              onCheckedChange={(checked) =>
                                setRightSettings({
                                  ...rightSettings,
                                  timeFilter: {
                                    enabled: checked as boolean,
                                    excludeStart: rightSettings.timeFilter?.excludeStart || '05:00',
                                    excludeEnd: rightSettings.timeFilter?.excludeEnd || '20:00'
                                  }
                                })
                              }
                              className="h-3 w-3"
                            />
                            <Label htmlFor="right-filter" className="text-xs cursor-pointer">
                              Enable time filter
                            </Label>
                          </div>
                          {rightSettings.timeFilter?.enabled && (
                            <div className="pl-5 space-y-2">
                              <p className="text-xs text-muted-foreground">Hide data between:</p>
                              <div className="flex items-center gap-2">
                                <Label className="text-xs w-12">From:</Label>
                                <Input
                                  type="time"
                                  value={rightSettings.timeFilter?.excludeStart || '05:00'}
                                  onChange={(e) =>
                                    setRightSettings({
                                      ...rightSettings,
                                      timeFilter: {
                                        ...rightSettings.timeFilter!,
                                        excludeStart: e.target.value
                                      }
                                    })
                                  }
                                  className="h-7 text-xs"
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <Label className="text-xs w-12">To:</Label>
                                <Input
                                  type="time"
                                  value={rightSettings.timeFilter?.excludeEnd || '20:00'}
                                  onChange={(e) =>
                                    setRightSettings({
                                      ...rightSettings,
                                      timeFilter: {
                                        ...rightSettings.timeFilter!,
                                        excludeEnd: e.target.value
                                      }
                                    })
                                  }
                                  className="h-7 text-xs"
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Moving Average Section */}
                        <div className="space-y-2 border-t pt-3">
                          <div className="flex items-center gap-2">
                            <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium">Moving Average</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id="right-ma"
                              checked={rightSettings.movingAverage?.enabled || false}
                              onCheckedChange={(checked) =>
                                setRightSettings({
                                  ...rightSettings,
                                  movingAverage: {
                                    enabled: checked as boolean,
                                    windowDays: rightSettings.movingAverage?.windowDays || 7,
                                    showLine: rightSettings.movingAverage?.showLine !== false
                                  }
                                })
                              }
                              className="h-3 w-3"
                            />
                            <Label htmlFor="right-ma" className="text-xs cursor-pointer">
                              Enable moving average
                            </Label>
                          </div>
                          {rightSettings.movingAverage?.enabled && (
                            <div className="pl-5 space-y-2">
                              <div className="flex items-center gap-2">
                                <Label className="text-xs w-16">Window:</Label>
                                <Input
                                  type="number"
                                  min="1"
                                  max="365"
                                  value={rightSettings.movingAverage?.windowDays || 7}
                                  onChange={(e) =>
                                    setRightSettings({
                                      ...rightSettings,
                                      movingAverage: {
                                        ...rightSettings.movingAverage!,
                                        windowDays: parseInt(e.target.value) || 7
                                      }
                                    })
                                  }
                                  className="h-7 text-xs w-20"
                                />
                                <span className="text-xs text-muted-foreground">days</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  id="right-ma-show"
                                  checked={rightSettings.movingAverage?.showLine !== false}
                                  onCheckedChange={(checked) =>
                                    setRightSettings({
                                      ...rightSettings,
                                      movingAverage: {
                                        ...rightSettings.movingAverage!,
                                        showLine: checked as boolean
                                      }
                                    })
                                  }
                                  className="h-3 w-3"
                                />
                                <Label htmlFor="right-ma-show" className="text-xs cursor-pointer">
                                  Show MA line on chart
                                </Label>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Y-Axis Range Section */}
                        <div className="space-y-2 border-t pt-3">
                          <div className="flex items-center gap-2">
                            <Ruler className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium">Y-Axis Range</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id="right-yaxis"
                              checked={rightSettings.yAxisRange?.enabled || false}
                              onCheckedChange={(checked) =>
                                setRightSettings({
                                  ...rightSettings,
                                  yAxisRange: {
                                    enabled: checked as boolean,
                                    min: rightSettings.yAxisRange?.min ?? rightDomain[0],
                                    max: rightSettings.yAxisRange?.max ?? rightDomain[1]
                                  }
                                })
                              }
                              className="h-3 w-3"
                            />
                            <Label htmlFor="right-yaxis" className="text-xs cursor-pointer">
                              Custom Y-axis range
                            </Label>
                          </div>
                          {rightSettings.yAxisRange?.enabled && (
                            <div className="pl-5 space-y-2">
                              <div className="flex items-center gap-2">
                                <Label className="text-xs w-12">Min:</Label>
                                <Input
                                  type="number"
                                  step="any"
                                  value={rightSettings.yAxisRange?.min ?? ''}
                                  onChange={(e) =>
                                    setRightSettings({
                                      ...rightSettings,
                                      yAxisRange: {
                                        ...rightSettings.yAxisRange!,
                                        min: parseFloat(e.target.value)
                                      }
                                    })
                                  }
                                  className="h-7 text-xs"
                                  placeholder="Min value"
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <Label className="text-xs w-12">Max:</Label>
                                <Input
                                  type="number"
                                  step="any"
                                  value={rightSettings.yAxisRange?.max ?? ''}
                                  onChange={(e) =>
                                    setRightSettings({
                                      ...rightSettings,
                                      yAxisRange: {
                                        ...rightSettings.yAxisRange!,
                                        max: parseFloat(e.target.value)
                                      }
                                    })
                                  }
                                  className="h-7 text-xs"
                                  placeholder="Max value"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
