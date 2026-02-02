"use client";

import React, { useState, useRef, useCallback, useMemo, useEffect, memo } from "react";
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlusCircle, LayoutGrid, Minus, AlignHorizontalJustifyCenter, Save, FolderOpen, BookOpen } from "lucide-react";

import { PinPlotInstance } from "./PinPlotInstance";
import { PinMarineMeteoPlot } from "./PinMarineMeteoPlot";
import { FileSelectionDialog } from "./FileSelectionDialog";
import { PlotTypeSelector } from "./PlotTypeSelector";
import { MergeRulesDialog, DEFAULT_MERGE_RULES, type MergeRule } from "./MergeRulesDialog";
import { SavePlotViewDialog } from "./SavePlotViewDialog";
import { LoadPlotViewDialog } from "./LoadPlotViewDialog";
import { PresenceAbsenceDialog, type PresenceAbsenceResult } from "./PresenceAbsenceDialog";
import { PresenceAbsenceTable } from "./PresenceAbsenceTable";
import { MethodologyModal } from "@/components/methodology";
import { parseISO, isValid, formatISO, format } from 'date-fns';
import { useToast } from "@/hooks/use-toast";
import { parseHaplotypeCsv, type ParseResult, type HaplotypeParseResult } from "./csvParser";
import type { CombinedDataPoint } from "@/app/om-marine-explorer/shared";
import type { SavedPlotViewConfig, SavedPlotView, PlotViewValidationResult } from "@/lib/supabase/plot-view-types";
import type { PinFile } from "@/lib/supabase/file-storage-service";
import { getFpodSuffix, getFpodBaseName } from "@/lib/fpod-file-pairing";

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
  fileType?: 'GP' | 'FPOD' | 'Subcam';
  files?: File[];
  location?: { lat: number; lon: number };
  timeRange?: { startDate: string; endDate: string };
  // Smoothing metadata
  isSmoothed?: boolean;
  originalObsCount?: number;
  smoothedObsCount?: number;
  // Parameter-specific settings (time filter, MA, y-axis range)
  settings?: ParameterSettings;
}

interface PlotConfig {
  id: string;
  title: string;
  type: 'device' | 'marine-meteo' | 'presence-absence';
  // For device plots
  fileType?: 'GP' | 'FPOD' | 'Subcam';
  files?: File[];
  fileName?: string; // Display name of the file(s)
  fileId?: string; // Database ID of the file for restoration
  pinId?: string; // Pin ID for saving corrected files to database
  // File metadata for header display
  pinLabel?: string; // Location name (e.g., "Control_S", "Farm_AS")
  startDate?: Date; // Start date of data
  endDate?: Date; // End date of data
  fileCategories?: string[]; // Categories (e.g., ["Sediment", "Haplotypes"])
  // For marine/meteo plots
  location?: { lat: number; lon: number };
  locationName?: string;
  timeRange?: { startDate: string; endDate: string };
  // For merged plots
  isMerged?: boolean;
  mergedData?: ParseResult; // Pre-parsed merged data
  mergedParams?: MergedParameterConfig[];
  // For computed plots (subtraction/merge operations)
  computationType?: 'subtract' | 'merge';
  sourcePlotIds?: string[]; // IDs of source plots used in computation
  // Display overrides for paired FPOD plots
  hideBrush?: boolean;
  showDateTimeAxis?: boolean;
  // Location coordinates for sunrise/sunset shading
  coordinates?: { lat: number; lng: number };
  computationParams?: {
    param1: string;
    param2: string;
    resultParam?: string;
  };
  computationConfig?: {
    direction?: '1-2' | '2-1'; // For subtraction
    missingDataMode?: 'skip' | 'zero'; // How to handle missing data
  };
  // For presence-absence plots
  presenceAbsenceData?: any; // Will be imported from PresenceAbsenceDialog
}

interface PinFile {
  id: string;
  pinId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileType: string;
  uploadedAt: Date;
  projectId: string;
}

interface FileOption {
  pinId: string;
  pinName: string;
  pinLocation?: { lat: number; lng: number };
  fileType: 'GP' | 'FPOD' | 'Subcam' | 'CROP' | 'CHEM' | 'CHEMSW' | 'CHEMWQ' | 'WQ' | 'MERGED';
  files: File[];
  fileName: string;
  metadata?: PinFile; // Include metadata for downloading
  needsDownload?: boolean; // Indicates file needs to be downloaded before use
}

interface PinMarineDeviceDataProps {
  fileType: 'GP' | 'FPOD' | 'Subcam' | 'CROP' | 'CHEM' | 'CHEMSW' | 'CHEMWQ' | 'WQ' | 'EDNA';
  files: File[];
  selectedFileMetadata?: {
    pinLabel?: string;
    startDate?: Date;
    endDate?: Date;
    fileCategories?: string[];
    coordinates?: { lat: number; lng: number };
  } | null;
  onRequestFileSelection?: () => void; // Callback to open file selector
  // Props for multi-file support
  availableFiles?: FileOption[];
  onDownloadFile?: (pinId: string | null, fileName: string, areaId?: string | null, metadata?: PinFile) => Promise<File | null>; // Callback to download file on-demand
  multiFileMergeMode?: 'sequential' | 'stack-parameters'; // Merge mode for multi-file selection
  // Props for marine/meteo integration
  objectLocation?: { lat: number; lng: number };
  objectName?: string;
  // Props for FileSelectionDialog (DataTimeline integration)
  allProjectFilesForTimeline?: (PinFile & { pinLabel: string })[];
  getFileDateRange?: (file: PinFile) => Promise<{
    totalDays: number | null;
    startDate: string | null;
    endDate: string | null;
    uniqueDates?: string[];
    isCrop?: boolean;
    error?: string;
  }>;
  projectId?: string;
  onRefreshFiles?: () => Promise<void>; // Callback to refresh file list when dialog opens
  availableProjects?: Array<{ id: string; name: string }>; // Available projects for cross-project selection
  // Auto-load saved plot view
  initialViewToLoad?: string; // Plot view ID to auto-load on mount
}

// Helper function to map fileType to tileName for methodology modal
function getTileNameFromFileType(fileType: PinMarineDeviceDataProps['fileType']): 'SubCam' | 'GrowProbe' | 'FPOD' | 'Water and Crop Samples' | 'eDNA' {
  switch (fileType) {
    case 'GP':
      return 'GrowProbe';
    case 'FPOD':
      return 'FPOD';
    case 'Subcam':
      return 'SubCam';
    case 'CROP':
    case 'CHEM':
    case 'CHEMSW':
    case 'CHEMWQ':
    case 'WQ':
      return 'Water and Crop Samples';
    case 'EDNA':
      return 'eDNA';
    default:
      return 'Water and Crop Samples'; // Default fallback
  }
}

function PinMarineDeviceData({ fileType, files, selectedFileMetadata, onRequestFileSelection, availableFiles, onDownloadFile, multiFileMergeMode = 'sequential', objectLocation, objectName, allProjectFilesForTimeline, getFileDateRange, projectId, onRefreshFiles, availableProjects, initialViewToLoad }: PinMarineDeviceDataProps) {
  const { toast } = useToast();

  // Derive tileName from fileType for methodology modal
  const tileName = getTileNameFromFileType(fileType);

  // State for managing plots with file data
  const [plots, setPlots] = useState<PlotConfig[]>([]);
  const plotsInitialized = useRef(false);
  const autoLoadInProgress = useRef(false);
  const [showFileSelector, setShowFileSelector] = useState(false);
  const [showPlotTypeSelector, setShowPlotTypeSelector] = useState(false);

  // Time axis synchronization state
  const [timeAxisMode, setTimeAxisMode] = useState<'separate' | 'common'>('separate');
  const [globalTimeRange, setGlobalTimeRange] = useState<{ min: Date | null; max: Date | null }>({ min: null, max: null });
  const [globalBrushRange, setGlobalBrushRange] = useState<{ startIndex: number; endIndex: number | undefined }>({ startIndex: 0, endIndex: undefined });
  const [plotsData, setPlotsData] = useState<Record<string, ParseResult>>({});

  // Visibility tracking for merge feature
  const [plotVisibilityState, setPlotVisibilityState] = useState<
    Record<string, {
      params: string[],
      colors: Record<string, string>,
      settings?: Record<string, any>,
      plotSettings?: {
        axisMode?: 'single' | 'multi';
        customYAxisLabel?: string;
        compactView?: boolean;
        customParameterNames?: Record<string, string>;
      }
    }>
  >({});

  // CSV preview for merge
  const [showMergePreview, setShowMergePreview] = useState(false);
  const [mergePreviewData, setMergePreviewData] = useState<ParseResult | null>(null);
  const [mergeRawData, setMergeRawData] = useState<ParseResult | null>(null); // Unrounded data
  const [timeRoundingInterval, setTimeRoundingInterval] = useState<string>('1hr'); // Default 1 hour

  // Refresh file list when file selector dialog opens
  useEffect(() => {
    if (showFileSelector && onRefreshFiles) {
      onRefreshFiles().catch(err => {
        console.error('Failed to refresh files:', err);
      });
    }
  }, [showFileSelector, onRefreshFiles]);

  // CSV preview for subtract
  const [showSubtractPreview, setShowSubtractPreview] = useState(false);
  const [subtractPreviewData, setSubtractPreviewData] = useState<ParseResult | null>(null);
  const [subtractRawData, setSubtractRawData] = useState<ParseResult | null>(null);
  const [subtractDirection, setSubtractDirection] = useState<'1-2' | '2-1'>('1-2'); // Plot1 - Plot2 by default
  const [subtractMissingDataMode, setSubtractMissingDataMode] = useState<'skip' | 'zero'>('skip'); // Skip by default
  const [subtractUnitsWarning, setSubtractUnitsWarning] = useState<string | null>(null);

  // Sparse data smoothing state
  const [smoothingApplied, setSmoothingApplied] = useState(false);
  const [smoothedParameterName, setSmoothedParameterName] = useState<string | null>(null);
  const [originalObsCount, setOriginalObsCount] = useState<number>(0);
  const [smoothedObsCount, setSmoothedObsCount] = useState<number>(0);

  // Multi-file confirmation dialog state
  const [showMultiFileConfirmDialog, setShowMultiFileConfirmDialog] = useState(false);
  const [multiFileConfirmData, setMultiFileConfirmData] = useState<{
    parsedFiles: any[];
    validation: any;
    downloadedFiles: File[];
    fileType: 'GP' | 'FPOD' | 'Subcam';
  } | null>(null);
  const [mergeRules, setMergeRules] = useState<MergeRule[]>(DEFAULT_MERGE_RULES);

  // Save/Load Plot View state
  const [showSavePlotViewDialog, setShowSavePlotViewDialog] = useState(false);
  const [showLoadPlotViewDialog, setShowLoadPlotViewDialog] = useState(false);
  const [serializedViewConfig, setSerializedViewConfig] = useState<SavedPlotViewConfig | null>(null);
  const [showMethodologyModal, setShowMethodologyModal] = useState(false);

  // Presence-Absence dialog state
  const [showPresenceAbsenceDialog, setShowPresenceAbsenceDialog] = useState(false);
  const [presenceAbsenceFiles, setPresenceAbsenceFiles] = useState<Array<{ fileName: string; parsedData: HaplotypeParseResult; selected: boolean }>>([]);

  // Merge rule toggle handler
  const handleMergeRuleToggle = useCallback((suffix: string, enabled: boolean) => {
    setMergeRules(prevRules =>
      prevRules.map(rule =>
        rule.suffix === suffix ? { ...rule, enabled } : rule
      )
    );
  }, []);

  // Get file display name
  const getFileName = useCallback((fileList: File[]) => {
    if (fileList.length === 0) return 'No files';
    if (fileList.length === 1) return fileList[0].name;
    return `${fileList.length} files`;
  }, []);

  // Time rounding function
  const roundTimeToInterval = useCallback((isoTimeStr: string, interval: string): string => {
    const date = parseISO(isoTimeStr);
    if (!isValid(date)) return isoTimeStr;

    const minutes = date.getMinutes();
    const hours = date.getHours();
    const days = date.getDate();

    let roundedDate = new Date(date);

    switch (interval) {
      case '1min':
        // Round to nearest minute (already at minute precision)
        roundedDate.setSeconds(0, 0);
        break;
      case '10min':
        // Round to nearest 10 minutes
        roundedDate.setMinutes(Math.round(minutes / 10) * 10, 0, 0);
        break;
      case '30min':
        // Round to nearest 30 minutes
        roundedDate.setMinutes(Math.round(minutes / 30) * 30, 0, 0);
        break;
      case '1hr':
        // Round to nearest hour
        roundedDate.setMinutes(Math.round(minutes / 60) * 60, 0, 0);
        break;
      case '6hr':
        // Round to nearest 6 hours
        const totalHours = hours + (minutes / 60);
        const rounded6hr = Math.round(totalHours / 6) * 6;
        roundedDate.setHours(rounded6hr, 0, 0, 0);
        break;
      case '1day':
        // Round to nearest day (midnight)
        roundedDate.setHours(hours >= 12 ? 24 : 0, 0, 0, 0);
        break;
      default:
        roundedDate.setSeconds(0, 0);
    }

    return roundedDate.toISOString();
  }, []);

  // Apply time rounding to merged data
  const applyTimeRounding = useCallback((data: ParseResult, interval: string): ParseResult => {
    console.log('🔄 applyTimeRounding called with interval:', interval);

    // Group by rounded time and aggregate values
    const roundedGroups = new Map<string, any[]>();

    data.data.forEach(row => {
      const roundedTime = roundTimeToInterval(row.time, interval);
      if (!roundedGroups.has(roundedTime)) {
        roundedGroups.set(roundedTime, []);
      }
      roundedGroups.get(roundedTime)!.push(row);
    });

    // For each rounded time, aggregate the values (take first non-null for each parameter)
    const aggregatedData = Array.from(roundedGroups.entries()).map(([time, rows]) => {
      const aggregated: any = { time };

      // Get all parameter names (excluding time)
      const params = data.headers.filter(h => h !== 'time');

      params.forEach(param => {
        // Find first non-null value for this parameter
        const nonNullRow = rows.find(r => r[param] !== null && r[param] !== undefined);
        aggregated[param] = nonNullRow?.[param] ?? null;
      });

      return aggregated;
    });

    // Sort by time
    aggregatedData.sort((a, b) => a.time.localeCompare(b.time));

    // Get parameter names (excluding time)
    const params = data.headers.filter(h => h !== 'time');

    // Find the time range where ANY parameter has non-zero/non-null values
    // Changed from .every() to .some() to show full time range in merged plots
    let startIdx = -1;
    let endIdx = -1;

    // Find first row where at least one parameter has a value
    for (let i = 0; i < aggregatedData.length; i++) {
      const row = aggregatedData[i];
      const hasAnyParam = params.some(param => {
        const val = row[param];
        return val !== null && val !== undefined && val !== 0 && !isNaN(Number(val));
      });
      if (hasAnyParam) {
        startIdx = i;
        break;
      }
    }

    // Find last row where at least one parameter has a value
    for (let i = aggregatedData.length - 1; i >= 0; i--) {
      const row = aggregatedData[i];
      const hasAnyParam = params.some(param => {
        const val = row[param];
        return val !== null && val !== undefined && val !== 0 && !isNaN(Number(val));
      });
      if (hasAnyParam) {
        endIdx = i;
        break;
      }
    }

    // Trim the data to only remove completely empty edges
    const trimmedData = (startIdx >= 0 && endIdx >= startIdx)
      ? aggregatedData.slice(startIdx, endIdx + 1)
      : aggregatedData; // Keep all data if we couldn't find any valid data

    console.log('⏱️ Time rounding applied:', {
      interval,
      originalRows: data.data.length,
      roundedRows: aggregatedData.length,
      trimmedRows: trimmedData.length,
      trimRange: { startIdx, endIdx },
      sampleBeforeTrim: aggregatedData.slice(0, 3),
      sampleAfterTrim: trimmedData.slice(0, 3),
      parametersInHeaders: data.headers,
      nonNullCountsBeforeTrim: params.map(param => ({
        param,
        nonNullCount: aggregatedData.filter(row => row[param] !== null && row[param] !== undefined && row[param] !== 0).length
      })),
      nonNullCountsAfterTrim: params.map(param => ({
        param,
        nonNullCount: trimmedData.filter(row => row[param] !== null && row[param] !== undefined && row[param] !== 0).length
      }))
    });

    return {
      ...data,
      data: trimmedData,
      summary: {
        ...data.summary,
        totalRows: trimmedData.length,
        validRows: trimmedData.length
      }
    };
  }, [roundTimeToInterval]);

  // Detect sparse/dense scenario in merged data
  const detectSparseDenseScenario = useCallback((data: ParseResult): {
    isSparse: boolean;
    sparseParam: string | null;
    denseParam: string | null;
    ratio: number;
    sparseCount: number;
    denseCount: number;
  } | null => {
    if (!data || data.headers.length !== 3) return null; // Should have time + 2 parameters

    const param1 = data.headers[1];
    const param2 = data.headers[2];

    // Count non-null observations for each parameter
    const param1Count = data.data.filter(row =>
      row[param1] !== null && row[param1] !== undefined && !isNaN(Number(row[param1]))
    ).length;

    const param2Count = data.data.filter(row =>
      row[param2] !== null && row[param2] !== undefined && !isNaN(Number(row[param2]))
    ).length;

    // Determine which is sparse and which is dense
    const ratio = Math.max(param1Count, param2Count) / Math.min(param1Count, param2Count);

    // Sparse/dense if ratio exceeds 2:1
    if (ratio >= 2) {
      const sparseParam = param1Count < param2Count ? param1 : param2;
      const denseParam = param1Count < param2Count ? param2 : param1;
      const sparseCount = Math.min(param1Count, param2Count);
      const denseCount = Math.max(param1Count, param2Count);

      return {
        isSparse: true,
        sparseParam,
        denseParam,
        ratio,
        sparseCount,
        denseCount
      };
    }

    return null;
  }, []);

  // Apply cubic spline smoothing to sparse data
  const applySmoothingToData = useCallback(async (data: ParseResult): Promise<ParseResult> => {
    const scenario = detectSparseDenseScenario(data);
    if (!scenario || !scenario.isSparse || !scenario.sparseParam || !scenario.denseParam) {
      console.log('No sparse/dense scenario detected, returning original data');
      return data;
    }

    // Import interpolation function
    const { smoothSparseData } = await import('@/utils/interpolation');

    const sparseParam = scenario.sparseParam;
    const denseParam = scenario.denseParam;

    console.log('🔄 Applying smoothing:', {
      sparseParam,
      denseParam,
      sparseCount: scenario.sparseCount,
      denseCount: scenario.denseCount,
      ratio: scenario.ratio
    });

    // Extract sparse data points
    const sparsePoints = data.data
      .map(row => ({
        time: row.time,
        value: row[sparseParam] as number | null
      }))
      .filter(p => p.value !== null && !isNaN(p.value));

    // Get time range for sparse data
    const sparseTimes = sparsePoints.map(p => new Date(p.time).getTime());
    const sparseTimeRange = {
      min: new Date(Math.min(...sparseTimes)).toISOString(),
      max: new Date(Math.max(...sparseTimes)).toISOString()
    };

    // Get all timestamps from dense parameter
    const denseTimestamps = data.data
      .filter(row => row[denseParam] !== null && row[denseParam] !== undefined)
      .map(row => row.time);

    // Perform smoothing
    const smoothedData = smoothSparseData(
      sparsePoints.map(p => ({ time: p.time, value: p.value as number })),
      denseTimestamps,
      sparseTimeRange
    );

    console.log('✅ Smoothing complete:', {
      originalSparsePoints: sparsePoints.length,
      smoothedPoints: smoothedData.length
    });

    // Create new dataset with smoothed values
    // Build a map of smoothed values by time
    const smoothedMap = new Map(
      smoothedData.map(d => [d.time, d.value])
    );

    // Merge smoothed data back into the dataset
    const newData = data.data.map(row => {
      const smoothedValue = smoothedMap.get(row.time);
      if (smoothedValue !== undefined && smoothedValue !== null) {
        return {
          ...row,
          [sparseParam]: smoothedValue
        };
      }
      return row;
    });

    // Store smoothing metadata
    setSmoothedParameterName(sparseParam);
    setOriginalObsCount(scenario.sparseCount);
    setSmoothedObsCount(smoothedData.filter(d => d.value !== null).length);
    setSmoothingApplied(true);

    return {
      ...data,
      data: newData,
      summary: {
        ...data.summary,
        totalRows: newData.length,
        validRows: newData.length
      }
    };
  }, [detectSparseDenseScenario]);

  // Calculate global time range from brush-selected range of first plot
  const calculateGlobalTimeRange = useCallback(() => {
    // Get first plot's data as reference
    if (plots.length === 0) return { min: null, max: null };

    const firstPlot = plots[0];
    const firstPlotData = plotsData[firstPlot.id];

    if (!firstPlotData || firstPlotData.data.length === 0) {
      return { min: null, max: null };
    }

    // Use brush range to determine visible time range
    const startIdx = Math.max(0, globalBrushRange.startIndex);
    const endIdx = Math.min(
      firstPlotData.data.length - 1,
      globalBrushRange.endIndex ?? firstPlotData.data.length - 1
    );

    // Safety check: ensure indices are within bounds
    if (startIdx >= firstPlotData.data.length || endIdx >= firstPlotData.data.length) {
      return { min: null, max: null };
    }

    const startPoint = firstPlotData.data[startIdx];
    const endPoint = firstPlotData.data[endIdx];

    // Safety check: ensure data points have time property
    if (!startPoint?.time || !endPoint?.time) {
      return { min: null, max: null };
    }

    const startDate = parseISO(startPoint.time);
    const endDate = parseISO(endPoint.time);

    if (!isValid(startDate) || !isValid(endDate)) {
      return { min: null, max: null };
    }

    return {
      min: startDate,
      max: endDate,
    };
  }, [plots, plotsData, globalBrushRange]);

  // Update global time range when plots data changes, mode changes, or brush changes
  useEffect(() => {
    if (timeAxisMode === 'common') {
      const range = calculateGlobalTimeRange();
      // Only update if the range has actually changed
      setGlobalTimeRange(prev => {
        if (prev.min?.getTime() === range.min?.getTime() &&
            prev.max?.getTime() === range.max?.getTime()) {
          return prev; // Don't trigger re-render if values are the same
        }
        return range;
      });
    }
  }, [timeAxisMode, plotsData, globalBrushRange, calculateGlobalTimeRange]);

  // Callback for plots to register their data
  const handlePlotDataParsed = useCallback((plotId: string, data: ParseResult | CombinedDataPoint[]) => {
    // Convert CombinedDataPoint[] to ParseResult format for marine/meteo
    if (Array.isArray(data) && data.length > 0 && 'waveHeight' in data[0]) {
      // Marine/meteo data - convert to ParseResult format
      const marineParseResult: ParseResult = {
        data: data.map(d => ({ time: d.time, ...d })) as any,
        headers: Object.keys(data[0]),
        errors: [],
        summary: {
          totalRows: data.length,
          validRows: data.length,
          columns: Object.keys(data[0]).length,
          timeColumn: 'time'
        }
      };
      setPlotsData((prev) => ({ ...prev, [plotId]: marineParseResult }));
    } else {
      // Device data (existing logic)
      setPlotsData((prev) => ({ ...prev, [plotId]: data as ParseResult }));
    }
  }, []);

  // Callback for brush changes in common mode
  const handleGlobalBrushChange = useCallback((brushData: { startIndex?: number; endIndex?: number }) => {
    setGlobalBrushRange({
      startIndex: brushData.startIndex ?? 0,
      endIndex: brushData.endIndex,
    });
  }, []);

  // Helper to extract time range from first plot
  const extractTimeRangeFromPlotData = useCallback((parseResult: ParseResult): { startDate: string; endDate: string } | null => {
    try {
      console.log('[EXTRACT TIME RANGE] First 5 time values from parseResult:', parseResult.data.slice(0, 5).map(d => d.time));

      const dates = parseResult.data
        .map(d => parseISO(d.time))
        .filter(isValid);

      if (dates.length === 0) return null;

      const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
      const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));

      console.log('[EXTRACT TIME RANGE] Min date:', minDate.toISOString());
      console.log('[EXTRACT TIME RANGE] Max date:', maxDate.toISOString());

      const result = {
        startDate: formatISO(minDate, { representation: 'date' }),
        endDate: formatISO(maxDate, { representation: 'date' })
      };

      console.log('[EXTRACT TIME RANGE] Extracted range:', result);

      return result;
    } catch (e) {
      console.error('Error extracting time range:', e);
      return null;
    }
  }, []);

  // Serialize current plot state for saving
  const serializePlotViewState = useCallback(async (): Promise<SavedPlotViewConfig> => {
    // Calculate date range display
    const calculateDateRangeDisplay = (): string => {
      const allDates: Date[] = [];

      Object.values(plotsData).forEach(plotData => {
        if (plotData && plotData.data.length > 0) {
          plotData.data.forEach(row => {
            const date = parseISO(row.time);
            if (isValid(date)) {
              allDates.push(date);
            }
          });
        }
      });

      if (allDates.length === 0) return 'No data';

      const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
      const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));

      return `${format(minDate, 'MMM d, yyyy')} - ${format(maxDate, 'MMM d, yyyy')}`;
    };

    // Look up missing fileIds from database
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();

    // Log plotVisibilityState before saving
    console.log('💾 [SAVE] plotVisibilityState:', JSON.stringify(plotVisibilityState, null, 2));
    Object.keys(plotVisibilityState).forEach(plotId => {
      const state = plotVisibilityState[plotId];
      console.log(`💾 [SAVE] Plot ${plotId}:`, {
        params: state.params,
        colors: state.colors,
        hasSettings: !!state.settings,
        settings: state.settings
      });
    });

    const plotsWithFileIds = await Promise.all(plots.map(async (plot) => {
      let fileId = plot.fileId;

      // If fileId is missing but we have a fileName, look it up
      if (!fileId && plot.fileName && plot.type === 'device') {
        console.log(`🔍 [SAVE] Looking up fileId for "${plot.fileName}"...`);

        // Try pin_files first
        const { data: pinFile } = await supabase
          .from('pin_files')
          .select('id')
          .eq('file_name', plot.fileName)
          .limit(1)
          .single();

        if (pinFile) {
          fileId = pinFile.id;
          console.log(`✅ [SAVE] Found fileId in pin_files: ${fileId}`);
        } else {
          // Try merged_files
          const { data: mergedFile} = await supabase
            .from('merged_files')
            .select('id')
            .eq('file_name', plot.fileName)
            .limit(1)
            .single();

          if (mergedFile) {
            fileId = mergedFile.id;
            console.log(`✅ [SAVE] Found fileId in merged_files: ${fileId}`);
          } else {
            console.warn(`⚠️ [SAVE] Could not find fileId for "${plot.fileName}"`);
          }
        }
      }

      return {
        id: plot.id,
        title: plot.title,
        type: plot.type,
        fileType: plot.fileType,
        pinId: plot.pinId,
        fileName: plot.fileName,
        fileId, // Use looked-up fileId if it was missing
        location: plot.location,
        locationName: plot.locationName,
        timeRange: plot.timeRange,
        isMerged: plot.isMerged,
        mergedParams: plot.mergedParams,
        // Computation metadata for save/restore
        computationType: plot.computationType,
        sourcePlotIds: plot.sourcePlotIds,
        computationParams: plot.computationParams,
        computationConfig: plot.computationConfig,
        visibleParameters: plotVisibilityState[plot.id]?.params || [],
        parameterColors: plotVisibilityState[plot.id]?.colors || {},
        // Capture full parameter settings (opacity, lineStyle, lineWidth, filters, MA)
        parameterSettings: plotVisibilityState[plot.id]?.settings || undefined,
        // Capture plot-level settings (axisMode, customYAxisLabel, compactView, customParameterNames)
        axisMode: plotVisibilityState[plot.id]?.plotSettings?.axisMode,
        customYAxisLabel: plotVisibilityState[plot.id]?.plotSettings?.customYAxisLabel,
        compactView: plotVisibilityState[plot.id]?.plotSettings?.compactView,
        customParameterNames: plotVisibilityState[plot.id]?.plotSettings?.customParameterNames
      };

      console.log(`💾 [SAVE] Serialized plot "${plotConfig.title}":`, {
        id: plotConfig.id,
        visibleParameters: plotConfig.visibleParameters,
        colorCount: Object.keys(plotConfig.parameterColors).length,
        hasSettings: !!plotConfig.parameterSettings,
        parameterSettings: plotConfig.parameterSettings
      });

      return plotConfig;
    }));

    return {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      timeAxisMode,
      globalBrushRange,
      plots: plotsWithFileIds,
      timeRoundingInterval,
      mergeRules,
      metadata: {
        totalPlots: plotsWithFileIds.length,
        datasetNames: plotsWithFileIds.map(p => p.fileName || p.locationName || p.title || 'Unknown'),
        dateRangeDisplay: calculateDateRangeDisplay()
      }
    };
  }, [plots, plotsData, plotVisibilityState, timeAxisMode, globalBrushRange, timeRoundingInterval, mergeRules]);

  // Deserialize and restore plot state
  const restorePlotViewState = useCallback(async (
    view: SavedPlotView,
    validation: PlotViewValidationResult
  ) => {
    try {
      console.log('🎨 [RESTORE] Starting plot view restoration:', view.name);
      console.log('🎨 [RESTORE] View created at:', view.created_at);

      const config = view.view_config;

      console.log('🎨 [RESTORE] View config details:', {
        totalPlots: config.metadata.totalPlots,
        timeAxisMode: config.timeAxisMode,
        globalBrushRange: config.globalBrushRange,
        timeRoundingInterval: config.timeRoundingInterval,
        mergeRulesCount: config.mergeRules.length
      });

      console.log('📋 [RESTORE] RAW config.plots from saved view:', config.plots.length, 'plots');
      config.plots.forEach((plot, idx) => {
        console.log(`📋 [RESTORE] Saved Plot ${idx + 1}:`, {
          id: plot.id,
          title: plot.title,
          fileName: plot.fileName,
          type: plot.type,
          fileId: plot.fileId
        });
      });

      console.log('🔍 [RESTORE] Validation result:', {
        availablePlotIds: validation.availablePlotIds,
        unavailablePlotIds: validation.unavailablePlotIds,
        hasWarnings: validation.hasWarnings
      });

      // Filter plots to only include those with available files
      const availablePlots = config.plots.filter(plot => {
        const isAvailable = validation.availablePlotIds.includes(plot.id);
        console.log(`🔍 [RESTORE] Checking plot "${plot.title}" (${plot.id}): ${isAvailable ? '✅ AVAILABLE' : '❌ FILTERED OUT'}`);
        return isAvailable;
      });

      console.log('🎨 [RESTORE] Plot availability:', {
        totalInView: config.plots.length,
        available: availablePlots.length,
        unavailable: config.plots.length - availablePlots.length,
        availableIds: availablePlots.map(p => p.id)
      });

      if (availablePlots.length === 0) {
        console.error('❌ [RESTORE] No plots available to restore');
        toast({
          variant: "destructive",
          title: "Cannot Restore View",
          description: "None of the plots in this view can be restored"
        });
        return;
      }

      // Show warning if some plots are missing
      if (availablePlots.length < config.plots.length) {
        console.warn('⚠️ [RESTORE] Partial restoration - some files unavailable');
        toast({
          variant: "default",
          title: "Partial Restore",
          description: `Restored ${availablePlots.length} of ${config.plots.length} plots. Some files are no longer available.`
        });
      }

      console.log('⚙️ [RESTORE] Restoring time axis configuration...');
      // Restore time axis configuration
      setTimeAxisMode(config.timeAxisMode);
      setGlobalBrushRange(config.globalBrushRange);

      console.log('⚙️ [RESTORE] Restoring settings...');
      // Restore settings
      setTimeRoundingInterval(config.timeRoundingInterval);
      setMergeRules(config.mergeRules);

      // Restore plots - download files for device plots
      console.log('📥 [RESTORE] Starting plot restoration. Available plots:', availablePlots.length);

      // Log each plot's data
      availablePlots.forEach((plot, idx) => {
        console.log(`📊 [RESTORE] Plot ${idx + 1}/${availablePlots.length}:`, {
          id: plot.id,
          title: plot.title,
          type: plot.type,
          location: plot.location,
          locationName: plot.locationName,
          timeRange: plot.timeRange,
          fileId: plot.fileId,
          fileName: plot.fileName,
          visibleParameters: plot.visibleParameters,
          hasColors: Object.keys(plot.parameterColors).length > 0
        });
      });

      console.log('📦 [RESTORE] Starting file downloads for device plots...');

      console.log('🚀 [RESTORE] Starting Promise.all with', availablePlots.length, 'plots');

      const restoredPlots: PlotConfig[] = await Promise.all(
        availablePlots.map(async (savedPlot, idx) => {
          console.log(`📦 [RESTORE] START processing plot ${idx + 1}/${availablePlots.length}: "${savedPlot.title}"`);
          console.log(`🔍 [RESTORE] savedPlot details:`, {
            type: savedPlot.type,
            fileId: savedPlot.fileId,
            fileName: savedPlot.fileName,
            fileType: savedPlot.fileType,
            pinId: savedPlot.pinId,
            hasFileId: !!savedPlot.fileId,
            entireObject: savedPlot
          });
          let downloadedFiles: File[] = [];

          // Skip file download for computed plots - they will be recreated after restoration
          if (savedPlot.computationType) {
            console.log(`🧮 [RESTORE] Skipping file download for computed plot "${savedPlot.title}" - will be recreated from source plots`);
          }
          // If it's a device plot with a file ID, download the file
          else if (savedPlot.type === 'device' && savedPlot.fileName) {
            try {
              let fileIdToUse = savedPlot.fileId;

              // FALLBACK: If fileId is missing (old saved plots), look it up by fileName
              if (!fileIdToUse) {
                console.warn(`⚠️ [RESTORE] fileId missing for "${savedPlot.fileName}", attempting lookup by fileName...`);

                const { createClient } = await import('@/lib/supabase/client');
                const supabase = createClient();

                // Try to find the file by name in pin_files table
                const { data: fileRecord, error: lookupError } = await supabase
                  .from('pin_files')
                  .select('id, file_name')
                  .eq('file_name', savedPlot.fileName)
                  .limit(1)
                  .single();

                if (lookupError || !fileRecord) {
                  console.error(`❌ [RESTORE] Could not find file "${savedPlot.fileName}" in database:`, lookupError);

                  // Try merged_files table as fallback
                  const { data: mergedRecord, error: mergedLookupError } = await supabase
                    .from('merged_files')
                    .select('id, file_name')
                    .eq('file_name', savedPlot.fileName)
                    .limit(1)
                    .single();

                  if (mergedLookupError || !mergedRecord) {
                    console.error(`❌ [RESTORE] File not found in merged_files either:`, mergedLookupError);
                  } else {
                    fileIdToUse = mergedRecord.id;
                    console.log(`✅ [RESTORE] Found file in merged_files table: ${fileIdToUse}`);
                  }
                } else {
                  fileIdToUse = fileRecord.id;
                  console.log(`✅ [RESTORE] Found file in pin_files table: ${fileIdToUse}`);
                }
              }

              if (!fileIdToUse) {
                console.error(`❌ [RESTORE] Cannot download file - no fileId available for "${savedPlot.fileName}"`);
                throw new Error(`File "${savedPlot.fileName}" not found in database`);
              }

              console.log(`📥 [RESTORE] Plot is device type, downloading file...`, {
                fileName: savedPlot.fileName,
                fileId: fileIdToUse,
                fileType: savedPlot.fileType,
                wasLookedUp: !savedPlot.fileId
              });

              // Import the file storage service
              const { fileStorageService } = await import('@/lib/supabase/file-storage-service');

              // Download the file by ID (will query database for path first)
              const result = await fileStorageService.downloadFileById(fileIdToUse);

              console.log(`📥 [RESTORE] Download result for "${savedPlot.title}":`, {
                success: result.success,
                hasData: !!result.data,
                error: result.error,
                blobSize: result.data?.blob.size
              });

              if (result.success && result.data) {
                // Convert blob to File object
                const file = new File(
                  [result.data.blob],
                  result.data.fileName,
                  { type: 'text/csv' }
                );
                downloadedFiles = [file];
                console.log(`✅ [RESTORE] File downloaded successfully: ${result.data.fileName} (${result.data.blob.size} bytes)`);
              } else {
                console.error(`❌ [RESTORE] Failed to download file for plot "${savedPlot.title}":`, result.error);
              }
            } catch (error) {
              console.error(`❌ [RESTORE] Exception while downloading file for plot "${savedPlot.title}":`, error);
            }
          } else if (savedPlot.type === 'marine-meteo') {
            console.log(`🌊 [RESTORE] Plot is marine-meteo type, no file download needed`);
          } else {
            console.log(`ℹ️ [RESTORE] Plot type "${savedPlot.type}" does not require file download`);
          }

          const restoredPlot = {
            id: savedPlot.id,
            title: savedPlot.title,
            type: savedPlot.type,
            fileType: savedPlot.fileType,
            pinId: savedPlot.pinId,
            fileName: savedPlot.fileName,
            files: downloadedFiles,
            location: savedPlot.location,
            locationName: savedPlot.locationName,
            timeRange: savedPlot.timeRange,
            isMerged: savedPlot.isMerged,
            mergedParams: savedPlot.mergedParams,
            // Include computation metadata for computed plots
            computationType: savedPlot.computationType,
            sourcePlotIds: savedPlot.sourcePlotIds,
            computationParams: savedPlot.computationParams,
            computationConfig: savedPlot.computationConfig,
          };

          console.log(`✅ [RESTORE] DONE processing plot ${idx + 1}/${availablePlots.length}: "${savedPlot.title}"`, {
            id: restoredPlot.id,
            type: restoredPlot.type,
            filesCount: restoredPlot.files.length,
            hasLocation: !!restoredPlot.location
          });

          return restoredPlot;
        })
      );

      console.log('📋 [RESTORE] All plots processed, setting plots state...', {
        plotsCount: restoredPlots.length,
        plotIds: restoredPlots.map(p => p.id),
        plotDetails: restoredPlots.map(p => ({
          id: p.id,
          type: p.type,
          title: p.title,
          hasFiles: p.files?.length > 0,
          hasLocation: !!p.location
        }))
      });

      console.log('🔥 [RESTORE] CALLING setPlots with', restoredPlots.length, 'plots');
      setPlots(restoredPlots);
      console.log('✅ [RESTORE] setPlots completed');

      // Restore plot visibility state (which parameters are visible in each plot)
      const restoredVisibilityState: Record<string, {
        params: string[],
        colors: Record<string, string>,
        settings?: Record<string, any>,
        plotSettings?: {
          axisMode?: 'single' | 'multi';
          customYAxisLabel?: string;
          compactView?: boolean;
          customParameterNames?: Record<string, string>;
        }
      }> = {};
      availablePlots.forEach(savedPlot => {
        if (savedPlot.visibleParameters && savedPlot.visibleParameters.length > 0) {
          // Construct plotSettings from flat fields (stored at root level in database)
          const plotSettings: {
            axisMode?: 'single' | 'multi';
            customYAxisLabel?: string;
            compactView?: boolean;
            customParameterNames?: Record<string, string>;
          } = {};

          if (savedPlot.axisMode !== undefined) plotSettings.axisMode = savedPlot.axisMode;
          if (savedPlot.customYAxisLabel !== undefined) plotSettings.customYAxisLabel = savedPlot.customYAxisLabel;
          if (savedPlot.compactView !== undefined) plotSettings.compactView = savedPlot.compactView;
          if (savedPlot.customParameterNames !== undefined) plotSettings.customParameterNames = savedPlot.customParameterNames;

          restoredVisibilityState[savedPlot.id] = {
            params: savedPlot.visibleParameters,
            colors: savedPlot.parameterColors || {},
            settings: savedPlot.parameterSettings,
            plotSettings: Object.keys(plotSettings).length > 0 ? plotSettings : undefined
          };
          console.log(`🎨 [RESTORE] Restored visibility for plot "${savedPlot.title}":`, {
            visibleParams: savedPlot.visibleParameters.length,
            colors: Object.keys(savedPlot.parameterColors || {}).length,
            hasSettings: !!savedPlot.parameterSettings,
            hasPlotSettings: Object.keys(plotSettings).length > 0,
            plotSettings: plotSettings,
            rawFields: {
              axisMode: savedPlot.axisMode,
              compactView: savedPlot.compactView,
              customYAxisLabel: savedPlot.customYAxisLabel
            }
          });
        }
      });

      if (Object.keys(restoredVisibilityState).length > 0) {
        setPlotVisibilityState(restoredVisibilityState);
        console.log('✅ [RESTORE] Plot visibility state restored for', Object.keys(restoredVisibilityState).length, 'plots');
      }

      console.log('✅✅✅ [RESTORE] Plot view restored successfully! ✅✅✅');
      console.log('📊 [RESTORE] Final state:', {
        plots: restoredPlots.length,
        timeAxisMode: config.timeAxisMode,
        globalBrushRange: config.globalBrushRange,
        visibilityStateRestored: Object.keys(restoredVisibilityState).length
      });

      toast({
        title: "View Restored",
        description: `"${view.name}" has been loaded with ${restoredPlots.length} plot(s)`
      });

    } catch (error) {
      console.error('❌ [RESTORE] Error restoring plot view:', error);
      console.error('❌ [RESTORE] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      toast({
        variant: "destructive",
        title: "Restore Failed",
        description: "Failed to restore plot view"
      });
    }
  }, [toast]);

  // Auto-load plot from session storage (redirected from data-explorer)
  useEffect(() => {
    const checkForPendingPlotLoad = async () => {
      try {
        console.log('🔍 [PINMARINEDEVICEDATA] useEffect triggered - checking for pending plot load');
        console.log('🔍 [PINMARINEDEVICEDATA] Current state:', {
          projectId: projectId || 'NOT SET',
          fileType,
          filesLength: files.length,
          hasRestoreFunction: !!restorePlotViewState
        });

        const storedData = sessionStorage.getItem('pebl-load-plot-view');
        if (!storedData) {
          console.log('ℹ️ [PINMARINEDEVICEDATA] No pending plot load in sessionStorage');
          return;
        }

        const parsedData = JSON.parse(storedData);
        const { viewId, viewName, timestamp } = parsedData;

        console.log('✅ [PINMARINEDEVICEDATA] Found pending plot load:', {
          viewId,
          viewName,
          timestamp,
          age: Date.now() - timestamp,
          maxAge: 30000
        });

        // Only auto-load if the timestamp is recent (within 30 seconds)
        const now = Date.now();
        if (now - timestamp > 30000) {
          console.warn('⏰ [PINMARINEDEVICEDATA] Plot load expired (>30s old), removing from sessionStorage');
          sessionStorage.removeItem('pebl-load-plot-view');
          return;
        }

        console.log('🔄 [PINMARINEDEVICEDATA] Starting auto-load of plot view:', viewName);

        // Clear the flag immediately to prevent re-loading
        sessionStorage.removeItem('pebl-load-plot-view');
        console.log('🗑️ [PINMARINEDEVICEDATA] Cleared sessionStorage to prevent duplicate loads');

        // Set ref to prevent initialization useEffect from adding empty plot
        autoLoadInProgress.current = true;
        console.log('🚀 [PINMARINEDEVICEDATA] Set autoLoadInProgress = true');

        if (!projectId) {
          console.error('❌ [PINMARINEDEVICEDATA] Cannot auto-load plot: No projectId available');
          console.error('❌ [PINMARINEDEVICEDATA] projectId is:', projectId);
          toast({
            variant: "destructive",
            title: "Cannot Load Plot",
            description: "Project context not available"
          });
          autoLoadInProgress.current = false;
          return;
        }

        console.log('📡 [PINMARINEDEVICEDATA] Loading plot view from database...', {
          viewId,
          projectId
        });

        // Load and restore the plot view
        const { plotViewService } = await import('@/lib/supabase/plot-view-service');

        const loadResult = await plotViewService.loadPlotView(viewId);

        console.log('📦 [PINMARINEDEVICEDATA] Load result:', {
          success: loadResult.success,
          hasData: !!loadResult.data,
          error: loadResult.error,
          viewName: loadResult.data?.name
        });

        if (!loadResult.success || !loadResult.data) {
          console.error('❌ [PINMARINEDEVICEDATA] Failed to load plot view:', loadResult.error);
          toast({
            variant: "destructive",
            title: "Failed to Load Plot",
            description: loadResult.error || "Could not load the saved plot"
          });
          autoLoadInProgress.current = false;
          return;
        }

        console.log('✅ [PINMARINEDEVICEDATA] Plot view loaded successfully, validating...');
        console.log('📊 [PINMARINEDEVICEDATA] View config:', {
          totalPlots: loadResult.data.view_config.metadata.totalPlots,
          timeAxisMode: loadResult.data.view_config.timeAxisMode,
          plotCount: loadResult.data.view_config.plots.length
        });

        const validation = await plotViewService.validatePlotView(loadResult.data.view_config);

        console.log('🔍 [PINMARINEDEVICEDATA] Validation result:', {
          valid: validation.valid,
          allFilesAvailable: validation.allFilesAvailable,
          availablePlotIds: validation.availablePlotIds,
          missingFiles: validation.missingFiles,
          warnings: validation.warnings
        });

        if (!validation.valid) {
          console.error('❌ [PINMARINEDEVICEDATA] Validation failed - view references unavailable files');
          toast({
            variant: "destructive",
            title: "Cannot Load Plot",
            description: "This plot references files that are no longer available"
          });
          autoLoadInProgress.current = false;
          return;
        }

        console.log('🎨 [PINMARINEDEVICEDATA] Validation passed, restoring plot view state...');

        // Restore the plot view
        await restorePlotViewState(loadResult.data, validation);

        console.log('✅ [PINMARINEDEVICEDATA] Plot view restoration complete!');

        // Reset auto-load flag after successful restoration
        autoLoadInProgress.current = false;
        plotsInitialized.current = true; // Mark plots as initialized to prevent empty plot creation
        console.log('✅ [PINMARINEDEVICEDATA] Reset autoLoadInProgress = false and plotsInitialized = true');

      } catch (error) {
        console.error('❌ [PINMARINEDEVICEDATA] Error auto-loading plot view:', error);
        console.error('❌ [PINMARINEDEVICEDATA] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        toast({
          variant: "destructive",
          title: "Auto-Load Failed",
          description: "Failed to automatically load the plot"
        });
        // Clear the flag on error
        sessionStorage.removeItem('pebl-load-plot-view');
        // Reset auto-load flag after error
        autoLoadInProgress.current = false;
        console.log('❌ [PINMARINEDEVICEDATA] Reset autoLoadInProgress = false (error)');
      }
    };

    checkForPendingPlotLoad();
  }, [projectId, toast, restorePlotViewState, fileType, files.length]);

  // Plot management functions
  const addPlot = useCallback((
    type: 'device' | 'marine-meteo',
    files: File[] = [],
    options?: {
      fileType?: 'GP' | 'FPOD' | 'Subcam';
      customTitle?: string;
      location?: { lat: number; lon: number };
      locationName?: string;
      timeRange?: { startDate: string; endDate: string };
      pinId?: string;
      fileId?: string; // Database ID of the file for restoration
      pinLabel?: string; // Location name for header display
      startDate?: Date; // Start date of data
      endDate?: Date; // End date of data
      fileCategories?: string[]; // Categories (e.g., ["Sediment", "Haplotypes"])
      hideBrush?: boolean;
      showDateTimeAxis?: boolean;
      coordinates?: { lat: number; lng: number };
    }
  ) => {
    setPlots((prevPlots) => [
      ...prevPlots,
      {
        id: `pin-plot-${Date.now()}-${prevPlots.length}`,
        title: options?.customTitle || `Plot ${prevPlots.length + 1}`,
        type,
        // Device plot properties
        fileType: options?.fileType,
        files: type === 'device' ? files : undefined,
        fileName: type === 'device' ? getFileName(files) : undefined,
        fileId: options?.fileId, // Store the database file ID
        pinId: options?.pinId,
        pinLabel: options?.pinLabel,
        startDate: options?.startDate,
        endDate: options?.endDate,
        fileCategories: options?.fileCategories,
        hideBrush: options?.hideBrush,
        showDateTimeAxis: options?.showDateTimeAxis,
        coordinates: options?.coordinates,
        // Marine/meteo plot properties
        location: options?.location,
        locationName: options?.locationName,
        timeRange: options?.timeRange,
      },
    ]);
  }, []);

  const removePlot = useCallback((idToRemove: string) => {
    setPlots((prevPlots) => prevPlots.filter((plot) => plot.id !== idToRemove));
  }, []);

  // Handler for visibility changes from child plots
  // Using a stable callback pattern to avoid creating new functions on every render
  const handleVisibilityChange = useCallback((
    plotId: string,
    params: string[],
    colors: Record<string, string>,
    paramSettings?: Record<string, any>,
    plotSettings?: {
      axisMode?: 'single' | 'multi';
      customYAxisLabel?: string;
      compactView?: boolean;
      customParameterNames?: Record<string, string>;
    }
  ) => {
    setPlotVisibilityState(prev => ({
      ...prev,
      [plotId]: {
        params,
        colors,
        settings: paramSettings,
        plotSettings
      }
    }));
  }, []);

  // Create stable callbacks using useMemo - only recreate when plots array changes
  // This prevents infinite render loops by ensuring callback references remain stable
  const visibilityCallbacks = useMemo(() => {
    const callbacks: Record<string, (
      params: string[],
      colors: Record<string, string>,
      paramSettings?: Record<string, any>,
      plotSettings?: {
        axisMode?: 'single' | 'multi';
        customYAxisLabel?: string;
        compactView?: boolean;
        customParameterNames?: Record<string, string>;
      }
    ) => void> = {};

    plots.forEach(plot => {
      callbacks[plot.id] = (params, colors, paramSettings, plotSettings) => {
        handleVisibilityChange(plot.id, params, colors, paramSettings, plotSettings);
      };
    });

    return callbacks;
  }, [plots, handleVisibilityChange]);

  // Debug: Log whenever plots array changes (DISABLED for cleaner console)
  // useEffect(() => {
  //   console.log('🔵 [PLOTS STATE CHANGE] plots.length:', plots.length);
  //   console.log('🔵 [PLOTS STATE] Plot details:', plots.map((p, i) => ({
  //     index: i,
  //     id: p.id,
  //     type: p.type,
  //     title: p.title || p.fileName || p.locationName,
  //     hasFiles: p.files?.length > 0,
  //     hasLocation: !!p.location
  //   })));
  // }, [plots]);

  // Recreate computed plots when source data becomes available
  useEffect(() => {
    // Find computed plots that need recreation
    const computedPlots = plots.filter(p => p.computationType && !p.mergedData);

    if (computedPlots.length === 0) return;

    console.log('🧮 [COMPUTED PLOTS] Found', computedPlots.length, 'computed plots needing recreation');

    computedPlots.forEach(async (computedPlot) => {
      // Check if this is a subtraction plot
      if (computedPlot.computationType !== 'subtract') {
        console.warn(`⚠️ [COMPUTED PLOTS] Unsupported computation type: ${computedPlot.computationType}`);
        return;
      }

      const { sourcePlotIds, computationParams, computationConfig } = computedPlot;

      if (!sourcePlotIds || sourcePlotIds.length !== 2 || !computationParams) {
        console.error(`❌ [COMPUTED PLOTS] Invalid metadata for computed plot "${computedPlot.title}"`);
        return;
      }

      // Check if source plots' data is available
      const [sourcePlot1Id, sourcePlot2Id] = sourcePlotIds;
      const sourcePlot1Data = plotsData[sourcePlot1Id];
      const sourcePlot2Data = plotsData[sourcePlot2Id];

      if (!sourcePlot1Data || !sourcePlot2Data) {
        console.log(`⏳ [COMPUTED PLOTS] Waiting for source data for "${computedPlot.title}"`, {
          plot1Ready: !!sourcePlot1Data,
          plot2Ready: !!sourcePlot2Data
        });
        return;
      }

      console.log(`🧮 [COMPUTED PLOTS] Recreating subtraction plot "${computedPlot.title}"`);

      // Recreate the subtraction computation
      const { param1, param2 } = computationParams;
      const { direction = '1-2', missingDataMode = 'skip', includeZeroValues = false } = computationConfig || {};

      // Helper to find data key
      const findDataKey = (dataPoint: any, paramName: string): string | null => {
        if (paramName in dataPoint) return paramName;
        const normalizedParam = paramName.replace(/\s+/g, '').toLowerCase();
        for (const key of Object.keys(dataPoint)) {
          if (key.toLowerCase() === normalizedParam) return key;
        }
        const cleanedParam = paramName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        for (const key of Object.keys(dataPoint)) {
          const cleanedKey = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          if (cleanedKey.includes(cleanedParam) || cleanedParam.includes(cleanedKey)) return key;
        }
        return null;
      };

      const actualParam1Key = findDataKey(sourcePlot1Data.data[0], param1) || param1;
      const actualParam2Key = findDataKey(sourcePlot2Data.data[0], param2) || param2;

      // Build time -> value maps
      const leftMap = new Map<string, number>();
      sourcePlot1Data.data.forEach(point => {
        const value = point[actualParam1Key];
        if (value !== null && value !== undefined && !isNaN(Number(value))) {
          leftMap.set(point.time, Number(value));
        }
      });

      const rightMap = new Map<string, number>();
      sourcePlot2Data.data.forEach(point => {
        const value = point[actualParam2Key];
        if (value !== null && value !== undefined && !isNaN(Number(value))) {
          rightMap.set(point.time, Number(value));
        }
      });

      // Compute subtraction
      const allTimestamps = Array.from(new Set([...leftMap.keys(), ...rightMap.keys()])).sort();
      const subtractedData: any[] = [];

      allTimestamps.forEach(time => {
        const val1 = leftMap.get(time);
        const val2 = rightMap.get(time);

        let resultValue: number | null = null;

        if (val1 !== undefined && val2 !== undefined) {
          // Check if we should show zero for points where one value is zero
          if (!includeZeroValues && (val1 === 0 || val2 === 0)) {
            // Show as zero instead of skipping - preserves timeline
            resultValue = 0;
          } else {
            // Calculate actual difference
            resultValue = direction === '1-2' ? val1 - val2 : val2 - val1;
          }
        } else if (missingDataMode === 'zero') {
          const useVal1 = val1 ?? 0;
          const useVal2 = val2 ?? 0;
          resultValue = direction === '1-2' ? useVal1 - useVal2 : useVal2 - useVal1;
        }
        // else skip (resultValue stays null)

        if (resultValue !== null) {
          subtractedData.push({
            time,
            [computationParams.resultParam || 'Difference']: resultValue
          });
        }
      });

      // Create ParseResult
      const subtractedParseResult: ParseResult = {
        data: subtractedData,
        headers: ['time', computationParams.resultParam || 'Difference'],
        errors: [],
        summary: {
          totalRows: subtractedData.length,
          validRows: subtractedData.length,
          columns: 2,
          timeColumn: 'time'
        }
      };

      // Update the plot with the recreated data
      setPlots(prevPlots => prevPlots.map(p => {
        if (p.id === computedPlot.id) {
          console.log(`✅ [COMPUTED PLOTS] Recreated subtraction plot "${computedPlot.title}" with ${subtractedData.length} points`);
          return {
            ...p,
            mergedData: subtractedParseResult
          };
        }
        return p;
      }));

      // Set visibility state for the computed plot - preserve existing state if available
      setPlotVisibilityState(prev => {
        const existingState = prev[computedPlot.id];

        // If there's already visibility state (from restoration), preserve it
        if (existingState) {
          console.log(`🎨 [COMPUTED PLOTS] Preserving existing visibility state for "${computedPlot.title}"`, existingState);
          return prev; // Don't overwrite!
        }

        // Otherwise, set default state for new computed plots
        console.log(`🎨 [COMPUTED PLOTS] Setting default visibility state for new computed plot "${computedPlot.title}"`);
        return {
          ...prev,
          [computedPlot.id]: {
            params: [computationParams.resultParam || 'Difference'],
            colors: { [computationParams.resultParam || 'Difference']: '#8884d8' },
            settings: {}
          }
        };
      });
    });
  }, [plots, plotsData]);

  // Check if plots are eligible for merging
  const canMergePlots = useMemo(() => {
    if (plots.length < 2) return false;
    const firstState = plotVisibilityState[plots[0].id];
    const secondState = plotVisibilityState[plots[1].id];

    // Check if both have exactly 1 visible parameter
    if (firstState?.params.length !== 1 || secondState?.params.length !== 1) {
      return false;
    }

    // Allow merging if:
    // 1. Parameters are different, OR
    // 2. Parameters are the same BUT from different data sources (different files/locations)
    const firstParam = firstState.params[0];
    const secondParam = secondState.params[0];
    const firstPlot = plots[0];
    const secondPlot = plots[1];

    // If parameters are different, allow merge
    if (firstParam !== secondParam) {
      return true;
    }

    // If same parameter, only allow if from different sources
    // Check if they have different identifiers (fileName, locationName, or id)
    if (firstPlot.type === 'device' && secondPlot.type === 'device') {
      return firstPlot.fileName !== secondPlot.fileName;
    } else if (firstPlot.type === 'marine-meteo' && secondPlot.type === 'marine-meteo') {
      return firstPlot.locationName !== secondPlot.locationName;
    } else {
      // Different types (device vs marine), allow merge
      return true;
    }
  }, [plots, plotVisibilityState]);

  // Helper function to extract base parameter name (before brackets)
  const getBaseParameterName = useCallback((paramName: string): string => {
    // Remove everything in brackets and trim
    const baseName = paramName.replace(/\[.*?\]/g, '').trim();
    return baseName;
  }, []);

  // Check if plots are eligible for subtracting
  const canSubtractPlots = useMemo(() => {
    if (plots.length < 2) return false;
    const firstState = plotVisibilityState[plots[0].id];
    const secondState = plotVisibilityState[plots[1].id];

    // Check if both have exactly 1 visible parameter
    if (firstState?.params.length !== 1 || secondState?.params.length !== 1) {
      return false;
    }

    const firstParam = firstState.params[0];
    const secondParam = secondState.params[0];

    // Extract base parameter names (without brackets)
    const firstBaseParam = getBaseParameterName(firstParam);
    const secondBaseParam = getBaseParameterName(secondParam);

    // Parameters must match (at least the base name)
    // e.g., "Porpoise clicks [Station A]" and "Porpoise clicks [Station B]" should match
    return firstBaseParam === secondBaseParam;
  }, [plots, plotVisibilityState, getBaseParameterName]);

  // Check if presence-absence table can be created (2+ HAPL/NMAX files)
  const canCreatePresenceAbsence = useMemo(() => {
    const haplFiles = plots.filter(plot =>
      plot.type === 'device' &&
      plot.fileName?.toLowerCase().match(/_hapl|_nmax/i)
    );
    return haplFiles.length >= 2;
  }, [plots]);

  // Handler for merging first 2 plots
  const handleMergePlots = useCallback(() => {
    if (plots.length < 2) return;

    const firstPlot = plots[0];
    const secondPlot = plots[1];

    const firstState = plotVisibilityState[firstPlot.id];
    const secondState = plotVisibilityState[secondPlot.id];

    if (!firstState || !secondState || firstState.params.length !== 1 || secondState.params.length !== 1) {
      return;
    }

    const param1 = firstState.params[0];
    const param2 = secondState.params[0];

    console.log('🔍 Parameter names from visibility state:', {
      param1,
      param1Type: typeof param1,
      param2,
      param2Type: typeof param2,
      firstStateParams: firstState.params,
      secondStateParams: secondState.params
    });

    // Get the actual data from both plots
    const firstPlotData = plotsData[firstPlot.id];
    const secondPlotData = plotsData[secondPlot.id];

    if (!firstPlotData || !secondPlotData) {
      console.error('Cannot merge: plot data not loaded');
      return;
    }

    // Helper function to find the actual data key for a parameter (handles display names vs data keys)
    const findDataKey = (dataPoint: any, paramName: string): string | null => {
      // Try direct match first
      if (paramName in dataPoint) return paramName;

      // Try case-insensitive match with spaces removed (e.g., "Wave Height" -> "waveHeight")
      const normalizedParam = paramName.replace(/\s+/g, '').toLowerCase();
      for (const key of Object.keys(dataPoint)) {
        if (key.toLowerCase() === normalizedParam) {
          return key;
        }
      }

      // Try removing special characters and parentheses (e.g., "Sea Level (MSL)" -> "sealevel")
      const cleanedParam = paramName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      for (const key of Object.keys(dataPoint)) {
        const cleanedKey = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        if (cleanedKey.includes(cleanedParam) || cleanedParam.includes(cleanedKey)) {
          console.log('🔍 Found fuzzy match:', { paramName, cleanedParam, key, cleanedKey });
          return key;
        }
      }

      // Special mappings for known display names
      const specialMappings: Record<string, string[]> = {
        'seaLevelHeightMsl': ['Sea Level (MSL)', 'Sea Level', 'sea level'],
        'waveHeight': ['Wave Height', 'Significant Wave Height'],
        'wavePeriod': ['Wave Period'],
        'waveDirection': ['Wave Direction'],
        'seaSurfaceTemperature': ['Sea Surface Temp (0m)', 'Sea Surface Temperature'],
        'windSpeed10m': ['Wind Speed (10m)', 'Wind Speed'],
        'windDirection10m': ['Wind Direction (10m)', 'Wind Direction'],
        'temperature2m': ['Air Temperature (2m)', 'Air Temperature'],
        'ghi': ['Global Horizontal Irradiance (GHI)', 'GHI']
      };

      for (const [dataKey, displayNames] of Object.entries(specialMappings)) {
        if (displayNames.some(name => name.toLowerCase() === paramName.toLowerCase())) {
          if (dataKey in dataPoint) {
            console.log('🔍 Found via special mapping:', { paramName, dataKey });
            return dataKey;
          }
        }
      }

      console.warn('⚠️ Could not find data key for parameter:', paramName, 'Available keys:', Object.keys(dataPoint));
      return null;
    };

    // Find actual data keys for both parameters
    const firstSamplePoint = firstPlotData.data[0];
    const secondSamplePoint = secondPlotData.data[0];
    const actualParam1Key = findDataKey(firstSamplePoint, param1) || param1;
    const actualParam2Key = findDataKey(secondSamplePoint, param2) || param2;

    console.log('🔑 Data key mapping:', {
      requestedParam1: param1,
      actualParam1Key,
      requestedParam2: param2,
      actualParam2Key
    });

    // Helper function to normalize time to ISO format
    const normalizeTimeToISO = (timeStr: string): string => {
      try {
        const date = parseISO(timeStr);
        if (isValid(date)) {
          // Return full ISO format with milliseconds: 2024-10-03T06:05:50.000Z
          return date.toISOString();
        }
        return timeStr; // Return original if can't parse
      } catch (e) {
        return timeStr;
      }
    };

    // Get source labels for each parameter
    const getSourceLabel = (plot: PlotConfig): string => {
      if (plot.type === 'marine-meteo') return 'OM';

      // Try to get file type from plot config first
      if (plot.fileType) return plot.fileType;

      // Extract file type from filename if available (text after first underscore)
      if (plot.fileName) {
        const parts = plot.fileName.split('_');
        if (parts.length >= 2) {
          const extractedType = parts[1].toUpperCase();
          // Validate that it's a known file type
          if (['GP', 'FPOD', 'SC', 'SUBCAM'].includes(extractedType)) {
            console.log(`🏷️ Extracted file type "${extractedType}" from filename "${plot.fileName}"`);
            return extractedType === 'SUBCAM' ? 'SC' : extractedType;
          }
        }
      }

      // Fall back to 'GP' if extraction fails
      console.warn(`⚠️ Could not extract file type from filename "${plot.fileName}", defaulting to GP`);
      return 'GP';
    };

    const source1Label = getSourceLabel(firstPlot);
    const source2Label = getSourceLabel(secondPlot);

    // Create parameter names with source labels and plot numbers to ensure uniqueness
    // Even if both parameters have the same name, adding " 1" and " 2" prevents key collision
    const param1WithSource = `${param1} [${source1Label}] 1`;
    const param2WithSource = `${param2} [${source2Label}] 2`;

    console.log('🏷️ Parameter labels with source:', {
      param1,
      param1WithSource,
      source1Label,
      param2,
      param2WithSource,
      source2Label
    });

    // UNION APPROACH: Merge datasets preserving original timestamps from both
    // This allows plotting parameters with different time intervals on the same chart

    // Build maps: time -> value for each parameter
    const leftMap = new Map<string, any>();
    let leftSkipped = 0;
    firstPlotData.data.forEach(point => {
      const value = point[actualParam1Key];
      if (value !== null && value !== undefined && !isNaN(Number(value))) {
        leftMap.set(normalizeTimeToISO(point.time), value);
      } else {
        leftSkipped++;
      }
    });

    const rightMap = new Map<string, any>();
    let rightSkipped = 0;
    secondPlotData.data.forEach(point => {
      const value = point[actualParam2Key];
      if (value !== null && value !== undefined && !isNaN(Number(value))) {
        rightMap.set(normalizeTimeToISO(point.time), value);
      } else {
        rightSkipped++;
      }
    });

    console.log('🗺️ MAP POPULATION DEBUG:', {
      leftMapSize: leftMap.size,
      rightMapSize: rightMap.size,
      leftSkipped,
      rightSkipped,
      leftTotalPoints: firstPlotData.data.length,
      rightTotalPoints: secondPlotData.data.length,
      sampleLeftPoint: firstPlotData.data[0],
      sampleRightPoint: secondPlotData.data[0],
      actualParam1Key,
      actualParam2Key,
      sampleLeftValue: firstPlotData.data[0]?.[actualParam1Key],
      sampleRightValue: secondPlotData.data[0]?.[actualParam2Key],
      leftDataKeys: Object.keys(firstPlotData.data[0] || {}),
      rightDataKeys: Object.keys(secondPlotData.data[0] || {})
    });

    // Get UNION of all timestamps (sorted)
    const leftKeys = Array.from(leftMap.keys());
    const rightKeys = Array.from(rightMap.keys());

    console.log('🔍 TIMESTAMP UNION ANALYSIS:', {
      leftKeysCount: leftKeys.length,
      rightKeysCount: rightKeys.length,
      sampleLeftKeys: leftKeys.slice(0, 5),
      sampleRightKeys: rightKeys.slice(0, 5),
      leftKeysLast: leftKeys.slice(-5),
      rightKeysLast: rightKeys.slice(-5),
      // Check for overlaps
      firstRightInLeft: leftMap.has(rightKeys[0]),
      lastRightInLeft: leftMap.has(rightKeys[rightKeys.length - 1])
    });

    const allTimestamps = Array.from(
      new Set([
        ...leftKeys,
        ...rightKeys
      ])
    ).sort();

    console.log('🎯 UNION RESULT:', {
      totalUniqueTimestamps: allTimestamps.length,
      expectedIfNoOverlap: leftKeys.length + rightKeys.length,
      overlapCount: (leftKeys.length + rightKeys.length) - allTimestamps.length
    });

    // Create merged data with each timestamp having values from both maps (or null)
    const mergedData = allTimestamps.map(time => ({
      time,
      [param1WithSource]: leftMap.get(time) ?? null,
      [param2WithSource]: rightMap.get(time) ?? null
    }));

    console.log('⏰ Time format samples:', {
      firstPlotSampleTime: firstPlotData.data[0]?.time,
      secondPlotSampleTime: secondPlotData.data[0]?.time,
      mergedFirstTime: mergedData[0]?.time,
      mergedLastTime: mergedData[mergedData.length - 1]?.time,
      mergedMiddleTime: mergedData[Math.floor(mergedData.length / 2)]?.time
    });

    console.log('🔄 UNION MERGE DEBUG:', {
      param1WithSource,
      param2WithSource,
      firstPlotDataLength: firstPlotData.data.length,
      secondPlotDataLength: secondPlotData.data.length,
      mergedDataLength: mergedData.length,
      uniqueTimestamps: allTimestamps.length,
      sampleFirstPoint: firstPlotData.data[0],
      sampleSecondPoint: secondPlotData.data[0],
      sampleMergedPoint: mergedData[0],
      sampleMergedPointMiddle: mergedData[Math.floor(mergedData.length / 2)],
      sampleMergedPointEnd: mergedData[mergedData.length - 1],
      firstDataKeys: Object.keys(firstPlotData.data[0] || {}),
      secondDataKeys: Object.keys(secondPlotData.data[0] || {}),
      mergedDataKeys: Object.keys(mergedData[0] || {}),
      // Check distribution of data points
      pointsWithBothParams: mergedData.filter(d => d[param1WithSource] !== null && d[param2WithSource] !== null).length,
      pointsWithOnlyParam1: mergedData.filter(d => d[param1WithSource] !== null && d[param2WithSource] === null).length,
      pointsWithOnlyParam2: mergedData.filter(d => d[param1WithSource] === null && d[param2WithSource] !== null).length,
      leftMapSize: leftMap.size,
      rightMapSize: rightMap.size
    });

    // Create ParseResult structure for the RAW merged data (before rounding)
    const rawMergedData: ParseResult = {
      data: mergedData as any,
      headers: ['time', param1WithSource, param2WithSource],
      errors: [],
      summary: {
        totalRows: mergedData.length,
        validRows: mergedData.length,
        columns: 3,
        timeColumn: 'time'
      }
    };

    // Save raw data
    setMergeRawData(rawMergedData);

    // Apply default time rounding (30 min)
    const roundedData = applyTimeRounding(rawMergedData, timeRoundingInterval);

    // Show preview dialog with rounded data
    setMergePreviewData(roundedData);
    setShowMergePreview(true);
  }, [plots, plotVisibilityState, plotsData, timeRoundingInterval, applyTimeRounding]);

  // Handler to confirm merge after preview
  const confirmMerge = useCallback(() => {
    if (!mergePreviewData || plots.length < 2) return;

    const firstPlot = plots[0];
    const secondPlot = plots[1];
    const firstState = plotVisibilityState[firstPlot.id];
    const secondState = plotVisibilityState[secondPlot.id];

    if (!firstState || !secondState) return;

    const param1 = firstState.params[0];
    const param2 = secondState.params[0];

    // Determine which parameter was smoothed (if any)
    const param1WithSource = mergePreviewData.headers[1];
    const param2WithSource = mergePreviewData.headers[2];
    const param1WasSmoothed = smoothingApplied && smoothedParameterName === param1WithSource;
    const param2WasSmoothed = smoothingApplied && smoothedParameterName === param2WithSource;

    // Create a virtual device plot with merged data
    const mergedPlot: PlotConfig = {
      id: `merged-${Date.now()}`,
      title: `${param1} + ${param2}`,
      type: 'device',
      fileType: firstPlot.fileType || 'GP',
      files: [],
      fileName: `Merged: ${param1} + ${param2}`,
      isMerged: true,
      mergedData: mergePreviewData,
      mergedParams: [
        {
          parameter: param1,
          sourceType: (firstPlot.type === 'marine-meteo' ? 'marine' : firstPlot.fileType) as 'GP' | 'FPOD' | 'Subcam' | 'marine',
          sourceLabel: (firstPlot.type === 'marine-meteo' ? firstPlot.locationName : firstPlot.fileName) as string,
          color: firstState.colors[param1],
          axis: 'left' as const,
          isSmoothed: param1WasSmoothed,
          originalObsCount: param1WasSmoothed ? originalObsCount : undefined,
          smoothedObsCount: param1WasSmoothed ? smoothedObsCount : undefined,
        },
        {
          parameter: param2,
          sourceType: (secondPlot.type === 'marine-meteo' ? 'marine' : secondPlot.fileType) as 'GP' | 'FPOD' | 'Subcam' | 'marine',
          sourceLabel: (secondPlot.type === 'marine-meteo' ? secondPlot.locationName : secondPlot.fileName) as string,
          color: secondState.colors[param2],
          axis: 'right' as const,
          isSmoothed: param2WasSmoothed,
          originalObsCount: param2WasSmoothed ? originalObsCount : undefined,
          smoothedObsCount: param2WasSmoothed ? smoothedObsCount : undefined,
        }
      ]
    };

    // Keep first 2 plots and add merged plot below them
    setPlots([plots[0], plots[1], mergedPlot, ...plots.slice(2)]);

    // Force common mode for merged plots
    setTimeAxisMode('common');

    // Close preview
    setShowMergePreview(false);
    setMergePreviewData(null);
  }, [mergePreviewData, plots, plotVisibilityState, smoothingApplied, smoothedParameterName, originalObsCount, smoothedObsCount]);

  // Handler for unmerging plots
  const handleUnmergePlot = useCallback((mergedPlotId: string) => {
    const mergedPlot = plots.find(p => p.id === mergedPlotId);
    if (!mergedPlot?.isMerged || !mergedPlot.mergedParams || mergedPlot.mergedParams.length !== 2) {
      return;
    }

    const [leftConfig, rightConfig] = mergedPlot.mergedParams;

    // Recreate original plot 1
    const plot1: PlotConfig = {
      id: `unmerged-1-${Date.now()}`,
      title: leftConfig.parameter,
      type: leftConfig.sourceType === 'marine' ? 'marine-meteo' : 'device',
      ...(leftConfig.sourceType === 'marine' ? {
        location: leftConfig.location,
        locationName: leftConfig.sourceLabel,
        timeRange: leftConfig.timeRange
      } : {
        fileType: leftConfig.fileType,
        files: leftConfig.files,
        fileName: leftConfig.sourceLabel
      })
    };

    // Recreate original plot 2
    const plot2: PlotConfig = {
      id: `unmerged-2-${Date.now()}`,
      title: rightConfig.parameter,
      type: rightConfig.sourceType === 'marine' ? 'marine-meteo' : 'device',
      ...(rightConfig.sourceType === 'marine' ? {
        location: rightConfig.location,
        locationName: rightConfig.sourceLabel,
        timeRange: rightConfig.timeRange
      } : {
        fileType: rightConfig.fileType,
        files: rightConfig.files,
        fileName: rightConfig.sourceLabel
      })
    };

    // Replace merged plot with originals
    const mergedIndex = plots.findIndex(p => p.id === mergedPlotId);
    setPlots([
      ...plots.slice(0, mergedIndex),
      plot1,
      plot2,
      ...plots.slice(mergedIndex + 1)
    ]);
  }, [plots]);

  // Handler for subtracting first 2 plots
  const handleSubtractPlots = useCallback(() => {
    if (plots.length < 2) return;

    const firstPlot = plots[0];
    const secondPlot = plots[1];

    const firstState = plotVisibilityState[firstPlot.id];
    const secondState = plotVisibilityState[secondPlot.id];

    if (!firstState || !secondState || firstState.params.length !== 1 || secondState.params.length !== 1) {
      return;
    }

    const param1 = firstState.params[0];
    const param2 = secondState.params[0];

    console.log('➖ Subtract: Parameter names from visibility state:', {
      param1,
      param2,
    });

    // Get the actual data from both plots
    const firstPlotData = plotsData[firstPlot.id];
    const secondPlotData = plotsData[secondPlot.id];

    if (!firstPlotData || !secondPlotData) {
      console.error('Cannot subtract: plot data not loaded');
      return;
    }

    // Helper function to find the actual data key for a parameter
    const findDataKey = (dataPoint: any, paramName: string): string | null => {
      if (paramName in dataPoint) return paramName;

      const normalizedParam = paramName.replace(/\s+/g, '').toLowerCase();
      for (const key of Object.keys(dataPoint)) {
        if (key.toLowerCase() === normalizedParam) {
          return key;
        }
      }

      const cleanedParam = paramName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      for (const key of Object.keys(dataPoint)) {
        const cleanedKey = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        if (cleanedKey.includes(cleanedParam) || cleanedParam.includes(cleanedKey)) {
          return key;
        }
      }

      return null;
    };

    // Find actual data keys for both parameters
    const firstSamplePoint = firstPlotData.data[0];
    const secondSamplePoint = secondPlotData.data[0];
    const actualParam1Key = findDataKey(firstSamplePoint, param1) || param1;
    const actualParam2Key = findDataKey(secondSamplePoint, param2) || param2;

    // Helper function to normalize time to ISO format
    const normalizeTimeToISO = (timeStr: string): string => {
      try {
        const date = parseISO(timeStr);
        if (isValid(date)) {
          return date.toISOString();
        }
        return timeStr;
      } catch (e) {
        return timeStr;
      }
    };

    // Get source labels for each parameter
    const getSourceLabel = (plot: PlotConfig): string => {
      if (plot.type === 'marine-meteo') return 'OM';
      if (plot.fileType) return plot.fileType;
      if (plot.fileName) {
        const parts = plot.fileName.split('_');
        if (parts.length >= 2) {
          const extractedType = parts[1].toUpperCase();
          if (['GP', 'FPOD', 'SC', 'SUBCAM'].includes(extractedType)) {
            return extractedType === 'SUBCAM' ? 'SC' : extractedType;
          }
        }
      }
      return 'GP';
    };

    const source1Label = getSourceLabel(firstPlot);
    const source2Label = getSourceLabel(secondPlot);

    // Build maps: time -> value for each parameter
    const leftMap = new Map<string, any>();
    firstPlotData.data.forEach(point => {
      const value = point[actualParam1Key];
      if (value !== null && value !== undefined && !isNaN(Number(value))) {
        leftMap.set(normalizeTimeToISO(point.time), value);
      }
    });

    const rightMap = new Map<string, any>();
    secondPlotData.data.forEach(point => {
      const value = point[actualParam2Key];
      if (value !== null && value !== undefined && !isNaN(Number(value))) {
        rightMap.set(normalizeTimeToISO(point.time), value);
      }
    });

    // Get UNION of all timestamps (sorted)
    const allTimestamps = Array.from(
      new Set([
        ...Array.from(leftMap.keys()),
        ...Array.from(rightMap.keys())
      ])
    ).sort();

    // Create smart parameter name by omitting matching text
    // e.g., "Porpoise clicks [Station A]" and "Porpoise clicks [Station B]" -> "Difference (A - B)"
    // For merged files: "Porpoise(DPM)[C_S]" and "Porpoise(DPM)[F_L]" -> "Difference (Porpoise(DPM)[C_S] - Porpoise(DPM)[F_L])"
    const smartParameterName = (() => {
      const base1 = getBaseParameterName(param1);
      const base2 = getBaseParameterName(param2);

      // Extract the differing parts (typically the source/station names)
      const extractDifference = (fullName: string, baseName: string): string => {
        // Check if this is a merged file parameter (has both parentheses AND brackets)
        // This indicates station identifiers like "Porpoise(DPM)[C_S]"
        const hasParentheses = /\([^)]+\)/.test(fullName);
        const hasBrackets = /\[[^\]]+\]/.test(fullName);

        if (hasParentheses && hasBrackets) {
          // For merged files, keep the ENTIRE parameter name with all identifiers
          return fullName;
        }

        // For simpler parameters, extract only the bracketed part (original logic)
        const bracketMatch = fullName.match(/\[(.*?)\]/);
        if (bracketMatch) {
          return bracketMatch[1];
        }

        // If no brackets, return the source label
        return fullName.replace(baseName, '').trim() || fullName;
      };

      const diff1 = extractDifference(param1, base1) || source1Label;
      const diff2 = extractDifference(param2, base2) || source2Label;

      return `Difference (${diff1} - ${diff2})`;
    })();

    // Perform subtraction based on direction
    const subtractedData = allTimestamps.map(time => {
      const val1 = leftMap.get(time);
      const val2 = rightMap.get(time);

      let result: number | null = null;

      if (val1 !== null && val1 !== undefined && val2 !== null && val2 !== undefined) {
        // Both values exist
        // ZERO RULE: If either value is zero, set result to zero (default rule)
        if (Number(val1) === 0 || Number(val2) === 0) {
          result = 0;
        } else {
          result = subtractDirection === '1-2' ? Number(val1) - Number(val2) : Number(val2) - Number(val1);
        }
      } else if (subtractMissingDataMode === 'zero') {
        // Use zero for missing values
        // ZERO RULE: When using 'zero' mode, result is always zero (since at least one value is missing/zero)
        result = 0;
      }
      // else: skip mode, result stays null

      return {
        time,
        [smartParameterName]: result
      };
    });

    // Filter out null results if in skip mode
    const filteredData = subtractMissingDataMode === 'skip'
      ? subtractedData.filter(row => row[smartParameterName] !== null)
      : subtractedData;

    console.log('➖ SUBTRACT DEBUG:', {
      smartParameterName,
      direction: subtractDirection,
      missingDataMode: subtractMissingDataMode,
      leftMapSize: leftMap.size,
      rightMapSize: rightMap.size,
      allTimestampsCount: allTimestamps.length,
      filteredDataCount: filteredData.length,
      sampleResult: filteredData[0]
    });

    // Create ParseResult structure for the RAW subtracted data
    const rawSubtractedData: ParseResult = {
      data: filteredData as any,
      headers: ['time', smartParameterName],
      errors: [],
      summary: {
        totalRows: filteredData.length,
        validRows: filteredData.length,
        columns: 2,
        timeColumn: 'time'
      }
    };

    // Save raw data
    setSubtractRawData(rawSubtractedData);

    // Apply default time rounding (1 hr)
    const roundedData = applyTimeRounding(rawSubtractedData, timeRoundingInterval);

    // TODO: Check for units mismatch and set warning

    // Show preview dialog with rounded data
    setSubtractPreviewData(roundedData);
    setShowSubtractPreview(true);
  }, [plots, plotVisibilityState, plotsData, getBaseParameterName, subtractDirection, subtractMissingDataMode, timeRoundingInterval, applyTimeRounding]);

  // Handler to confirm subtract after preview
  const confirmSubtract = useCallback(() => {
    if (!subtractPreviewData || plots.length < 2) return;

    const firstPlot = plots[0];
    const secondPlot = plots[1];
    const firstState = plotVisibilityState[firstPlot.id];
    const secondState = plotVisibilityState[secondPlot.id];

    if (!firstState || !secondState) return;

    const param1 = firstState.params[0];
    const param2 = secondState.params[0];

    // Get the result parameter name from headers
    const resultParamName = subtractPreviewData.headers[1];

    // Check if both source plots are _std files to apply _std styling to difference
    const isFirstPlotStd = firstPlot.fileName?.includes('_std') || false;
    const isSecondPlotStd = secondPlot.fileName?.includes('_std') || false;
    const bothAreStd = isFirstPlotStd && isSecondPlotStd;

    // Create filename with _diff_std.csv suffix if both sources are _std files
    // This matches the styling rule in StylingRulesDialog.tsx
    const subtractedFileName = bothAreStd
      ? `Subtracted: ${resultParamName}_diff_std.csv`
      : `Subtracted: ${resultParamName}`;

    console.log('➖ Subtracted plot filename logic:', {
      firstPlotFileName: firstPlot.fileName,
      secondPlotFileName: secondPlot.fileName,
      isFirstPlotStd,
      isSecondPlotStd,
      bothAreStd,
      subtractedFileName
    });

    // Create a virtual device plot with subtracted data
    const subtractedPlot: PlotConfig = {
      id: `subtracted-${Date.now()}`,
      title: resultParamName,
      type: 'device',
      fileType: firstPlot.fileType || 'GP',
      files: [],
      fileName: subtractedFileName,
      isMerged: true,
      mergedData: subtractPreviewData,
      // Store computation metadata for save/restore
      computationType: 'subtract',
      sourcePlotIds: [firstPlot.id, secondPlot.id],
      computationParams: {
        param1,
        param2,
        resultParam: resultParamName,
      },
      computationConfig: {
        direction: subtractDirection,
        missingDataMode: subtractMissingDataMode,
        includeZeroValues: false, // Default: exclude zero values
      },
    };

    // Keep first 2 plots and add subtracted plot below them
    setPlots([plots[0], plots[1], subtractedPlot, ...plots.slice(2)]);

    // Force common mode for subtracted plots
    setTimeAxisMode('common');

    // Initialize visibility state with default 1-day moving average for _diff_std plots
    if (bothAreStd) {
      console.log('📊 [SUBTRACT] Initializing _diff_std plot with 1-day moving average default');
      setPlotVisibilityState(prev => ({
        ...prev,
        [subtractedPlot.id]: {
          params: [resultParamName], // Make the difference parameter visible by default
          colors: {
            [resultParamName]: '#4477AA' // Colorblind-friendly blue
          },
          settings: {
            [resultParamName]: {
              movingAverage: {
                enabled: true,
                windowDays: 1,
                showLine: true
              }
            }
          }
        }
      }));
    }

    // Close preview
    setShowSubtractPreview(false);
    setSubtractPreviewData(null);

    toast({
      title: "Subtraction Complete",
      description: `Created plot: ${resultParamName}${bothAreStd ? ' (1-day MA enabled)' : ''}`
    });
  }, [subtractPreviewData, plots, plotVisibilityState, subtractDirection, subtractMissingDataMode, toast]);

  // Handler for updating includeZeroValues setting for subtracted plots
  const handleIncludeZeroValuesChange = useCallback((plotId: string, include: boolean) => {
    setPlots(prevPlots => prevPlots.map(plot => {
      if (plot.id === plotId && plot.computationType === 'subtract' && plot.computationConfig) {
        console.log(`🔄 [SUBTRACT] Updating includeZeroValues for plot "${plot.title}" to:`, include);
        return {
          ...plot,
          computationConfig: {
            ...plot.computationConfig,
            includeZeroValues: include
          }
        };
      }
      return plot;
    }));
  }, []);

  // Handler for adding marine/meteo plot
  const handleAddMarineMeteoPlot = useCallback(() => {
    // Check prerequisites
    if (plots.length === 0) {
      toast({
        variant: "destructive",
        title: "Cannot Add Marine/Meteo Data",
        description: "Please add at least one device data plot first."
      });
      return;
    }

    if (!objectLocation) {
      toast({
        variant: "destructive",
        title: "Cannot Add Marine/Meteo Data",
        description: "Object location is not available."
      });
      return;
    }

    // Extract time range from first plot
    const firstPlot = plots[0];
    const firstPlotData = plotsData[firstPlot.id];

    if (!firstPlotData) {
      toast({
        variant: "destructive",
        title: "Cannot Add Marine/Meteo Data",
        description: "First plot data not loaded yet. Please wait."
      });
      return;
    }

    const timeRange = extractTimeRangeFromPlotData(firstPlotData);

    if (!timeRange) {
      toast({
        variant: "destructive",
        title: "Cannot Add Marine/Meteo Data",
        description: "Could not extract time range from first plot. Haplotype files don't have time data."
      });
      return;
    }

    // Add marine/meteo plot
    addPlot('marine-meteo', [], {
      location: { lat: objectLocation.lat, lon: objectLocation.lng },
      locationName: objectName || 'Object Location',
      timeRange
    });

    setShowPlotTypeSelector(false);

    toast({
      title: "Marine/Meteo Plot Added",
      description: `Time range: ${timeRange.startDate} to ${timeRange.endDate}`
    });
  }, [plots, plotsData, objectLocation, objectName, extractTimeRangeFromPlotData, addPlot, toast]);

  // Handler for copying the previous plot
  const handleCopyPreviousPlot = useCallback(() => {
    if (plots.length === 0) {
      toast({
        variant: "destructive",
        title: "Cannot Copy Plot",
        description: "No plots available to copy."
      });
      return;
    }

    // Get the last plot in the array (the one directly above the "Add Plot" button)
    const lastPlot = plots[plots.length - 1];

    // Create a copy with a new ID and modified title
    const copiedPlot: PlotConfig = {
      ...lastPlot,
      id: `${lastPlot.type}-copy-${Date.now()}`,
      title: lastPlot.title ? `${lastPlot.title} (Copy)` : `Plot ${plots.length + 1}`,
      fileName: lastPlot.fileName ? `${lastPlot.fileName} (Copy)` : undefined,
    };

    // Add the copied plot to the end of the array
    setPlots([...plots, copiedPlot]);

    setShowPlotTypeSelector(false);

    toast({
      title: "Plot Copied",
      description: `Created a copy of "${lastPlot.title || lastPlot.fileName || 'Plot'}"`
    });
  }, [plots, toast]);

  // Handler for presence-absence table creation
  const handlePresenceAbsenceClick = useCallback(async () => {
    // Get all HAPL/NMAX plots
    const haplPlots = plots.filter(plot =>
      plot.type === 'device' &&
      plot.fileName?.toLowerCase().match(/_hapl|_nmax/i)
    );

    if (haplPlots.length < 2) {
      toast({
        variant: "destructive",
        title: "Not Enough Files",
        description: "You need at least 2 HAPL or NMAX files to create a presence-absence table."
      });
      return;
    }

    // Parse each file to get species data
    const filesWithData: Array<{ fileName: string; parsedData: HaplotypeParseResult; selected: boolean }> = [];

    for (const plot of haplPlots) {
      if (plot.files && plot.files.length > 0) {
        try {
          const parsedData = await parseHaplotypeCsv(plot.files[0]);
          filesWithData.push({
            fileName: plot.fileName || plot.files[0].name,
            parsedData: parsedData,
            selected: true // All selected by default
          });
        } catch (error) {
          console.error(`Failed to parse ${plot.fileName}:`, error);
        }
      }
    }

    if (filesWithData.length < 2) {
      toast({
        variant: "destructive",
        title: "Parsing Error",
        description: "Could not parse enough files to create a presence-absence table."
      });
      return;
    }

    setPresenceAbsenceFiles(filesWithData);
    setShowPresenceAbsenceDialog(true);
    setShowPlotTypeSelector(false);
  }, [plots, toast]);

  // Handler for confirming presence-absence table
  const handleConfirmPresenceAbsence = useCallback((result: PresenceAbsenceResult) => {
    // Create a new plot with the presence-absence data
    const newPlot: PlotConfig = {
      id: `presence-absence-${Date.now()}`,
      title: `Presence-Absence (${result.fileCount} files)`,
      type: 'presence-absence',
      presenceAbsenceData: result
    };

    setPlots([...plots, newPlot]);
    setShowPresenceAbsenceDialog(false);

    toast({
      title: "Presence-Absence Table Created",
      description: `Comparing ${result.totalSpecies} species across ${result.fileCount} files`
    });
  }, [plots, toast]);

  // Initialize with one plot for the initially selected files
  // TESTING: Always add an empty plot on mount for quick testing
  React.useEffect(() => {
    if (!plotsInitialized.current && plots.length === 0) {
      // Check if auto-load is in progress
      if (autoLoadInProgress.current) {
        // Don't add empty plot, let the auto-load useEffect handle restoration
        console.log('⏭️ [INIT] Skipping empty plot initialization - auto-load in progress');
        plotsInitialized.current = true;
        return;
      }

      if (files.length > 0) {
        // Check for paired FPOD files (2 files: one _std, one _24hr)
        if (files.length === 2 && fileType === 'FPOD') {
          const suffixes = files.map(f => getFpodSuffix(f.name));
          const stdIdx = suffixes.indexOf('std');
          const avgIdx = suffixes.indexOf('24hr');

          if (stdIdx !== -1 && avgIdx !== -1) {
            const baseName = getFpodBaseName(files[stdIdx].name) || 'FPOD';
            console.log('📋 [PAIRED FPOD] Adding 2 stacked plots for paired files:', baseName);

            // Add _std plot first (top)
            addPlot('device', [files[stdIdx]], {
              fileType,
              customTitle: `${baseName} (Std)`,
              pinLabel: selectedFileMetadata?.pinLabel,
              startDate: selectedFileMetadata?.startDate,
              endDate: selectedFileMetadata?.endDate,
              fileCategories: selectedFileMetadata?.fileCategories,
              coordinates: selectedFileMetadata?.coordinates,
            });

            // Add _24hr plot second (bottom)
            addPlot('device', [files[avgIdx]], {
              fileType,
              customTitle: `${baseName} (Avg 24hr)`,
              pinLabel: selectedFileMetadata?.pinLabel,
              startDate: selectedFileMetadata?.startDate,
              endDate: selectedFileMetadata?.endDate,
              fileCategories: ['Avg 24hrs'],
              hideBrush: true,
              showDateTimeAxis: true,
              coordinates: selectedFileMetadata?.coordinates,
            });

            plotsInitialized.current = true;
            return;
          }
        }

        // Default: add a single plot with all files
        // Check if this is a 24hr FPOD file and apply special settings
        const is24hrFile = files.length === 1 &&
          fileType === 'FPOD' &&
          getFpodSuffix(files[0].name) === '24hr';

        console.log('📋 [INITIAL PLOT] Adding plot with metadata:', selectedFileMetadata, 'is24hr:', is24hrFile);
        addPlot('device', files, {
          fileType,
          customTitle: getFileName(files),
          pinLabel: selectedFileMetadata?.pinLabel,
          startDate: selectedFileMetadata?.startDate,
          endDate: selectedFileMetadata?.endDate,
          fileCategories: is24hrFile ? ['Avg 24hrs'] : selectedFileMetadata?.fileCategories,
          hideBrush: is24hrFile ? true : undefined,
          showDateTimeAxis: is24hrFile ? true : undefined,
          coordinates: selectedFileMetadata?.coordinates,
        });
      } else {
        // TESTING: Add an empty plot by default for quick testing of load functionality
        console.log('📊 [TESTING] Adding empty default plot for testing');
        setPlots([{
          id: `plot-${Date.now()}`,
          title: 'Plot 1',
          type: 'device',
          fileType: fileType,
          files: [],
          fileName: 'Empty Plot'
        }]);
      }
      plotsInitialized.current = true;
    }
  }, [addPlot, plots.length, fileType, files, getFileName]);

  return (
    <div className="h-full flex flex-col">
      {/* Content area - clean white background without header */}
      <CardContent className="p-3 flex-1 overflow-hidden">
        {plots.length === 0 ? (
          // Empty state - exactly like the original
          <div className="flex flex-col items-center justify-center text-muted-foreground h-full min-h-40 p-2 border rounded-md bg-muted/20">
            <LayoutGrid className="w-8 h-8 mb-2 text-muted" />
            <p className="text-xs">No device data plots to display.</p>
            <p className="text-[0.7rem]">Click "Add New Plot" to get started.</p>
          </div>
        ) : (
          // Plots container - scrollable with Add Plot button
          <div className="h-full flex flex-col gap-3">
            {/* Time Axis Mode Toggle and Save/Load Buttons - Sticky at top */}
            {/* Always show this header bar when there are plots */}
            {plots.length > 0 && (
              <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b pb-2">
                <div className="flex items-center justify-between gap-4">
                  {/* Left side: Time Axis Mode toggle (multi-plot, non-paired) or mouse-over hint for FPOD */}
                  {plots.length > 1 && !plots.some(p => p.hideBrush) && !plots.some(p => p.fileType === 'FPOD') ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Time Axis Mode:</span>
                      <Minus className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Separate</span>
                      <Switch
                        checked={timeAxisMode === 'common'}
                        onCheckedChange={(checked) => setTimeAxisMode(checked ? 'common' : 'separate')}
                        className="h-5 w-9"
                      />
                      <span className="text-xs text-muted-foreground">Common</span>
                      <AlignHorizontalJustifyCenter className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ) : plots.some(p => p.hideBrush || p.fileType === 'FPOD') ? (
                    <div className="bg-muted/50 border rounded px-3 py-1.5 flex items-center gap-2">
                      <p className="text-xs text-muted-foreground">
                        Mouse-over chart area for actual values
                      </p>
                    </div>
                  ) : (
                    <div className="flex-1" />
                  )}

                  {/* Right side: Methodology + Save/Load Plot View buttons - Always visible */}
                  {/* Added mr-10 to leave space for modal close X button */}
                  <div className="flex items-center gap-2 mr-10">
                    {projectId && tileName && (
                      <Button
                        size="sm"
                        className="h-8 text-xs text-white font-medium bg-teal-700 hover:bg-teal-800"
                        onClick={() => setShowMethodologyModal(true)}
                      >
                        <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                        Methodology
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const config = await serializePlotViewState();
                        setSerializedViewConfig(config);
                        setShowSavePlotViewDialog(true);
                      }}
                      disabled={plots.length === 0}
                      className="h-8"
                    >
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      Save View
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowLoadPlotViewDialog(true)}
                      className="h-8"
                    >
                      <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                      Load View
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-3">
              {plots.map((plot, index) => {
                // Render device plot (including merged plots which are now device plots with pre-parsed data)
                if (plot.type === 'device') {
                  return (
                    <PinPlotInstance
                      key={plot.id}
                      instanceId={plot.id}
                      initialPlotTitle={plot.fileName!}
                      onRemovePlot={plots.length > 1 && !plots.some(p => p.hideBrush) ? removePlot : undefined}
                      fileType={plot.fileType!}
                      files={plot.files!}
                      preParsedData={plot.mergedData} // Pass merged data for merged plots
                      pinLabel={plot.pinLabel}
                      startDate={plot.startDate}
                      endDate={plot.endDate}
                      fileCategories={plot.fileCategories}
                      hideBrush={plot.hideBrush}
                      showDateTimeAxis={plot.showDateTimeAxis}
                      coordinates={plot.coordinates}
                      timeAxisMode={timeAxisMode}
                      globalTimeRange={timeAxisMode === 'common' ? globalTimeRange : undefined}
                      globalBrushRange={timeAxisMode === 'common' ? globalBrushRange : undefined}
                      onDataParsed={handlePlotDataParsed}
                      onBrushChange={timeAxisMode === 'common' && index === plots.length - 1 ? handleGlobalBrushChange : undefined}
                      isLastPlot={index === plots.length - 1}
                      onVisibilityChange={visibilityCallbacks[plot.id]}
                      // Pass initial state for restoring saved views
                      initialVisibleParameters={plotVisibilityState[plot.id]?.params}
                      initialParameterColors={plotVisibilityState[plot.id]?.colors}
                      initialParameterSettings={plotVisibilityState[plot.id]?.settings}
                      initialAxisMode={plotVisibilityState[plot.id]?.plotSettings?.axisMode}
                      initialCustomYAxisLabel={plotVisibilityState[plot.id]?.plotSettings?.customYAxisLabel}
                      initialCompactView={plotVisibilityState[plot.id]?.plotSettings?.compactView}
                      initialCustomParameterNames={plotVisibilityState[plot.id]?.plotSettings?.customParameterNames}
                      pinId={plot.pinId}
                      // Subtracted plot settings
                      isSubtractedPlot={plot.computationType === 'subtract'}
                      includeZeroValues={plot.computationConfig?.includeZeroValues ?? false}
                      onIncludeZeroValuesChange={(include) => handleIncludeZeroValuesChange(plot.id, include)}
                      // Methodology modal props
                      projectId={projectId}
                      tileName={tileName}
                    />
                  );
                }

                // Render presence-absence plot
                if (plot.type === 'presence-absence' && plot.presenceAbsenceData) {
                  return (
                    <PresenceAbsenceTable
                      key={plot.id}
                      data={plot.presenceAbsenceData}
                      plotId={plot.id}
                      onClose={() => removePlot(plot.id)}
                    />
                  );
                }

                // Render marine/meteo plot
                return (
                  <PinMarineMeteoPlot
                    key={plot.id}
                    instanceId={plot.id}
                    location={plot.location!}
                    locationName={plot.locationName!}
                    timeRange={plot.timeRange!}
                    onRemovePlot={plots.length > 1 ? removePlot : undefined}
                    timeAxisMode={timeAxisMode}
                    globalTimeRange={timeAxisMode === 'common' ? globalTimeRange : undefined}
                    globalBrushRange={timeAxisMode === 'common' ? globalBrushRange : undefined}
                    onDataParsed={handlePlotDataParsed}
                    onBrushChange={timeAxisMode === 'common' && index === plots.length - 1 ? handleGlobalBrushChange : undefined}
                    isLastPlot={index === plots.length - 1}
                    onVisibilityChange={visibilityCallbacks[plot.id]}
                    // Pass initial state for restoring saved views
                    initialVisibleParameters={plotVisibilityState[plot.id]?.params}
                    initialParameterColors={plotVisibilityState[plot.id]?.colors}
                    initialParameterSettings={plotVisibilityState[plot.id]?.settings}
                  />
                );
              })}

              {/* Add Plot Button - inside scrollable area */}
              <div className="flex justify-center py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowPlotTypeSelector(true);
                  }}
                  className="gap-2"
                >
                  <PlusCircle className="h-4 w-4" />
                  Add Plot
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>

      {/* Plot Type Selector Modal */}
      {showPlotTypeSelector && (
        <PlotTypeSelector
          onSelectDeviceData={() => {
            setShowPlotTypeSelector(false);
            setShowFileSelector(true);
          }}
          onSelectMarineMeteo={handleAddMarineMeteoPlot}
          onSelectMerge={() => {
            handleMergePlots();
            setShowPlotTypeSelector(false);
          }}
          onSelectSubtract={() => {
            handleSubtractPlots();
            setShowPlotTypeSelector(false);
          }}
          onSelectCopyPrevious={handleCopyPreviousPlot}
          onSelectPresenceAbsence={handlePresenceAbsenceClick}
          canMergePlots={canMergePlots}
          canSubtractPlots={canSubtractPlots}
          canCopyPrevious={plots.length > 0}
          canCreatePresenceAbsence={canCreatePresenceAbsence}
          onCancel={() => setShowPlotTypeSelector(false)}
        />
      )}

      {/* File Selector Modal - Using DataTimeline for selection */}
      {showFileSelector && allProjectFilesForTimeline && getFileDateRange && (
        <FileSelectionDialog
          open={showFileSelector}
          onOpenChange={setShowFileSelector}
          files={allProjectFilesForTimeline}
          getFileDateRange={getFileDateRange}
          projectId={projectId}
          excludeFileNames={plots.filter(p => p.type === 'device').map(p => p.fileName!)}
          enableProjectSelector={true}
          availableProjects={availableProjects}
          onProjectChange={(newProjectId) => {
            console.log('[PinMarineDeviceData] User selected project:', newProjectId);
          }}
          onFileSelected={async (file) => {
            // Detect file type from filename
            const lowerFileName = file.fileName.toLowerCase();
            let detectedFileType: 'GP' | 'FPOD' | 'Subcam' = 'GP';
            if (lowerFileName.includes('subcam')) {
              detectedFileType = 'Subcam';
            } else if (lowerFileName.includes('fpod')) {
              detectedFileType = 'FPOD';
            }

            // Map the file to FileOption format for download handling
            const fileOption = {
              pinId: file.pinId || null,
              areaId: file.areaId || null,
              pinName: file.pinLabel,
              fileType: detectedFileType,
              files: [], // No files loaded yet
              fileName: file.fileName,
              metadata: file
            };

            // Check if files need to be downloaded
            if (fileOption.files.length === 0 && onDownloadFile && fileOption.metadata) {
              console.log('📥 File not loaded, downloading...', fileOption.fileName);
              console.log('📥 File IDs:', { pinId: fileOption.pinId, areaId: fileOption.areaId });
              console.log('📥 Passing metadata for cross-project support:', fileOption.metadata);
              const downloadedFile = await onDownloadFile(fileOption.pinId, fileOption.fileName, fileOption.areaId, fileOption.metadata);

              if (downloadedFile) {
                // Add plot with downloaded file AND its database ID
                // Use pinId if available, otherwise use areaId for tracking
                const objectId = fileOption.pinId || fileOption.areaId;

                // Extract metadata for header display
                const metadata = fileOption.metadata;
                const pinLabel = (metadata as any)?.pinLabel || fileOption.pinName;
                const startDate = metadata?.startDate;
                const endDate = metadata?.endDate;

                // Extract category from filename using categorization
                const { categorizeFile } = await import('@/lib/file-categorization-config');
                const categories = categorizeFile(fileOption.fileName);
                const fileCategory = categories[0]?.category;

                addPlot('device', [downloadedFile], {
                  fileType: fileOption.fileType,
                  customTitle: fileOption.fileName,
                  pinId: objectId,
                  fileId: file.id, // Store the database file ID for restoration
                  pinLabel,
                  startDate,
                  endDate,
                  fileCategory
                });
              } else {
                console.error('Failed to download file:', fileOption.fileName);
                toast({
                  variant: "destructive",
                  title: "Download Failed",
                  description: `Could not download ${fileOption.fileName}`
                });
              }
            } else {
              // Files already loaded, add plot directly
              if (fileOption.files.length > 0) {
                const objectId = fileOption.pinId || fileOption.areaId;

                // Extract metadata for header display
                const metadata = fileOption.metadata;
                const pinLabel = (metadata as any)?.pinLabel || fileOption.pinName;
                const startDate = metadata?.startDate;
                const endDate = metadata?.endDate;

                // Extract category from filename using categorization
                const { categorizeFile } = await import('@/lib/file-categorization-config');
                const categories = categorizeFile(fileOption.fileName);
                const fileCategory = categories[0]?.category;

                addPlot('device', fileOption.files, {
                  fileType: fileOption.fileType,
                  customTitle: fileOption.fileName,
                  pinId: objectId,
                  fileId: file.id, // Store the database file ID for restoration
                  pinLabel,
                  startDate,
                  endDate,
                  fileCategory
                });
              } else {
                console.error('❌ No files to add and no download function provided');
                toast({
                  variant: "destructive",
                  title: "Cannot Add Plot",
                  description: "No file data available. Please try reloading the page."
                });
              }
            }
          }}
        />
      )}

      {/* Merge CSV Preview Dialog */}
      {showMergePreview && mergePreviewData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[99999]" onClick={() => {
          setShowMergePreview(false);
          setMergePreviewData(null);
        }}>
          <div className="bg-background p-6 rounded-lg shadow-lg max-w-4xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 space-y-3">
              <h3 className="text-lg font-semibold mb-1">Preview Merged CSV Data</h3>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {mergePreviewData.summary.totalRows} rows × {mergePreviewData.headers.length} columns
                </p>
                <div className="flex items-center gap-2">
                  <Label htmlFor="time-rounding" className="text-sm">Time Rounding:</Label>
                  <Select
                    value={timeRoundingInterval}
                    onValueChange={(value) => {
                      console.log('📊 Dropdown changed to:', value);
                      setTimeRoundingInterval(value);
                      if (mergeRawData) {
                        console.log('📊 Applying time rounding with new interval...');
                        const rounded = applyTimeRounding(mergeRawData, value);
                        setMergePreviewData(rounded);
                        // Reset smoothing when time rounding changes
                        setSmoothingApplied(false);
                        setSmoothedParameterName(null);
                      } else {
                        console.warn('📊 mergeRawData is null, cannot apply rounding');
                      }
                    }}
                  >
                    <SelectTrigger id="time-rounding" className="w-32 h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1min">1 Minute</SelectItem>
                      <SelectItem value="10min">10 Minutes</SelectItem>
                      <SelectItem value="30min">30 Minutes</SelectItem>
                      <SelectItem value="1hr">1 Hour</SelectItem>
                      <SelectItem value="6hr">6 Hours</SelectItem>
                      <SelectItem value="1day">1 Day</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Sparse/Dense Detection Banner */}
              {(() => {
                const scenario = detectSparseDenseScenario(mergePreviewData);
                if (scenario && scenario.isSparse) {
                  return (
                    <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-md p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-amber-900 dark:text-amber-100 mb-1">
                            Sparse Data Detected
                          </p>
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                            <strong>{scenario.sparseParam}</strong>: {scenario.sparseCount} observations<br />
                            <strong>{scenario.denseParam}</strong>: {scenario.denseCount} observations<br />
                            {!smoothingApplied && (
                              <span className="text-amber-600 dark:text-amber-400">
                                Smoothing will generate ~{scenario.denseCount - scenario.sparseCount} additional points for the sparse parameter
                              </span>
                            )}
                            {smoothingApplied && smoothedParameterName && (
                              <span className="text-green-600 dark:text-green-400 font-medium">
                                ✓ Smoothed {smoothedParameterName} from {originalObsCount} to {smoothedObsCount} observations
                              </span>
                            )}
                          </p>
                        </div>
                        {!smoothingApplied ? (
                          <Button
                            size="sm"
                            variant="default"
                            className="bg-amber-600 hover:bg-amber-700 text-white"
                            onClick={async () => {
                              if (mergePreviewData) {
                                const smoothed = await applySmoothingToData(mergePreviewData);
                                setMergePreviewData(smoothed);
                                toast({
                                  title: "Smoothing Applied",
                                  description: `Generated ${smoothedObsCount - originalObsCount} new data points`
                                });
                              }
                            }}
                          >
                            Smooth Sparse Data
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              // Reset to time-rounded data without smoothing
                              if (mergeRawData) {
                                const rounded = applyTimeRounding(mergeRawData, timeRoundingInterval);
                                setMergePreviewData(rounded);
                                setSmoothingApplied(false);
                                setSmoothedParameterName(null);
                                toast({
                                  title: "Smoothing Removed",
                                  description: "Restored original data"
                                });
                              }
                            }}
                          >
                            Remove Smoothing
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            {/* Table Preview */}
            <div className="flex-1 overflow-auto border rounded-md mb-4">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    {mergePreviewData.headers.map((header, headerIdx) => (
                      <th key={`header-${headerIdx}`} className="p-2 text-left border-b font-semibold">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mergePreviewData.data.slice(0, 100).map((row, idx) => (
                    <tr key={idx} className="border-b hover:bg-muted/50">
                      {mergePreviewData.headers.map((header, headerIdx) => (
                        <td key={`cell-${idx}-${headerIdx}`} className="p-2">
                          {row[header] !== null && row[header] !== undefined
                            ? String(row[header])
                            : '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {mergePreviewData.data.length > 100 && (
                <div className="p-2 text-center text-xs text-muted-foreground bg-muted/50">
                  Showing first 100 of {mergePreviewData.data.length} rows
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowMergePreview(false);
                  setMergePreviewData(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  // Download CSV
                  const csvContent = [
                    mergePreviewData.headers.join(','),
                    ...mergePreviewData.data.map(row =>
                      mergePreviewData.headers.map(header => {
                        const value = row[header];
                        return value !== null && value !== undefined ? value : '';
                      }).join(',')
                    )
                  ].join('\n');

                  const blob = new Blob([csvContent], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `merged-${mergePreviewData.headers[1]}-${mergePreviewData.headers[2]}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);

                  toast({
                    title: "CSV Downloaded",
                    description: "Merged CSV file has been saved"
                  });
                }}
              >
                Save as CSV
              </Button>
              <Button onClick={confirmMerge}>
                Create Merged Plot
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Subtract CSV Preview Dialog */}
      {showSubtractPreview && subtractPreviewData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[99999]" onClick={() => {
          setShowSubtractPreview(false);
          setSubtractPreviewData(null);
        }}>
          <div className="bg-background p-6 rounded-lg shadow-lg max-w-4xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 space-y-3">
              <h3 className="text-lg font-semibold mb-1">Preview Subtracted Data</h3>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {subtractPreviewData.summary.totalRows} rows × {subtractPreviewData.headers.length} columns
                </p>
                <div className="flex items-center gap-2">
                  <Label htmlFor="subtract-time-rounding" className="text-sm">Time Rounding:</Label>
                  <Select
                    value={timeRoundingInterval}
                    onValueChange={(value) => {
                      setTimeRoundingInterval(value);
                      if (subtractRawData) {
                        const rounded = applyTimeRounding(subtractRawData, value);
                        setSubtractPreviewData(rounded);
                      }
                    }}
                  >
                    <SelectTrigger id="subtract-time-rounding" className="w-32 h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1min">1 Minute</SelectItem>
                      <SelectItem value="10min">10 Minutes</SelectItem>
                      <SelectItem value="30min">30 Minutes</SelectItem>
                      <SelectItem value="1hr">1 Hour</SelectItem>
                      <SelectItem value="6hr">6 Hours</SelectItem>
                      <SelectItem value="1day">1 Day</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Control Panel */}
              <div className="bg-muted/30 border rounded-md p-3 space-y-2">
                {/* Direction Control */}
                <div className="flex items-center gap-4">
                  <Label className="text-sm font-medium">Direction:</Label>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="direction"
                        checked={subtractDirection === '1-2'}
                        onChange={() => {
                          setSubtractDirection('1-2');
                          if (subtractRawData) {
                            // Reapply subtraction with new direction
                            handleSubtractPlots();
                          }
                        }}
                        className="h-4 w-4"
                      />
                      <span className="text-sm">Plot 1 - Plot 2</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="direction"
                        checked={subtractDirection === '2-1'}
                        onChange={() => {
                          setSubtractDirection('2-1');
                          if (subtractRawData) {
                            // Reapply subtraction with new direction
                            handleSubtractPlots();
                          }
                        }}
                        className="h-4 w-4"
                      />
                      <span className="text-sm">Plot 2 - Plot 1</span>
                    </label>
                  </div>
                </div>

                {/* Missing Data Mode Control */}
                <div className="flex items-center gap-4">
                  <Label className="text-sm font-medium">Missing Data:</Label>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="missingData"
                        checked={subtractMissingDataMode === 'skip'}
                        onChange={() => {
                          setSubtractMissingDataMode('skip');
                          if (subtractRawData) {
                            handleSubtractPlots();
                          }
                        }}
                        className="h-4 w-4"
                      />
                      <span className="text-sm">Skip (only where both exist)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="missingData"
                        checked={subtractMissingDataMode === 'zero'}
                        onChange={() => {
                          setSubtractMissingDataMode('zero');
                          if (subtractRawData) {
                            handleSubtractPlots();
                          }
                        }}
                        className="h-4 w-4"
                      />
                      <span className="text-sm">Use zero for missing values</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Units Warning Banner (if applicable) */}
              {subtractUnitsWarning && (
                <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-md p-3">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-100 mb-1">
                    Units May Differ
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {subtractUnitsWarning}
                  </p>
                </div>
              )}
            </div>

            {/* Table Preview */}
            <div className="flex-1 overflow-auto border rounded-md mb-4">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    {subtractPreviewData.headers.map((header, headerIdx) => (
                      <th key={`header-${headerIdx}`} className="p-2 text-left border-b font-semibold">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {subtractPreviewData.data.slice(0, 100).map((row, idx) => (
                    <tr key={idx} className="border-b hover:bg-muted/50">
                      {subtractPreviewData.headers.map((header, headerIdx) => (
                        <td key={`cell-${idx}-${headerIdx}`} className="p-2">
                          {row[header] !== null && row[header] !== undefined
                            ? String(row[header])
                            : '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {subtractPreviewData.data.length > 100 && (
                <div className="p-2 text-center text-xs text-muted-foreground bg-muted/50">
                  Showing first 100 of {subtractPreviewData.data.length} rows
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowSubtractPreview(false);
                  setSubtractPreviewData(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  // Download CSV
                  const csvContent = [
                    subtractPreviewData.headers.join(','),
                    ...subtractPreviewData.data.map(row =>
                      subtractPreviewData.headers.map(header => {
                        const value = row[header];
                        return value !== null && value !== undefined ? value : '';
                      }).join(',')
                    )
                  ].join('\n');

                  const blob = new Blob([csvContent], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `subtracted-${subtractPreviewData.headers[1].replace(/[^a-z0-9]/gi, '_')}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);

                  toast({
                    title: "CSV Downloaded",
                    description: "Subtracted CSV file has been saved"
                  });
                }}
              >
                Save as CSV
              </Button>
              <Button onClick={confirmSubtract}>
                Create Subtracted Plot
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Save Plot View Dialog */}
      {projectId && serializedViewConfig && (
        <SavePlotViewDialog
          open={showSavePlotViewDialog}
          onOpenChange={setShowSavePlotViewDialog}
          viewConfig={serializedViewConfig}
          projectId={projectId}
          onSaveSuccess={() => {
            // Optionally refresh the list when a view is saved
            console.log('Plot view saved successfully');
          }}
        />
      )}

      {/* Load Plot View Dialog */}
      {projectId && (
        <LoadPlotViewDialog
          open={showLoadPlotViewDialog}
          onOpenChange={setShowLoadPlotViewDialog}
          projectId={projectId}
          onLoad={restorePlotViewState}
        />
      )}

      {/* Methodology Modal */}
      {projectId && tileName && (
        <MethodologyModal
          open={showMethodologyModal}
          onOpenChange={setShowMethodologyModal}
          projectId={projectId}
          tileName={tileName}
        />
      )}

      {/* Presence-Absence Dialog */}
      <PresenceAbsenceDialog
        open={showPresenceAbsenceDialog}
        onOpenChange={setShowPresenceAbsenceDialog}
        availableFiles={presenceAbsenceFiles}
        onConfirm={handleConfirmPresenceAbsence}
        onCancel={() => setShowPresenceAbsenceDialog(false)}
      />

      {/* Merge Rules Dialog */}
      {multiFileConfirmData && (
        <MergeRulesDialog
          open={showMultiFileConfirmDialog}
          onOpenChange={setShowMultiFileConfirmDialog}
          parsedFiles={multiFileConfirmData.parsedFiles}
          mergeRules={mergeRules}
          onMergeRuleToggle={handleMergeRuleToggle}
          onConfirm={async (mode) => {
            console.log('✅ Confirm & Merge clicked!', { mode, multiFileConfirmData });
            try {
              // Import merge utilities
              const { mergeFiles } = await import('@/lib/multiFileValidator');

              // Merge files with selected mode
              console.log(`🔄 Merging files after confirmation using ${mode} mode...`);
              console.log('📁 Parsed files to merge:', multiFileConfirmData.parsedFiles);
              const mergedData = mergeFiles(multiFileConfirmData.parsedFiles, mode);
              console.log('✅ Merge completed:', mergedData);

              // Convert merged data to ParseResult format
              const parseResult = {
                data: mergedData.data,
                headers: mergedData.headers,
                errors: [],
                summary: {
                  totalRows: mergedData.data.length,
                  validRows: mergedData.data.length,
                  columns: mergedData.headers.length,
                  timeColumn: mergedData.timeColumn
                }
              };

              // Create a merged plot
              const modeLabel = mode === 'stack-parameters' ? 'Stacked' : 'Sequential';
              const mergedFileName = `${modeLabel}: ${mergedData.sourceFiles.map(f => f.split('.')[0]).join(' + ')}`;

              // Add plot with merged data
              const mergedPlot: PlotConfig = {
                id: `multi-file-${Date.now()}`,
                title: mergedFileName,
                type: 'device',
                fileType: multiFileConfirmData.fileType,
                files: [],
                fileName: mergedFileName,
                isMerged: true,
                mergedData: parseResult,
              };

              console.log('📊 Adding merged plot to plots:', mergedPlot);
              setPlots([...plots, mergedPlot]);
              console.log('✅ Plot added, closing dialog');
              setShowMultiFileConfirmDialog(false);
              setMultiFileConfirmData(null);

              console.log('🎉 Showing success toast');
              toast({
                title: "Files Merged Successfully",
                description: `Combined ${mergedData.sourceFiles.length} files in ${modeLabel} mode with ${mergedData.data.length} data points`,
                duration: 4000
              });
            } catch (error) {
              console.error('Error merging files:', error);
              toast({
                variant: "destructive",
                title: "Multi-file Merge Failed",
                description: error instanceof Error ? error.message : 'An unknown error occurred',
                duration: 6000
              });
            }
          }}
          onCancel={() => {
            setShowMultiFileConfirmDialog(false);
            setMultiFileConfirmData(null);
          }}
        />
      )}
    </div>
  );
}

// Custom comparison function for React.memo()
// Focus on data props that affect rendering
const arePropsEqual = (prevProps: PinMarineDeviceDataProps, nextProps: PinMarineDeviceDataProps): boolean => {
  // Check file-related props
  if (prevProps.fileType !== nextProps.fileType ||
      prevProps.files !== nextProps.files ||
      prevProps.availableFiles !== nextProps.availableFiles) {
    return false;
  }

  // Check location props
  if (prevProps.objectLocation?.lat !== nextProps.objectLocation?.lat ||
      prevProps.objectLocation?.lon !== nextProps.objectLocation?.lon ||
      prevProps.objectName !== nextProps.objectName) {
    return false;
  }

  // Check project props
  if (prevProps.projectId !== nextProps.projectId ||
      prevProps.availableProjects !== nextProps.availableProjects) {
    return false;
  }

  // Check initial view to load
  if (prevProps.initialViewToLoad !== nextProps.initialViewToLoad) {
    return false;
  }

  // Check merge mode
  if (prevProps.multiFileMergeMode !== nextProps.multiFileMergeMode) {
    return false;
  }

  // Check timeline data (reference equality)
  if (prevProps.allProjectFilesForTimeline !== nextProps.allProjectFilesForTimeline) {
    return false;
  }

  // Callbacks are assumed to be memoized in parent
  // If they change, component should re-render

  return true; // Props are equal, skip re-render
};

// Export memoized component for better performance (reduces re-renders for large data processing)
export default memo(PinMarineDeviceData, arePropsEqual);