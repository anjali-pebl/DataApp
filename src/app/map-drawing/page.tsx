'use client';

import React, { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from "@/hooks/use-toast";
import { Loader2, MapPin, Minus, Square, Home, RotateCcw, Save, Trash2, Navigation, Settings, Plus, Minus as MinusIcon, ZoomIn, ZoomOut, Map as MapIcon, Crosshair, FolderOpen, Bookmark, Eye, EyeOff, Target, Menu, ChevronDown, ChevronRight, Info, Edit3, Check, Database, BarChart3, Upload, Cloud, Calendar, RotateCw, Share, Share2, Users, Lock, Globe, X, Search, CheckCircle2, XCircle, ChevronUp, Thermometer, Wind as WindIcon, CloudSun, Compass as CompassIcon, Waves, Sailboat, Timer as TimerIcon, Sun as SunIcon, AlertCircle, AlertTriangle, Move3D, Copy, FileCode } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line as RechartsLine, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid, Brush, LabelList, ReferenceLine } from 'recharts';
import type { LucideIcon } from "lucide-react";
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { format, parseISO, isValid, startOfDay, formatISO, subDays } from 'date-fns';
import { cn } from '@/lib/utils';

import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  SettingsDialogContent,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMapView } from '@/hooks/use-map-view';
import { useSettings } from '@/hooks/use-settings';
import { useMapData } from '@/hooks/use-map-data';
import { useActiveProject } from '@/hooks/use-active-project';
import { projectService } from '@/lib/supabase/project-service';
import { getTimeWindowSummary } from '@/lib/dateParser';
import { fileStorageService, type PinFile } from '@/lib/supabase/file-storage-service';
import { mapDataService } from '@/lib/supabase/map-data-service';
import { perfLogger } from '@/lib/perf-logger';
import { DataRestoreNotifications } from '@/components/auth/DataRestoreDialog';
import { createClient } from '@/lib/supabase/client';
import type { DateRange } from "react-day-picker";
import type { CombinedDataPoint, LogStep as ApiLogStep, CombinedParameterKey } from '../om-marine-explorer/shared';
import { ALL_PARAMETERS, PARAMETER_CONFIG } from '../om-marine-explorer/shared';
import { fetchCombinedDataAction } from '../om-marine-explorer/actions';
import MarinePlotsGrid from '@/components/charts/LazyMarinePlotsGrid';
import { DataTimeline } from '@/components/pin-data/DataTimeline';
import { DEFAULT_MERGE_RULES, type MergeRule } from '@/components/pin-data/MergeRulesDialog';
import { DatePickerWithRange } from '@/components/ui/date-picker-with-range';
import { getMergedFilesByProjectAction } from '@/app/api/merged-files/actions';
import type { MergedFile } from '@/lib/supabase/merged-files-service';
import {
  parseCoordinateInput,
  getCoordinateFormats,
  validateCoordinate,
  CoordinateFormat,
  COORDINATE_FORMAT_LABELS,
  COORDINATE_FORMAT_EXAMPLES
} from '@/lib/coordinate-utils';
import { usePageLoadingState } from '@/hooks/usePageLoadingState';
import { TopProgressBar } from '@/components/loading/TopProgressBar';
import { MapSkeleton, MarinePlotsSkeleton, DataTimelineSkeleton } from '@/components/loading/PageSkeletons';
import { DateInputDialog } from '@/components/pin-data/DateInputDialog';
import { BatchDateConfirmDialog } from '@/components/pin-data/BatchDateConfirmDialog';
import { hasTimeColumn, createFileWithDateColumn } from '@/lib/csv-date-injector';
import { extractEdnaDate, isEdnaMetaFile } from '@/lib/edna-utils';

// ============================================================================
// DATA EXPLORER PANEL IMPORTS - NEW ADDITION
// ============================================================================
import { isFeatureEnabled } from '@/lib/feature-flags';
import LazyDataExplorerPanel from '@/components/data-explorer/LazyDataExplorerPanel';
import type { SavedPlotView } from '@/lib/supabase/plot-view-types';
// ============================================================================

// Lazy load heavy dialog components
const ShareDialogSimplified = dynamic(
  () => import('@/components/sharing/ShareDialogSimplified').then(mod => ({ default: mod.ShareDialogSimplified })),
  { ssr: false, loading: () => <div className="animate-pulse">Loading...</div> }
);

const MergeRulesDialog = dynamic(
  () => import('@/components/pin-data/MergeRulesDialog').then(mod => ({ default: mod.MergeRulesDialog })),
  { ssr: false, loading: () => <div className="animate-pulse">Loading...</div> }
);
// Define types locally to avoid SSR issues with Leaflet
interface LatLng {
  lat: number;
  lng: number;
}

interface LeafletMouseEvent {
  latlng: LatLng;
  originalEvent: MouseEvent;
}

interface LeafletMap {
  setView: (center: [number, number], zoom: number, options?: any) => void;
  getCenter: () => LatLng;
  getZoom: () => number;
  zoomIn: () => void;
  zoomOut: () => void;
  invalidateSize: () => void;
  closePopup: () => void;
  eachLayer: (fn: (layer: any) => void) => void;
}

const LeafletMap = dynamic(() => import('@/components/map/LeafletMap').then(mod => ({ default: mod.default })), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-muted flex items-center justify-center min-h-[500px]">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Loading map...</p>
      </div>
    </div>
  ),
});

import { Project, Tag, Pin, Line as LineType, Area } from '@/lib/supabase/types';
import PinMarineDeviceData from '@/components/pin-data/PinMarineDeviceData';
// Lazy-loaded dialog components (reduce initial bundle size)
import {
  LazyFileUploadDialog as FileUploadDialog,
  LazyProjectSettingsDialog as ProjectSettingsDialog,
  LazyMarineDeviceModal as MarineDeviceModal,
  LazyProjectsDialog as ProjectsDialog,
  LazyDeleteProjectConfirmDialog as DeleteProjectConfirmDialog,
  LazyBatchDeleteConfirmDialog as BatchDeleteConfirmDialog,
  LazyDuplicateWarningDialog as DuplicateWarningDialog,
  LazyAddProjectDialog as AddProjectDialog,
  LazyProjectDataDialog as ProjectDataDialog
} from '@/components/map-drawing/dialogs/LazyDialogs';

type DrawingMode = 'none' | 'pin' | 'line' | 'area';

// Predefined project locations from DataApp
const PROJECT_LOCATIONS = {
  milfordhaven: { name: "Milford Haven", lat: 51.7128, lon: -5.0341 },
  ramseysound: { name: "Ramsey Sound", lat: 51.871645, lon: -5.313960 },
  bidefordbay: { name: "Bideford Bay", lat: 51.052156, lon: -4.405961 },
  blakeneyoverfalls: { name: "Blakeney Overfalls", lat: 53.028671, lon: 0.939562 },
  pabayinnersound: { name: "Pabay Inner Sound", lat: 57.264780, lon: -5.853793 },
  lochbay: { name: "Loch Bay", lat: 57.506498, lon: -6.620397 },
  lochsunart: { name: "Loch Sunart", lat: 56.666195, lon: -5.917401 },
};

// Helper components for pin meteo data display (matching MarinePlotsGrid style)
const formatDateTickBrush = (timeValue: string | number): string => {
  try {
    const dateObj = typeof timeValue === 'string' ? parseISO(timeValue) : new Date(timeValue);
    if (!isValid(dateObj)) return String(timeValue);
    return format(dateObj, 'EEE, dd/MM');
  } catch (e) {
    return String(timeValue);
  }
};

type SeriesAvailabilityStatus = 'pending' | 'available' | 'unavailable';

type PlotConfigInternal = {
  dataKey: CombinedParameterKey; 
  name: string;
  unit: string;
  color: string;
  Icon: LucideIcon; 
  isDirectional?: boolean;
};

// A simple arrow shape for the data labels
const DirectionArrow = ({ className, ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    width="14" height="14" viewBox="0 0 24 24" 
    fill="currentColor" stroke="hsl(var(--background))" 
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" 
    className={cn("lucide lucide-navigation", className)}
    {...props}
  >
    <polygon points="12 2 19 21 12 17 5 21 12 2"></polygon>
  </svg>
);

// Custom Label for Directional Plots
const DirectionLabel = (props: any) => {
  const { x, y, value, index } = props;

  // Only render for every 10th item to prevent clutter
  if (index % 10 !== 0 || value === null || value === undefined) {
    return null;
  }

  return (
    <foreignObject x={x - 7} y={y - 7} width="14" height="14">
      <DirectionArrow
        style={{ transform: `rotate(${value + 180}deg)`, transformOrigin: 'center center' }} 
        className="text-foreground/80"
      />
    </foreignObject>
  );
};

const PinMeteoPlotRow = React.memo(({
  config,
  index,
  plotCount,
  displayData,
  isPlotVisible,
  availabilityStatus,
  dailyReferenceLines,
  onVisibilityChange,
  onMove
}: {
  config: PlotConfigInternal;
  index: number;
  plotCount: number;
  displayData: CombinedDataPoint[];
  isPlotVisible: boolean;
  availabilityStatus: SeriesAvailabilityStatus;
  dailyReferenceLines: string[];
  onVisibilityChange: (key: CombinedParameterKey, checked: boolean) => void;
  onMove: (index: number, direction: 'up' | 'down') => void;
}) => {

  const isDirectional = config.isDirectional;

  const transformedDisplayData = React.useMemo(() => displayData.map(point => {
    const value = point[config.dataKey as keyof CombinedDataPoint];
    if (value === undefined || value === null || (typeof value === 'number' && isNaN(value))) {
      return { ...point, [config.dataKey]: null };
    }
    return point;
  }), [displayData, config.dataKey]);

  const hasValidDataForSeriesInView = React.useMemo(() => transformedDisplayData.some(p => {
    const val = p[config.dataKey as keyof CombinedDataPoint];
    return val !== null && !isNaN(Number(val));
  }), [transformedDisplayData, config.dataKey]);

  const lastDataPointWithValidValue = React.useMemo(() => [...transformedDisplayData].reverse().find(p => {
    const val = p[config.dataKey as keyof CombinedDataPoint];
    return val !== null && !isNaN(Number(val));
  }), [transformedDisplayData, config.dataKey]);
  
  const currentValue = lastDataPointWithValidValue ? lastDataPointWithValidValue[config.dataKey as keyof CombinedDataPoint] as number | undefined : undefined;
  
  let displayValue = "";
  if (isPlotVisible && availabilityStatus === 'available' && typeof currentValue === 'number' && !isNaN(currentValue)) {
    displayValue = `${currentValue.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits: 1})}${isDirectional ? '' : config.unit || ''}`;
  }

  const IconComponent = config.Icon;

  return (
    <div key={config.dataKey as string} className="border rounded-md p-1.5 shadow-sm bg-card flex-shrink-0 flex flex-col">
      <div className="flex items-center justify-between px-1 pt-0.5 text-lg">
        <div className="flex flex-1 items-center gap-1.5 min-w-0">
          <Checkbox
            id={`visibility-${config.dataKey}-${index}`}
            checked={isPlotVisible}
            onCheckedChange={(checked) => onVisibilityChange(config.dataKey, !!checked)}
            className="h-3.5 w-3.5 flex-shrink-0 border-muted-foreground/50"
          />
          <Label htmlFor={`visibility-${config.dataKey}-${index}`} className="flex items-center gap-1 cursor-pointer min-w-0 text-muted-foreground">
            <IconComponent className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="font-medium whitespace-nowrap overflow-hidden text-ellipsis" title={config.name}>
              {config.name}
            </span>
          </Label>
          <div className="flex-shrink-0 flex items-center ml-1">
            {availabilityStatus === 'pending' && <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />}
            {availabilityStatus === 'available' && isPlotVisible && hasValidDataForSeriesInView && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
            {availabilityStatus !== 'pending' && isPlotVisible && (!hasValidDataForSeriesInView || availabilityStatus === 'unavailable') && <XCircle className="h-3.5 w-3.5 text-red-500" />}
          </div>
        </div>
        <div className="flex items-center flex-shrink-0">
          {displayValue && (
            <span className={cn("text-muted-foreground text-lg font-semibold ml-auto pl-2 whitespace-nowrap")}>{displayValue}
             {isDirectional && typeof currentValue === 'number' && <DirectionArrow style={{ display: 'inline-block', transform: `rotate(${currentValue + 180}deg)`, height: '1em', width: '1em', marginLeft: '0.25em', verticalAlign: 'middle' }} />}
            </span>
          )}
          <Button variant="ghost" size="icon" className="h-5 w-5 ml-1" onClick={() => onMove(index, 'up')} disabled={index === 0}>
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => onMove(index, 'down')} disabled={index === plotCount - 1}>
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {isPlotVisible && (
        <div className="flex-grow h-[100px] sm:h-[90px] mt-1">
          {(availabilityStatus === 'available' && hasValidDataForSeriesInView) ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={transformedDisplayData} margin={{ top: 5, right: 12, left: 5, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 2" stroke="hsl(var(--border))" vertical={false} />
                {dailyReferenceLines.map(time => (
                  <ReferenceLine key={time} yAxisId={config.dataKey} x={time} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                ))}
                <YAxis
                  yAxisId={config.dataKey}
                  domain={isDirectional ? [0, 360] : ['auto', 'auto']}
                  ticks={isDirectional ? [0, 90, 180, 270, 360] : undefined}
                  tickFormatter={(value) => typeof value === 'number' ? value.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:1}) : String(value)}
                  tick={{ fontSize: '0.75rem', fill: 'hsl(var(--muted-foreground))' }}
                  stroke="hsl(var(--border))"
                  width={60} 
                />
                <XAxis dataKey="time" hide />
                <RechartsTooltip
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--background))', 
                    border: '1px solid hsl(var(--border))', 
                    fontSize: '0.75rem',
                    padding: '8px',
                    borderRadius: '6px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                  }}
                  itemStyle={{ color: 'hsl(var(--foreground))' }}
                  formatter={(value: number | null | undefined, name: string, props) => { 
                    const formattedValue = (value !== null && value !== undefined && typeof value === 'number' && !isNaN(value)) 
                      ? value.toLocaleString(undefined, {minimumFractionDigits:1, maximumFractionDigits:1}) 
                      : 'N/A';
                    return [
                       <div key="val" style={{ display: 'flex', alignItems: 'center' }}>
                         {`${formattedValue}${isDirectional ? '' : (config.unit || '')}`}
                         {isDirectional && typeof value === 'number' && <DirectionArrow style={{ transform: `rotate(${value + 180}deg)`, height: '1em', width: '1em', marginLeft: '0.5em' }} />}
                       </div>,
                       name
                    ];
                  }}
                  labelFormatter={(label) => {
                    try {
                      const date = parseISO(String(label));
                      return isValid(date) ? format(date, 'EEE, MMM dd, HH:mm') : String(label);
                    } catch {
                      return String(label);
                    }
                  }}
                  isAnimationActive={false}
                />
                 <RechartsLine
                    yAxisId={config.dataKey}
                    type="monotone"
                    dataKey={config.dataKey as string}
                    stroke={`hsl(var(${config.color || '--chart-1'}))`}
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls={true}
                    name={config.name} 
                    isAnimationActive={false}
                  >
                    {isDirectional && <LabelList dataKey={config.dataKey as string} content={<DirectionLabel />} />}
                  </RechartsLine>
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground italic">
              {availabilityStatus === 'pending' ? "Loading plot data..." : 
               availabilityStatus === 'unavailable' ? "Data unavailable for this parameter." : 
               availabilityStatus === 'available' && !hasValidDataForSeriesInView ? "No data points in selected range." :
               "Checking data..."
              }
            </div>
          )}
        </div>
      )}
    </div>
  );
});

PinMeteoPlotRow.displayName = 'PinMeteoPlotRow';


function MapDrawingPageContent() {
  const { view, setView } = useMapView('dev-user');
  const { settings, setSettings } = useSettings();
  const { toast, dismiss } = useToast();
  const searchParams = useSearchParams();

  
  // Use the integrated map data hook
  const {
    projects,
    tags,
    pins,
    lines,
    areas,
    isLoading: isDataLoading,
    isOnline,
    isAuthenticated,
    lastSyncTime,
    createPin: createPinData,
    updatePin: updatePinData,
    deletePin: deletePinData,
    createLine: createLineData,
    updateLine: updateLineData,
    deleteLine: deleteLineData,
    createArea: createAreaData,
    updateArea: updateAreaData,
    deleteArea: deleteAreaData,
    batchUpdatePins,
    batchUpdateLines,
    batchUpdateAreas,
    clearAll: clearAllData,
    forceSync,
    migrateToDatabase
  } = useMapData({ projectId: 'default', enableSync: true });
  
  // Map state
  const mapRef = useRef<LeafletMap | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LatLng | null>(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [locationPermission, setLocationPermission] = useState<'granted' | 'denied' | 'prompt' | 'unknown'>('unknown');
  const [showProjectsDialog, setShowProjectsDialog] = useState(false);
  const [showMainMenu, setShowMainMenu] = useState(false);
  const [showProjectsDropdown, setShowProjectsDropdown] = useState(false);
  const [showDrawingToolsDropdown, setShowDrawingToolsDropdown] = useState(false);
  const [showProjectInfo, setShowProjectInfo] = useState<string | null>(null);
  const [showProjectMenuInfo, setShowProjectMenuInfo] = useState<string | null>(null);
  const [mapScale, setMapScale] = useState<{ distance: number; unit: string; pixels: number } | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [objectTypeFilter, setObjectTypeFilter] = useState<'all' | 'pin' | 'line' | 'area'>('all');
  const [sidebarWidth, setSidebarWidth] = useState(320); // Default width in pixels
  const [originalSidebarWidth, setOriginalSidebarWidth] = useState(320); // Store original width
  const [isResizing, setIsResizing] = useState(false);
  const [showFloatingDrawingTools, setShowFloatingDrawingTools] = useState(false);
  const [isEditingObject, setIsEditingObject] = useState(false);
  const [editingLabel, setEditingLabel] = useState('');
  const [editingNotes, setEditingNotes] = useState('');
  const [editingColor, setEditingColor] = useState('#3b82f6');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingSize, setEditingSize] = useState(6);
  const [editingLat, setEditingLat] = useState('');
  const [editingLng, setEditingLng] = useState('');
  const [coordinateFormat, setCoordinateFormat] = useState<CoordinateFormat>('decimal');
  const [showNotesSection, setShowNotesSection] = useState(false);
  const [showCoordinateFormatPopover, setShowCoordinateFormatPopover] = useState(false);
  const [showDataDropdown, setShowDataDropdown] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [selectedPinForShare, setSelectedPinForShare] = useState<{ id: string; label: string } | null>(null);
  const [showMultiFileConfirmDialog, setShowMultiFileConfirmDialog] = useState(false);
  const [multiFileConfirmData, setMultiFileConfirmData] = useState<{
    parsedFiles: any[];
    validation: any;
    downloadedFiles: File[];
    fileType: 'GP' | 'FPOD' | 'Subcam';
    selectedFiles: any[]; // Add selectedFiles to store original file metadata
  } | null>(null);
  const [multiFileMergeMode, setMultiFileMergeMode] = useState<'sequential' | 'stack-parameters'>('sequential');
  const [mergeRules, setMergeRules] = useState<MergeRule[]>(DEFAULT_MERGE_RULES);
  const [showSharePopover, setShowSharePopover] = useState(false);
  const [sharePrivacyLevel, setSharePrivacyLevel] = useState<'private' | 'public' | 'specific'>('private');
  const [shareEmails, setShareEmails] = useState('');
  const [isUpdatingPrivacy, setIsUpdatingPrivacy] = useState(false);
  const [pinFiles, setPinFiles] = useState<Record<string, File[]>>({});
  const [pinFileMetadata, setPinFileMetadata] = useState<Record<string, PinFile[]>>({});
  const [areaFileMetadata, setAreaFileMetadata] = useState<Record<string, PinFile[]>>({});
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);

  // Date input dialog state (for files without time columns)
  const [showDateInputDialog, setShowDateInputDialog] = useState(false);
  const [pendingDateFile, setPendingDateFile] = useState<{file: File; targetId: string; targetType: 'pin' | 'area'} | null>(null);

  // Batch date confirmation dialog state
  const [showBatchDateConfirm, setShowBatchDateConfirm] = useState(false);
  const [filesWithoutDates, setFilesWithoutDates] = useState<File[]>([]);
  const [batchDateContext, setBatchDateContext] = useState<{targetId: string; targetType: 'pin' | 'area'} | null>(null);
  const [isBatchDateMode, setIsBatchDateMode] = useState(false);

  // Merged files state (must be declared before availableFilesForPlots)
  // Store as PinFile format for compatibility with timeline and other components
  const [mergedFiles, setMergedFiles] = useState<(PinFile & { fileSource: 'merged', pinLabel: string })[]>([]);
  const [isLoadingMergedFiles, setIsLoadingMergedFiles] = useState(false);

  // Transform pinFileMetadata into availableFiles format for PinMarineDeviceData
  const availableFilesForPlots = React.useMemo(() => {
    const fileOptions: Array<{
      pinId: string;
      pinName: string;
      pinLocation?: { lat: number; lng: number };
      fileType: 'GP' | 'FPOD' | 'Subcam' | 'CROP' | 'CHEM' | 'CHEMSW' | 'CHEMWQ' | 'WQ' | 'EDNA' | 'MERGED';
      files: File[];
      fileName: string;
      metadata?: PinFile; // Include metadata for downloading
    }> = [];

    perfLogger.start('buildFileOptions');
    let totalFiles = 0;
    let totalPins = 0;

    for (const [pinId, metadata] of Object.entries(pinFileMetadata)) {
      const pin = pins.find(p => p.id === pinId);

      // Don't skip files if pin isn't found - show ALL project files
      // This allows file selector to match the timeline view

      totalPins++;
      totalFiles += metadata.length;

      for (const fileMeta of metadata) {
        // Determine file type from filename
        // New format: PROJECTNAME_DATATYPE_STATION_DIRECTION_[PELAGIC]_YYMM-YYMM
        // Example: ALGA_GP_F_L_PELAGIC_2504-2506_LOG_AVG.csv
        // Old format: DATATYPE_ProjectName_Station_YYMM-YYMM
        // Example: GP-Pel_Alga-Control-S_2410-2411_LOG_AVG.CSV
        let fileType: 'GP' | 'FPOD' | 'Subcam' | 'CROP' | 'CHEM' | 'CHEMSW' | 'CHEMWQ' | 'WQ' | 'EDNA' | 'MERGED' = 'GP';

        const parts = fileMeta.fileName.split('_');
        const position0 = parts[0]?.toLowerCase() || '';
        const position1 = parts[1]?.toLowerCase() || '';
        const fileNameLower = fileMeta.fileName.toLowerCase();

        // Check first two positions for data type (case-insensitive)
        // Also check for _chem and _wq suffixes
        // Check for specific CHEMSW and CHEMWQ before general CHEM/WQ
        if (position0.includes('crop') || position1.includes('crop')) {
          fileType = 'CROP';
        } else if (position0.includes('chemsw') || position1.includes('chemsw')) {
          fileType = 'CHEMSW';
        } else if (position0.includes('chemwq') || position1.includes('chemwq')) {
          fileType = 'CHEMWQ';
        } else if (position0.includes('chem') || position1.includes('chem') || fileNameLower.includes('_chem')) {
          fileType = 'CHEM';
        } else if (position0.includes('wq') || position1.includes('wq') || fileNameLower.includes('_wq')) {
          fileType = 'WQ';
        } else if (position0.includes('edna') || position1.includes('edna')) {
          fileType = 'EDNA';
        } else if (position0.includes('fpod') || position1.includes('fpod')) {
          fileType = 'FPOD';
        } else if (position0.includes('subcam') || position1.includes('subcam')) {
          fileType = 'Subcam';
        } else if (position0.includes('gp') || position1.includes('gp')) {
          fileType = 'GP';
        }

        // Check if we have the actual File object
        const actualFiles = pinFiles[pinId] || [];
        const matchingFile = actualFiles.find(f => f.name === fileMeta.fileName);

        // Add to list with metadata for on-demand downloading
        fileOptions.push({
          pinId,
          pinName: pin?.label || `Pin ${pinId.substring(0, 8)}...`, // Fallback if pin not drawn
          pinLocation: pin?.location, // May be undefined
          fileType,
          files: matchingFile ? [matchingFile] : [], // Empty array if not loaded yet
          fileName: fileMeta.fileName,
          metadata: fileMeta // Store metadata for downloading
        });
      }
    }

    // Add merged files to the list
    for (const mergedFile of mergedFiles) {
      fileOptions.push({
        pinId: 'merged', // Special ID for merged files
        pinName: 'Merged Files',
        pinLocation: undefined,
        fileType: 'MERGED',
        files: [], // Merged files need to be downloaded
        fileName: mergedFile.fileName,
        metadata: {
          id: mergedFile.id,
          pinId: 'merged',
          fileName: mergedFile.fileName,
          filePath: mergedFile.filePath,
          fileSize: 0, // Size not available
          fileType: 'MERGED',
          uploadedAt: new Date(mergedFile.createdAt),
          projectId: mergedFile.projectId,
          startDate: mergedFile.startDate ? new Date(mergedFile.startDate) : undefined,
          endDate: mergedFile.endDate ? new Date(mergedFile.endDate) : undefined
        }
      });
    }

    perfLogger.end('buildFileOptions', `${fileOptions.length} options from ${totalFiles} files across ${totalPins} pins + ${mergedFiles.length} merged files`);
    return fileOptions;
  }, [pinFileMetadata, pins, pinFiles, mergedFiles]);

  // Transform pinFileMetadata into DataTimeline format (includes pin labels)
  const allProjectFilesForTimeline = React.useMemo(() => {
    const result: (PinFile & { pinLabel: string })[] = [];

    // Add pin files
    for (const [pinId, files] of Object.entries(pinFileMetadata)) {
      const pin = pins.find(p => p.id === pinId);
      const pinLabel = pin?.label || `Pin ${pinId.substring(0, 8)}...`;

      files.forEach(file => {
        result.push({
          ...file,
          pinLabel
        });
      });
    }

    // Add area files
    for (const [areaId, files] of Object.entries(areaFileMetadata)) {
      const area = areas.find(a => a.id === areaId);
      const areaLabel = area?.name || `Area ${areaId.substring(0, 8)}...`;

      files.forEach(file => {
        result.push({
          ...file,
          pinLabel: areaLabel // Using pinLabel field for consistency with interface
        });
      });
    }

    // Add merged files with special label
    mergedFiles.forEach(mergedFile => {
      result.push({
        id: mergedFile.id,
        pinId: 'merged',
        fileName: mergedFile.fileName,
        filePath: mergedFile.filePath,
        fileSize: 0,
        fileType: 'MERGED',
        uploadedAt: new Date(mergedFile.createdAt),
        projectId: mergedFile.projectId,
        startDate: mergedFile.startDate ? new Date(mergedFile.startDate) : undefined,
        endDate: mergedFile.endDate ? new Date(mergedFile.endDate) : undefined,
        pinLabel: 'Merged Files',
        isDiscrete: false,
        fileSource: 'merged' // Mark as merged file for identification
      } as PinFile & { pinLabel: string; fileSource: 'merged' });
    });

    return result;
  }, [pinFileMetadata, areaFileMetadata, pins, areas, mergedFiles]);

  const [showExploreDropdown, setShowExploreDropdown] = useState(false);
  const [selectedPinForExplore, setSelectedPinForExplore] = useState<string | null>(null);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState<{ id: string; name: string } | null>(null);
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<{ id: string; type: 'pin' | 'line' | 'area'; hasData?: boolean } | null>(null);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [showProjectDataDialog, setShowProjectDataDialog] = useState(false);
  const [showProjectSettingsDialog, setShowProjectSettingsDialog] = useState(false);
  const [showDeleteConfirmDialog, setShowDeleteConfirmDialog] = useState(false);
  const [currentProjectContext, setCurrentProjectContext] = useState<string>('');
  const [showAddProjectDialog, setShowAddProjectDialog] = useState(false);

  // Multi-selection state for batch operations
  const [selectedObjectIds, setSelectedObjectIds] = useState<Set<string>>(new Set());
  const [showBatchDeleteConfirmDialog, setShowBatchDeleteConfirmDialog] = useState(false);
  const [isBulkDeleteMode, setIsBulkDeleteMode] = useState(false);
  const [showUploadPinSelector, setShowUploadPinSelector] = useState(false);
  const [selectedUploadPinId, setSelectedUploadPinId] = useState<string>('');
  const [selectedUploadAreaId, setSelectedUploadAreaId] = useState<string>(''); // NEW: For area uploads
  const [uploadTargetType, setUploadTargetType] = useState<'pin' | 'area'>('pin'); // NEW: Toggle between pin and area
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [duplicateFiles, setDuplicateFiles] = useState<{fileName: string, existingFile: PinFile}[]>([]);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [isUpdatingProject, setIsUpdatingProject] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  // File filtering state
  const [selectedPins, setSelectedPins] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedSuffixes, setSelectedSuffixes] = useState<string[]>([]);
  const [selectedDateRanges, setSelectedDateRanges] = useState<string[]>([]);
  const [selectedFileSources, setSelectedFileSources] = useState<string[]>(['upload', 'merged']); // Both selected by default

  // Extract date range from filename (format: YYMM_YYMM)
  const extractDateRange = (fileName: string): string | null => {
    const match = fileName.match(/(\d{4}_\d{4})/);
    return match ? match[1] : null;
  };

  // Initialize Supabase client for CSV analysis
  const supabase = createClient();
  
  // Data restoration state
  const [showDataRestore, setShowDataRestore] = useState(false);
  const [hasCheckedAuth, setHasCheckedAuth] = useState(false);

  // One-time initialization guards for consolidated effects
  const hasInitializedGPS = useRef(false);
  const hasInitializedCache = useRef(false);
  const hasCheckedRedirect = useRef(false);
  const hasLoadedProjects = useRef(false);
  
  // Pin Meteo Data State (copied from data explorer)
  const [pinMeteoDateRange, setPinMeteoDateRange] = useState<DateRange | undefined>(() => {
    const today = new Date();
    const from = subDays(today, 7); // 7 days ago
    const to = subDays(today, 1);   // yesterday
    return { from, to };
  });
  const [pinMeteoData, setPinMeteoData] = useState<CombinedDataPoint[] | null>(null);
  const [isLoadingPinMeteoData, setIsLoadingPinMeteoData] = useState(false);
  const [errorPinMeteoData, setErrorPinMeteoData] = useState<string | null>(null);
  const [pinMeteoLocationContext, setPinMeteoLocationContext] = useState<string | null>(null);
  const [pinMeteoFetchLogSteps, setPinMeteoFetchLogSteps] = useState<ApiLogStep[]>([]);
  const [pinMeteoPlotVisibility, setPinMeteoPlotVisibility] = useState(() => {
    return Object.fromEntries(
      ALL_PARAMETERS.map(key => [key, true])
    );
  });
  const [showMeteoDataSection, setShowMeteoDataSection] = useState(false);
  
  // Pin Meteo Grid state (matching MarinePlotsGrid)
  const [pinMeteoBrushStartIndex, setPinMeteoBrushStartIndex] = useState<number | undefined>(0);
  const [pinMeteoBrushEndIndex, setPinMeteoBrushEndIndex] = useState<number | undefined>(undefined);
  const [pinMeteoPlotConfigsInternal, setPinMeteoPlotConfigsInternal] = useState<PlotConfigInternal[]>([]);
  const [pinMeteoSeriesDataAvailability, setPinMeteoSeriesDataAvailability] = useState<Record<CombinedParameterKey, SeriesAvailabilityStatus>>({});
  const [pinMeteoExpanded, setPinMeteoExpanded] = useState(false);
  
  // Marine Device Modal State
  const [showMarineDeviceModal, setShowMarineDeviceModal] = useState(false);
  const [selectedFileType, setSelectedFileType] = useState<'GP' | 'FPOD' | 'Subcam' | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isLoadingFromSavedPlot, setIsLoadingFromSavedPlot] = useState(false);

  // ============================================================================
  // DATA EXPLORER PANEL STATE - NEW ADDITION (Safe to remove/disable)
  // ============================================================================
  const [showDataExplorerPanel, setShowDataExplorerPanel] = useState(false);
  const [savedPlots, setSavedPlots] = useState<SavedPlotView[]>([]);
  const [isLoadingSavedPlots, setIsLoadingSavedPlots] = useState(false);
  // ============================================================================

  // Store object GPS coordinates for marine/meteo data
  const [objectGpsCoords, setObjectGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [objectName, setObjectName] = useState<string>('');

  // Line Edit Mode State
  const [lineEditMode, setLineEditMode] = useState<'none' | 'endpoints'>('none');
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [tempLinePath, setTempLinePath] = useState<{ lat: number; lng: number }[] | null>(null);
  const [draggedPointIndex, setDraggedPointIndex] = useState<number | null>(null);
  
  // Dynamic projects state (combines hardcoded + database projects)
  const [dynamicProjects, setDynamicProjects] = useState<Record<string, { name: string; lat?: number; lon?: number; isDynamic?: boolean }>>(PROJECT_LOCATIONS);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);

  // Project management state
  const [projectVisibility, setProjectVisibility] = useState<Record<string, boolean>>(() => {
    // Initialize all projects as visible
    return Object.keys(PROJECT_LOCATIONS).reduce((acc, key) => {
      acc[key] = true;
      return acc;
    }, {} as Record<string, boolean>);
  });
  // Use persistent active project hook
  const { activeProject: persistentActiveProject, setActiveProject: setPersistentActiveProject, isLoading: isLoadingActiveProject } = useActiveProject();
  
  // Manage active project with fallback to default
  const activeProjectId = persistentActiveProject || Object.keys(dynamicProjects)[0] || 'milfordhaven';
  const setActiveProjectId = (projectId: string) => {
    setPersistentActiveProject(projectId);
  };

  // Unified loading state for smooth UX
  const {
    isLoading: isPageLoading,
    progress: loadingProgress,
    currentStage,
    isInitialLoad
  } = usePageLoadingState({
    isLoadingProjects,
    isLoadingActiveProject,
    isLoadingPinMeteoData,
    isDataLoading,
    isUploadingFiles,
  });

  // Load dynamic projects from database
  const loadDynamicProjects = useCallback(async () => {
    perfLogger.start('loadProjects');
    setIsLoadingProjects(true);
    try {
      const databaseProjects = await projectService.getProjects();

      // Combine hardcoded projects with database projects
      const combinedProjects = { ...PROJECT_LOCATIONS };

      databaseProjects.forEach(project => {
        // Use project ID as key, add isDynamic flag
        combinedProjects[project.id] = {
          name: project.name,
          isDynamic: true
        };
      });

      perfLogger.end('loadProjects', `${databaseProjects.length} projects loaded`);
      setDynamicProjects(combinedProjects);
      
      // Update project visibility to include new projects
      setProjectVisibility(prev => {
        const updated = { ...prev };
        databaseProjects.forEach(project => {
          if (!(project.id in updated)) {
            updated[project.id] = true; // Make new projects visible by default
          }
        });
        return updated;
      });
      
    } catch (error) {
      console.error('Failed to load dynamic projects:', error);
    } finally {
      setIsLoadingProjects(false);
    }
  }, []);

  // ============================================================================
  // CONSOLIDATED: Initial Setup & Authentication
  // Replaces 5 separate effects: Load Dynamic Projects, Check GPS Permission,
  // Clear File Date Cache, Check LocalStorage Data, Authentication & Restore Dialog
  // Lines replaced: 818, 864, 1052, 1072, 2532
  // ============================================================================
  useEffect(() => {
    // 1. Initialize file date cache (one-time)
    if (!hasInitializedCache.current) {
      hasInitializedCache.current = true;
      setFileDateCache({});
    }

    // 2. Check GPS permission (one-time)
    if (!hasInitializedGPS.current) {
      hasInitializedGPS.current = true;
      const checkLocationPermission = async () => {
        if ('permissions' in navigator) {
          try {
            const permission = await navigator.permissions.query({ name: 'geolocation' });
            setLocationPermission(permission.state);
            permission.addEventListener('change', () => {
              setLocationPermission(permission.state);
            });
          } catch (error) {
            console.log('Permissions API not supported');
            setLocationPermission('unknown');
          }
        }
      };
      checkLocationPermission();
    }

    // 3. Load dynamic projects (one-time)
    if (!hasLoadedProjects.current) {
      hasLoadedProjects.current = true;
      loadDynamicProjects();
    }

    // 4. Clean up legacy localStorage (when authenticated and data loaded)
    if (typeof window !== 'undefined' && isAuthenticated && !isDataLoading) {
      const hasLocalData =
        localStorage.getItem('map-drawing-pins') ||
        localStorage.getItem('map-drawing-lines') ||
        localStorage.getItem('map-drawing-areas');

      if (hasLocalData) {
        console.log('🧹 Clearing legacy localStorage data (authentication-only mode)');
        localStorage.removeItem('map-drawing-pins');
        localStorage.removeItem('map-drawing-lines');
        localStorage.removeItem('map-drawing-areas');
      }
    }

    // 5. Check authentication and show restore dialog
    const checkAuthAndRestore = async () => {
      if (!hasCheckedAuth && isAuthenticated) {
        setHasCheckedAuth(true);

        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();

        if (session) {
          const lastSync = localStorage.getItem('map-drawing-last-sync');
          const timeSinceSync = lastSync ? Date.now() - new Date(lastSync).getTime() : Infinity;

          if (timeSinceSync > 5 * 60 * 1000 || !lastSync) {
            setShowDataRestore(true);
          }
        }
      }
    };
    checkAuthAndRestore();
  }, [isAuthenticated, isDataLoading, loadDynamicProjects, hasCheckedAuth]);
  
  // Drawing state
  const [drawingMode, setDrawingMode] = useState<DrawingMode>('none');
  const [isDrawingLine, setIsDrawingLine] = useState(false);
  const [lineStartPoint, setLineStartPoint] = useState<LatLng | null>(null);
  const [currentMousePosition, setCurrentMousePosition] = useState<LatLng | null>(null);
  const [isDrawingArea, setIsDrawingArea] = useState(false);
  const [pendingAreaPath, setPendingAreaPath] = useState<LatLng[]>([]);
  const [areaStartPoint, setAreaStartPoint] = useState<LatLng | null>(null);
  const [currentAreaEndPoint, setCurrentAreaEndPoint] = useState<LatLng | null>(null);
  
  // Pending items (waiting for user input)
  const [pendingPin, setPendingPin] = useState<LatLng | null>(null);
  const [pendingLine, setPendingLine] = useState<{ path: LatLng[] } | null>(null);
  const [pendingArea, setPendingArea] = useState<{ path: LatLng[] } | null>(null);
  
  // New state for enhanced features
  const [editingAreaCoords, setEditingAreaCoords] = useState<string[][]>([]);
  const [editingTransparency, setEditingTransparency] = useState(20);

  // Area corner dragging mode
  const [isAreaCornerDragging, setIsAreaCornerDragging] = useState(false);
  const [tempAreaPath, setTempAreaPath] = useState<{ lat: number; lng: number }[] | null>(null);

  // Refs to prevent duplicate operations
  const lineConfirmInProgressRef = useRef<boolean>(false);
  const labelInputRef = useRef<HTMLInputElement>(null);

  // Auto-expand sidebar when pin marine meteo data section is opened
  useEffect(() => {
    if (showDataDropdown && showMeteoDataSection) {
      // Store the current width if not already stored
      if (sidebarWidth <= 450) {
        setOriginalSidebarWidth(sidebarWidth);
        setSidebarWidth(450); // Moderately wider for better data visibility
      }
    } else if (!showDataDropdown) {
      // Restore original width when closing the data dropdown
      setSidebarWidth(originalSidebarWidth);
    }
  }, [showDataDropdown, showMeteoDataSection, sidebarWidth, originalSidebarWidth]);

  // REMOVED: Check GPS permission status - now in consolidated effect above (line 836)
  // useEffect(() => {
  //   const checkLocationPermission = async () => {
  //     if ('permissions' in navigator) {
  //       try {
  //         const permission = await navigator.permissions.query({ name: 'geolocation' });
  //         setLocationPermission(permission.state);
  //
  //         // Listen for permission changes
  //         permission.addEventListener('change', () => {
  //           setLocationPermission(permission.state);
  //         });
  //       } catch (error) {
  //         console.log('Permissions API not supported, will use geolocation directly');
  //         setLocationPermission('unknown');
  //       }
  //     } else {
  //       setLocationPermission('unknown');
  //     }
  //   };
  //
  //   checkLocationPermission();
  // }, []);

  // ============================================================================
  // CONSOLIDATED: Data Explorer Initialization
  // Replaces 3 separate effects: Auto-Open Marine Device Modal, Load Saved Plots, Auto-Open from Redirect
  // Lines replaced: 960, 1007, 1037
  // ============================================================================
  useEffect(() => {
    if (!isFeatureEnabled('DATA_EXPLORER_PANEL')) return;

    // 1. Check for redirect to open data explorer (one-time)
    if (!hasCheckedRedirect.current) {
      hasCheckedRedirect.current = true;
      const shouldOpen = localStorage.getItem('pebl-open-data-explorer');
      if (shouldOpen === 'true') {
        console.log('🔄 [DATA EXPLORER PANEL] Auto-opening panel from redirect');
        setShowDataExplorerPanel(true);
        localStorage.removeItem('pebl-open-data-explorer');
      }
    }

    // 2. Load saved plots for current project
    const loadSavedPlots = async () => {
      const projectId = currentProjectContext || activeProjectId;
      if (!projectId) {
        setSavedPlots([]);
        return;
      }

      setIsLoadingSavedPlots(true);
      try {
        const { plotViewService } = await import('@/lib/supabase/plot-view-service');
        const result = await plotViewService.listPlotViews(projectId);

        if (result.success && result.data) {
          setSavedPlots(result.data);
        } else if (!result.success) {
          setSavedPlots([]);
        }
      } catch (error) {
        console.error('❌ [DATA EXPLORER PANEL] Error loading saved plots:', error);
        setSavedPlots([]);
      } finally {
        setIsLoadingSavedPlots(false);
      }
    };
    loadSavedPlots();

    // 3. Check for saved plot load from sessionStorage
    const checkForSavedPlotLoad = () => {
      try {
        const storedData = sessionStorage.getItem('pebl-load-plot-view');
        if (!storedData) return;

        const parsedData = JSON.parse(storedData);
        const { viewId, viewName, timestamp } = parsedData;

        console.log('✅ [MAP-DRAWING] Found saved plot to load:', {
          viewId,
          viewName,
          timestamp,
          timeSinceSet: Date.now() - timestamp,
          currentProjectId: currentProjectContext || activeProjectId
        });

        console.log('📂 [MAP-DRAWING] Opening marine device modal for auto-load...');
        setSelectedFileType('GP');
        setSelectedFiles([]);
        setIsLoadingFromSavedPlot(true);
        setShowMarineDeviceModal(true);

        console.log('✅ [MAP-DRAWING] Modal state set to open. PinMarineDeviceData should now mount and detect sessionStorage.');

        // Note: sessionStorage cleared by PinMarineDeviceData after successful load
      } catch (error) {
        console.error('❌ [MAP-DRAWING] Error checking for saved plot load:', error);
        sessionStorage.removeItem('pebl-load-plot-view');
      }
    };
    checkForSavedPlotLoad();
  }, [currentProjectContext, activeProjectId]);

  // REMOVED: Old Auto-open marine device modal - now in consolidated effect above (line 1003)
  // useEffect(() => {
  //   const checkForSavedPlotLoad = () => {
  //     try {
  //       const storedData = sessionStorage.getItem('pebl-load-plot-view');
  //       if (!storedData) return;
  //
  //       const parsedData = JSON.parse(storedData);
  //       const { viewId, viewName, timestamp } = parsedData;
  //
  //       console.log('✅ [MAP-DRAWING] Found saved plot to load:', {
  //         viewId,
  //         viewName,
  //         timestamp,
  //         timeSinceSet: Date.now() - timestamp,
  //         currentProjectId: currentProjectContext || activeProjectId
  //       });
  //
  //       console.log('📂 [MAP-DRAWING] Opening marine device modal for auto-load...');
  //       setSelectedFileType('GP');
  //       setSelectedFiles([]);
  //       setIsLoadingFromSavedPlot(true);
  //       setShowMarineDeviceModal(true);
  //
  //       console.log('✅ [MAP-DRAWING] Modal state set to open. PinMarineDeviceData should now mount and detect sessionStorage.');
  //
  //     } catch (error) {
  //       console.error('❌ [MAP-DRAWING] Error checking for saved plot load:', error);
  //       sessionStorage.removeItem('pebl-load-plot-view');
  //     }
  //   };
  //
  //   checkForSavedPlotLoad();
  // }, [currentProjectContext, activeProjectId]);

  // REMOVED: Load saved plots - now in consolidated effect above (line 978)
  // useEffect(() => {
  //   if (!isFeatureEnabled('DATA_EXPLORER_PANEL')) return;
  //
  //   const loadSavedPlots = async () => {
  //     const projectId = currentProjectContext || activeProjectId;
  //     if (!projectId) {
  //       setSavedPlots([]);
  //       return;
  //     }
  //
  //     setIsLoadingSavedPlots(true);
  //     try {
  //       const { plotViewService } = await import('@/lib/supabase/plot-view-service');
  //       const result = await plotViewService.listPlotViews(projectId);
  //
  //       if (result.success && result.data) {
  //         console.log('📊 [DATA EXPLORER PANEL] Loaded', result.data.length, 'saved plots');
  //         setSavedPlots(result.data);
  //       }
  //     } catch (error) {
  //       console.error('❌ [DATA EXPLORER PANEL] Error loading saved plots:', error);
  //     } finally {
  //       setIsLoadingSavedPlots(false);
  //     }
  //   };
  //
  //   loadSavedPlots();
  // }, [currentProjectContext, activeProjectId]);

  // REMOVED: Auto-open from redirect - now in consolidated effect above (line 967)
  // useEffect(() => {
  //   if (!isFeatureEnabled('DATA_EXPLORER_PANEL')) return;
  //
  //   const shouldOpen = localStorage.getItem('pebl-open-data-explorer');
  //   if (shouldOpen === 'true') {
  //     console.log('🔄 [DATA EXPLORER PANEL] Auto-opening panel from redirect');
  //     setShowDataExplorerPanel(true);
  //     localStorage.removeItem('pebl-open-data-explorer');
  //   }
  // }, []);

  // ============================================================================
  // CONSOLIDATED: Event Listeners
  // Replaces 2 separate effects: Keyboard Shortcut, Custom Event Listener
  // Lines replaced: 1115, 1133
  // ============================================================================
  useEffect(() => {
    if (!isFeatureEnabled('DATA_EXPLORER_PANEL')) return;

    // 1. Keyboard shortcut handler (Cmd/Ctrl + D)
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        setShowDataExplorerPanel(prev => {
          console.log('⌨️ [DATA EXPLORER PANEL] Toggling panel via keyboard');
          return !prev;
        });
      }
    };

    // 2. Custom event handler from UserMenu
    const handleOpenPanel = () => {
      console.log('📡 [DATA EXPLORER PANEL] Received open event from UserMenu');
      setShowDataExplorerPanel(true);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('open-data-explorer-panel', handleOpenPanel);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('open-data-explorer-panel', handleOpenPanel);
    };
  }, []);

  // REMOVED: Keyboard shortcut - now in consolidated effect above (line 1118)
  // useEffect(() => {
  //   if (!isFeatureEnabled('DATA_EXPLORER_PANEL')) return;
  //
  //   const handleKeyDown = (e: KeyboardEvent) => {
  //     if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
  //       e.preventDefault();
  //       setShowDataExplorerPanel(prev => {
  //         console.log('⌨️ [DATA EXPLORER PANEL] Toggling panel via keyboard');
  //         return !prev;
  //       });
  //     }
  //   };
  //
  //   window.addEventListener('keydown', handleKeyDown);
  //   return () => window.removeEventListener('keydown', handleKeyDown);
  // }, []);

  // REMOVED: Custom event listener - now in consolidated effect above (line 1125)
  // useEffect(() => {
  //   if (!isFeatureEnabled('DATA_EXPLORER_PANEL')) return;
  //
  //   const handleOpenPanel = () => {
  //     console.log('📡 [DATA EXPLORER PANEL] Received open event from UserMenu');
  //     setShowDataExplorerPanel(true);
  //   };
  //
  //   window.addEventListener('open-data-explorer-panel', handleOpenPanel);
  //   return () => window.removeEventListener('open-data-explorer-panel', handleOpenPanel);
  // }, []);
  // ============================================================================

  const [itemToEdit, setItemToEdit] = useState<Pin | Line | Area | null>(null);
  const [editingGeometry, setEditingGeometry] = useState<Line | Area | null>(null);
  
  // Handle URL parameters for centering on pin
  useEffect(() => {
    const centerPinId = searchParams.get('centerPin');
    if (centerPinId && pins.length > 0 && mapRef.current) {
      // Find the pin to center on
      const targetPin = pins.find(pin => pin.id === centerPinId);
      if (targetPin) {
        // Center the map on the pin
        mapRef.current.setView([targetPin.lat, targetPin.lng], 16);
        
        // Set the pin as the item to edit (opens properties dialog)
        setItemToEdit(targetPin);
        
        // Show notification
        toast({
          title: "Centered on pin",
          description: `Map centered on "${targetPin.label || 'New pin'}"`,
        });
        
        // Remove URL parameters to clean up the URL
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          url.searchParams.delete('centerPin');
          url.searchParams.delete('notification');
          window.history.replaceState({}, '', url.toString());
        }
      } else {
        // Pin not found, show error
        toast({
          title: "Pin not found",
          description: "The requested pin could not be found on the map.",
          variant: "destructive"
        });
      }
    }
  }, [searchParams, pins, mapRef, toast]);
  
  // REMOVED: Migration prompt - authentication-only mode means no legacy localStorage data exists
  
  // REMOVED: Check for existing localStorage data - now in consolidated effect above (line 858)
  // useEffect(() => {
  //   // Wait for initial data load to complete
  //   if (typeof window !== 'undefined' && isAuthenticated && !isDataLoading) {
  //     const hasLocalData =
  //       localStorage.getItem('map-drawing-pins') ||
  //       localStorage.getItem('map-drawing-lines') ||
  //       localStorage.getItem('map-drawing-areas');
  //
  //     // DISABLED: Migration prompt removed - only logged-in users can draw, so no legacy data should exist
  //     // Just silently clear any stale localStorage data if it exists
  //     if (hasLocalData) {
  //       console.log('🧹 Clearing legacy localStorage data (authentication-only mode)');
  //       localStorage.removeItem('map-drawing-pins');
  //       localStorage.removeItem('map-drawing-lines');
  //       localStorage.removeItem('map-drawing-areas');
  //     }
  //   }
  // }, [isAuthenticated, isDataLoading]);

  // REMOVED: Check for authentication and show restore dialog - now in consolidated effect above (line 874)
  // useEffect(() => {
  //   const checkAuthAndRestore = async () => {
  //     if (!hasCheckedAuth && isAuthenticated) {
  //       setHasCheckedAuth(true);
  //
  //       // Check if this is a fresh login (no data in state but user is authenticated)
  //       const supabase = createClient();
  //       const { data: { session } } = await supabase.auth.getSession();
  //
  //       if (session) {
  //         // Check if we need to restore data
  //         const lastSync = localStorage.getItem('map-drawing-last-sync');
  //         const timeSinceSync = lastSync ? Date.now() - new Date(lastSync).getTime() : Infinity;
  //
  //         // Show restore dialog if it's been more than 5 minutes since last sync
  //         // or if there's no sync time recorded
  //         if (timeSinceSync > 5 * 60 * 1000 || !lastSync) {
  //           setShowDataRestore(true);
  //         }
  //       }
  //     }
  //   };
  //
  //   checkAuthAndRestore();
  // }, [isAuthenticated, hasCheckedAuth]);
  
  // REMOVED: handleMigration - authentication-only mode means no legacy localStorage data exists

  // Load ALL pin files from Supabase for the current project
  // This ensures the file selector shows ALL files, not just files from currently drawn pins
  useEffect(() => {
    const loadPinFiles = async () => {
      const projectId = currentProjectContext || activeProjectId;
      if (!projectId) return;

      perfLogger.start('loadPinFiles');
      const pinMetadata: Record<string, PinFile[]> = {};
      const areaMetadata: Record<string, PinFile[]> = {};

      try {
        // Load ALL files for the entire project (not just drawn pins)
        const allProjectFiles = await fileStorageService.getProjectFiles(projectId);

        // Group files by pinId or areaId
        for (const file of allProjectFiles) {
          if (file.pinId) {
            if (!pinMetadata[file.pinId]) {
              pinMetadata[file.pinId] = [];
            }
            pinMetadata[file.pinId].push(file);
          } else if (file.areaId) {
            if (!areaMetadata[file.areaId]) {
              areaMetadata[file.areaId] = [];
            }
            areaMetadata[file.areaId].push(file);
          }
        }

        const totalFiles = allProjectFiles.length;
        const pinCount = Object.keys(pinMetadata).length;
        const areaCount = Object.keys(areaMetadata).length;

        perfLogger.end('loadPinFiles', `${totalFiles} files from ${pinCount} pins + ${areaCount} areas (project-wide)`);
        setPinFileMetadata(pinMetadata);
        setAreaFileMetadata(areaMetadata);

      } catch (error) {
        perfLogger.end('loadPinFiles');
        perfLogger.error('Failed to load project files', error);
      }
    };

    loadPinFiles();
  }, [currentProjectContext, activeProjectId]); // Re-load when project changes



  const handleLocationFound = useCallback((latlng: LatLng) => {
    setCurrentLocation(latlng);
  }, []);

  const handleLocationError = useCallback((error: any) => {
    console.error('Location error:', error);
    toast({
      variant: "destructive",
      title: "Location Error",
      description: "Could not get your current location."
    });
  }, [toast]);

  // Map move handler for line and area drawing - use ref to avoid stale closures
  const mapMoveHandlerRef = useRef<(center: LatLng, zoom: number, isMoving: boolean) => void>();

  // Update the handler ref whenever dependencies change
  mapMoveHandlerRef.current = (center: LatLng, zoom: number, isMoving: boolean = false) => {
    // Only update crosshair during continuous movement (isMoving=true) if actively drawing
    const shouldUpdateDuringMove = isMoving && (isDrawingLine || isDrawingArea);

    // Update view - but only on moveend (not during continuous dragging) to avoid excessive re-renders
    if (!isMoving) {
      setView({ center, zoom });
      updateMapScale(center, zoom);
    }

    // Update crosshair position for line drawing (this needs to update during movement)
    if (isDrawingLine && lineStartPoint && shouldUpdateDuringMove) {
      setCurrentMousePosition(center);
    }

    // Update crosshair position for area drawing (this needs to update during movement)
    if (isDrawingArea && areaStartPoint && shouldUpdateDuringMove) {
      setCurrentAreaEndPoint(center);
    }
  };

  // Calculate scale bar
  const updateMapScale = useCallback((center: LatLng, zoom: number) => {
    // Calculate meters per pixel at the current zoom level and latitude
    const earthRadius = 6378137; // Earth's radius in meters
    const latRad = (center.lat * Math.PI) / 180;
    const metersPerPixel = (2 * Math.PI * earthRadius * Math.cos(latRad)) / (256 * Math.pow(2, zoom));
    
    // Calculate appropriate scale bar length
    const targetPixels = 100; // Target width in pixels
    const targetMeters = metersPerPixel * targetPixels;
    
    // Round to nice numbers
    let distance: number;
    let unit: string;
    
    if (targetMeters >= 1000) {
      distance = Math.round(targetMeters / 1000);
      unit = 'km';
    } else if (targetMeters >= 100) {
      distance = Math.round(targetMeters / 100) * 100;
      unit = 'm';
    } else if (targetMeters >= 10) {
      distance = Math.round(targetMeters / 10) * 10;
      unit = 'm';
    } else {
      distance = Math.round(targetMeters);
      unit = 'm';
    }
    
    // Calculate actual pixel width for the rounded distance
    const actualMeters = unit === 'km' ? distance * 1000 : distance;
    const pixels = actualMeters / metersPerPixel;
    
    setMapScale({ distance, unit, pixels: Math.round(pixels) });
  }, []);
  
  // Initialize scale bar
  useEffect(() => {
    if (view) {
      updateMapScale({ lat: view.center.lat, lng: view.center.lng }, view.zoom);
    }
  }, [view, updateMapScale]);

  // ============================================================================
  // CONSOLIDATED: Pin Meteo Grid Management
  // Replaces 3 separate effects: Initialize Plot Configurations, Manage Data Availability, Manage Brush Range
  // Lines replaced: 1368, 1398, 1428
  // ============================================================================
  useEffect(() => {
    // 1. Initialize plot configurations (one-time, if not already set)
    if (pinMeteoPlotConfigsInternal.length === 0) {
      const configs: PlotConfigInternal[] = ALL_PARAMETERS.map(key => {
        const baseConfig = PARAMETER_CONFIG[key as CombinedParameterKey];
        let iconComp: LucideIcon = Info; // Default icon
        const isDirectional = key === 'waveDirection' || key === 'windDirection10m';

        // Fallbacks if no icon is in PARAMETER_CONFIG
        if (key === 'seaLevelHeightMsl') iconComp = Waves;
        else if (key === 'waveHeight') iconComp = Sailboat;
        else if (key === 'waveDirection') iconComp = CompassIcon;
        else if (key === 'wavePeriod') iconComp = TimerIcon;
        else if (key === 'seaSurfaceTemperature') iconComp = Thermometer;
        else if (key === 'temperature2m') iconComp = Thermometer;
        else if (key === 'windSpeed10m') iconComp = WindIcon;
        else if (key === 'windDirection10m') iconComp = CompassIcon;
        else if (key === 'ghi') iconComp = SunIcon;

        return {
          dataKey: key as CombinedParameterKey,
          name: baseConfig.name,
          unit: baseConfig.unit || '',
          color: baseConfig.color || '--chart-1',
          Icon: iconComp,
          isDirectional,
        };
      });
      setPinMeteoPlotConfigsInternal(configs);
    }

    // 2. Manage data availability status
    if (isLoadingPinMeteoData) {
      const pendingAvailability: Partial<Record<CombinedParameterKey, SeriesAvailabilityStatus>> = {};
      ALL_PARAMETERS.forEach(key => {
        pendingAvailability[key as CombinedParameterKey] = 'pending';
      });
      setPinMeteoSeriesDataAvailability(pendingAvailability as Record<CombinedParameterKey, SeriesAvailabilityStatus>);
    } else {
      const newAvailability: Partial<Record<CombinedParameterKey, SeriesAvailabilityStatus>> = {};
      if (!pinMeteoData || pinMeteoData.length === 0) {
        ALL_PARAMETERS.forEach(key => {
          newAvailability[key as CombinedParameterKey] = 'unavailable';
        });
      } else {
        ALL_PARAMETERS.forEach(key => {
          const hasData = pinMeteoData.some(
            point => {
              const val = point[key as keyof CombinedDataPoint];
              return val !== undefined && val !== null && !isNaN(Number(val));
            }
          );
          newAvailability[key as CombinedParameterKey] = hasData ? 'available' : 'unavailable';
        });
      }
      setPinMeteoSeriesDataAvailability(newAvailability as Record<CombinedParameterKey, SeriesAvailabilityStatus>);
    }

    // 3. Manage brush range
    if (pinMeteoData && pinMeteoData.length > 0 && pinMeteoBrushEndIndex === undefined) {
      setPinMeteoBrushStartIndex(0);
      setPinMeteoBrushEndIndex(pinMeteoData.length - 1);
    } else if ((!pinMeteoData || pinMeteoData.length === 0)) {
      setPinMeteoBrushStartIndex(0);
      setPinMeteoBrushEndIndex(undefined);
    }
  }, [pinMeteoData, isLoadingPinMeteoData, pinMeteoBrushEndIndex, pinMeteoPlotConfigsInternal.length]);

  // REMOVED: Initialize plot configurations - now in consolidated effect above (line 1373)
  // useEffect(() => {
  //   const configs: PlotConfigInternal[] = ALL_PARAMETERS.map(key => {
  //     const baseConfig = PARAMETER_CONFIG[key as CombinedParameterKey];
  //     let iconComp: LucideIcon = Info;
  //     const isDirectional = key === 'waveDirection' || key === 'windDirection10m';
  //     ...
  //     return { dataKey, name, unit, color, Icon, isDirectional };
  //   });
  //   setPinMeteoPlotConfigsInternal(configs);
  // }, []);

  // REMOVED: Manage data availability status - now in consolidated effect above (line 1411)
  // useEffect(() => {
  //   if (isLoadingPinMeteoData) {
  //     const pendingAvailability = {};
  //     ALL_PARAMETERS.forEach(key => {
  //       pendingAvailability[key] = 'pending';
  //     });
  //     setPinMeteoSeriesDataAvailability(pendingAvailability);
  //     return;
  //   }
  //   ...
  // }, [pinMeteoData, isLoadingPinMeteoData]);

  // REMOVED: Manage brush range - now in consolidated effect above (line 1440)
  // useEffect(() => {
  //   if (pinMeteoData && pinMeteoData.length > 0 && pinMeteoBrushEndIndex === undefined) {
  //     setPinMeteoBrushStartIndex(0);
  //     setPinMeteoBrushEndIndex(pinMeteoData.length - 1);
  //   } else if ((!pinMeteoData || pinMeteoData.length === 0)) {
  //     setPinMeteoBrushStartIndex(0);
  //     setPinMeteoBrushEndIndex(undefined);
  //   }
  // }, [pinMeteoData, pinMeteoBrushEndIndex]);

  // Fetch merged files - extracted as reusable function
  const fetchMergedFiles = useCallback(async () => {
    const projectId = currentProjectContext || activeProjectId;
    if (!projectId) {
      setMergedFiles([]);
      return;
    }

    setIsLoadingMergedFiles(true);
    try {
      const result = await getMergedFilesByProjectAction(projectId);

      // Handle undefined or null result (defensive check)
      if (!result) {
        console.warn('getMergedFilesByProjectAction returned undefined/null');
        setMergedFiles([]);
        return;
      }

      if (result.success && result.data) {
        // Convert MergedFile to PinFile format for compatibility
        const mergedFilesWithLabel = result.data.map(mf => ({
          id: mf.id,
          pinId: mf.pinId,
          fileName: mf.fileName,
          filePath: mf.filePath,
          fileSize: mf.fileSize,
          fileType: mf.fileType,
          uploadedAt: new Date(mf.createdAt),
          projectId: mf.projectId,
          startDate: mf.startDate ? new Date(mf.startDate) : undefined,
          endDate: mf.endDate ? new Date(mf.endDate) : undefined,
          fileSource: 'merged' as const,
          pinLabel: 'Merged' // Merged files don't have a specific pin, use generic label
        }));
        setMergedFiles(mergedFilesWithLabel);
      } else {
        console.error('Failed to fetch merged files:', result.error || 'No result returned');
        setMergedFiles([]);
      }
    } catch (error) {
      console.error('Error fetching merged files:', error);
      setMergedFiles([]);
    } finally {
      setIsLoadingMergedFiles(false);
    }
  }, [currentProjectContext, activeProjectId]);

  // Reload all project files - comprehensive refresh function
  const reloadProjectFiles = useCallback(async () => {
    console.log('🔄 Reloading all project files...');

    const projectId = currentProjectContext || activeProjectId;
    if (!projectId) {
      console.warn('No project ID available for reloading files');
      return;
    }

    try {
      // Load ALL files for the entire project (same approach as initial load)
      // This ensures we get files from ALL pins/areas, not just the ones currently drawn on the map
      const allProjectFiles = await fileStorageService.getProjectFiles(projectId);

      // Group files by pinId or areaId
      const pinMetadata: Record<string, PinFile[]> = {};
      const areaMetadata: Record<string, PinFile[]> = {};

      for (const file of allProjectFiles) {
        if (file.pinId) {
          if (!pinMetadata[file.pinId]) {
            pinMetadata[file.pinId] = [];
          }
          pinMetadata[file.pinId].push(file);
        } else if (file.areaId) {
          if (!areaMetadata[file.areaId]) {
            areaMetadata[file.areaId] = [];
          }
          areaMetadata[file.areaId].push(file);
        }
      }

      // Update state
      setPinFileMetadata(pinMetadata);
      setAreaFileMetadata(areaMetadata);

      console.log(`✅ Reloaded ${allProjectFiles.length} files (${Object.keys(pinMetadata).length} pins, ${Object.keys(areaMetadata).length} areas)`);

      // Also refresh merged files
      await fetchMergedFiles();

    } catch (error) {
      console.error('Error reloading project files:', error);
    }
  }, [currentProjectContext, activeProjectId, fetchMergedFiles]);

  // Fetch merged files when dialog opens or project changes
  useEffect(() => {
    if (showProjectDataDialog) {
      fetchMergedFiles();
    } else {
      setMergedFiles([]);
    }
  }, [showProjectDataDialog, fetchMergedFiles]);

  // Stable callback that calls the current handler
  const handleMapMove = useCallback((center: LatLng, zoom: number, isMoving: boolean = false) => {
    mapMoveHandlerRef.current?.(center, zoom, isMoving);
  }, []);

  const handleMapClick = useCallback((e: LeafletMouseEvent) => {
    // Pin dropping, line drawing, and area drawing are now handled by button clicks, not map click
  }, [drawingMode, isDrawingLine, lineStartPoint, isDrawingArea, pendingAreaPath]);

  // Add a custom click handler that checks if we clicked on an object
  const handleObjectClick = useCallback((objectId: string, objectType: 'pin' | 'line' | 'area') => {
    let clickedObject = null;
    
    if (objectType === 'pin') {
      clickedObject = pins.find(p => p.id === objectId);
    } else if (objectType === 'line') {
      clickedObject = lines.find(l => l.id === objectId);
    } else if (objectType === 'area') {
      clickedObject = areas.find(a => a.id === objectId);
    }
    
    if (clickedObject) {
      setItemToEdit(clickedObject);
      // Prevent default popup behavior
      return false;
    }
  }, [pins, lines, areas]);

  const handleMapMouseMove = useCallback((e: LeafletMouseEvent) => {
    // Mouse move disabled for line drawing - we only want drag/pan to update the line
    // Line updates are handled by handleMapMove when the map center changes
  }, []);

  const handlePinSave = useCallback(async (id: string, label: string, lat: number, lng: number, notes: string, tagId?: string) => {
    const pinData = {
      lat,
      lng,
      label,
      notes,
      projectId: activeProjectId,
      tagIds: tagId ? [tagId] : [],
      labelVisible: true
    };
    
    try {
      await createPinData(pinData);
      setPendingPin(null);
      toast({
        title: "Pin Created",
        description: `Pin "${label}" has been added to the map.`
      });
    } catch (error) {
      console.error('Error creating pin:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to create pin. Please try again."
      });
    }
  }, [createPinData, activeProjectId, toast]);

  const handlePinCancel = useCallback(() => {
    setPendingPin(null);
  }, []);

  const handleLineSave = useCallback(async (id: string, label: string, path: LatLng[], notes: string, tagId?: string) => {
    console.log('🎯 STEP 7: handleLineSave called', {
      id,
      label,
      pathLength: path.length,
      timestamp: Date.now(),
      callStack: new Error().stack?.split('\n')[1]?.trim()
    });
    
    const lineData = {
      label,
      path: path.map(p => ({ lat: p.lat, lng: p.lng })),
      notes,
      projectId: activeProjectId,
      tagIds: tagId ? [tagId] : [],
      labelVisible: true,
      size: 2 // Default to thinner lines
    };
    
    try {
      console.log('🎯 STEP 8: Calling createLineData');
      const newLine = await createLineData(lineData);
      console.log('🎯 STEP 9: Line created successfully, clearing pendingLine');
      setPendingLine(null);
      lineConfirmInProgressRef.current = false; // Reset the flag
      
      // Immediately select this line and enter edit mode
      setItemToEdit(newLine);
      setIsEditingObject(true);
      
    } catch (error) {
      console.error('Error creating line:', error);
      lineConfirmInProgressRef.current = false; // Reset the flag on error too
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to create line. Please try again."
      });
    }
  }, [createLineData, activeProjectId, toast]);

  const handleLineCancel = useCallback(() => {
    setPendingLine(null);
    lineConfirmInProgressRef.current = false; // Reset the flag
  }, []);

  const handleAreaSave = useCallback(async (id: string, label: string, path: LatLng[], notes: string, tagId?: string) => {
    const areaData = {
      label,
      path: path.map(p => ({ lat: p.lat, lng: p.lng })),
      notes,
      projectId: activeProjectId,
      tagIds: tagId ? [tagId] : [],
      labelVisible: true,
      fillVisible: true,
      color: '#3b82f6', // Default to blue instead of red
      size: 2, // Default to thinner lines
      transparency: 20 // Default to 20% transparency
    };
    
    try {
      const newArea = await createAreaData(areaData);
      setPendingArea(null);
      
      // Immediately select this area and enter edit mode
      setItemToEdit(newArea);
      setIsEditingObject(true);
      
    } catch (error) {
      console.error('Error creating area:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to create area. Please try again."
      });
    }
  }, [createAreaData, activeProjectId, toast]);

  const handleAreaCancel = useCallback(() => {
    setPendingArea(null);
  }, []);

  // Line drawing helpers
  const handleLineConfirm = useCallback(() => {
    console.log('🎯 STEP 1: handleLineConfirm called', {
      lineStartPoint: !!lineStartPoint,
      currentMousePosition: !!currentMousePosition,
      pendingLine: !!pendingLine,
      lineConfirmInProgress: lineConfirmInProgressRef.current,
      timestamp: Date.now(),
      callStack: new Error().stack?.split('\n')[1]?.trim()
    });
    
    // Prevent duplicate calls
    if (lineConfirmInProgressRef.current) {
      console.log('❌ handleLineConfirm blocked - already in progress');
      return;
    }
    
    if (lineStartPoint && currentMousePosition && !pendingLine) {
      console.log('🎯 STEP 2: Setting pendingLine');
      lineConfirmInProgressRef.current = true;
      setPendingLine({ path: [lineStartPoint, currentMousePosition] });
      setIsDrawingLine(false);
      setLineStartPoint(null);
      setCurrentMousePosition(null);
      setDrawingMode('none');
      
      // Reset the flag after a short delay to allow the popup to be created
      setTimeout(() => {
        lineConfirmInProgressRef.current = false;
      }, 1000);
    } else {
      console.log('❌ handleLineConfirm blocked - conditions not met', {
        hasLineStartPoint: !!lineStartPoint,
        hasCurrentMousePosition: !!currentMousePosition,
        hasPendingLine: !!pendingLine
      });
    }
  }, [lineStartPoint, currentMousePosition, pendingLine]);

  const handleLineCancelDrawing = useCallback(() => {
    setIsDrawingLine(false);
    setLineStartPoint(null);
    setCurrentMousePosition(null);
    setDrawingMode('none');
  }, []);

  // Area drawing helpers
  const handleAreaStart = useCallback(() => {
    if (mapRef.current) {
      const mapCenter = mapRef.current.getCenter();
      setAreaStartPoint(mapCenter);
      setCurrentAreaEndPoint(mapCenter);
      setPendingAreaPath([mapCenter]);
      setIsDrawingArea(true);
      setDrawingMode('area');
    }
  }, []);

  const handleAreaAddCorner = useCallback(() => {
    if (currentAreaEndPoint && areaStartPoint) {
      const newPath = [...pendingAreaPath, currentAreaEndPoint];
      setPendingAreaPath(newPath);
      setAreaStartPoint(currentAreaEndPoint);
      setCurrentAreaEndPoint(currentAreaEndPoint);
    }
  }, [currentAreaEndPoint, areaStartPoint, pendingAreaPath]);

  const handleAreaFinish = useCallback(() => {
    if (pendingAreaPath.length >= 3) {
      setPendingArea({ path: pendingAreaPath });
      setIsDrawingArea(false);
      setAreaStartPoint(null);
      setCurrentAreaEndPoint(null);
      setPendingAreaPath([]);
      setDrawingMode('none');
    }
  }, [pendingAreaPath]);

  const handleAreaCancelDrawing = useCallback(() => {
    setIsDrawingArea(false);
    setAreaStartPoint(null);
    setCurrentAreaEndPoint(null);
    setPendingAreaPath([]);
    setDrawingMode('none');
  }, []);

  // Update/Delete handlers
  const handleUpdatePin = useCallback(async (id: string, label: string, notes: string, projectId?: string, tagIds?: string[]) => {
    try {
      console.log('handleUpdatePin called with:', { id, label, notes, projectId, tagIds });
      
      // Ensure label is not empty string but can be undefined
      const sanitizedLabel = label?.trim() || undefined;
      
      console.log('Updating pin with sanitized label:', sanitizedLabel);
      await updatePinData(id, { 
        label: sanitizedLabel, 
        notes: notes?.trim() || undefined, 
        projectId, 
        tagIds 
      });
      
      console.log('Pin update successful');
      toast({ 
        title: "Pin Updated", 
        description: `Pin "${sanitizedLabel || 'Unnamed'}" has been updated successfully.`,
        duration: 3000 
      });
    } catch (error) {
      console.error('Error updating pin:', error);
      toast({ 
        variant: "destructive",
        title: "Error", 
        description: "Failed to update pin. Please try again." 
      });
    }
  }, [updatePinData, toast]);

  const handleDeletePin = useCallback(async (id: string) => {
    try {
      await deletePinData(id);
      toast({ title: "Pin Deleted", description: "Pin has been deleted from the map." });
    } catch (error) {
      console.error('Error deleting pin:', error);
      toast({ 
        variant: "destructive",
        title: "Error", 
        description: "Failed to delete pin. Please try again." 
      });
    }
  }, [deletePinData, toast]);

  const handleUpdateLine = useCallback(async (id: string, label: string, notes: string, projectId?: string, tagIds?: string[]) => {
    try {
      await updateLineData(id, { label, notes, projectId, tagIds });
      toast({ title: "Line Updated", description: "Line has been updated successfully." });
    } catch (error) {
      console.error('Error updating line:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update line. Please try again."
      });
    }
  }, [updateLineData, toast]);

  const handleDeleteLine = useCallback(async (id: string) => {
    try {
      await deleteLineData(id);
      toast({ title: "Line Deleted", description: "Line has been deleted from the map." });
    } catch (error) {
      console.error('Error deleting line:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete line. Please try again."
      });
    }
  }, [deleteLineData, toast]);

  const handleUpdateArea = useCallback(async (id: string, label: string, notes: string, path: {lat: number, lng: number}[], projectId?: string, tagIds?: string[]) => {
    try {
      await updateAreaData(id, { label, notes, path, projectId, tagIds });
      toast({ title: "Area Updated", description: "Area has been updated successfully." });
    } catch (error) {
      console.error('Error updating area:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update area. Please try again."
      });
    }
  }, [updateAreaData, toast]);

  const handleDeleteArea = useCallback(async (id: string) => {
    try {
      await deleteAreaData(id);
      toast({ title: "Area Deleted", description: "Area has been deleted from the map." });
    } catch (error) {
      console.error('Error deleting area:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete area. Please try again."
      });
    }
  }, [deleteAreaData, toast]);

  // Multi-selection helper functions
  const toggleObjectSelection = (objectId: string) => {
    setSelectedObjectIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(objectId)) {
        newSet.delete(objectId);
      } else {
        newSet.add(objectId);
      }
      return newSet;
    });
  };

  const selectAllFilteredObjects = () => {
    const allObjects = [
      ...projectPins.map(p => ({ id: p.id, type: 'pin' as const })),
      ...projectLines.map(l => ({ id: l.id, type: 'line' as const })),
      ...projectAreas.map(a => ({ id: a.id, type: 'area' as const }))
    ].filter(obj => {
      if (objectTypeFilter === 'all') return true;
      return obj.type === objectTypeFilter;
    });

    setSelectedObjectIds(new Set(allObjects.map(o => o.id)));
  };

  const clearObjectSelection = () => {
    setSelectedObjectIds(new Set());
  };

  const getSelectedObjects = (): Array<{ id: string; type: 'pin' | 'line' | 'area'; label: string }> => {
    // Get all objects across all projects (since selections can span projects)
    const allObjects = [
      ...pins.map(pin => ({ ...pin, type: 'pin' as const })),
      ...lines.map(line => ({ ...line, type: 'line' as const })),
      ...areas.map(area => ({ ...area, type: 'area' as const }))
    ];

    return allObjects.filter(obj => selectedObjectIds.has(obj.id));
  };

  // Batch delete handler
  const handleBatchDelete = async () => {
    const objectsToDelete = getSelectedObjects();
    const totalCount = objectsToDelete.length;
    let successCount = 0;
    let errorCount = 0;

    // Show loading toast
    toast({
      title: "Deleting Objects...",
      description: `Deleting ${totalCount} object${totalCount !== 1 ? 's' : ''}...`,
      duration: 3000,
    });

    // Delete each object sequentially
    for (const obj of objectsToDelete) {
      try {
        if (obj.type === 'pin') {
          await deletePinData(obj.id);
        } else if (obj.type === 'line') {
          await deleteLineData(obj.id);
        } else if (obj.type === 'area') {
          await deleteAreaData(obj.id);
        }
        successCount++;
      } catch (error) {
        console.error(`Error deleting ${obj.type} ${obj.label}:`, error);
        errorCount++;
      }
    }

    // Show result toast
    if (errorCount === 0) {
      toast({
        title: "Batch Delete Complete",
        description: `Successfully deleted ${successCount} object${successCount !== 1 ? 's' : ''}.`,
        duration: 5000,
      });
    } else {
      toast({
        variant: errorCount === totalCount ? "destructive" : "default",
        title: "Batch Delete Complete with Errors",
        description: `Deleted ${successCount} object${successCount !== 1 ? 's' : ''}, ${errorCount} failed.`,
        duration: 7000,
      });
    }

    // Clear selections and close dialog
    clearObjectSelection();
    setShowBatchDeleteConfirmDialog(false);
    setIsBulkDeleteMode(false);
  };

  const handleToggleLabel = useCallback(async (id: string, type: 'pin' | 'line' | 'area') => {
    try {
      if (type === 'pin') {
        const pin = pins.find(p => p.id === id);
        if (pin) {
          await updatePinData(id, { labelVisible: !pin.labelVisible });
        }
      } else if (type === 'line') {
        const line = lines.find(l => l.id === id);
        if (line) {
          await updateLineData(id, { labelVisible: !line.labelVisible });
        }
      } else if (type === 'area') {
        const area = areas.find(a => a.id === id);
        if (area) {
          await updateAreaData(id, { labelVisible: !area.labelVisible });
        }
      }
    } catch (error) {
      console.error('Error toggling label:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to toggle label visibility."
      });
    }
  }, [pins, lines, areas, updatePinData, updateLineData, updateAreaData, toast]);

  const handleToggleFill = useCallback(async (id: string) => {
    try {
      const area = areas.find(a => a.id === id);
      if (area) {
        await updateAreaData(id, { fillVisible: !area.fillVisible });
      }
    } catch (error) {
      console.error('Error toggling fill:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to toggle fill visibility."
      });
    }
  }, [areas, updateAreaData, toast]);

  const handleToggleObjectVisibility = async (id: string, type: 'pin' | 'line' | 'area') => {
    try {
      if (type === 'pin') {
        const pin = pins.find(p => p.id === id);
        if (pin) {
          await updatePinData(id, { objectVisible: !pin.objectVisible });
        }
      } else if (type === 'line') {
        const line = lines.find(l => l.id === id);
        if (line) {
          await updateLineData(id, { objectVisible: !line.objectVisible });
        }
      } else if (type === 'area') {
        const area = areas.find(a => a.id === id);
        if (area) {
          await updateAreaData(id, { objectVisible: !area.objectVisible });
        }
      }
    } catch (error) {
      console.error('Error toggling object visibility:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to toggle object visibility."
      });
    }
  };

  const handleToggleAllLabels = async (projectId: string, visible: boolean) => {
    try {
      const projectPins = pins.filter(p => p.projectId === projectId);
      const projectLines = lines.filter(l => l.projectId === projectId);
      const projectAreas = areas.filter(a => a.projectId === projectId);

      const pinIds = projectPins.map(p => p.id);
      const lineIds = projectLines.map(l => l.id);
      const areaIds = projectAreas.map(a => a.id);

      // Batch update all objects in parallel
      await Promise.all([
        pinIds.length > 0 && batchUpdatePins(pinIds, { labelVisible: visible }),
        lineIds.length > 0 && batchUpdateLines(lineIds, { labelVisible: visible }),
        areaIds.length > 0 && batchUpdateAreas(areaIds, { labelVisible: visible })
      ]);

      toast({
        title: visible ? "Labels Shown" : "Labels Hidden",
        description: `All labels ${visible ? 'shown' : 'hidden'} for this project.`
      });
    } catch (error) {
      console.error('Error toggling all labels:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to toggle all labels."
      });
    }
  };

  const handleToggleAllObjects = async (projectId: string, visible: boolean) => {
    try {
      const projectPins = pins.filter(p => p.projectId === projectId);
      const projectLines = lines.filter(l => l.projectId === projectId);
      const projectAreas = areas.filter(a => a.projectId === projectId);

      const pinIds = projectPins.map(p => p.id);
      const lineIds = projectLines.map(l => l.id);
      const areaIds = projectAreas.map(a => a.id);

      // Batch update all objects in parallel
      await Promise.all([
        pinIds.length > 0 && batchUpdatePins(pinIds, { objectVisible: visible }),
        lineIds.length > 0 && batchUpdateLines(lineIds, { objectVisible: visible }),
        areaIds.length > 0 && batchUpdateAreas(areaIds, { objectVisible: visible })
      ]);

      toast({
        title: visible ? "Objects Shown" : "Objects Hidden",
        description: `All objects ${visible ? 'shown' : 'hidden'} for this project.`
      });
    } catch (error) {
      console.error('Error toggling all objects:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to toggle all objects."
      });
    }
  };

  const clearAll = async () => {
    try {
      await clearAllData();
    } catch (error) {
      console.error('Error clearing data:', error);
      toast({ 
        variant: "destructive",
        title: "Error", 
        description: "Failed to clear all data." 
      });
    }
  };

  const centerOnCurrentLocation = useCallback(async () => {
    if (!mapRef.current) {
      toast({
        variant: "destructive",
        title: "Map Not Ready",
        description: "Map is not yet initialized."
      });
      return;
    }

    if (!navigator.geolocation) {
      toast({
        variant: "destructive",
        title: "GPS Not Supported",
        description: "Your browser doesn't support GPS location."
      });
      return;
    }

    console.log('🗺️ GPS Request:', {
      currentPermission: locationPermission,
      timestamp: new Date().toISOString()
    });

    setIsGettingLocation(true);

    // First, explicitly check if we need to request permission
    if (locationPermission === 'denied') {
      setIsGettingLocation(false);
      toast({
        variant: "destructive",
        title: "Location Permission Denied",
        description: "Please enable location access in your browser settings and refresh the page."
      });
      return;
    }

    // Request location with detailed logging
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        
        console.log('📍 GPS Success:', {
          latitude,
          longitude,
          accuracy,
          timestamp: new Date().toISOString()
        });

        const newLocation = { lat: latitude, lng: longitude } as LatLng;
        setCurrentLocation(newLocation);
        
        if (mapRef.current) {
          // Center on actual GPS location with higher zoom
          mapRef.current.setView([latitude, longitude], 16);
          toast({
            title: "Location Found",
            description: `Lat: ${latitude.toFixed(6)}, Lng: ${longitude.toFixed(6)}`,
            duration: 3000
          });
        }
        setIsGettingLocation(false);
        
        // Update permission state after successful location
        setLocationPermission('granted');
      },
      (error) => {
        setIsGettingLocation(false);
        
        console.error('🚫 GPS Error:', {
          code: error.code,
          message: error.message,
          timestamp: new Date().toISOString()
        });

        let errorMessage = "Could not get your location.";
        let titleMessage = "Location Error";
        
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setLocationPermission('denied');
            titleMessage = "Permission Denied";
            errorMessage = "Location access was denied. Please enable location permissions in your browser and try again.";
            break;
          case error.POSITION_UNAVAILABLE:
            titleMessage = "Location Unavailable";
            errorMessage = "Your location information is unavailable. Make sure GPS is enabled on your device.";
            break;
          case error.TIMEOUT:
            titleMessage = "Location Timeout";
            errorMessage = "Location request timed out. Please try again.";
            break;
        }
        
        toast({
          variant: "destructive",
          title: titleMessage,
          description: errorMessage,
          duration: 5000
        });

        // Show instructions for enabling location
        if (error.code === error.PERMISSION_DENIED) {
          setTimeout(() => {
            toast({
              title: "How to Enable Location",
              description: "Click the location icon in your browser's address bar, or check browser settings > Privacy & Security > Location.",
              duration: 8000
            });
          }, 2000);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30000 // Shorter cache to get fresher location
      }
    );
  }, [toast, locationPermission]);

  const zoomIn = useCallback(() => {
    if (mapRef.current) {
      const currentZoom = mapRef.current.getZoom();
      const newZoom = currentZoom + 0.5; // Smaller increment (was 1.0 by default)
      mapRef.current.setView(mapRef.current.getCenter(), newZoom, {
        animate: true,
        duration: 0.25
      });
    }
  }, []);

  const zoomOut = useCallback(() => {
    if (mapRef.current) {
      const currentZoom = mapRef.current.getZoom();
      const newZoom = currentZoom - 0.5; // Smaller decrement (was 1.0 by default)
      mapRef.current.setView(mapRef.current.getCenter(), newZoom, {
        animate: true,
        duration: 0.25
      });
    }
  }, []);

  const goToProjectLocation = useCallback((locationKey: string) => {
    const location = dynamicProjects[locationKey];
    if (location && mapRef.current) {
      // Get all objects for this project
      const projectPins = pins.filter(pin => pin.projectId === locationKey);
      const projectLines = lines.filter(line => line.projectId === locationKey);
      const projectAreas = areas.filter(area => area.projectId === locationKey);
      const totalObjects = projectPins.length + projectLines.length + projectAreas.length;
      
      if (totalObjects > 0) {
        // Calculate bounds that include all project objects
        let minLat = Infinity, maxLat = -Infinity;
        let minLng = Infinity, maxLng = -Infinity;
        
        // Process pins
        projectPins.forEach(pin => {
          minLat = Math.min(minLat, pin.lat);
          maxLat = Math.max(maxLat, pin.lat);
          minLng = Math.min(minLng, pin.lng);
          maxLng = Math.max(maxLng, pin.lng);
        });
        
        // Process lines
        projectLines.forEach(line => {
          if (line.points) {
            line.points.forEach(point => {
              minLat = Math.min(minLat, point.lat);
              maxLat = Math.max(maxLat, point.lat);
              minLng = Math.min(minLng, point.lng);
              maxLng = Math.max(maxLng, point.lng);
            });
          }
        });
        
        // Process areas
        projectAreas.forEach(area => {
          if (area.points) {
            area.points.forEach(point => {
              minLat = Math.min(minLat, point.lat);
              maxLat = Math.max(maxLat, point.lat);
              minLng = Math.min(minLng, point.lng);
              maxLng = Math.max(maxLng, point.lng);
            });
          }
        });
        
        // Add some padding around the bounds
        const latPadding = (maxLat - minLat) * 0.1 || 0.01;
        const lngPadding = (maxLng - minLng) * 0.1 || 0.01;
        
        // Fit bounds to show all objects
        mapRef.current.fitBounds([
          [minLat - latPadding, minLng - lngPadding],
          [maxLat + latPadding, maxLng + lngPadding]
        ], { padding: [20, 20] });
        
        toast({
          title: `Viewing ${location.name}`,
          description: `Showing all ${totalObjects} project objects`,
          duration: 3000
        });
      } else if (location.lat && location.lon) {
        // Fallback to project location if no objects (only for hardcoded projects with coordinates)
        mapRef.current.setView([location.lat, location.lon], 12);
        toast({
          title: `Navigated to ${location.name}`,
          description: `No objects found - showing project location`,
          duration: 3000
        });
      } else {
        // For dynamic projects without coordinates, just show a message
        toast({
          title: location.name,
          description: `This project has no objects or location to display`,
          duration: 3000
        });
      }
      
      setShowProjectsDialog(false);
    }
  }, [toast, pins, lines, areas, dynamicProjects]);

  // Project management handlers
  const toggleProjectVisibility = useCallback((projectKey: string) => {
    setProjectVisibility(prev => ({
      ...prev,
      [projectKey]: !prev[projectKey]
    }));
  }, []);

  const setActiveProject = useCallback((projectKey: string) => {
    setActiveProjectId(projectKey);
    toast({
      title: "Active Project Changed",
      description: `${dynamicProjects[projectKey]?.name} is now the active project`,
      duration: 3000
    });
  }, [toast]);

  // Auto-fit map to active project area on initial load
  const hasAutoFittedRef = useRef(false);

  useEffect(() => {
    // Only auto-fit once when data is loaded and map is ready
    if (!hasAutoFittedRef.current &&
        activeProjectId &&
        mapRef.current &&
        (pins.length > 0 || lines.length > 0 || areas.length > 0)) {

      // Small delay to ensure map is fully initialized
      const timer = setTimeout(() => {
        goToProjectLocation(activeProjectId);
        hasAutoFittedRef.current = true;
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [activeProjectId, pins.length, lines.length, areas.length, goToProjectLocation]);

  // Generalized utility function to create invisible wrapper polygon
  const createWrapperPolygon = useCallback(async (
    wrapperLabel: string,
    projectKey: string,
    areaLabels?: string[], // Optional: specific area labels to wrap. If not provided, wraps all areas in project
    notes?: string
  ) => {
    // Find areas to wrap
    let areasToWrap = areas.filter(area => area.projectId === projectKey);

    // If specific area labels provided, filter to only those
    if (areaLabels && areaLabels.length > 0) {
      areasToWrap = areasToWrap.filter(area =>
        areaLabels.some(label => area.label.toLowerCase().includes(label.toLowerCase()))
      );
    }

    if (areasToWrap.length === 0) {
      toast({
        variant: "destructive",
        title: "No Areas Found",
        description: areaLabels
          ? `No areas found matching: ${areaLabels.join(', ')}`
          : `No areas found for project: ${projectKey}`
      });
      return;
    }

    // Calculate bounding box from all area points
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    areasToWrap.forEach(area => {
      if (area.path) {
        area.path.forEach(point => {
          minLat = Math.min(minLat, point.lat);
          maxLat = Math.max(maxLat, point.lat);
          minLng = Math.min(minLng, point.lng);
          maxLng = Math.max(maxLng, point.lng);
        });
      }
    });

    // Add 10% padding to ensure all areas are inside
    const latPadding = (maxLat - minLat) * 0.1;
    const lngPadding = (maxLng - minLng) * 0.1;

    // Create wrapper polygon path (rectangle around all areas)
    const wrapperPath = [
      { lat: minLat - latPadding, lng: minLng - lngPadding }, // Bottom-left
      { lat: maxLat + latPadding, lng: minLng - lngPadding }, // Top-left
      { lat: maxLat + latPadding, lng: maxLng + lngPadding }, // Top-right
      { lat: minLat - latPadding, lng: maxLng + lngPadding }, // Bottom-right
    ];

    // Create the invisible wrapper area
    const wrapperData = {
      label: wrapperLabel,
      notes: notes || `Invisible wrapper polygon for ${projectKey} - wraps ${areasToWrap.length} areas`,
      path: wrapperPath,
      projectId: projectKey,
      tagIds: [],
      color: 'transparent', // Invisible border
      size: 0, // No border width
      fillVisible: false, // No fill
      transparency: 0, // Completely transparent
      labelVisible: true
    };

    try {
      await createAreaData(wrapperData);
      toast({
        title: "Wrapper Created",
        description: `Created "${wrapperLabel}" wrapping ${areasToWrap.length} areas`
      });
    } catch (error) {
      console.error('Error creating wrapper polygon:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to create wrapper polygon"
      });
    }
  }, [areas, createAreaData, toast]);

  // Convenience function for Milford Haven (backward compatibility)
  const createMilfordHavenWrapper = useCallback(async () => {
    await createWrapperPolygon("META Project Areas", "milfordhaven");
  }, [createWrapperPolygon]);

  // Utility function to remove old wrapper by label
  const removeWrapperByLabel = useCallback(async (labelToRemove: string) => {
    const wrapperToRemove = areas.find(area => area.label === labelToRemove);

    if (!wrapperToRemove) {
      toast({
        variant: "destructive",
        title: "Not Found",
        description: `No area found with label "${labelToRemove}"`
      });
      return;
    }

    try {
      await deleteAreaData(wrapperToRemove.id);
      toast({
        title: "Wrapper Removed",
        description: `Removed wrapper: "${labelToRemove}"`
      });
    } catch (error) {
      console.error('Error removing wrapper:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to remove wrapper polygon"
      });
    }
  }, [areas, deleteAreaData, toast]);

  // Expose wrapper functions to console for one-time use
  useEffect(() => {
    (window as any).createWrapperPolygon = createWrapperPolygon;
    (window as any).createMilfordHavenWrapper = createMilfordHavenWrapper;
    (window as any).removeWrapperByLabel = removeWrapperByLabel;
    return () => {
      delete (window as any).createWrapperPolygon;
      delete (window as any).createMilfordHavenWrapper;
      delete (window as any).removeWrapperByLabel;
    };
  }, [createWrapperPolygon, createMilfordHavenWrapper, removeWrapperByLabel]);

  // Function to group files by type (FPOD, SubCam, GP)
  const groupFilesByType = useCallback((files: PinFile[]) => {
    const grouped = {
      FPOD: [] as Array<PinFile & { pinLabel: string }>,
      SubCam: [] as Array<PinFile & { pinLabel: string }>,
      GP: [] as Array<PinFile & { pinLabel: string }>,
      Other: [] as Array<PinFile & { pinLabel: string }>
    };

    files.forEach(file => {
      const pin = pins.find(p => p.id === file.pinId);
      const fileWithPinLabel = { ...file, pinLabel: pin?.label || 'Unnamed Pin' };
      
      const fileName = file.fileName.toUpperCase();
      if (fileName.includes('FPOD') || fileName.startsWith('FPOD_')) {
        grouped.FPOD.push(fileWithPinLabel);
      } else if (fileName.includes('SUBCAM') || fileName.includes('SUB_CAM') || fileName.startsWith('SUBCAM_')) {
        grouped.SubCam.push(fileWithPinLabel);
      } else if (fileName.includes('GP') || fileName.startsWith('GP_') || fileName.includes('GPS')) {
        grouped.GP.push(fileWithPinLabel);
      } else {
        grouped.Other.push(fileWithPinLabel);
      }
    });

    return grouped;
  }, [pins]);

  // Function to get all project files
  const getProjectFiles = useCallback((projectId?: string) => {
    const targetProjectId = projectId || activeProjectId;
    if (!targetProjectId) return [];

    const projectPins = pins.filter(pin => pin.projectId === targetProjectId);
    const projectAreas = areas.filter(area => area.projectId === targetProjectId);
    const allFiles: PinFile[] = [];

    // Add pin files
    projectPins.forEach(pin => {
      const pinFilesMetadata = pinFileMetadata[pin.id] || [];
      allFiles.push(...pinFilesMetadata);
    });

    // Add area files
    projectAreas.forEach(area => {
      const areaFilesMetadata = areaFileMetadata[area.id] || [];
      allFiles.push(...areaFilesMetadata);
    });

    return allFiles;
  }, [activeProjectId, pins, areas, pinFileMetadata, areaFileMetadata]);

  // CSV Date Analysis Functions
  // Now uses the intelligent csvParser.ts for consistent date parsing across the app
  const analyzeCSVDateRange = useCallback(async (file: PinFile): Promise<{
    totalDays: number | null;
    startDate: string | null;
    endDate: string | null;
    uniqueDates?: string[]; // Array of unique date strings for discrete sampling (CROP files)
    isCrop?: boolean; // Flag to indicate CROP file type
    error?: string;
  }> => {
    try {
      // Use the correct property name for file path
      const storagePath = file.filePath || (file as any).storagePath || (file as any).storage_path;

      if (!storagePath) {
        return {
          totalDays: null,
          startDate: null,
          endDate: null,
          error: 'No storage path available'
        };
      }

      // Download file content from Supabase Storage with timeout
      const downloadPromise = supabase.storage
        .from('pin-files')
        .download(storagePath);

      // Create timeout promise
      const timeoutPromise = new Promise<{ data: null; error: { message: string } }>((_, reject) => {
        setTimeout(() => reject(new Error('Download timeout after 30 seconds')), 30000);
      });

      let fileData: Blob;
      let downloadError: any;

      try {
        const result = await Promise.race([downloadPromise, timeoutPromise]);
        fileData = result.data as Blob;
        downloadError = result.error;
      } catch (error) {
        console.error('❌ File download timeout or error:', {
          fileName: file.fileName,
          storagePath: storagePath,
          error: error
        });
        return {
          totalDays: null,
          startDate: null,
          endDate: null,
          error: `Download timeout: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
      }

      if (downloadError) {
        console.error('❌ File download error:', {
          fileName: file.fileName,
          storagePath: storagePath,
          error: downloadError,
          errorMessage: downloadError.message,
          errorDetails: JSON.stringify(downloadError)
        });
        return {
          totalDays: null,
          startDate: null,
          endDate: null,
          error: `Download failed: ${downloadError.message}`
        };
      }

      if (!fileData) {
        console.error('❌ File data is null despite no error:', {
          fileName: file.fileName,
          storagePath: storagePath
        });
        return {
          totalDays: null,
          startDate: null,
          endDate: null,
          error: 'Download returned null data'
        };
      }

      // Detect if this is a discrete sampling file (CROP, CHEM, CHEMSW, CHEMWQ, WQ, EDNA)
      const fileName = file.fileName.toLowerCase();
      const isDiscreteFile = fileName.includes('crop') || fileName.includes('chem') ||
                             fileName.includes('chemsw') || fileName.includes('chemwq') ||
                             fileName.includes('wq') || fileName.includes('edna');

      // Detect if this is a UK logger file that uses DD/MM/YYYY format (GP files)
      const isUKLoggerFile = fileName.includes('_gp_') || fileName.startsWith('gp_');

      // Convert Blob to File object for csvParser
      const fileObject = new File([fileData], file.fileName, { type: 'text/csv' });

      // Use the intelligent csvParser with auto-detection (supports DD/MM/YYYY, MM/DD/YYYY, and YYYY-MM-DD formats)
      // Force DD/MM/YYYY for known UK data files (discrete sampling and GP logger files)
      const { parseCSVFile } = await import('@/components/pin-data/csvParser');
      const dateFormatOverride = (isDiscreteFile || isUKLoggerFile) ? 'DD/MM/YYYY' as const : undefined;

      const parseResult = await parseCSVFile(fileObject, 'GP', dateFormatOverride);

      if (parseResult.errors.length > 0) {
        console.warn('⚠️ CSV parsing warnings:', parseResult.errors);
      }

      if (parseResult.data.length === 0) {
        return {
          totalDays: null,
          startDate: null,
          endDate: null,
          error: 'No valid dates could be parsed'
        };
      }

      // Convert time strings to Date objects
      const dates: Date[] = parseResult.data
        .map(row => {
          try {
            return new Date(row.time);
          } catch {
            return null;
          }
        })
        .filter((d): d is Date => d !== null && !isNaN(d.getTime()));

      // SANITY CHECK: Extract expected date range from filename
      // E.g., "ALGA_CROP_F_L_2503-2506" means March 2025 (2503) to June 2025 (2506)
      // Support both hyphen and underscore separators (e.g., 2503-2506 or 2504_2506)
      const filenameMatch = file.fileName.match(/(\d{2})(\d{2})[-_](\d{2})(\d{2})/);
      if (filenameMatch && (isDiscreteFile || isUKLoggerFile)) {
        const [, startYY, startMM, endYY, endMM] = filenameMatch;
        const expectedStartMonth = parseInt(startMM);
        const expectedEndMonth = parseInt(endMM);
        const expectedStartYear = 2000 + parseInt(startYY);
        const expectedEndYear = 2000 + parseInt(endYY);

        // Validate each parsed date against expected range
        const invalidDates: Date[] = [];
        dates.forEach(date => {
          const dateYear = date.getFullYear();
          const dateMonth = date.getMonth() + 1; // 1-based month

          // Check if date is outside expected range
          const beforeStart = dateYear < expectedStartYear ||
                             (dateYear === expectedStartYear && dateMonth < expectedStartMonth);
          const afterEnd = dateYear > expectedEndYear ||
                          (dateYear === expectedEndYear && dateMonth > expectedEndMonth);

          if (beforeStart || afterEnd) {
            invalidDates.push(date);
          }
        });

        if (invalidDates.length > 0) {
          console.warn(`⚠️ Date format may be incorrect for ${file.fileName}: ${invalidDates.length} dates outside expected range ${expectedStartMonth}/${expectedStartYear}-${expectedEndMonth}/${expectedEndYear}`);
        }
      }

      if (dates.length === 0) {
        return {
          totalDays: null,
          startDate: null,
          endDate: null,
          error: 'No valid dates could be parsed'
        };
      }

      // Sort dates and calculate range
      dates.sort((a, b) => a.getTime() - b.getTime());
      const startDate = dates[0];
      const endDate = dates[dates.length - 1];

      // Format dates in DD/MM/YYYY format for CSV files
      const formatDateForCSV = (date: Date): string => {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = String(date.getFullYear()); // Full 4-digit year
        return `${day}/${month}/${year}`;
      };

      // Use the discrete file detection from earlier (already determined above)
      const isDiscrete = isDiscreteFile;

      // For discrete files, count unique days; for others, calculate continuous range
      let totalDays: number;
      let uniqueDates: string[] | undefined;

      if (isDiscrete) {
        // Get unique dates (date-only, ignoring time)
        const uniqueDateSet = new Set<string>();
        dates.forEach(date => {
          const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
          uniqueDateSet.add(formatDateForCSV(dateOnly));
        });
        uniqueDates = Array.from(uniqueDateSet).sort((a, b) => {
          // Parse dates back for proper sorting
          const [dayA, monthA, yearA] = a.split('/').map(Number);
          const [dayB, monthB, yearB] = b.split('/').map(Number);
          const dateA = new Date(yearA, monthA - 1, dayA);
          const dateB = new Date(yearB, monthB - 1, dayB);
          return dateA.getTime() - dateB.getTime();
        });
        totalDays = uniqueDates.length; // Number of unique sampling days
      } else {
        // Continuous data: calculate range
        totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      }

      const formattedStartDate = formatDateForCSV(startDate);
      const formattedEndDate = formatDateForCSV(endDate);

      // Only log if there seems to be an issue
      if (totalDays > 365 || totalDays < 1) {
        console.warn(`⚠️ Unusual duration for ${file.fileName}: ${totalDays} days (${formattedStartDate} to ${formattedEndDate})`);
      }

      const result = {
        totalDays,
        startDate: formattedStartDate,
        endDate: formattedEndDate,
        uniqueDates,
        isCrop: isDiscrete, // Renamed for compatibility
      };

      return result;

    } catch (error) {
      console.error('❌ CSV analysis error:', {
        fileName: file.fileName,
        error: error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined
      });
      return {
        totalDays: null,
        startDate: null,
        endDate: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }, []);

  // REMOVED: Date parsing self-test - functionality verified and no longer needed

  // Parse various date formats commonly found in CSV files
  // NOTE: Old detectDateFormat() and parseCSVDate() functions removed
  // Now using the intelligent csvParser.ts for consistent date parsing across the app
  // See CLAUDE.md Task 3 for unified date parser strategy

  // Cache for file date analysis to avoid re-analyzing the same files
  // Clear cache on mount to ensure fresh analysis after date parsing fixes
  const [fileDateCache, setFileDateCache] = useState<Record<string, {
    totalDays: number | null;
    startDate: string | null;
    endDate: string | null;
    uniqueDates?: string[];
    isCrop?: boolean;
    error?: string;
  }>>({});

  // REMOVED: Clear the file date cache - now in consolidated effect above (line 830)
  // useEffect(() => {
  //   setFileDateCache({});
  // }, []);

  // Function to get or analyze file date range
  const getFileDateRange = useCallback(async (file: PinFile) => {
    const cacheKey = `${file.id}-${file.fileName}`;
    
    if (fileDateCache[cacheKey]) {
      return fileDateCache[cacheKey];
    }

    const result = await analyzeCSVDateRange(file);
    
    // Cache the result
    setFileDateCache(prev => ({
      ...prev,
      [cacheKey]: result
    }));
    
    return result;
  }, [analyzeCSVDateRange, fileDateCache]);

  // ============================================================================
  // CONSOLIDATED: UI Event Listeners
  // Replaces 2 separate effects: Click Outside Handler, Sidebar Resizing
  // Lines replaced: 2773, 2821
  // ============================================================================
  useEffect(() => {
    // 1. Click outside handler for menus and dropdowns
    const handleClickOutside = (event: MouseEvent) => {
      if (showMainMenu) {
        const target = event.target as Element;
        const menuButton = document.querySelector('[data-menu-button]');
        const menuDropdown = document.querySelector('[data-menu-dropdown]');

        if (menuButton && !menuButton.contains(target) && menuDropdown && !menuDropdown.contains(target)) {
          setShowMainMenu(false);
        }
      }

      // Close data dropdown when clicking outside
      if (showDataDropdown) {
        const target = event.target as Element;
        const dataDropdown = document.querySelector('[data-data-dropdown]');

        if (dataDropdown && !dataDropdown.contains(target)) {
          setShowDataDropdown(false);
        }
      }

      // Close explore dropdown when clicking outside
      if (showExploreDropdown) {
        const target = event.target as Element;
        const exploreDropdown = document.querySelector('[data-explore-dropdown]');

        if (exploreDropdown && !exploreDropdown.contains(target)) {
          setShowExploreDropdown(false);
        }
      }

      // Close marine device modal when clicking outside
      if (showMarineDeviceModal) {
        const target = event.target as Element;
        const modalContent = document.querySelector('[data-marine-modal]');

        if (modalContent && !modalContent.contains(target)) {
          // Let the Dialog component handle backdrop clicks
        }
      }
    };

    // 2. Sidebar resize handlers
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const newWidth = Math.max(280, Math.min(600, e.clientX)); // Min 280px, max 600px
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    // Add click outside listener
    document.addEventListener('mousedown', handleClickOutside);

    // Add resize listeners if resizing is active
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    // Cleanup function
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [showMainMenu, showDataDropdown, showExploreDropdown, isResizing]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  // ============================================================================
  // CONSOLIDATED: Object Editing State
  // Replaces 2 separate effects: Keep itemToEdit in Sync, Initialize Editing State
  // Lines replaced: 2857, 2900
  // ============================================================================
  useEffect(() => {
    // 1. Keep itemToEdit in sync with pins/lines/areas arrays
    // NOTE: itemToEdit intentionally NOT in dependencies to avoid infinite loop
    if (itemToEdit) {
      // Check if it's a pin
      if ('lat' in itemToEdit && 'lng' in itemToEdit) {
        const updatedPin = pins.find(p => p.id === itemToEdit.id);
        if (updatedPin) {
          // Only update if the data has actually changed (comparing relevant fields)
          if (updatedPin.label !== itemToEdit.label ||
              updatedPin.notes !== itemToEdit.notes ||
              updatedPin.lat !== itemToEdit.lat ||
              updatedPin.lng !== itemToEdit.lng ||
              updatedPin.labelVisible !== itemToEdit.labelVisible) {
            console.log('Updating itemToEdit with updated pin data:', updatedPin);
            setItemToEdit(updatedPin);
          }
        }
      }
      // Check if it's a line
      else if ('path' in itemToEdit && !('fillVisible' in itemToEdit)) {
        const updatedLine = lines.find(l => l.id === itemToEdit.id);
        if (updatedLine) {
          if (updatedLine.label !== itemToEdit.label ||
              updatedLine.notes !== itemToEdit.notes) {
            console.log('Updating itemToEdit with updated line data:', updatedLine);
            setItemToEdit(updatedLine);
          }
        }
      }
      // Check if it's an area
      else if ('path' in itemToEdit && 'fillVisible' in itemToEdit) {
        const updatedArea = areas.find(a => a.id === itemToEdit.id);
        if (updatedArea) {
          if (updatedArea.label !== itemToEdit.label ||
              updatedArea.notes !== itemToEdit.notes) {
            console.log('Updating itemToEdit with updated area data:', updatedArea);
            setItemToEdit(updatedArea);
          }
        }
      }
    }

    // 2. Initialize editing state when itemToEdit changes and edit mode is active
    if (itemToEdit && isEditingObject) {
      setEditingLabel(itemToEdit.label || '');
      setEditingNotes(itemToEdit.notes || '');
      setEditingProjectId(itemToEdit.projectId || null);
      // Initialize coordinates and colors based on object type
      if ('lat' in itemToEdit && 'lng' in itemToEdit) {
        console.log('Initializing coordinates:', itemToEdit.lat, itemToEdit.lng, 'format:', coordinateFormat);

        const formats = getCoordinateFormats(itemToEdit.lat);
        const lngFormats = getCoordinateFormats(itemToEdit.lng);

        console.log('Generated formats:', formats, lngFormats);

        // Set coordinates based on current format
        switch (coordinateFormat) {
          case 'degreeMinutes':
            setEditingLat(formats.degreeMinutes);
            setEditingLng(lngFormats.degreeMinutes);
            break;
          case 'degreeMinutesSeconds':
            setEditingLat(formats.degreeMinutesSeconds);
            setEditingLng(lngFormats.degreeMinutesSeconds);
            break;
          default:
            setEditingLat(itemToEdit.lat.toString());
            setEditingLng(itemToEdit.lng.toString());
            break;
        }
        setEditingColor(itemToEdit.color || '#3b82f6'); // Use stored color or blue for pins
      } else if ('path' in itemToEdit && Array.isArray(itemToEdit.path)) {
        if ('fillVisible' in itemToEdit) {
          // This is an area - initialize area-specific state
          setEditingColor(itemToEdit.color || '#3b82f6'); // Use stored color or blue for areas
          setEditingTransparency(itemToEdit.transparency || 20); // Use stored transparency or default

          // Initialize area coordinates for editing
          const areaCoords = itemToEdit.path.map(point => {
            const latFormats = getCoordinateFormats(point.lat);
            const lngFormats = getCoordinateFormats(point.lng);

            switch (coordinateFormat) {
              case 'degreeMinutes':
                return [latFormats.degreeMinutes, lngFormats.degreeMinutes];
              case 'degreeMinutesSeconds':
                return [latFormats.degreeMinutesSeconds, lngFormats.degreeMinutesSeconds];
              default:
                return [point.lat.toString(), point.lng.toString()];
            }
          });
          setEditingAreaCoords(areaCoords);
        } else {
          setEditingColor(itemToEdit.color || '#10b981'); // Use stored color or green for lines
        }
      }
      setEditingSize(itemToEdit.size || 2); // Use stored size or default to thinner

      // Auto-expand notes if there are existing notes
      setShowNotesSection(Boolean(itemToEdit.notes && itemToEdit.notes.trim()));

      // Focus the label input field after a brief delay
      setTimeout(() => {
        if (labelInputRef.current) {
          labelInputRef.current.focus();
          labelInputRef.current.select(); // Select all text for easy editing
        }
      }, 100);
    }
  }, [pins, lines, areas, itemToEdit, isEditingObject, coordinateFormat]);

  // REMOVED: Initialize editing state - now in consolidated effect above (line 2793)
  // useEffect(() => {
  //   if (itemToEdit && isEditingObject) {
  //     setEditingLabel(itemToEdit.label || '');
  //     setEditingNotes(itemToEdit.notes || '');
  //     setEditingProjectId(itemToEdit.projectId || null);
  //     ...
  //   }
  // }, [itemToEdit, isEditingObject, coordinateFormat]);

  // REMOVED: Keep itemToEdit in sync - now in consolidated effect above (line 2783)
  // useEffect(() => {
  //   if (itemToEdit) {
  //     // Check if it's a pin
  //     if ('lat' in itemToEdit && 'lng' in itemToEdit) {
  //       const updatedPin = pins.find(p => p.id === itemToEdit.id);
  //       ...
  //     }
  //     ...
  //   }
  // }, [pins, lines, areas]);

  // Handle coordinate format change
  const handleCoordinateFormatChange = (newFormat: CoordinateFormat) => {
    console.log('Format change requested:', newFormat, 'current values:', editingLat, editingLng);
    
    if (itemToEdit && 'lat' in itemToEdit) {
      // Convert current coordinates to new format
      const currentLat = parseCoordinateInput(editingLat);
      const currentLng = parseCoordinateInput(editingLng);
      
      console.log('Parsed current coordinates:', currentLat, currentLng);
      
      if (currentLat !== null && currentLng !== null) {
        const latFormats = getCoordinateFormats(currentLat);
        const lngFormats = getCoordinateFormats(currentLng);
        
        console.log('Generated new formats:', latFormats, lngFormats);
        
        switch (newFormat) {
          case 'degreeMinutes':
            setEditingLat(latFormats.degreeMinutes);
            setEditingLng(lngFormats.degreeMinutes);
            break;
          case 'degreeMinutesSeconds':
            setEditingLat(latFormats.degreeMinutesSeconds);
            setEditingLng(lngFormats.degreeMinutesSeconds);
            break;
          default:
            setEditingLat(currentLat.toString());
            setEditingLng(currentLng.toString());
            break;
        }
      } else {
        console.log('Failed to parse coordinates, falling back to original values');
        // Fall back to using the original coordinates from itemToEdit
        const latFormats = getCoordinateFormats(itemToEdit.lat);
        const lngFormats = getCoordinateFormats(itemToEdit.lng);
        
        switch (newFormat) {
          case 'degreeMinutes':
            setEditingLat(latFormats.degreeMinutes);
            setEditingLng(lngFormats.degreeMinutes);
            break;
          case 'degreeMinutesSeconds':
            setEditingLat(latFormats.degreeMinutesSeconds);
            setEditingLng(lngFormats.degreeMinutesSeconds);
            break;
          default:
            setEditingLat(itemToEdit.lat.toString());
            setEditingLng(itemToEdit.lng.toString());
            break;
        }
      }
    }
    setCoordinateFormat(newFormat);
  };

  const handleStartEdit = () => {
    if (itemToEdit) {
      console.log('DEBUG: handleStartEdit - itemToEdit:', itemToEdit);
      setIsEditingObject(true);
      setEditingLabel(itemToEdit.label || '');
      setEditingNotes(itemToEdit.notes || '');
      setEditingProjectId(itemToEdit.projectId || null);
      // Set current coordinates and colors based on object type
      if ('lat' in itemToEdit && 'lng' in itemToEdit) {
        console.log('DEBUG: handleStartEdit - Setting coordinates from itemToEdit - lat:', itemToEdit.lat, 'lng:', itemToEdit.lng);
        setEditingLat(itemToEdit.lat.toString());
        setEditingLng(itemToEdit.lng.toString());
        console.log('DEBUG: handleStartEdit - Coordinate format is:', coordinateFormat);
        setEditingColor('#3b82f6');
      } else if ('path' in itemToEdit && Array.isArray(itemToEdit.path)) {
        if ('fillVisible' in itemToEdit) {
          setEditingColor('#ef4444');
        } else {
          setEditingColor('#10b981');
        }
      }
      setEditingSize(6);
    }
  };

  const handleSaveEdit = () => {
    if (itemToEdit) {
      // Validate coordinates for pins
      if ('lat' in itemToEdit) {
        console.log('DEBUG: Saving coordinates - editingLat:', editingLat, 'editingLng:', editingLng);
        const lat = parseCoordinateInput(editingLat);
        const lng = parseCoordinateInput(editingLng);
        console.log('DEBUG: Parsed coordinates - lat:', lat, 'lng:', lng);
        
        // Validate coordinate values
        if (lat === null || lng === null) {
          toast({
            variant: "destructive",
            title: "Invalid Coordinates",
            description: "Please enter valid coordinates in the selected format."
          });
          return;
        }
        
        if (!validateCoordinate(lat, 'latitude')) {
          toast({
            variant: "destructive", 
            title: "Invalid Latitude",
            description: "Latitude must be between -90 and 90 degrees."
          });
          return;
        }
        
        if (!validateCoordinate(lng, 'longitude')) {
          toast({
            variant: "destructive",
            title: "Invalid Longitude", 
            description: "Longitude must be between -180 and 180 degrees."
          });
          return;
        }

        const updatedObject = {
          ...itemToEdit,
          lat,
          lng,
          label: editingLabel.trim() || undefined,
          notes: editingNotes.trim() || undefined,
          color: editingColor,
          size: editingSize,
          projectId: editingProjectId || undefined
        };

        console.log('DEBUG: Original itemToEdit:', itemToEdit);
        console.log('DEBUG: updatedObject before save:', updatedObject);
        console.log('DEBUG: Coordinates in updatedObject - lat:', updatedObject.lat, 'lng:', updatedObject.lng);
        
        updatePinData(itemToEdit.id, updatedObject);
        
        toast({
          title: "Pin Updated",
          description: `Coordinates updated to ${lat.toFixed(6)}, ${lng.toFixed(6)}`
        });
        
      } else {
        // For lines and areas, handle coordinate editing and updates
        const updatedObject = {
          ...itemToEdit,
          label: editingLabel.trim() || undefined,
          notes: editingNotes.trim() || undefined,
          color: editingColor,
          size: editingSize,
          projectId: editingProjectId || undefined
        };

        // Handle area coordinate editing
        if ('path' in itemToEdit && Array.isArray(itemToEdit.path) && 'fillVisible' in itemToEdit) {
          // This is an area - add coordinate editing support
          if (editingAreaCoords.length > 0) {
            // Parse coordinate strings and update path
            const newPath = editingAreaCoords.map(coordPair => {
              const lat = parseCoordinateInput(coordPair[0]);
              const lng = parseCoordinateInput(coordPair[1]);
              return { lat: lat || 0, lng: lng || 0 };
            }).filter(coord => coord.lat !== 0 || coord.lng !== 0);
            
            if (newPath.length >= 3) {
              updatedObject.path = newPath;
            }
          }
          
          // Add transparency support for areas
          updatedObject.transparency = editingTransparency;
          
          updateAreaData(itemToEdit.id, updatedObject);
        } else if ('path' in itemToEdit && Array.isArray(itemToEdit.path)) {
          // This is a line - no coordinate editing for now
          updateLineData(itemToEdit.id, updatedObject);
        }
      }

      setIsEditingObject(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditingObject(false);
    setEditingLabel('');
    setEditingNotes('');
    setEditingColor('#3b82f6');
    setEditingSize(2); // Updated default to thinner
    setEditingAreaCoords([]); // Clear area coordinates
    setEditingTransparency(20); // Reset transparency
    setEditingProjectId(null); // Reset project assignment
    // Reset area corner dragging state
    setIsAreaCornerDragging(false);
    setTempAreaPath(null);
  };

  // Line Edit Mode Handlers
  const handleLinePointDrag = (pointIndex: number, newPosition: LatLng) => {
    if (!tempLinePath) return;

    setTempLinePath(prevPath => {
      if (!prevPath) return prevPath;
      const updatedPath = [...prevPath];
      updatedPath[pointIndex] = {
        lat: newPosition.lat,
        lng: newPosition.lng
      };
      return updatedPath;
    });
  };

  const handleLineEditComplete = async () => {
    if (!editingLineId || !tempLinePath) return;

    try {
      // Update the line with new path
      const updateData = { path: tempLinePath };

      await updateLineData(editingLineId, updateData);

      // Note: updateLineData handles the state update internally via useMapData hook
      // No need to manually update local state

      // Reset edit mode
      setLineEditMode('none');
      setEditingLineId(null);
      setTempLinePath(null);

      toast({
        title: 'Line location updated',
        description: 'The line position has been saved.'
      });
    } catch (error) {
      console.error('💾 Error saving line:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to update line',
        description: 'Could not save the line location.'
      });
    }
  };

  const handleLineEditCancel = () => {
    setLineEditMode('none');
    setEditingLineId(null);
    setTempLinePath(null);
  };

  // Move pin to current map center (crosshair position)
  const handleMovePinToCenter = async () => {
    if (itemToEdit && 'lat' in itemToEdit && mapRef.current) {
      const mapCenter = mapRef.current.getCenter();

      // Update the editing coordinates to the map center
      setEditingLat(mapCenter.lat.toString());
      setEditingLng(mapCenter.lng.toString());

      // Immediately update the pin in the database/state
      const updatedObject = {
        ...itemToEdit,
        lat: mapCenter.lat,
        lng: mapCenter.lng,
      };

      try {
        await updatePinData(itemToEdit.id, updatedObject);
      } catch (error) {
        console.error('Pin update failed:', error);
        toast({
          variant: "destructive",
          title: "Error Moving Pin",
          description: "Failed to move pin. Check console for details."
        });
        return;
      }
      
      toast({
        title: "Pin Moved",
        description: `Pin moved to map center: ${mapCenter.lat.toFixed(6)}, ${mapCenter.lng.toFixed(6)}`
      });
    }
  };

  // Duplicate object at crosshair position
  const handleDuplicateObject = async () => {
    if (!itemToEdit || !mapRef.current) return;

    const mapCenter = mapRef.current.getCenter();

    try {
      // Handle Pin duplication
      if ('lat' in itemToEdit && 'lng' in itemToEdit) {
        const newPin = {
          lat: mapCenter.lat,
          lng: mapCenter.lng,
          label: itemToEdit.label ? `${itemToEdit.label} (Copy)` : undefined,
          notes: itemToEdit.notes,
          color: itemToEdit.color,
          size: itemToEdit.size,
          projectId: itemToEdit.projectId,
          labelVisible: itemToEdit.labelVisible
        };

        await createPinData(newPin);

        toast({
          title: "Pin Duplicated",
          description: `Pin duplicated at crosshairs: ${mapCenter.lat.toFixed(6)}, ${mapCenter.lng.toFixed(6)}`
        });
      }
      // Handle Line duplication
      else if ('path' in itemToEdit && Array.isArray(itemToEdit.path) && !('fillVisible' in itemToEdit)) {
        // Calculate offset to place the duplicate at the crosshairs
        const originalCenter = {
          lat: itemToEdit.path.reduce((sum, p) => sum + p.lat, 0) / itemToEdit.path.length,
          lng: itemToEdit.path.reduce((sum, p) => sum + p.lng, 0) / itemToEdit.path.length
        };

        const offset = {
          lat: mapCenter.lat - originalCenter.lat,
          lng: mapCenter.lng - originalCenter.lng
        };

        const newPath = itemToEdit.path.map(point => ({
          lat: point.lat + offset.lat,
          lng: point.lng + offset.lng
        }));

        const newLine = {
          path: newPath,
          label: itemToEdit.label ? `${itemToEdit.label} (Copy)` : undefined,
          notes: itemToEdit.notes,
          color: itemToEdit.color,
          size: itemToEdit.size,
          projectId: itemToEdit.projectId,
          labelVisible: itemToEdit.labelVisible
        };

        await createLineData(newLine);

        toast({
          title: "Line Duplicated",
          description: `Line duplicated at crosshairs`
        });
      }
      // Handle Area duplication
      else if ('path' in itemToEdit && Array.isArray(itemToEdit.path) && 'fillVisible' in itemToEdit) {
        // Calculate offset to place the duplicate at the crosshairs
        const originalCenter = {
          lat: itemToEdit.path.reduce((sum, p) => sum + p.lat, 0) / itemToEdit.path.length,
          lng: itemToEdit.path.reduce((sum, p) => sum + p.lng, 0) / itemToEdit.path.length
        };

        const offset = {
          lat: mapCenter.lat - originalCenter.lat,
          lng: mapCenter.lng - originalCenter.lng
        };

        const newPath = itemToEdit.path.map(point => ({
          lat: point.lat + offset.lat,
          lng: point.lng + offset.lng
        }));

        const newArea = {
          path: newPath,
          label: itemToEdit.label ? `${itemToEdit.label} (Copy)` : undefined,
          notes: itemToEdit.notes,
          color: itemToEdit.color,
          size: itemToEdit.size,
          transparency: itemToEdit.transparency,
          fillVisible: itemToEdit.fillVisible,
          projectId: itemToEdit.projectId,
          labelVisible: itemToEdit.labelVisible
        };

        await createAreaData(newArea);

        toast({
          title: "Area Duplicated",
          description: `Area duplicated at crosshairs`
        });
      }
    } catch (error) {
      console.error('Error duplicating object:', error);
      toast({
        variant: "destructive",
        title: "Error Duplicating",
        description: "Failed to duplicate object. Check console for details."
      });
    }
  };

  // Handle area corner drag
  const handleAreaCornerDrag = (cornerIndex: number, newPosition: LatLng) => {
    if (tempAreaPath && itemToEdit && 'path' in itemToEdit) {
      const newPath = [...tempAreaPath];
      newPath[cornerIndex] = { lat: newPosition.lat, lng: newPosition.lng };
      setTempAreaPath(newPath);

      // Update coordinate inputs in real-time
      const newCoords = [...editingAreaCoords];
      const latFormats = getCoordinateFormats(newPosition.lat);
      const lngFormats = getCoordinateFormats(newPosition.lng);
      newCoords[cornerIndex] = [
        latFormats[coordinateFormat],
        lngFormats[coordinateFormat]
      ];
      setEditingAreaCoords(newCoords);
    }
  };

  // Save area corner edits
  const handleSaveAreaCornerEdit = async () => {
    console.log('🔥🔥🔥 AREA CORNER SAVE - NEW CODE LOADED 🔥🔥🔥');
    if (tempAreaPath && itemToEdit && 'path' in itemToEdit) {
      try {
        console.log('[SAVE AREA CORNERS] Saving with data:', {
          id: itemToEdit.id,
          path: tempAreaPath,
          pathLength: tempAreaPath.length
        });

        // Only update the path - don't send other fields that might cause issues
        await updateAreaData(itemToEdit.id, {
          path: tempAreaPath
        });

        setIsAreaCornerDragging(false);
        setTempAreaPath(null);

        toast({
          title: "Area Updated",
          description: `Area corners updated successfully`
        });
      } catch (error) {
        console.error('[SAVE AREA CORNERS] Error updating area:', error);
        console.error('[SAVE AREA CORNERS] Error details:', JSON.stringify(error, null, 2));
        toast({
          variant: "destructive",
          title: "Error Updating Area",
          description: error instanceof Error ? error.message : "Failed to update area corners"
        });
      }
    }
  };

  // Cancel area corner edits
  const handleCancelAreaCornerEdit = () => {
    if (itemToEdit && 'path' in itemToEdit) {
      setTempAreaPath(null);
      setIsAreaCornerDragging(false);

      // Revert editingAreaCoords to original
      const originalCoords = itemToEdit.path.map(point => {
        const latFormats = getCoordinateFormats(point.lat);
        const lngFormats = getCoordinateFormats(point.lng);
        return [latFormats[coordinateFormat], lngFormats[coordinateFormat]];
      });
      setEditingAreaCoords(originalCoords);
    }
  };

  // Handle sharing pin privacy settings
  const handleUpdatePrivacy = async () => {
    if (!itemToEdit || !('lat' in itemToEdit)) return;

    setIsUpdatingPrivacy(true);
    try {
      const sharedEmails = sharePrivacyLevel === 'specific' && shareEmails 
        ? shareEmails.split(',').map(email => email.trim()).filter(email => email.length > 0)
        : [];
      
      // Update pin privacy in database
      await mapDataService.updatePinPrivacy(itemToEdit.id, sharePrivacyLevel, sharedEmails);
      
      // Update local state
      const updatedPin = { ...itemToEdit, privacyLevel: sharePrivacyLevel };
      setItemToEdit(updatedPin);
      
      // Update the pins array
      setPins(prevPins => 
        prevPins.map(pin => 
          pin.id === itemToEdit.id 
            ? { ...pin, privacyLevel: sharePrivacyLevel }
            : pin
        )
      );
      
      toast({
        title: "Privacy Updated",
        description: `Pin privacy set to ${sharePrivacyLevel}${sharePrivacyLevel === 'specific' && sharedEmails.length > 0 ? ` and shared with: ${sharedEmails.join(', ')}` : ''}`
      });
      
      setShowSharePopover(false);
      setShareEmails('');
    } catch (error) {
      console.error('Error updating privacy:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update privacy settings"
      });
    } finally {
      setIsUpdatingPrivacy(false);
    }
  };

  // Initialize sharing state when item is selected
  const handleOpenShare = () => {
    if (itemToEdit && 'lat' in itemToEdit) {
      setSelectedPinForShare({
        id: itemToEdit.id,
        label: itemToEdit.label || 'Unnamed Pin'
      });
      setShowShareDialog(true);
    }
  };

  // Handle fetching pin meteo data (copied from data explorer)
  const handleFetchPinMeteoData = useCallback(async () => {
    if (!itemToEdit || !('lat' in itemToEdit)) {
      toast({ variant: "destructive", title: "No Pin Selected", description: "Please select a pin first." });
      return;
    }
    
    if (!pinMeteoDateRange?.from || !pinMeteoDateRange?.to) {
      toast({ variant: "destructive", title: "Missing Date Range", description: "Please select a date range." });
      return;
    }
    
    const selectedParams = ALL_PARAMETERS;

    const locationName = itemToEdit.label || `Pin at ${itemToEdit.lat.toFixed(3)}, ${itemToEdit.lng.toFixed(3)}`;
    
    setIsLoadingPinMeteoData(true);
    setErrorPinMeteoData(null);
    setPinMeteoData(null);
    setPinMeteoLocationContext(null);
    setPinMeteoFetchLogSteps([{ message: `Fetching ${selectedParams.length} parameter(s) for ${locationName}...`, status: 'pending' }]);

    const loadingToastId = toast({ 
      title: "Fetching Meteo Data", 
      description: `Fetching data for ${locationName}...` 
    }).id;

    try {
      const result = await fetchCombinedDataAction({
        latitude: itemToEdit.lat,
        longitude: itemToEdit.lng,
        startDate: formatISO(pinMeteoDateRange.from, { representation: 'date' }),
        endDate: formatISO(pinMeteoDateRange.to, { representation: 'date' }),
        parameters: selectedParams
      });

      if (loadingToastId) dismiss(loadingToastId);
      setPinMeteoFetchLogSteps(result.log || []);

      if (result.success && result.data) {
        setPinMeteoData(result.data);
        setPinMeteoLocationContext(locationName);
        
        if (result.data.length === 0 && !result.error) {
          toast({ variant: "default", title: "No Meteo Data", description: "No data points found for the selected criteria.", duration: 4000 });
        } else if (result.data.length > 0) {
          const successToast = toast({ title: "Meteo Data Loaded", description: `Loaded ${result.data.length} data points for ${locationName}.` });
          setTimeout(() => {
            successToast.dismiss();
          }, 3000);
        } else { 
          setErrorPinMeteoData(result.error || "Failed to load meteo data.");
          toast({ variant: "destructive", title: "Error Loading Meteo Data", description: result.error || "Failed to load meteo data." });
        }
      } else {
        setErrorPinMeteoData(result.error || "Failed to load meteo data.");
        toast({ variant: "destructive", title: "Error Loading Meteo Data", description: result.error || "Failed to load meteo data." });
      }
    } catch (e) {
      if (loadingToastId) dismiss(loadingToastId);
      const errorMsg = e instanceof Error ? e.message : "An unknown error occurred during meteo data fetch.";
      setErrorPinMeteoData(errorMsg);
      setPinMeteoFetchLogSteps(prev => [...prev, { message: `Critical error in meteo fetch operation: ${errorMsg}`, status: 'error' }]);
      toast({ variant: "destructive", title: "Critical Meteo Fetch Error", description: errorMsg });
    } finally {
      setIsLoadingPinMeteoData(false);
    }
  }, [itemToEdit, pinMeteoDateRange, pinMeteoPlotVisibility, toast, dismiss]);

  // Handle meteo plot visibility changes
  const handlePinMeteoPlotVisibilityChange = useCallback((key: CombinedParameterKey, checked: boolean) => {
    setPinMeteoPlotVisibility(prev => ({
      ...prev,
      [key]: checked
    }));
  }, []);

  // Pin Meteo Grid: Handle brush change
  const handlePinMeteoBrushChange = useCallback((newIndex: { startIndex?: number; endIndex?: number }) => {
    setPinMeteoBrushStartIndex(newIndex.startIndex);
    setPinMeteoBrushEndIndex(newIndex.endIndex);
  }, []);

  // Pin Meteo Grid: Handle plot reordering
  const handlePinMeteoMovePlot = useCallback((index: number, direction: 'up' | 'down') => {
    setPinMeteoPlotConfigsInternal(prevConfigs => {
      const newConfigs = [...prevConfigs];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;

      if (targetIndex >= 0 && targetIndex < newConfigs.length) {
        [newConfigs[index], newConfigs[targetIndex]] = [newConfigs[targetIndex], newConfigs[index]];
      }
      return newConfigs;
    });
  }, []);

  // Pin Meteo Grid: Calculate display data based on brush range
  const pinMeteoDisplayData = React.useMemo(() => {
    if (!pinMeteoData || pinMeteoData.length === 0 || pinMeteoBrushStartIndex === undefined || pinMeteoBrushEndIndex === undefined) {
      return [];
    }
    const start = Math.max(0, pinMeteoBrushStartIndex);
    const end = Math.min(pinMeteoData.length - 1, pinMeteoBrushEndIndex);
    const slicedData = pinMeteoData.slice(start, end + 1);
    return slicedData;
  }, [pinMeteoData, pinMeteoBrushStartIndex, pinMeteoBrushEndIndex]);

  // Pin Meteo Grid: Calculate daily reference lines
  const pinMeteoDailyReferenceLines = React.useMemo(() => {
    if (!pinMeteoData || pinMeteoData.length === 0) return [];
    const dailyTimestamps = new Set<string>();

    pinMeteoData.forEach(point => {
      try {
        const date = parseISO(point.time);
        if (isValid(date)) {
          // Get the ISO string for the start of the day
          const dayStartISO = startOfDay(date).toISOString();
          dailyTimestamps.add(dayStartISO);
        }
      } catch (e) {
        // ignore invalid time format
      }
    });

    // The reference lines need to match exact timestamps in the data.
    // We find the first timestamp for each day.
    return Array.from(dailyTimestamps).map(dayStartISO => {
      return pinMeteoData.find(p => p.time.startsWith(dayStartISO.substring(0, 10)))?.time;
    }).filter((t): t is string => !!t);
  }, [pinMeteoData]);

  // Helper function to categorize files by type
  const categorizeFiles = (files: File[]) => {
    const categories = {
      GP: [] as File[],
      FPOD: [] as File[],
      Subcam: [] as File[]
    };

    files.forEach(file => {
      const fileName = file.name.toLowerCase();
      const parts = fileName.split('_');
      const position0 = parts[0]?.toLowerCase() || '';
      const position1 = parts[1]?.toLowerCase() || '';

      console.log(`[CATEGORIZE FILES] ${file.name} → detected in positions (pos0: ${position0}, pos1: ${position1})`);

      if (position0.includes('gp') || position1.includes('gp')) {
        categories.GP.push(file);
      } else if (position0.includes('fpod') || position1.includes('fpod')) {
        categories.FPOD.push(file);
      } else if (position0.includes('subcam') || position1.includes('subcam')) {
        categories.Subcam.push(file);
      }
    });

    return categories;
  };

  // Get or create "Area-wide Data" pin for project-level files (e.g., CHEMWQ with _ALL_ station)
  const getOrCreateAreawidePin = async (projectId: string): Promise<string | null> => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        console.error('User not authenticated');
        return null;
      }

      // Check if area-wide pin already exists
      const areawidePinLabel = '📊 Area-wide Data';
      const existingPin = pins.find(pin =>
        pin.projectId === projectId && pin.label === areawidePinLabel
      );

      if (existingPin) {
        console.log('✅ Using existing area-wide pin:', existingPin.id);
        return existingPin.id;
      }

      // Create new area-wide pin
      console.log('📌 Creating area-wide pin for project:', projectId);
      const { data: newPin, error } = await supabase
        .from('pins')
        .insert({
          user_id: user.id,
          project_id: projectId,
          label: areawidePinLabel,
          lat: 0,  // No specific location
          lng: 0,
          color: '#8b5cf6',  // Purple color to distinguish from location pins
        })
        .select()
        .single();

      if (error || !newPin) {
        console.error('❌ Failed to create area-wide pin:', {
          error,
          errorMessage: error?.message,
          errorCode: error?.code,
          errorDetails: error?.details,
          errorHint: error?.hint,
          projectId,
          userId: user.id
        });
        toast({
          variant: "destructive",
          title: "Failed to create area-wide pin",
          description: error?.message || 'Unknown error'
        });
        return null;
      }

      console.log('✅ Created area-wide pin:', newPin.id);

      // Add to pins state
      setPins(prev => [...prev, {
        id: newPin.id,
        lat: 0,
        lon: 0,
        label: areawidePinLabel,
        color: '#8b5cf6',
        projectId: projectId,
      }]);

      return newPin.id;
    } catch (error) {
      console.error('Error in getOrCreateAreawidePin:', error);
      return null;
    }
  };

  // Initiate file upload - select files first, then show pin selector
  const handleInitiateFileUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.multiple = true;
    input.setAttribute('data-testid', 'file-upload-input');

    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      const csvFiles = files.filter(file => file.name.toLowerCase().endsWith('.csv'));

      if (csvFiles.length !== files.length) {
        toast({
          variant: "destructive",
          title: "Invalid File Type",
          description: "Please select only CSV files."
        });
        return;
      }

      if (csvFiles.length > 0) {
        setPendingUploadFiles(csvFiles);

        // Auto-detect _ALL_ files (files not assigned to specific pin)
        const hasAllFiles = csvFiles.some(file => {
          const parts = file.name.split('_');
          const position2 = parts[2]?.toUpperCase() || '';
          return position2 === 'ALL';
        });

        // For _ALL_ files, auto-create/use area-wide pin
        if (hasAllFiles && activeProjectId) {
          console.log('🌐 Detected _ALL_ file(s) - auto-selecting area-wide pin');
          const areawidePin = await getOrCreateAreawidePin(activeProjectId);
          if (areawidePin) {
            setSelectedUploadPinId(areawidePin);
            toast({
              title: "Area-wide File Detected",
              description: "File will be uploaded to '📊 Area-wide Data' pin",
            });
          }
        }

        setShowUploadPinSelector(true);
      }
    };

    input.click();
  };

  // Handle date confirmation for files without time columns
  const handleDateConfirm = async (date: string) => {
    try {
      // Batch mode: Add date to all files that need it
      if (isBatchDateMode && filesWithoutDates.length > 0 && batchDateContext) {
        console.log('[DATE-INPUT] Batch mode: User confirmed date:', date, 'for', filesWithoutDates.length, 'files');

        // Create modified versions of all files that need dates
        const modifiedFilesPromises = filesWithoutDates.map(file =>
          createFileWithDateColumn(file, date)
        );
        const modifiedFiles = await Promise.all(modifiedFilesPromises);

        console.log('[DATE-INPUT] Modified', modifiedFiles.length, 'files with date column');

        // Create a map for quick lookup
        const modifiedFilesMap = new Map<string, File>();
        modifiedFiles.forEach(modifiedFile => {
          // Find the original file name (remove any potential modifications)
          const originalFile = filesWithoutDates.find(f => f.name === modifiedFile.name.replace('_with_date', ''));
          if (originalFile) {
            modifiedFilesMap.set(originalFile.name, modifiedFile);
          }
        });

        // Replace all files that were modified in pendingUploadFiles
        const updatedFiles = pendingUploadFiles.map(f => {
          const modified = modifiedFilesMap.get(f.name);
          return modified || f;
        });

        // Close dialog and reset batch state
        setShowDateInputDialog(false);
        setIsBatchDateMode(false);
        const contextToProcess = batchDateContext;
        setFilesWithoutDates([]);
        setBatchDateContext(null);

        // Continue with upload
        console.log('[DATE-INPUT] Continuing batch upload with', updatedFiles.length, 'files');
        await handleFileUpload(contextToProcess.targetId, contextToProcess.targetType, updatedFiles, true);
      }
      // Single file mode: Add date to one file
      else if (pendingDateFile) {
        console.log('[DATE-INPUT] Single mode: User confirmed date:', date, 'for file:', pendingDateFile.file.name);

        // Inject date into file
        const modifiedFile = await createFileWithDateColumn(pendingDateFile.file, date);

        console.log('[DATE-INPUT] Modified file created:', modifiedFile.name, 'Size:', modifiedFile.size);

        // Replace the file in pendingUploadFiles
        const updatedFiles = pendingUploadFiles.map(f =>
          f.name === pendingDateFile.file.name ? modifiedFile : f
        );

        // Close dialog
        setShowDateInputDialog(false);
        const fileToProcess = pendingDateFile;
        setPendingDateFile(null);

        // Check if there are more files waiting for dates (different dates mode)
        if (filesWithoutDates.length > 0 && batchDateContext) {
          console.log('[DATE-INPUT] More files need dates, showing dialog for next file');
          // Update pendingUploadFiles to include the modified file
          setPendingUploadFiles(updatedFiles);

          // Show dialog for next file
          setPendingDateFile({
            file: filesWithoutDates[0],
            targetId: batchDateContext.targetId,
            targetType: batchDateContext.targetType
          });
          setFilesWithoutDates(filesWithoutDates.slice(1));
          setShowDateInputDialog(true);
          return; // Don't upload yet, still more files to process
        }

        // No more files need dates, continue with upload
        console.log('[DATE-INPUT] Continuing upload with modified file(s)');
        await handleFileUpload(fileToProcess.targetId, fileToProcess.targetType, updatedFiles, true);

        // Clear batch context if it was set
        setBatchDateContext(null);
      }
    } catch (error) {
      console.error('[DATE-INPUT] Error processing date input:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to add date column to file(s)'
      });
      setShowDateInputDialog(false);
      setPendingDateFile(null);
      setIsBatchDateMode(false);
      setFilesWithoutDates([]);
      setBatchDateContext(null);
    }
  };

  // Handle batch date confirmation - all files from same date
  const handleBatchSameDate = () => {
    console.log('[BATCH-DATE] User confirmed all files are from same date');
    setShowBatchDateConfirm(false);
    setIsBatchDateMode(true);

    // Show date input dialog in batch mode
    // Use first file name as representative
    const firstFileName = filesWithoutDates[0]?.name || '';
    setPendingDateFile(filesWithoutDates[0] ? {
      file: filesWithoutDates[0],
      targetId: batchDateContext?.targetId || '',
      targetType: batchDateContext?.targetType || 'pin'
    } : null);
    setShowDateInputDialog(true);
  };

  // Handle batch date confirmation - files from different dates
  const handleBatchDifferentDates = async () => {
    console.log('[BATCH-DATE] User wants to add dates individually for', filesWithoutDates.length, 'files');
    setShowBatchDateConfirm(false);

    if (filesWithoutDates.length > 0 && batchDateContext) {
      // Show date input dialog for the first file
      setPendingDateFile({
        file: filesWithoutDates[0],
        targetId: batchDateContext.targetId,
        targetType: batchDateContext.targetType
      });

      // Remove the first file from the list and keep the rest for later
      setFilesWithoutDates(filesWithoutDates.slice(1));
      setShowDateInputDialog(true);
    }
  };

  // Handle cancelling batch date upload
  const handleBatchDateCancel = () => {
    console.log('[BATCH-DATE] User cancelled batch upload');
    setShowBatchDateConfirm(false);
    setFilesWithoutDates([]);
    setBatchDateContext(null);
    setPendingUploadFiles([]);
    setSelectedUploadPinId('');
    setSelectedUploadAreaId('');
  };

  // Handle file upload for pins or areas - now receives target (pin or area) and files
  const handleFileUpload = async (targetId: string, targetType: 'pin' | 'area' = 'pin', filesToUpload?: File[], skipDuplicateCheck: boolean = false) => {
    const csvFiles = filesToUpload || pendingUploadFiles;

    if (csvFiles.length === 0) {
      return;
    }

    // First check if user is authenticated
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('Authentication check failed:', authError);
      toast({
        variant: "destructive",
        title: "Authentication Required",
        description: "Please log in to upload files."
      });
      return;
    }

    console.log('User authenticated for upload:', user.id);

    // Check for duplicate file names (unless we're replacing)
    if (!skipDuplicateCheck) {
      console.log('🔍 Checking for duplicate files...');

      // Fetch existing files from database to ensure we have latest data
      const existingFiles = targetType === 'pin'
        ? await fileStorageService.getPinFiles(targetId)
        : await fileStorageService.getAreaFiles(targetId);
      console.log(`📂 Found ${existingFiles.length} existing files for ${targetType} ${targetId}`);

      const duplicates: {fileName: string, existingFile: PinFile}[] = [];

      csvFiles.forEach(file => {
        const existing = existingFiles.find(ef => ef.fileName === file.name);
        if (existing) {
          console.log(`⚠️  Duplicate detected: ${file.name}`);
          duplicates.push({ fileName: file.name, existingFile: existing });
        }
      });

      // If duplicates found, show warning dialog
      if (duplicates.length > 0) {
        console.log(`🚫 Found ${duplicates.length} duplicate file(s), showing warning dialog`);
        setDuplicateFiles(duplicates);
        setShowDuplicateWarning(true);
        return; // Don't proceed with upload yet
      } else {
        console.log('✅ No duplicates found, proceeding with upload');
      }
    }

    // Check if any files need a date column (skip if we're already handling date input)
    if (!skipDuplicateCheck) {
      console.log('🔍 Checking files for time columns...');

      // First, check ALL files for missing date columns
      const filesNeedingDates: File[] = [];
      for (const file of csvFiles) {
        const hasTime = await hasTimeColumn(file);

        if (!hasTime) {
          console.log(`⚠️  File "${file.name}" has no time column`);
          filesNeedingDates.push(file);
        } else {
          console.log(`✅ File "${file.name}" has time column`);
        }
      }

      // Handle files that need dates
      if (filesNeedingDates.length > 0) {
        // Multiple files without dates - show batch confirmation dialog
        if (filesNeedingDates.length > 1) {
          console.log(`⚠️  ${filesNeedingDates.length} files need date columns, showing batch confirmation`);
          setFilesWithoutDates(filesNeedingDates);
          setBatchDateContext({ targetId, targetType });
          setShowBatchDateConfirm(true);
          return; // Pause upload until user decides
        }
        // Single file without date - show date input dialog directly
        else {
          console.log(`⚠️  File "${filesNeedingDates[0].name}" has no time column, requesting date input`);
          setPendingDateFile({ file: filesNeedingDates[0], targetId, targetType });
          setShowDateInputDialog(true);
          return; // Pause upload until user provides date
        }
      }

      console.log('✅ All files have time columns, proceeding with upload');
    }

    setIsUploadingFiles(true);

    try {
      const uploadResults: PinFile[] = [];
      const failedUploads: string[] = [];

      // Upload each file to Supabase
      perfLogger.start('uploadFiles');

      for (const file of csvFiles) {
        try {
          const target = { type: targetType, id: targetId } as import('@/lib/supabase/file-storage-service').UploadTarget;
          const result = await fileStorageService.uploadFile(target, file, activeProjectId);

          if (result) {
            uploadResults.push(result);
          } else {
            perfLogger.error(`Failed to upload: ${file.name}`);
            failedUploads.push(file.name);
          }
        } catch (uploadError) {
          perfLogger.error(`Exception uploading ${file.name}`, uploadError);
          failedUploads.push(file.name);
        }
      }

      perfLogger.end('uploadFiles', `${uploadResults.length}/${csvFiles.length} files uploaded successfully`);

      if (uploadResults.length > 0) {
        // Reload all project files to ensure timeline is completely up to date
        console.log('🔄 Triggering full project files reload after upload...');
        await reloadProjectFiles();
      }

      // Show success/failure toast
      if (failedUploads.length === 0) {
        toast({
          title: "Files Uploaded Successfully",
          description: `${uploadResults.length} CSV file${uploadResults.length > 1 ? 's' : ''} uploaded to ${targetType === 'pin' ? 'pin' : 'area'}.`
            });

            // Keep the explore dropdown open to show the newly uploaded files (pins only)
            if (targetType === 'pin') {
              setShowExploreDropdown(true);
              setSelectedPinForExplore(targetId);
            }
          } else {
            toast({
              variant: failedUploads.length === csvFiles.length ? "destructive" : "default",
              title: failedUploads.length === csvFiles.length ? "Upload Failed" : "Partial Upload Success",
              description: failedUploads.length === csvFiles.length
                ? `Failed to upload ${failedUploads.length} files`
                : `${uploadResults.length} uploaded, ${failedUploads.length} failed: ${failedUploads.join(', ')}`
            });

            // If at least some files uploaded successfully, keep dropdown open (pins only)
            if (uploadResults.length > 0 && targetType === 'pin') {
              setShowExploreDropdown(true);
              setSelectedPinForExplore(targetId);
            }
      }

    } catch (error) {
      console.error('File upload error:', error);
      toast({
        variant: "destructive",
        title: "Upload Error",
        description: "An error occurred while uploading files. Please try again."
      });
    } finally {
      setIsUploadingFiles(false);
      setPendingUploadFiles([]);
      setSelectedUploadPinId('');
      setSelectedUploadAreaId('');
    }
  };

  // Handle replacing duplicate files
  const handleReplaceDuplicates = async () => {
    const targetId = uploadTargetType === 'pin' ? selectedUploadPinId : selectedUploadAreaId;
    if (!targetId) return;

    setShowDuplicateWarning(false);

    // Delete the existing duplicate files first
    for (const dup of duplicateFiles) {
      try {
        await fileStorageService.deleteFile(dup.existingFile.id);
        console.log(`Deleted duplicate file: ${dup.fileName}`);

        // Also update local state to remove the deleted file (only for pins)
        if (uploadTargetType === 'pin') {
          setPinFileMetadata(prev => ({
            ...prev,
            [targetId]: (prev[targetId] || []).filter(f => f.id !== dup.existingFile.id)
          }));
        }
      } catch (error) {
        console.error(`Failed to delete duplicate file ${dup.fileName}:`, error);
      }
    }

    // Clear duplicates list
    setDuplicateFiles([]);

    // Now proceed with the upload, skipping duplicate check
    await handleFileUpload(targetId, uploadTargetType, pendingUploadFiles, true);
  };

  // Handle cancelling duplicate upload
  const handleCancelDuplicateUpload = () => {
    setShowDuplicateWarning(false);
    setDuplicateFiles([]);
    setPendingUploadFiles([]);
    setSelectedUploadPinId('');
    setShowUploadPinSelector(false);
  };

  // Handle explore data with file type selection
  const handleExploreData = (pinId: string) => {
    const dbFiles = pinFileMetadata[pinId] || [];
    const totalFiles = dbFiles.length;
    
    if (totalFiles === 0) {
      toast({
        title: "No Data Available",
        description: "No files uploaded for this pin yet."
      });
      return;
    }
    
    setSelectedPinForExplore(pinId);
    setShowExploreDropdown(true);
  };

  // Marine Device Modal Handlers
  const openMarineDeviceModal = useCallback((fileType: 'GP' | 'FPOD' | 'Subcam', files: File[]) => {
    setSelectedFileType(fileType);
    setSelectedFiles(files);
    setShowMarineDeviceModal(true);
    
    // Keep all UI elements open - don't close anything
    // The modal will overlay on top of the existing UI
  }, []);

  const closeMarineDeviceModal = useCallback(() => {
    setShowMarineDeviceModal(false);
    setSelectedFileType(null);
    setSelectedFiles([]);
    // UI state is already preserved, no need to reopen anything
  }, []);

  // Merge Rules Handler
  const handleMergeRuleToggle = useCallback((suffix: string, enabled: boolean) => {
    setMergeRules(prevRules =>
      prevRules.map(rule =>
        rule.suffix === suffix ? { ...rule, enabled } : rule
      )
    );
  }, []);

  // Handle request to return to file selection from Add New Plot button
  const handleRequestFileSelection = useCallback(() => {
    // Close the marine device modal
    setShowMarineDeviceModal(false);
    setSelectedFileType(null);
    setSelectedFiles([]);

    // UI state is already preserved, no need to reopen anything
    // The explore dropdown and object properties should still be open

    // Reopen the object properties with the file selector
    // We need to find the original pin that was being edited
    const pinForReselection = selectedPinForExplore || 
      (pinFiles && Object.keys(pinFiles).find(pinId => pinFiles[pinId]?.length > 0));
    
    if (pinForReselection) {
      // Find the pin object
      const pin = pins.find(p => p.id === pinForReselection);
      if (pin) {
        setItemToEdit(pin);
        setShowDataDropdown(true);
        setShowExploreDropdown(true);
        setSelectedPinForExplore(pinForReselection);
      }
    }
  }, [selectedPinForExplore, pinFiles, pins]);

  // Handle on-demand file download for plots
  const handleDownloadFileForPlot = useCallback(async (
    pinId: string | null,
    fileName: string,
    areaId?: string | null,
    providedMetadata?: PinFile
  ): Promise<File | null> => {
    try {
      console.log(`📥 Downloading file for plot: ${fileName} (pin: ${pinId}, area: ${areaId})`);

      // Handle merged files separately
      if (pinId === 'merged') {
        console.log(`🔀 Looking up merged file: ${fileName}`);
        const mergedFileMetadata = mergedFiles.find(
          f => f.fileName === fileName
        );

        if (!mergedFileMetadata) {
          console.error('❌ Merged file metadata not found:', { fileName });
          toast({
            variant: "destructive",
            title: "Download Failed",
            description: "Merged file metadata not found"
          });
          return null;
        }

        // Download merged file from storage
        console.log(`📦 Downloading merged file from storage: ${mergedFileMetadata.filePath}`);
        const blob = await fileStorageService.downloadPinFile(mergedFileMetadata.filePath);

        if (!blob) {
          console.error('❌ Failed to download merged file from storage');
          toast({
            variant: "destructive",
            title: "Download Failed",
            description: `Could not download ${fileName}`
          });
          return null;
        }

        // Convert to File object
        const file = new File([blob], fileName, {
          type: mergedFileMetadata.fileType || 'text/csv'
        });

        console.log(`✅ Merged file downloaded successfully: ${fileName} (${(file.size / 1024).toFixed(2)} KB)`);

        // Cache it in pinFiles state
        setPinFiles(prev => ({
          ...prev,
          [pinId]: [...(prev[pinId] || []), file]
        }));

        toast({
          title: "Merged File Downloaded",
          description: `${fileName} is ready for plotting`
        });

        return file;
      }

      // Get file metadata for regular (uploaded) files
      // Try pin files first, then area files, or use provided metadata
      let fileMetadata: PinFile | undefined = providedMetadata;
      let objectType: 'pin' | 'area' | null = null;
      let objectId: string | null = null;

      if (!fileMetadata && pinId) {
        fileMetadata = pinFileMetadata[pinId]?.find(
          f => f.fileName === fileName
        );
        if (fileMetadata) {
          objectType = 'pin';
          objectId = pinId;
        }
      }

      if (!fileMetadata && areaId) {
        fileMetadata = areaFileMetadata[areaId]?.find(
          f => f.fileName === fileName
        );
        if (fileMetadata) {
          objectType = 'area';
          objectId = areaId;
        }
      }

      // If we still don't have metadata, try to determine objectType from provided metadata
      if (fileMetadata && !objectType) {
        if (fileMetadata.pinId) {
          objectType = 'pin';
          objectId = fileMetadata.pinId;
        } else if (fileMetadata.areaId) {
          objectType = 'area';
          objectId = fileMetadata.areaId;
        }
      }

      if (!fileMetadata) {
        console.error('❌ File metadata not found:', { pinId, areaId, fileName });
        console.error('Available pinFileMetadata keys:', Object.keys(pinFileMetadata));
        console.error('Available areaFileMetadata keys:', Object.keys(areaFileMetadata));
        toast({
          variant: "destructive",
          title: "Download Failed",
          description: "File metadata not found"
        });
        return null;
      }

      // Download from storage using fileStorageService.downloadFile()
      console.log(`📦 Downloading ${objectType || 'cross-project'} file from storage: ${fileMetadata.filePath}`);
      const blob = await fileStorageService.downloadPinFile(fileMetadata.filePath);

      if (!blob) {
        console.error('❌ Failed to download file from storage');
        toast({
          variant: "destructive",
          title: "Download Failed",
          description: `Could not download ${fileName}`
        });
        return null;
      }

      // Convert to File object
      const file = new File([blob], fileName, {
        type: fileMetadata.fileType || 'text/csv'
      });

      console.log(`✅ File downloaded successfully: ${fileName} (${(file.size / 1024).toFixed(2)} KB)`);

      // Cache it in pinFiles state using the objectId
      if (objectId) {
        setPinFiles(prev => ({
          ...prev,
          [objectId]: [...(prev[objectId] || []), file]
        }));
      }

      toast({
        title: "File Downloaded",
        description: `${fileName} is ready for plotting`
      });

      return file;
    } catch (error) {
      console.error('❌ Download error:', error);
      toast({
        variant: "destructive",
        title: "Download Failed",
        description: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }, [pinFileMetadata, areaFileMetadata, mergedFiles, toast]);

  // ============================================================================
  // DATA EXPLORER PANEL HANDLERS - NEW ADDITION
  // ============================================================================
  const handleFileClickFromPanel = useCallback(async (file: PinFile & { pinLabel: string }) => {
    console.log('📂 [DATA EXPLORER PANEL] File clicked:', file.fileName);

    try {
      // Determine file type from filename
      let fileType: 'GP' | 'FPOD' | 'Subcam' = 'GP';
      const parts = file.fileName.split('_');
      const position0 = parts[0]?.toLowerCase() || '';
      const position1 = parts[1]?.toLowerCase() || '';

      if (position0.includes('fpod') || position1.includes('fpod')) {
        fileType = 'FPOD';
      } else if (position0.includes('subcam') || position1.includes('subcam')) {
        fileType = 'Subcam';
      }

      // Fetch GPS coordinates for marine/meteo integration
      if (file.pinId || file.areaId) {
        console.log('📍 [DATA EXPLORER PANEL] Fetching GPS coordinates for:', file.pinId || file.areaId);

        if (file.pinId) {
          // Fetch pin coordinates
          const pin = pins.find(p => p.id === file.pinId);
          if (pin) {
            setObjectGpsCoords({ lat: pin.lat, lng: pin.lng });
            setObjectName(pin.label || file.pinLabel || 'Pin');
            console.log('✅ [DATA EXPLORER PANEL] Set GPS coords from pin:', { lat: pin.lat, lng: pin.lng });
          }
        } else if (file.areaId) {
          // Fetch area coordinates (use centroid)
          const area = areas.find(a => a.id === file.areaId);
          if (area && area.path && area.path.length > 0) {
            const centerLat = area.path.reduce((sum, p) => sum + p.lat, 0) / area.path.length;
            const centerLng = area.path.reduce((sum, p) => sum + p.lng, 0) / area.path.length;
            setObjectGpsCoords({ lat: centerLat, lng: centerLng });
            setObjectName(area.name || file.pinLabel || 'Area');
            console.log('✅ [DATA EXPLORER PANEL] Set GPS coords from area centroid:', { lat: centerLat, lng: centerLng });
          }
        }
      }

      // Download the file (reuse existing handler)
      const downloadedFile = await handleDownloadFileForPlot(
        file.pinId || null,
        file.fileName,
        file.areaId || null,
        file
      );

      if (!downloadedFile) {
        throw new Error('File download failed');
      }

      // Open in marine device modal
      setSelectedFileType(fileType);
      setSelectedFiles([downloadedFile]);
      setShowMarineDeviceModal(true);
      setShowDataExplorerPanel(false); // Close panel

      console.log('✅ [DATA EXPLORER PANEL] File opened in marine device modal');
    } catch (error) {
      console.error('❌ [DATA EXPLORER PANEL] Error opening file:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to open file"
      });
    }
  }, [handleDownloadFileForPlot, pins, areas, toast]);

  const handleOpenStackedPlotsFromPanel = useCallback(async (filesToOpen: (PinFile & { pinLabel: string })[]) => {
    console.log('📚 [DATA EXPLORER PANEL] Opening stacked plots for:', filesToOpen.map(f => f.fileName));

    if (filesToOpen.length === 0) {
      toast({
        variant: "destructive",
        title: "No Files Selected",
        description: "Please select files to open"
      });
      return;
    }

    try {
      // Determine file type from first file (assume all same type)
      let fileType: 'GP' | 'FPOD' | 'Subcam' = 'GP';
      const firstFileName = filesToOpen[0].fileName;
      const parts = firstFileName.split('_');
      const position0 = parts[0]?.toLowerCase() || '';
      const position1 = parts[1]?.toLowerCase() || '';

      if (position0.includes('fpod') || position1.includes('fpod')) {
        fileType = 'FPOD';
      } else if (position0.includes('subcam') || position1.includes('subcam')) {
        fileType = 'Subcam';
      }

      // Set GPS coordinates from first file for marine/meteo integration
      const firstFile = filesToOpen[0];
      if (firstFile.pinId || firstFile.areaId) {
        console.log('📍 [DATA EXPLORER PANEL] Fetching GPS coordinates for:', firstFile.pinId || firstFile.areaId);

        if (firstFile.pinId) {
          const pin = pins.find(p => p.id === firstFile.pinId);
          if (pin) {
            setObjectGpsCoords({ lat: pin.lat, lng: pin.lng });
            setObjectName(pin.label || firstFile.pinLabel || 'Pin');
            console.log('✅ [DATA EXPLORER PANEL] Set GPS coords from pin:', { lat: pin.lat, lng: pin.lng });
          }
        } else if (firstFile.areaId) {
          const area = areas.find(a => a.id === firstFile.areaId);
          if (area && area.path && area.path.length > 0) {
            const centerLat = area.path.reduce((sum, p) => sum + p.lat, 0) / area.path.length;
            const centerLng = area.path.reduce((sum, p) => sum + p.lng, 0) / area.path.length;
            setObjectGpsCoords({ lat: centerLat, lng: centerLng });
            setObjectName(area.name || firstFile.pinLabel || 'Area');
            console.log('✅ [DATA EXPLORER PANEL] Set GPS coords from area centroid:', { lat: centerLat, lng: centerLng });
          }
        }
      }

      // Download ALL files in parallel for better performance
      const startTime = Date.now();
      toast({
        title: "Loading Stacked Plots",
        description: `Downloading ${filesToOpen.length} files in parallel...`
      });

      // Create download promises for parallel execution
      const downloadPromises = filesToOpen.map(async (file, index) => {
        try {
          const downloadedFile = await handleDownloadFileForPlot(
            file.pinId || null,
            file.fileName,
            file.areaId || null,
            file
          );

          if (downloadedFile) {
            console.log(`✅ [${index + 1}/${filesToOpen.length}] Downloaded: ${file.fileName}`);
            return downloadedFile;
          } else {
            console.warn(`⚠️ [${index + 1}/${filesToOpen.length}] Failed to download: ${file.fileName}`);
            return null;
          }
        } catch (error) {
          console.error(`❌ [${index + 1}/${filesToOpen.length}] Error downloading ${file.fileName}:`, error);
          return null;
        }
      });

      // Wait for all downloads to complete in parallel
      const downloadResults = await Promise.all(downloadPromises);
      const downloadedFiles = downloadResults.filter((file): file is File => file !== null);
      const downloadTime = Date.now() - startTime;

      if (downloadedFiles.length === 0) {
        throw new Error('All file downloads failed');
      }

      console.log(`✅ Downloaded ${downloadedFiles.length}/${filesToOpen.length} files for stacked plots in ${downloadTime}ms (${Math.round(downloadTime / filesToOpen.length)}ms avg per file)`);

      // Open in marine device modal with ALL files
      setSelectedFileType(fileType);
      setSelectedFiles(downloadedFiles);
      setShowMarineDeviceModal(true);
      setShowDataExplorerPanel(false); // Close panel

      toast({
        title: "Stacked Plots Loaded",
        description: `Successfully loaded ${downloadedFiles.length} files in ${(downloadTime / 1000).toFixed(1)}s`
      });

      console.log('✅ [DATA EXPLORER PANEL] Opened stacked plots in marine device modal');
    } catch (error) {
      console.error('❌ [DATA EXPLORER PANEL] Error opening stacked plots:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to open stacked plots"
      });
    }
  }, [handleDownloadFileForPlot, pins, areas, toast]);

  const handleDeleteFileForPlot = useCallback(async (file: PinFile & { pinLabel: string }) => {
    console.log('🗑️ [DATA EXPLORER PANEL] Delete file clicked:', file.fileName);

    try {
      console.log('Calling deleteFileSimple with ID:', file.id);
      const success = await fileStorageService.deleteFileSimple(file.id);
      console.log('Delete result from service:', success);

      if (success) {
        console.log('Delete successful, reloading files...');

        // Update the metadata state to remove the deleted file
        if (file.pinId) {
          setPinFileMetadata(prev => {
            const updated = { ...prev };
            if (updated[file.pinId]) {
              updated[file.pinId] = updated[file.pinId].filter(f => f.id !== file.id);
            }
            return updated;
          });
        } else if (file.areaId) {
          setAreaFileMetadata(prev => {
            const updated = { ...prev };
            if (updated[file.areaId]) {
              updated[file.areaId] = updated[file.areaId].filter(f => f.id !== file.id);
            }
            return updated;
          });
        }

        toast({
          title: "File Deleted",
          description: `"${file.fileName}" has been deleted successfully`
        });
      } else {
        throw new Error('Delete operation returned false');
      }
    } catch (error) {
      console.error('❌ [DATA EXPLORER PANEL] Error deleting file:', error);
      toast({
        variant: "destructive",
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "Failed to delete file"
      });
    }
  }, [toast]);

  const handleRenameFileForPlot = useCallback(async (file: PinFile & { pinLabel: string }, newName: string): Promise<boolean> => {
    console.log('✏️ [DATA EXPLORER PANEL] Rename file request:', file.fileName, '→', newName);

    try {
      const success = await fileStorageService.renameFile(file.id, newName);
      console.log('Rename result from service:', success);

      if (success) {
        console.log('Rename successful, updating UI...');

        // Update the metadata state with the new filename
        if (file.pinId) {
          setPinFileMetadata(prev => {
            const updated = { ...prev };
            if (updated[file.pinId]) {
              updated[file.pinId] = updated[file.pinId].map(f =>
                f.id === file.id ? { ...f, fileName: newName } : f
              );
            }
            return updated;
          });
        } else if (file.areaId) {
          setAreaFileMetadata(prev => {
            const updated = { ...prev };
            if (updated[file.areaId]) {
              updated[file.areaId] = updated[file.areaId].map(f =>
                f.id === file.id ? { ...f, fileName: newName } : f
              );
            }
            return updated;
          });
        }

        toast({
          title: "File Renamed",
          description: `File renamed to "${newName}"`
        });

        return true;
      } else {
        throw new Error('Rename operation returned false');
      }
    } catch (error) {
      console.error('❌ [DATA EXPLORER PANEL] Error renaming file:', error);
      toast({
        variant: "destructive",
        title: "Rename Failed",
        description: error instanceof Error ? error.message : "Failed to rename file"
      });
      return false;
    }
  }, [toast]);

  const handlePlotClickFromPanel = useCallback(async (plot: SavedPlotView) => {
    console.log('📊 [DATA EXPLORER PANEL] Plot clicked:', plot.name);

    try {
      // Validate plot first
      const { plotViewService } = await import('@/lib/supabase/plot-view-service');
      const validation = await plotViewService.validatePlotView(plot.view_config);

      if (!validation.valid) {
        toast({
          variant: "destructive",
          title: "Cannot Open Plot",
          description: "This plot references files that are no longer available"
        });
        return;
      }

      // Determine file type from the first plot in the saved view
      let fileType: 'GP' | 'FPOD' | 'Subcam' = 'GP';
      const firstPlot = plot.view_config.plots?.[0];
      if (firstPlot?.fileName) {
        const parts = firstPlot.fileName.split('_');
        const position0 = parts[0]?.toLowerCase() || '';
        const position1 = parts[1]?.toLowerCase() || '';

        if (position0.includes('fpod') || position1.includes('fpod')) {
          fileType = 'FPOD';
        } else if (position0.includes('subcam') || position1.includes('subcam')) {
          fileType = 'Subcam';
        }
      }
      console.log('🎯 [DATA EXPLORER PANEL] Detected file type:', fileType, 'from first plot:', firstPlot?.fileName);

      // Use existing auto-load mechanism
      sessionStorage.setItem('pebl-load-plot-view', JSON.stringify({
        viewId: plot.id,
        viewName: plot.name,
        timestamp: Date.now()
      }));

      // Open marine device modal with correct file type
      setSelectedFileType(fileType);
      setSelectedFiles([]);
      setIsLoadingFromSavedPlot(true); // Tell modal we're loading from saved plot
      setShowMarineDeviceModal(true);
      setShowDataExplorerPanel(false); // Close panel

      console.log('✅ [DATA EXPLORER PANEL] Plot will auto-load in marine device modal');

      toast({
        title: "Loading Plot",
        description: `Opening "${plot.name}"`,
        duration: 2000
      });
    } catch (error) {
      console.error('❌ [DATA EXPLORER PANEL] Error opening plot:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to open plot"
      });
    }
  }, [toast]);

  const handlePlotDeleteFromPanel = useCallback(async (plotId: string) => {
    console.log('🗑️ [DATA EXPLORER PANEL] Deleting plot:', plotId);

    // Reuse existing plot view service
    const { plotViewService } = await import('@/lib/supabase/plot-view-service');
    const result = await plotViewService.deletePlotView(plotId);

    if (!result.success) {
      throw new Error(result.error || 'Delete failed');
    }

    // Update local state
    setSavedPlots(prev => prev.filter(p => p.id !== plotId));

    console.log('✅ [DATA EXPLORER PANEL] Plot deleted successfully');
  }, []);

  const handlePlotEditFromPanel = useCallback((plot: SavedPlotView) => {
    console.log('✏️ [DATA EXPLORER PANEL] Edit plot:', plot.name);

    toast({
      title: "Edit Plot",
      description: "Plot editing functionality coming soon. You'll be able to edit the name and description."
    });

    // TODO: Implement edit dialog
    // - Show dialog with name and description fields
    // - Call plotViewService.updatePlotView() to save changes
    // - Update local state: setSavedPlots(prev => prev.map(p => p.id === plot.id ? updated : p))
  }, [toast]);
  // ============================================================================

  // Handle file type selection
  const handleFileTypeSelection = async (fileType: 'GP' | 'FPOD' | 'Subcam') => {
    if (!selectedPinForExplore) return;
    
    // Get local files
    const localFiles = pinFiles[selectedPinForExplore] || [];
    
    // Get database files and convert them to File objects if needed
    const dbFileMetadata = pinFileMetadata[selectedPinForExplore] || [];
    const dbFiles: File[] = [];
    
    // For database files, we need to download them first
    for (const meta of dbFileMetadata) {
      try {
        // Check if file matches the selected type based on filename prefix
        if (meta.fileName.startsWith(fileType)) {
          // Create a File-like object for now (you may want to actually download the file)
          const file = new File([new Blob()], meta.fileName, { type: meta.fileType || 'text/csv' });
          Object.defineProperty(file, 'size', { value: meta.fileSize });
          dbFiles.push(file);
        }
      } catch (error) {
        console.error('Error processing database file:', error);
      }
    }
    
    // Combine all files
    const allFiles = [...localFiles, ...dbFiles];
    const categorizedFiles = categorizeFiles(allFiles);
    const selectedFiles = categorizedFiles[fileType];
    
    // Don't close any dropdowns - keep the UI state
    // The modal will overlay on top
    
    if (selectedFiles.length > 0) {
      // Open the Marine Device Modal instead of showing toast
      openMarineDeviceModal(fileType, selectedFiles);
    } else {
      toast({
        variant: "destructive",
        title: "No Files Found",
        description: `No ${fileType} files found for this pin.`
      });
    }
  };





  if (!view || !settings) {
    return (
      <div className="w-full h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading app...</p>
        </div>
      </div>
    );
  }
  
  if (isDataLoading) {
    return (
      <div className="w-full h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading map data...</p>
          {!isOnline && (
            <p className="text-xs text-amber-600 mt-1">Offline - Using local data</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Top progress bar for smooth loading feedback */}
      <TopProgressBar isLoading={isPageLoading} progress={loadingProgress} />










                    


      {/* Map Container - Account for top navigation height (h-14 = 3.5rem) */}
      <main className="relative overflow-hidden bg-background text-foreground" style={{ height: 'calc(100vh - 3.5rem)' }}>
        <div className="h-full w-full relative" style={{ minHeight: '500px', cursor: drawingMode === 'none' ? 'default' : 'crosshair' }}>

          {/* Show skeleton during initial load */}
          {isPageLoading && isInitialLoad ? (
            <MapSkeleton />
          ) : (
            <LeafletMap
              mapRef={mapRef}
              center={[view.center.lat, view.center.lng]}
              zoom={view.zoom}
              pins={pins}
              lines={lines}
              areas={areas}
              projects={projects}
              tags={tags}
              settings={settings}
              currentLocation={null}
              onLocationFound={() => {}}
              onLocationError={() => {}}
              onMove={handleMapMove}
              isDrawingLine={isDrawingLine}
              lineStartPoint={lineStartPoint}
              currentMousePosition={currentMousePosition}
              isDrawingArea={isDrawingArea}
              onMapClick={handleMapClick}
              onMapMouseMove={handleMapMouseMove}
              pendingAreaPath={pendingAreaPath}
              areaStartPoint={areaStartPoint}
              currentAreaEndPoint={currentAreaEndPoint}
              pendingPin={pendingPin}
              onPinSave={handlePinSave}
              onPinCancel={handlePinCancel}
              pendingLine={pendingLine}
            onLineSave={handleLineSave}
            onLineCancel={handleLineCancel}
            pendingArea={pendingArea}
            onAreaSave={handleAreaSave}
            onAreaCancel={handleAreaCancel}
            onUpdatePin={handleUpdatePin}
            onDeletePin={handleDeletePin}
            onUpdateLine={handleUpdateLine}
            onDeleteLine={handleDeleteLine}
            onUpdateArea={handleUpdateArea}
            onDeleteArea={handleDeleteArea}
            onToggleLabel={handleToggleLabel}
            onToggleFill={handleToggleFill}
            itemToEdit={itemToEdit}
            onEditItem={setItemToEdit}
            activeProjectId={activeProjectId}
            projectVisibility={projectVisibility}
            editingGeometry={editingGeometry}
            onEditGeometry={setEditingGeometry}
            onUpdateGeometry={(itemId, newPath) => {}}
            showPopups={false}
            useEditPanel={true}
            disableDefaultPopups={true}
            forceUseEditCallback={true}
            popupMode="none"
            lineEditMode={lineEditMode}
            editingLineId={editingLineId}
            tempLinePath={tempLinePath}
            onLinePointDrag={handleLinePointDrag}
            onLineEditComplete={handleLineEditComplete}
            onLineEditCancel={handleLineEditCancel}
            areaEditMode={isAreaCornerDragging ? 'corners' : 'none'}
            editingAreaId={isAreaCornerDragging && itemToEdit && 'path' in itemToEdit ? itemToEdit.id : null}
            tempAreaPath={tempAreaPath}
            onAreaCornerDrag={handleAreaCornerDrag}
          />
          )}


          {/* Line Edit Mode Toolbar */}
          {lineEditMode !== 'none' && (
            <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-[1000] bg-background/95 border rounded-lg shadow-lg p-2 flex gap-2">
              <Button
                onClick={handleLineEditComplete}
                size="sm"
                className="bg-green-600 hover:bg-green-700"
              >
                <Check className="h-4 w-4 mr-1" />
                Save Changes
              </Button>
              <Button
                onClick={handleLineEditCancel}
                size="sm"
                variant="outline"
              >
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
            </div>
          )}
          
          {/* Main Menu Button */}
          <div className="absolute top-8 left-4 z-[1000]">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost"
                    size="icon" 
                    onClick={() => setShowMainMenu(!showMainMenu)}
                    className="h-10 w-10 rounded-full shadow-lg bg-primary/90 hover:bg-primary text-primary-foreground border-0 backdrop-blur-sm transition-all duration-200 hover:scale-105"
                    data-menu-button
                  >
                    <Menu className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Menu</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* Top Right Controls */}
          <div className="absolute top-8 right-4 z-[1000] flex flex-col gap-2 items-end">
            {/* Object Details Panel */}
            {itemToEdit && (
              <div className="w-72 bg-background/95 border rounded-lg shadow-lg p-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {'lat' in itemToEdit ? (
                      <MapPin className="h-4 w-4 text-blue-500" />
                    ) : 'path' in itemToEdit && Array.isArray(itemToEdit.path) ? (
                      'fillVisible' in itemToEdit ? (
                        <Square className="h-4 w-4 text-purple-500" />
                      ) : (
                        <Minus className="h-4 w-4 text-green-500" />
                      )
                    ) : (
                      <Square className="h-4 w-4 text-purple-500" />
                    )}
                    <span className="text-sm font-medium text-foreground">
                      {itemToEdit.label || `Unnamed ${'lat' in itemToEdit ? 'Pin' : 'path' in itemToEdit && Array.isArray(itemToEdit.path) ? ('fillVisible' in itemToEdit ? 'Area' : 'Line') : 'Unknown'}`}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setItemToEdit(null);
                      setIsEditingObject(false);
                    }}
                    className="h-6 w-6 p-0 hover:bg-muted"
                  >
                    <Plus className="h-3 w-3 rotate-45" />
                  </Button>
                </div>
                
                {!isEditingObject ? (
                  // View Mode
                  <>
                    {itemToEdit.notes && (
                      <div className="mb-3">
                        <div className="text-sm text-muted-foreground">{itemToEdit.notes}</div>
                      </div>
                    )}
                    
                    {'lat' in itemToEdit && (
                      <div className="mb-3">
                        <div className="text-xs font-mono text-muted-foreground">
                          {itemToEdit.lat.toFixed(6)}, {itemToEdit.lng.toFixed(6)}
                        </div>
                      </div>
                    )}
                    
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        {/* Edit button - with dropdown for lines */}
                        {itemToEdit && 'path' in itemToEdit && !('fillVisible' in itemToEdit) ? (
                          // Line - show dropdown with Edit Location option
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="flex-1 h-8"
                              >
                                <Edit3 className="h-3 w-3 mr-1" />
                                Edit
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="z-[1100]">
                              <DropdownMenuItem onClick={handleStartEdit}>
                                <Edit3 className="h-3 w-3 mr-2" />
                                Edit Properties
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setLineEditMode('endpoints');
                                  setEditingLineId(itemToEdit.id);
                                  setTempLinePath([...itemToEdit.path]);
                                  setItemToEdit(null); // Close properties panel
                                }}
                              >
                                <Move3D className="h-3 w-3 mr-2" />
                                Edit Location
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          // Pin or Area - regular edit button
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleStartEdit}
                            className="flex-1 h-8"
                          >
                            <Edit3 className="h-3 w-3 mr-1" />
                            Edit
                          </Button>
                        )}
                        
                        {/* Share button - only for pins */}
                        {itemToEdit && 'lat' in itemToEdit && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={handleOpenShare}
                                  className="h-8 px-2"
                                >
                                  <Share2 className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Share Pin</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {/* Duplicate button */}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleDuplicateObject}
                                className="h-8 px-2"
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Duplicate at Crosshairs</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        {/* Delete button with confirmation */}
                        <Popover 
                          open={deleteConfirmItem?.id === itemToEdit.id}
                          onOpenChange={(open) => {
                            if (!open) setDeleteConfirmItem(null);
                          }}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                // Check if pin has data
                                let hasData = false;
                                if ('lat' in itemToEdit) {
                                  const pinFiles = pinFileMetadata[itemToEdit.id];
                                  hasData = pinFiles && pinFiles.length > 0;
                                }
                                setDeleteConfirmItem({ 
                                  id: itemToEdit.id, 
                                  type: 'lat' in itemToEdit ? 'pin' : 'fillVisible' in itemToEdit ? 'area' : 'line',
                                  hasData 
                                });
                              }}
                              className="h-8 px-2 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent 
                            className="w-auto p-2 z-[9999]" 
                            align="start"
                            side="bottom"
                          >
                            <div className="flex flex-col gap-2">
                              <p className="text-xs font-medium">
                                Delete {deleteConfirmItem?.type}?
                              </p>
                              {deleteConfirmItem?.hasData && (
                                <p className="text-xs text-amber-600">
                                  ⚠️ Data files attached will be deleted
                                </p>
                              )}
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-6 text-xs px-2"
                                  onClick={() => {
                                    if ('lat' in itemToEdit) {
                                      handleDeletePin(itemToEdit.id);
                                    } else if ('path' in itemToEdit && Array.isArray(itemToEdit.path)) {
                                      if ('fillVisible' in itemToEdit) {
                                        handleDeleteArea(itemToEdit.id);
                                      } else {
                                        handleDeleteLine(itemToEdit.id);
                                      }
                                    }
                                    setItemToEdit(null);
                                    setDeleteConfirmItem(null);
                                  }}
                                >
                                  Yes, delete
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 text-xs px-2"
                                  onClick={() => setDeleteConfirmItem(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                      
                      {/* Share Popover - Only for Pins */}
                      {itemToEdit && 'lat' in itemToEdit && (
                        <Popover open={showSharePopover} onOpenChange={setShowSharePopover}>
                          <PopoverTrigger />
                          <PopoverContent className="w-80 p-4 z-[9999]" align="start">
                            <div className="space-y-4">
                              <div>
                                <h4 className="font-medium text-sm mb-2">Pin Privacy Settings</h4>
                                <p className="text-xs text-muted-foreground mb-3">
                                  Control who can see this pin
                                </p>
                              </div>
                              
                              <div className="space-y-2">
                                <label className="flex items-center space-x-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="privacy"
                                    value="private"
                                    checked={sharePrivacyLevel === 'private'}
                                    onChange={(e) => setSharePrivacyLevel(e.target.value as 'private' | 'public' | 'specific')}
                                    className="text-primary"
                                  />
                                  <Lock className="h-4 w-4 text-muted-foreground" />
                                  <div>
                                    <div className="text-sm font-medium">Private</div>
                                    <div className="text-xs text-muted-foreground">Only you can see this pin</div>
                                  </div>
                                </label>
                                
                                <label className="flex items-center space-x-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="privacy"
                                    value="public"
                                    checked={sharePrivacyLevel === 'public'}
                                    onChange={(e) => setSharePrivacyLevel(e.target.value as 'private' | 'public' | 'specific')}
                                    className="text-primary"
                                  />
                                  <Globe className="h-4 w-4 text-muted-foreground" />
                                  <div>
                                    <div className="text-sm font-medium">Public</div>
                                    <div className="text-xs text-muted-foreground">Anyone can see this pin</div>
                                  </div>
                                </label>
                                
                                <label className="flex items-center space-x-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="privacy"
                                    value="specific"
                                    checked={sharePrivacyLevel === 'specific'}
                                    onChange={(e) => setSharePrivacyLevel(e.target.value as 'private' | 'public' | 'specific')}
                                    className="text-primary"
                                  />
                                  <Users className="h-4 w-4 text-muted-foreground" />
                                  <div>
                                    <div className="text-sm font-medium">Specific Users</div>
                                    <div className="text-xs text-muted-foreground">Share with specific people</div>
                                  </div>
                                </label>
                                
                                {sharePrivacyLevel === 'specific' && (
                                  <div className="ml-6 mt-2">
                                    <Input
                                      placeholder="Enter email addresses separated by commas"
                                      value={shareEmails}
                                      onChange={(e) => setShareEmails(e.target.value)}
                                      className="text-xs"
                                    />
                                    <div className="text-xs text-muted-foreground mt-1">
                                      Users will receive a notification when you share
                                    </div>
                                  </div>
                                )}
                              </div>
                              
                              <div className="flex justify-end space-x-2 pt-2 border-t">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setShowSharePopover(false)}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={handleUpdatePrivacy}
                                  disabled={isUpdatingPrivacy}
                                >
                                  {isUpdatingPrivacy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                                  Update Privacy
                                </Button>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                      
                      {/* Data Dropdown Button - Only for Pins */}
                      {'lat' in itemToEdit && (
                        <div className="relative" data-data-dropdown>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setShowDataDropdown(!showDataDropdown);

                              // Capture GPS coordinates when Data is accessed
                              if (!showDataDropdown && 'lat' in itemToEdit && 'lng' in itemToEdit) {
                                // For pins, use direct coordinates
                                setObjectGpsCoords({ lat: itemToEdit.lat, lng: itemToEdit.lng });
                                setObjectName(itemToEdit.label || 'Object');
                                console.log('📍 Captured GPS coords:', { lat: itemToEdit.lat, lng: itemToEdit.lng, name: itemToEdit.label });
                              } else if (!showDataDropdown && 'path' in itemToEdit) {
                                // For lines, use center of path
                                const path = itemToEdit.path;
                                if (path && path.length > 0) {
                                  const centerLat = path.reduce((sum, p) => sum + p.lat, 0) / path.length;
                                  const centerLng = path.reduce((sum, p) => sum + p.lng, 0) / path.length;
                                  setObjectGpsCoords({ lat: centerLat, lng: centerLng });
                                  setObjectName(itemToEdit.label || 'Line');
                                  console.log('📍 Captured GPS coords (line center):', { lat: centerLat, lng: centerLng, name: itemToEdit.label });
                                }
                              } else if (!showDataDropdown && 'path' in itemToEdit) {
                                // For areas, use center of path
                                const path = itemToEdit.path;
                                if (path && path.length > 0) {
                                  const centerLat = path.reduce((sum, p) => sum + p.lat, 0) / path.length;
                                  const centerLng = path.reduce((sum, p) => sum + p.lng, 0) / path.length;
                                  setObjectGpsCoords({ lat: centerLat, lng: centerLng });
                                  setObjectName(itemToEdit.label || 'Area');
                                  console.log('📍 Captured GPS coords (area center):', { lat: centerLat, lng: centerLng, name: itemToEdit.label });
                                }
                              }
                            }}
                            className="w-full h-8 flex items-center gap-2"
                          >
                            <Database className="h-3 w-3" />
                            Data
                            <ChevronDown className={`h-3 w-3 transition-transform ${showDataDropdown ? 'rotate-180' : ''}`} />
                          </Button>
                          
                          {/* Data Dropdown Menu */}
                          {showDataDropdown && (
                            <div className={`absolute top-full mt-1 bg-background border rounded-lg shadow-lg z-[1200] p-1 ${showMeteoDataSection ? 'w-[800px] right-0' : 'w-72 left-0'}`}>
                              {/* Explore Data Dropdown */}
                              <div className="relative" data-explore-dropdown>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    const fileCount = (pinFileMetadata[itemToEdit.id]?.length || 0) + (pinFiles[itemToEdit.id]?.length || 0);
                                    if (fileCount === 0) {
                                      toast({
                                        title: "No Data Available",
                                        description: "No files uploaded for this pin yet."
                                      });
                                      return;
                                    }
                                    setSelectedPinForExplore(itemToEdit.id);
                                    setShowExploreDropdown(!showExploreDropdown);
                                  }}
                                  className="w-full justify-between gap-2 h-8 text-xs"
                                >
                                  <div className="flex items-center gap-2">
                                    <BarChart3 className="h-3 w-3" />
                                    <span>
                                      Explore data 
                                      <span className={`ml-1 font-semibold ${((pinFileMetadata[itemToEdit.id]?.length || 0) + (pinFiles[itemToEdit.id]?.length || 0)) > 0 ? 'text-green-600' : ''}`}>
                                        ({(pinFileMetadata[itemToEdit.id]?.length || 0) + (pinFiles[itemToEdit.id]?.length || 0)} {((pinFileMetadata[itemToEdit.id]?.length || 0) + (pinFiles[itemToEdit.id]?.length || 0)) === 1 ? 'file' : 'files'})
                                      </span>
                                    </span>
                                  </div>
                                  <ChevronDown className={`h-3 w-3 transition-transform ${showExploreDropdown ? 'rotate-180' : ''}`} />
                                </Button>
                                
                                {/* File Type Dropdown */}
                                {showExploreDropdown && selectedPinForExplore === itemToEdit.id && (
                                  <div className="absolute top-full left-0 mt-1 w-full min-w-[200px] max-h-[400px] overflow-y-auto bg-background border rounded-lg shadow-lg z-[1300] p-1">
                                    {(() => {
                                      // Use files from database only (no more local files duplication)
                                      const dbFiles = pinFileMetadata[selectedPinForExplore] || [];
                                      
                                      // Convert database files to File-like objects for categorization
                                      const dbFilesAsFileObjects = dbFiles.map(f => ({
                                        name: f.fileName,
                                        size: f.fileSize,
                                        type: f.fileType || 'text/csv'
                                      }));
                                      
                                      // Use database files only
                                      const allFiles = dbFilesAsFileObjects;
                                      const categorizedFiles = categorizeFiles(allFiles);
                                      const availableTypes = Object.entries(categorizedFiles).filter(([_, files]) => files.length > 0);
                                      
                                      if (availableTypes.length === 0) {
                                        return (
                                          <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                                            No files with recognized prefixes found
                                          </div>
                                        );
                                      }
                                      
                                      return availableTypes.map(([fileType, files]) => {
                                        const timeWindow = getTimeWindowSummary(files);
                                        
                                        // Extract shortened name showing date range and suffix
                                        // e.g., "FPOD_Alga_Control_W_2406-2407_24_hours_v3.csv" -> "2406-2407_24_hours_v3"
                                        const getDateFromFileName = (fileName: string) => {
                                          // Look for pattern YYMM-YYMM and everything after it
                                          const match = fileName.match(/(\d{4}-\d{4}.*)\.csv$/i);
                                          if (match) {
                                            return match[1]; // Return the date range and everything after it
                                          }
                                          
                                          // Fallback: try to find any 4-digit pattern that might be a date
                                          const fallbackMatch = fileName.match(/(\d{4}.*)\.csv$/i);
                                          if (fallbackMatch) {
                                            return fallbackMatch[1];
                                          }
                                          
                                          // If no pattern found, return filename without extension
                                          return fileName.replace(/\.csv$/i, '');
                                        };
                                        
                                        return (
                                          <div key={fileType} className="space-y-1">
                                            <div className="flex items-center gap-2 px-2 py-1">
                                              <span className="font-medium text-xs">{fileType}</span>
                                              <span className="text-muted-foreground text-xs">({files.length} files)</span>
                                            </div>
                                            
                                            {/* Show individual files */}
                                            <div className="ml-4 space-y-0.5">
                                              {files.map((file, idx) => {
                                                // Check if this file has metadata (is from database)
                                                const dbMetadata = pinFileMetadata[selectedPinForExplore]?.find(
                                                  meta => meta.fileName === file.name
                                                );
                                                
                                                return (
                                                  <div key={`${fileType}-${idx}`} className="flex items-center gap-1 group max-w-full">
                                                    <Button
                                                      variant="ghost"
                                                      size="sm"
                                                      onClick={async () => {
                                                        // Download file from Supabase if it's a database file
                                                        if (dbMetadata) {
                                                          setDownloadingFileId(dbMetadata.id);
                                                          try {
                                                            const fileContent = await fileStorageService.downloadPinFile(dbMetadata.filePath);
                                                            if (fileContent) {
                                                              // Convert blob to File object
                                                              const actualFile = new File([fileContent], dbMetadata.fileName, {
                                                                type: dbMetadata.fileType || 'text/csv'
                                                              });
                                                              
                                                              // Open modal with the downloaded file
                                                              // Don't close anything - keep the UI state
                                                              openMarineDeviceModal(fileType as 'GP' | 'FPOD' | 'Subcam', [actualFile]);
                                                            } else {
                                                              toast({
                                                                variant: "destructive",
                                                                title: "Download Failed",
                                                                description: "Could not download file from storage."
                                                              });
                                                            }
                                                          } catch (error) {
                                                            console.error('Error downloading file:', error);
                                                            toast({
                                                              variant: "destructive",
                                                              title: "Download Error",
                                                              description: "Failed to download file. Please try again."
                                                            });
                                                          } finally {
                                                            setDownloadingFileId(null);
                                                          }
                                                        }
                                                      }}
                                                      disabled={downloadingFileId === dbMetadata?.id}
                                                      className="flex-1 min-w-0 justify-start gap-1 h-7 text-xs hover:bg-accent/50 px-2"
                                                    >
                                                      {downloadingFileId === dbMetadata?.id ? (
                                                        <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin" />
                                                      ) : (
                                                        <Calendar className="h-3 w-3 flex-shrink-0" />
                                                      )}
                                                      <span className="truncate max-w-[150px]" title={file.name}>
                                                        {getDateFromFileName(file.name)}
                                                      </span>
                                                      <span className="text-muted-foreground ml-auto flex-shrink-0 text-[10px]">
                                                        {downloadingFileId === dbMetadata?.id ? 'Loading...' : `${(file.size / 1024).toFixed(0)}KB`}
                                                      </span>
                                                    </Button>
                                                    
                                                    {/* Delete button - only show for database files */}
                                                    {dbMetadata && (
                                                      deleteConfirmFile?.id === dbMetadata.id ? (
                                                        // Show inline confirmation
                                                        <div className="flex items-center gap-1">
                                                          <span className="text-xs mr-1">Delete?</span>
                                                          <Button
                                                            size="sm"
                                                            variant="destructive"
                                                            className="h-5 text-[10px] px-1"
                                                            onClick={async (e) => {
                                                              e.stopPropagation();
                                                              console.log('Delete YES clicked for file:', dbMetadata.id, file.name);
                                                              
                                                              // Close the confirmation
                                                              setDeleteConfirmFile(null);
                                                              
                                                              try {
                                                                console.log('Calling deleteFileSimple with ID:', dbMetadata.id);
                                                                const success = await fileStorageService.deleteFileSimple(dbMetadata.id);
                                                                console.log('Delete result from service:', success);
                                                                
                                                                if (success) {
                                                                  console.log('Delete successful, updating UI...');
                                                                  // Update the state immediately to remove the file from UI
                                                                  setPinFileMetadata(prev => ({
                                                                    ...prev,
                                                                    [selectedPinForExplore]: prev[selectedPinForExplore]?.filter(f => f.id !== dbMetadata.id) || []
                                                                  }));
                                                                  
                                                                  toast({
                                                                    title: "File Deleted",
                                                                    description: `${file.name} has been deleted.`
                                                                  });
                                                                  
                                                                  // Keep the explore dropdown open
                                                                  setShowExploreDropdown(true);
                                                                } else {
                                                                  toast({
                                                                    variant: "destructive",
                                                                    title: "Delete Failed",
                                                                    description: `Failed to delete ${file.name}. Please try again.`
                                                                  });
                                                                }
                                                              } catch (error) {
                                                                console.error('Error during file deletion:', error);
                                                                toast({
                                                                  variant: "destructive",
                                                                  title: "Delete Error",
                                                                  description: "An error occurred while deleting the file."
                                                                });
                                                              }
                                                            }}
                                                          >
                                                            Yes
                                                          </Button>
                                                          <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="h-5 text-[10px] px-1"
                                                            onClick={(e) => {
                                                              e.stopPropagation();
                                                              console.log('Delete NO clicked');
                                                              setDeleteConfirmFile(null);
                                                            }}
                                                          >
                                                            No
                                                          </Button>
                                                        </div>
                                                      ) : (
                                                        // Show delete button
                                                        <Button
                                                          variant="ghost"
                                                          size="sm"
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            console.log('Delete button clicked for file:', dbMetadata.id, file.name);
                                                            setDeleteConfirmFile({ id: dbMetadata.id, name: file.name });
                                                          }}
                                                          className="h-6 w-6 p-0 flex-shrink-0"
                                                          title={`Delete ${file.name}`}
                                                        >
                                                          <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                                                        </Button>
                                                      )
                                                    )}
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        );
                                      });
                                    })()}
                                  </div>
                                )}
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  // Don't close the dropdown, just trigger file upload
                                  // Determine if this is a pin or area based on properties
                                  const targetType = ('fillVisible' in itemToEdit && 'path' in itemToEdit) ? 'area' : 'pin';
                                  handleFileUpload(itemToEdit.id, targetType);
                                }}
                                disabled={isUploadingFiles}
                                className="w-full justify-start gap-2 h-8 text-xs"
                              >
                                {isUploadingFiles ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Upload className="h-3 w-3" />
                                )}
                                {isUploadingFiles ? 'Uploading...' : 'Upload data'}
                              </Button>
                              {/* Marine & Meteorological Data Button */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowMeteoDataSection(!showMeteoDataSection)}
                                className="w-full justify-start gap-2 h-8 text-xs"
                              >
                                <BarChart3 className="h-3 w-3" />
                                Marine & meteo data
                                {showMeteoDataSection ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
                              </Button>
                              
                              {/* Marine & Meteo Data Expanded Section */}
                              {showMeteoDataSection && (
                                <div className="px-2 pb-2 space-y-3 border-l-2 border-accent/20 ml-2 w-[750px] max-h-[600px] overflow-y-auto">
                                  {/* Date Range and Fetch Button Row */}
                                  <div className="flex gap-2 items-end">
                                    {/* Date Range Selection */}
                                    <div className="flex-1">
                                      <div className="text-sm font-medium mb-1">Date Range</div>
                                      <DatePickerWithRange 
                                        date={pinMeteoDateRange} 
                                        onDateChange={setPinMeteoDateRange} 
                                        disabled={isLoadingPinMeteoData}
                                        className="h-7 text-sm w-full"
                                      />
                                      {pinMeteoDateRange?.from && pinMeteoDateRange?.to && pinMeteoDateRange.from > pinMeteoDateRange.to && (
                                        <p className="text-xs text-destructive mt-1">Start date must be before end date.</p>
                                      )}
                                    </div>
                                    
                                    {/* Fetch Button */}
                                    <Button 
                                      onClick={() => {
                                        handleFetchPinMeteoData();
                                        // Keep the dropdown open - remove setShowDataDropdown(false)
                                      }} 
                                      disabled={isLoadingPinMeteoData || !pinMeteoDateRange?.from || !pinMeteoDateRange?.to} 
                                      className="h-7 text-sm px-3 flex-shrink-0"
                                      size="sm"
                                    >
                                      {isLoadingPinMeteoData ? <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" /> : <Search className="mr-1 h-2.5 w-2.5"/>}
                                      {isLoadingPinMeteoData ? "Fetching..." : "Fetch Data"}
                                    </Button>
                                  </div>

                                  {/* Loading skeleton while fetching data */}
                                  {isLoadingPinMeteoData && (
                                    <div className="mt-3">
                                      <MarinePlotsSkeleton />
                                    </div>
                                  )}

                                  {/* Meteo Data Display - MarinePlotsGrid Style with Double Width and Expandable Panel */}
                                  {!isLoadingPinMeteoData && pinMeteoData && pinMeteoData.length > 0 && (
                                    <div className="w-full">
                                      {/* Header */}
                                      <div className="mb-2 flex items-center justify-between">
                                        <div className="text-base font-semibold text-foreground">
                                          {pinMeteoLocationContext} - {pinMeteoData.length} points
                                        </div>
                                        {/* Expand/Collapse Toggle */}
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => setPinMeteoExpanded(!pinMeteoExpanded)}
                                          className="h-6 w-6 p-0"
                                        >
                                          <ChevronDown 
                                            className={`h-4 w-4 transition-transform duration-200 ${
                                              pinMeteoExpanded ? 'transform rotate-180' : ''
                                            }`} 
                                          />
                                        </Button>
                                      </div>
                                      
                                      {/* Marine Data Container */}
                                      <div 
                                        className={`w-full border rounded-md bg-card/20 transition-all duration-300 ${
                                          pinMeteoExpanded ? 'max-h-[800px]' : 'max-h-[400px]'
                                        }`}
                                      >
                                        <div 
                                          className={`flex-grow flex flex-col space-y-1 overflow-y-auto pr-1 p-2 ${
                                            pinMeteoExpanded ? 'max-h-[700px]' : 'max-h-[300px]'
                                          }`}
                                        >
                                          {pinMeteoPlotConfigsInternal.map((config, index) => (
                                            <PinMeteoPlotRow
                                              key={config.dataKey}
                                              config={config}
                                              index={index}
                                              plotCount={pinMeteoPlotConfigsInternal.length}
                                              displayData={pinMeteoDisplayData}
                                              isPlotVisible={pinMeteoPlotVisibility[config.dataKey] ?? false}
                                              availabilityStatus={pinMeteoSeriesDataAvailability[config.dataKey] || 'pending'}
                                              dailyReferenceLines={pinMeteoDailyReferenceLines}
                                              onVisibilityChange={handlePinMeteoPlotVisibilityChange}
                                              onMove={handlePinMeteoMovePlot}
                                            />
                                          ))}
                                        </div>

                                        {/* Time Brush Selector */}
                                        {pinMeteoData && pinMeteoData.length > 0 && (
                                          <div className="h-[104px] sm:h-[96px] w-full border rounded-md p-2 shadow-sm bg-card mt-4 flex-shrink-0">
                                            <ResponsiveContainer width="100%" height="100%">
                                              <LineChart data={pinMeteoData} margin={{ top: 10, right: 30, left: 30, bottom: 0 }}>
                                                <XAxis
                                                  dataKey="time"
                                                  tickFormatter={formatDateTickBrush}
                                                  stroke="hsl(var(--muted-foreground))"
                                                  tick={{ fontSize: '0.65rem' }}
                                                  height={30}
                                                  interval="preserveStartEnd"
                                                />
                                                <Brush
                                                  dataKey="time"
                                                  height={44}
                                                  stroke="hsl(var(--primary))"
                                                  fill="transparent"
                                                  tickFormatter={() => ""} // Hide labels on brush itself
                                                  travellerWidth={24} // Larger for easier touch interaction
                                                  startIndex={pinMeteoBrushStartIndex}
                                                  endIndex={pinMeteoBrushEndIndex}
                                                  onChange={handlePinMeteoBrushChange}
                                                  y={36} 
                                                />
                                              </LineChart>
                                            </ResponsiveContainer>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {/* Error Display */}
                                  {errorPinMeteoData && (
                                    <div className="mt-2 p-2 border rounded-md bg-destructive/10 border-destructive/20">
                                      <div className="text-sm text-destructive font-medium">
                                        {errorPinMeteoData}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  // Edit Mode
                  <>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-muted-foreground">Label:</label>
                        <Input
                          ref={labelInputRef}
                          value={editingLabel}
                          onChange={(e) => setEditingLabel(e.target.value)}
                          placeholder="Enter label..."
                          className="mt-1 h-8"
                        />
                      </div>
                      
                      {/* Project Assignment */}
                      <div>
                        <label className="text-xs text-muted-foreground">Project:</label>
                        <Select
                          value={editingProjectId || 'unassigned'}
                          onValueChange={(value) => setEditingProjectId(value === 'unassigned' ? null : value)}
                        >
                          <SelectTrigger className="mt-1 h-8">
                            <SelectValue placeholder="Select a project">
                              {editingProjectId 
                                ? dynamicProjects[editingProjectId]?.name 
                                : 'Unassigned'}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="z-[9999]">
                            <SelectItem value="unassigned">
                              Unassigned
                            </SelectItem>
                            {Object.entries(dynamicProjects).map(([key, location]) => (
                              <SelectItem key={key} value={key}>
                                {location.name} {key === activeProjectId ? '(Active)' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {itemToEdit && itemToEdit.projectId && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Currently: {dynamicProjects[itemToEdit.projectId]?.name || 'Unknown'}
                          </div>
                        )}
                      </div>
                      
                      {/* Notes section - collapsible */}
                      <div>
                        <div className="flex items-center justify-between">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowNotesSection(!showNotesSection)}
                            className="h-6 px-0 text-xs text-muted-foreground hover:text-foreground"
                          >
                            {showNotesSection ? (
                              <ChevronDown className="h-3 w-3 mr-1" />
                            ) : (
                              <ChevronRight className="h-3 w-3 mr-1" />
                            )}
                            Notes {editingNotes.trim() && !showNotesSection ? '●' : ''}
                          </Button>
                        </div>
                        
                        {showNotesSection && (
                          <div className="mt-2">
                            <Textarea
                              value={editingNotes}
                              onChange={(e) => setEditingNotes(e.target.value)}
                              placeholder="Enter notes..."
                              className="text-xs"
                              rows={2}
                            />
                          </div>
                        )}
                      </div>

                      {/* Coordinate editing - only show for pins */}
                      {itemToEdit && 'lat' in itemToEdit && (
                        <>
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-xs text-muted-foreground">Coordinates:</label>
                              <div className="flex items-center gap-1">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground"
                                        onClick={handleMovePinToCenter}
                                      >
                                        <Target className="h-3 w-3" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                      <p>Move pin to current position</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                
                                <Popover open={showCoordinateFormatPopover} onOpenChange={setShowCoordinateFormatPopover}>
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground"
                                    >
                                      <Settings className="h-3 w-3" />
                                    </Button>
                                  </PopoverTrigger>
                                <PopoverContent className="w-60 p-2 z-[9999]" align="end">
                                  <div className="space-y-2">
                                    <div className="text-xs font-medium">Coordinate Format</div>
                                    <div className="space-y-1">
                                      {(Object.keys(COORDINATE_FORMAT_LABELS) as CoordinateFormat[]).map((format) => (
                                        <button
                                          key={format}
                                          onClick={() => {
                                            handleCoordinateFormatChange(format);
                                            setShowCoordinateFormatPopover(false);
                                          }}
                                          className={`w-full text-left p-2 text-xs rounded hover:bg-accent ${coordinateFormat === format ? 'bg-accent' : ''}`}
                                        >
                                          <div className="font-medium">{COORDINATE_FORMAT_LABELS[format]}</div>
                                          <div className="text-muted-foreground">{COORDINATE_FORMAT_EXAMPLES[format]}</div>
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                </PopoverContent>
                              </Popover>
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <Input
                                  value={editingLat}
                                  onChange={(e) => setEditingLat(e.target.value)}
                                  placeholder={coordinateFormat === 'decimal' ? 'e.g., 51.68498' : coordinateFormat === 'degreeMinutes' ? 'e.g., 51°41.099\'' : 'e.g., 51°41\'5.9"'}
                                  className="h-8 font-mono text-xs"
                                  type={coordinateFormat === 'decimal' ? 'number' : 'text'}
                                  step={coordinateFormat === 'decimal' ? 'any' : undefined}
                                />
                                <span className="text-xs text-muted-foreground">Latitude</span>
                              </div>
                              <div>
                                <Input
                                  value={editingLng}
                                  onChange={(e) => setEditingLng(e.target.value)}
                                  placeholder={coordinateFormat === 'decimal' ? 'e.g., 5.16133' : coordinateFormat === 'degreeMinutes' ? 'e.g., 5°9.680\'' : 'e.g., 5°9\'40.8"'}
                                  className="h-8 font-mono text-xs"
                                  type={coordinateFormat === 'decimal' ? 'number' : 'text'}
                                  step={coordinateFormat === 'decimal' ? 'any' : undefined}
                                />
                                <span className="text-xs text-muted-foreground">Longitude</span>
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                      
                      {/* Area coordinate editing */}
                      {itemToEdit && 'path' in itemToEdit && 'fillVisible' in itemToEdit && Array.isArray(itemToEdit.path) && (
                        <>
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-xs text-muted-foreground">Area Coordinates:</label>
                              <div className="flex items-center gap-1">
                                {!isAreaCornerDragging ? (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-6 px-2 text-xs"
                                          onClick={() => {
                                            setIsAreaCornerDragging(true);
                                            setTempAreaPath([...itemToEdit.path]);
                                          }}
                                        >
                                          <Move3D className="h-3 w-3 mr-1" />
                                          Drag
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">
                                        <p className="text-xs">Click to drag corners on map</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    <Button
                                      variant="default"
                                      size="sm"
                                      className="h-6 px-2 text-xs"
                                      onClick={handleSaveAreaCornerEdit}
                                    >
                                      <Check className="h-3 w-3 mr-1" />
                                      Save
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-6 px-2 text-xs"
                                      onClick={handleCancelAreaCornerEdit}
                                    >
                                      <X className="h-3 w-3 mr-1" />
                                      Cancel
                                    </Button>
                                  </div>
                                )}
                                <Popover open={showCoordinateFormatPopover} onOpenChange={setShowCoordinateFormatPopover}>
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground"
                                    >
                                      <Settings className="h-3 w-3" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-60 p-2 z-[9999]" align="end">
                                    <div className="space-y-2">
                                      <div className="text-xs font-medium">Coordinate Format</div>
                                      <div className="space-y-1">
                                        {(Object.keys(COORDINATE_FORMAT_LABELS) as CoordinateFormat[]).map((format) => (
                                          <button
                                            key={format}
                                            onClick={() => {
                                              handleCoordinateFormatChange(format);
                                              setShowCoordinateFormatPopover(false);
                                            }}
                                            className={cn(
                                              "w-full text-left px-2 py-1 rounded text-xs",
                                              coordinateFormat === format
                                                ? "bg-primary text-primary-foreground"
                                                : "hover:bg-muted"
                                            )}
                                          >
                                            <div className="font-medium">{COORDINATE_FORMAT_LABELS[format]}</div>
                                            <div className="text-xs opacity-75">{COORDINATE_FORMAT_EXAMPLES[format]}</div>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              </div>
                            </div>
                            <div className="space-y-2 max-h-40 overflow-y-auto">
                              {itemToEdit.path.map((point, index) => {
                                const latFormats = getCoordinateFormats(point.lat);
                                const lngFormats = getCoordinateFormats(point.lng);
                                
                                return (
                                  <div key={index} className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="text-xs text-muted-foreground">
                                        Corner {index + 1} Lat:
                                      </label>
                                      <Input
                                        value={editingAreaCoords[index]?.[0] || latFormats[coordinateFormat]}
                                        onChange={(e) => {
                                          const newCoords = [...editingAreaCoords];
                                          while (newCoords.length <= index) {
                                            newCoords.push(['', '']);
                                          }
                                          newCoords[index][0] = e.target.value;
                                          setEditingAreaCoords(newCoords);
                                        }}
                                        placeholder={COORDINATE_FORMAT_EXAMPLES[coordinateFormat]}
                                        className="h-7 text-xs"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-xs text-muted-foreground">
                                        Corner {index + 1} Lng:
                                      </label>
                                      <Input
                                        value={editingAreaCoords[index]?.[1] || lngFormats[coordinateFormat]}
                                        onChange={(e) => {
                                          const newCoords = [...editingAreaCoords];
                                          while (newCoords.length <= index) {
                                            newCoords.push(['', '']);
                                          }
                                          newCoords[index][1] = e.target.value;
                                          setEditingAreaCoords(newCoords);
                                        }}
                                        placeholder={COORDINATE_FORMAT_EXAMPLES[coordinateFormat]}
                                        className="h-7 text-xs"
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </>
                      )}
                      
                      <div>
                        <label className="text-xs text-muted-foreground">Color & Size:</label>
                        <div className="flex items-center gap-2 mt-1">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className="w-10 h-8 p-0 rounded border"
                                style={{ backgroundColor: editingColor }}
                              >
                                <span className="sr-only">Pick color</span>
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent 
                              className="w-72 p-3 z-[1100]" 
                              side="right" 
                              align="start"
                              sideOffset={8}
                            >
                              <div className="space-y-3">
                                <div>
                                  <label className="text-sm font-medium mb-2 block">Preset Colors</label>
                                  <div className="grid grid-cols-6 gap-1.5">
                                    {[
                                      '#ef4444', // Red
                                      '#f97316', // Orange  
                                      '#eab308', // Yellow
                                      '#22c55e', // Green
                                      '#3b82f6', // Blue
                                      '#6366f1', // Indigo
                                      '#8b5cf6', // Violet
                                      '#ec4899', // Pink
                                      '#06b6d4', // Cyan
                                      '#10b981', // Emerald
                                      '#84cc16', // Lime
                                      '#64748b', // Slate
                                    ].map((color) => (
                                      <button
                                        key={color}
                                        onClick={() => {
                                          setEditingColor(color);
                                          // Auto-apply color change
                                          if (itemToEdit) {
                                            if ('lat' in itemToEdit) {
                                              updatePinData(itemToEdit.id, { color: color, size: editingSize });
                                            } else if ('path' in itemToEdit && Array.isArray(itemToEdit.path)) {
                                              if ('fillVisible' in itemToEdit) {
                                                updateAreaData(itemToEdit.id, { color: color, size: editingSize });
                                              } else {
                                                updateLineData(itemToEdit.id, { color: color, size: editingSize });
                                              }
                                            }
                                          }
                                        }}
                                        className={cn(
                                          "w-8 h-8 rounded border-2 transition-all hover:scale-110",
                                          editingColor === color ? "border-white ring-2 ring-primary" : "border-gray-200"
                                        )}
                                        style={{ backgroundColor: color }}
                                        title={color}
                                      />
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <label className="text-sm font-medium mb-2 block">Custom Color</label>
                                  <input
                                    type="color"
                                    value={editingColor}
                                    onChange={(e) => {
                                      setEditingColor(e.target.value);
                                      // Auto-apply color change
                                      if (itemToEdit) {
                                        if ('lat' in itemToEdit) {
                                          updatePinData(itemToEdit.id, { color: e.target.value, size: editingSize });
                                        } else if ('path' in itemToEdit && Array.isArray(itemToEdit.path)) {
                                          if ('fillVisible' in itemToEdit) {
                                            updateAreaData(itemToEdit.id, { color: e.target.value, size: editingSize });
                                          } else {
                                            updateLineData(itemToEdit.id, { color: e.target.value, size: editingSize });
                                          }
                                        }
                                      }
                                    }}
                                    className="w-full h-8 rounded border cursor-pointer"
                                  />
                                  <div className="text-xs text-muted-foreground mt-1 text-center">
                                    {editingColor.toUpperCase()}
                                  </div>
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                          <Select 
                            value={editingSize.toString()} 
                            onValueChange={(value) => {
                              const newSize = parseInt(value);
                              setEditingSize(newSize);
                              // Auto-apply size change
                              if (itemToEdit) {
                                if ('lat' in itemToEdit) {
                                  updatePinData(itemToEdit.id, { color: editingColor, size: newSize });
                                } else if ('path' in itemToEdit && Array.isArray(itemToEdit.path)) {
                                  if ('fillVisible' in itemToEdit) {
                                    updateAreaData(itemToEdit.id, { color: editingColor, size: newSize });
                                  } else {
                                    updateLineData(itemToEdit.id, { color: editingColor, size: newSize });
                                  }
                                }
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs flex-1">
                              <SelectValue>
                                {editingSize === 2 ? 'Size: Small' : 
                                 editingSize === 4 ? 'Size: Medium' : 
                                 editingSize === 8 ? 'Size: Large' : 'Size: Small'}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent className="z-[1200]">
                              <SelectItem value="2">Small</SelectItem>
                              <SelectItem value="4">Medium</SelectItem>
                              <SelectItem value="8">Large</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      
                      {/* Fill Transparency - only show for areas */}
                      {itemToEdit && 'path' in itemToEdit && 'fillVisible' in itemToEdit && (
                        <div>
                          <label className="text-xs text-muted-foreground">Fill Transparency:</label>
                          <div className="mt-1">
                            <Select 
                              value={editingTransparency.toString()} 
                              onValueChange={(value) => {
                                const newTransparency = parseInt(value);
                                setEditingTransparency(newTransparency);
                                // Auto-apply transparency change
                                if (itemToEdit) {
                                  updateAreaData(itemToEdit.id, { transparency: newTransparency });
                                }
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue>
                                  {editingTransparency}% opacity
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent className="z-[1200]">
                                <SelectItem value="0">0% (Transparent)</SelectItem>
                                <SelectItem value="20">20%</SelectItem>
                                <SelectItem value="50">50%</SelectItem>
                                <SelectItem value="75">75%</SelectItem>
                                <SelectItem value="100">100% (Opaque)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                      
                      {/* Label visibility toggle - show for all object types */}
                      {itemToEdit && (
                        <div>
                          <label className="text-xs text-muted-foreground">Display Options:</label>
                          <div className="mt-1 space-y-2">
                            <div className="flex items-center space-x-2">
                              <Checkbox 
                                id="show-label"
                                checked={itemToEdit.labelVisible !== false}
                                onCheckedChange={(checked) => {
                                  const objectType = 'lat' in itemToEdit ? 'pin' : 
                                                   'fillVisible' in itemToEdit ? 'area' : 'line';
                                  handleToggleLabel(itemToEdit.id, objectType);
                                }}
                              />
                              <Label htmlFor="show-label" className="text-xs">Show label on map</Label>
                            </div>
                            {/* Fill visibility toggle - only show for areas */}
                            {itemToEdit && 'path' in itemToEdit && 'fillVisible' in itemToEdit && (
                              <div className="flex items-center space-x-2">
                                <Checkbox 
                                  id="show-fill"
                                  checked={itemToEdit.fillVisible !== false}
                                  onCheckedChange={() => {
                                    handleToggleFill(itemToEdit.id);
                                  }}
                                />
                                <Label htmlFor="show-fill" className="text-xs">Show area fill</Label>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex gap-2 pt-2 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCancelEdit}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveEdit}
                        className="flex-1"
                      >
                        Save
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}


            {/* Data Explorer Button - Hide when panel is open */}
            {!showDataExplorerPanel && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('open-data-explorer-panel'));
                      }}
                      className="h-10 w-10 rounded-full shadow-lg border-0 backdrop-blur-sm transition-all duration-200 hover:scale-105 bg-primary/90 hover:bg-primary text-primary-foreground"
                    >
                      <Database className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Data Explorer</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Floating Drawing Tools Button - Hide when panel is open */}
            {!showDataExplorerPanel && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowFloatingDrawingTools(!showFloatingDrawingTools)}
                      className={`h-10 w-10 rounded-full shadow-lg border-0 backdrop-blur-sm transition-all duration-200 hover:scale-105 ${
                        (drawingMode !== 'none' || isDrawingLine || isDrawingArea)
                          ? 'bg-accent/90 hover:bg-accent text-accent-foreground'
                          : 'bg-primary/90 hover:bg-primary text-primary-foreground'
                      }`}
                    >
                      <Edit3 className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Drawing Tools</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            
            {/* Floating Drawing Tools Dropdown */}
            {showFloatingDrawingTools && (
              <div className="w-48 bg-background border rounded-lg shadow-xl p-2 space-y-1">
                <div className="text-xs text-muted-foreground mb-2 px-2">
                  Create objects in active project
                </div>
                
                <Button 
                  variant="ghost"
                  size="sm" 
                  className={`w-full justify-start gap-3 h-10 text-sm ${
                    drawingMode === 'pin' ? 'bg-accent text-accent-foreground' : ''
                  }`}
                  onClick={async () => {
                    if (mapRef.current) {
                      const mapCenter = mapRef.current.getCenter();
                      
                      // Create pin directly with default label
                      const pinData = {
                        lat: mapCenter.lat,
                        lng: mapCenter.lng,
                        label: 'New Pin',
                        notes: '',
                        projectId: activeProjectId,
                        tagIds: [],
                        labelVisible: true
                      };
                      
                      try {
                        const newPin = await createPinData(pinData);
                        
                        // Immediately select this pin and enter edit mode
                        setItemToEdit(newPin);
                        setIsEditingObject(true);
                        setShowFloatingDrawingTools(false);
                        
                        toast({
                          title: "Pin Created",
                          description: "Pin added and ready for editing."
                        });
                      } catch (error) {
                        console.error('Error creating pin:', error);
                        toast({
                          variant: "destructive",
                          title: "Error",
                          description: "Failed to create pin. Please try again."
                        });
                      }
                    }
                  }}
                >
                  <MapPin className="h-4 w-4" />
                  Add Pin
                </Button>
                
                <Button 
                  variant="ghost"
                  size="sm" 
                  className={`w-full justify-start gap-3 h-10 text-sm ${
                    isDrawingLine ? 'bg-accent text-accent-foreground' : ''
                  }`}
                  onClick={() => {
                    if (mapRef.current) {
                      if (isDrawingLine) {
                        handleLineCancelDrawing();
                      } else {
                        const mapCenter = mapRef.current.getCenter();
                        setLineStartPoint(mapCenter);
                        setCurrentMousePosition(mapCenter);
                        setIsDrawingLine(true);
                        setDrawingMode('line');
                      }
                      setShowFloatingDrawingTools(false);
                    }
                  }}
                >
                  <Minus className="h-4 w-4" />
                  {isDrawingLine ? 'Cancel Line' : 'Draw Line'}
                </Button>
                
                <Button 
                  variant="ghost"
                  size="sm" 
                  className={`w-full justify-start gap-3 h-10 text-sm ${
                    isDrawingArea ? 'bg-accent text-accent-foreground' : ''
                  }`}
                  onClick={() => {
                    if (isDrawingArea) {
                      handleAreaCancelDrawing();
                    } else {
                      handleAreaStart();
                    }
                    setShowFloatingDrawingTools(false);
                  }}
                >
                  <Square className="h-4 w-4" />
                  {isDrawingArea ? 'Cancel Area' : 'Draw Area'}
                </Button>

                {/* Current Drawing Status */}
                {(drawingMode !== 'none' || isDrawingLine || isDrawingArea) && (
                  <div className="mt-2 p-2 bg-accent/10 rounded text-xs">
                    <div className="font-medium text-accent mb-1">Currently Drawing:</div>
                    <div className="text-muted-foreground">
                      {isDrawingLine && "Line - Drag map to set endpoint"}
                      {isDrawingArea && `Area - ${pendingAreaPath.length} corners added`}
                      {drawingMode === 'pin' && "Pin mode active"}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Sidebar Menu - Always rendered for animation */}
          <>
            {/* Sidebar - always present but translated off-screen when closed */}
            <div
              className={`fixed left-0 bg-background border-r shadow-xl z-[1600] transform transition-transform duration-300 ease-in-out overflow-y-auto ${
                showMainMenu ? 'translate-x-0' : '-translate-x-full'
              }`}
              style={{
                width: `${sidebarWidth}px`,
                top: '80px', // Start below the header bar
                height: 'calc(100vh - 80px)', // Adjust height accordingly
                transition: 'width 0.3s ease-out' // Smooth width transitions
              }}
              data-menu-dropdown
              data-sidebar
            >
              {/* Resize handle and collapse button - only show when sidebar is open */}
              {showMainMenu && (
                <>
                  {/* Resize Handle */}
                  <div 
                    className="absolute top-0 bottom-0 -right-1 w-2 cursor-col-resize z-20 flex items-center justify-center hover:bg-accent/10 transition-colors group"
                    onMouseDown={handleResizeStart}
                  >
                    {/* Double vertical line */}
                    <div className="flex gap-0.5">
                      <div className="w-px h-8 bg-border group-hover:bg-accent/40 transition-colors"></div>
                      <div className="w-px h-8 bg-border group-hover:bg-accent/40 transition-colors"></div>
                    </div>
                  </div>
                  
                  {/* Collapse button */}
                  <div className="absolute top-1/2 -translate-y-1/2 -right-2.5 z-10">
                    <Button
                      variant="ghost"
                      onClick={() => setShowMainMenu(false)}
                      className="h-8 w-2.5 rounded-r-md rounded-l-none bg-background/95 border border-l-0 hover:bg-muted/80 flex items-center justify-center shadow-sm p-0"
                    >
                      <ChevronRight className="h-2.5 w-2.5 rotate-180 text-muted-foreground" />
                    </Button>
                  </div>
                </>
              )}
              
              <div className="p-4">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-semibold">Menu</h2>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowMainMenu(false)}
                      className="h-8 w-8"
                    >
                      <Menu className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  {/* Active Project - First Item */}
                  <div className="space-y-2">
                    {(() => {
                      const activeProject = dynamicProjects[activeProjectId];
                      if (!activeProject) return null;
                      
                      const projectPins = pins.filter(p => p.projectId === activeProjectId);
                      const projectLines = lines.filter(l => l.projectId === activeProjectId);
                      const projectAreas = areas.filter(a => a.projectId === activeProjectId);
                      const totalObjects = projectPins.length + projectLines.length + projectAreas.length;
                      
                      return (
                        <div className="border-l-4 border-accent rounded-sm mb-4 pl-2">
                          {/* Clickable header with arrow and separate center button */}
                          <div className="flex items-center gap-1">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    className="h-6 w-6 p-0 hover:bg-accent/20 rounded inline-flex items-center justify-center"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      // Calculate bounding box and optimal zoom for all active project objects
                                      if (totalObjects > 0 && mapRef.current) {
                                        let minLat = Infinity;
                                        let maxLat = -Infinity;
                                        let minLng = Infinity;
                                        let maxLng = -Infinity;
                                        
                                        // Process pins
                                        projectPins.forEach(pin => {
                                          minLat = Math.min(minLat, pin.lat);
                                          maxLat = Math.max(maxLat, pin.lat);
                                          minLng = Math.min(minLng, pin.lng);
                                          maxLng = Math.max(maxLng, pin.lng);
                                        });
                                        
                                        // Process line points
                                        projectLines.forEach(line => {
                                          line.path.forEach(point => {
                                            minLat = Math.min(minLat, point.lat);
                                            maxLat = Math.max(maxLat, point.lat);
                                            minLng = Math.min(minLng, point.lng);
                                            maxLng = Math.max(maxLng, point.lng);
                                          });
                                        });
                                        
                                        // Process area points
                                        projectAreas.forEach(area => {
                                          area.path.forEach(point => {
                                            minLat = Math.min(minLat, point.lat);
                                            maxLat = Math.max(maxLat, point.lat);
                                            minLng = Math.min(minLng, point.lng);
                                            maxLng = Math.max(maxLng, point.lng);
                                          });
                                        });
                                        
                                        // Calculate center
                                        const centerLat = (minLat + maxLat) / 2;
                                        const centerLng = (minLng + maxLng) / 2;
                                        
                                        // Calculate the bounds span
                                        const latSpan = maxLat - minLat;
                                        const lngSpan = maxLng - minLng;
                                        
                                        // Calculate zoom level to fit bounds
                                        // Account for map container size (estimate viewport dimensions)
                                        const mapContainer = document.querySelector('.leaflet-container');
                                        const mapWidth = mapContainer?.clientWidth || 800;
                                        const mapHeight = mapContainer?.clientHeight || 600;
                                        
                                        // Account for sidebar if open (reduce effective width)
                                        const effectiveWidth = sidebarWidth > 0 ? mapWidth - sidebarWidth : mapWidth;
                                        
                                        // Calculate zoom level (simplified formula, works for most cases)
                                        const WORLD_DIM = { height: 256, width: 256 };
                                        const ZOOM_MAX = 18;
                                        
                                        function latRad(lat: number) {
                                          const sin = Math.sin(lat * Math.PI / 180);
                                          const radX2 = Math.log((1 + sin) / (1 - sin)) / 2;
                                          return Math.max(Math.min(radX2, Math.PI), -Math.PI) / 2;
                                        }
                                        
                                        function zoom(mapPx: number, worldPx: number, fraction: number) {
                                          return Math.floor(Math.log(mapPx / worldPx / fraction) / Math.LN2);
                                        }
                                        
                                        const latFraction = (latRad(maxLat) - latRad(minLat)) / Math.PI;
                                        const lngDiff = maxLng - minLng;
                                        const lngFraction = ((lngDiff < 0) ? (lngDiff + 360) : lngDiff) / 360;
                                        
                                        const latZoom = zoom(mapHeight, WORLD_DIM.height, latFraction);
                                        const lngZoom = zoom(effectiveWidth, WORLD_DIM.width, lngFraction);
                                        
                                        let finalZoom = Math.min(latZoom, lngZoom, ZOOM_MAX);
                                        
                                        // Add some padding (zoom out slightly to ensure everything is visible)
                                        finalZoom = Math.max(1, finalZoom - 1);
                                        
                                        // If bounds are very small (single point or close points), use default zoom
                                        if (latSpan < 0.001 && lngSpan < 0.001) {
                                          finalZoom = 15;
                                        }
                                        
                                        mapRef.current.setView([centerLat, centerLng], finalZoom);
                                        toast({
                                          title: "Map Centered",
                                          description: `Showing all ${totalObjects} objects in ${activeProject.name}`,
                                          duration: 2000
                                        });
                                      } else if (mapRef.current) {
                                        // No objects, center on project location
                                        mapRef.current.setView([activeProject.lat, activeProject.lon], 12);
                                        toast({
                                          title: "Map Centered",
                                          description: `Centered on ${activeProject.name} location`,
                                          duration: 2000
                                        });
                                      }
                                    }}
                                  >
                                    <Crosshair className="h-4 w-4 text-accent" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="right">
                                  <p>Center map on project</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <div className="flex-1">
                              <Button 
                                variant="ghost"
                                size="sm" 
                                onClick={() => setShowProjectInfo(showProjectInfo === activeProjectId ? null : activeProjectId)}
                                className="w-full justify-between gap-3 h-auto p-3 text-left hover:bg-muted/30"
                              >
                                <div className="flex items-center gap-2 ml-2">
                                  <div>
                                    <div className="text-sm font-medium text-foreground">
                                      {activeProject.name}
                                    </div>
                                    <div className="text-xs text-accent font-medium">
                                      Active Project
                                    </div>
                                    {totalObjects > 0 && (
                                      <div className="text-xs text-muted-foreground">
                                        {totalObjects} objects ({projectPins.length} pins, {projectLines.length} lines, {projectAreas.length} areas)
                                      </div>
                                    )}
                                  </div>
                                </div>
                                {showProjectInfo === activeProjectId ? (
                                  <ChevronDown className="h-4 w-4 text-accent" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-accent" />
                                )}
                              </Button>
                              <div className="flex gap-1 mt-2 px-3">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-xs px-2"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCurrentProjectContext(activeProjectId);
                                    setShowProjectDataDialog(true);
                                  }}
                                >
                                  <Database className="h-3 w-3 mr-1" />
                                  Project Data
                                </Button>
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-6 w-6 p-0"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const allLabelsVisible = [...projectPins, ...projectLines, ...projectAreas]
                                            .every(obj => obj.labelVisible !== false);
                                          handleToggleAllLabels(activeProjectId, !allLabelsVisible);
                                        }}
                                      >
                                        {(() => {
                                          const allLabelsVisible = [...projectPins, ...projectLines, ...projectAreas]
                                            .every(obj => obj.labelVisible !== false);
                                          return allLabelsVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />;
                                        })()}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="right">
                                      <p>Toggle all labels</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-6 w-6 p-0"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const allObjectsVisible = [...projectPins, ...projectLines, ...projectAreas]
                                            .every(obj => obj.objectVisible !== false);
                                          handleToggleAllObjects(activeProjectId, !allObjectsVisible);
                                        }}
                                      >
                                        {(() => {
                                          const allObjectsVisible = [...projectPins, ...projectLines, ...projectAreas]
                                            .every(obj => obj.objectVisible !== false);
                                          return allObjectsVisible ? <MapPin className="h-3 w-3" /> : <MapPin className="h-3 w-3 opacity-40" />;
                                        })()}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="right">
                                      <p>Toggle all objects</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCurrentProjectContext(activeProjectId);
                                    setProjectNameEdit(dynamicProjects[activeProjectId]?.name || '');
                                    setShowProjectSettingsDialog(true);
                                  }}
                                >
                                  <Settings className="h-3 w-3" />
                                </Button>
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant={isBulkDeleteMode ? "destructive" : "outline"}
                                        size="sm"
                                        className="h-6 w-6 p-0"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          console.log('🗑️ [BULK DELETE MODE] Trash button clicked');
                                          console.log('🗑️ [BULK DELETE MODE] Current isBulkDeleteMode:', isBulkDeleteMode);
                                          if (isBulkDeleteMode) {
                                            // Cancel bulk delete mode
                                            console.log('🗑️ [BULK DELETE MODE] Canceling bulk delete mode');
                                            setIsBulkDeleteMode(false);
                                            clearObjectSelection();
                                          } else {
                                            // Enter bulk delete mode
                                            console.log('🗑️ [BULK DELETE MODE] Entering bulk delete mode');
                                            setIsBulkDeleteMode(true);
                                          }
                                        }}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="right">
                                      <p>{isBulkDeleteMode ? 'Cancel bulk delete' : 'Bulk delete objects'}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                {isBulkDeleteMode && selectedObjectIds.size > 0 && (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="destructive"
                                          size="sm"
                                          className="h-6 px-2 text-xs"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            console.log('✅ [BULK DELETE] Confirm button clicked');
                                            console.log('✅ [BULK DELETE] selectedObjectIds size:', selectedObjectIds.size);
                                            console.log('✅ [BULK DELETE] selectedObjectIds array:', Array.from(selectedObjectIds));
                                            console.log('✅ [BULK DELETE] Opening batch delete confirmation dialog');
                                            setShowBatchDeleteConfirmDialog(true);
                                          }}
                                        >
                                          <Check className="h-3 w-3 mr-1" />
                                          Confirm ({selectedObjectIds.size})
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="right">
                                        <p>Delete {selectedObjectIds.size} selected object{selectedObjectIds.size !== 1 ? 's' : ''}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                              </div>
                            </div>

                          </div>


                          {/* Active Project Objects Dropdown */}
                          {showProjectInfo === activeProjectId && (
                            <div className="px-3 pb-3 pt-4">

                              {/* Filter Buttons Row */}
                              {totalObjects > 0 && (
                                <div className="flex gap-1 mb-2">
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant={objectTypeFilter === 'all' ? 'default' : 'outline'}
                                          size="sm"
                                          className="h-6 text-xs px-2 flex-1"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setObjectTypeFilter('all');
                                          }}
                                        >
                                          All
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="bottom">
                                        <p>Show all objects</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant={objectTypeFilter === 'pin' ? 'default' : 'outline'}
                                          size="sm"
                                          className="h-6 w-6 p-0"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setObjectTypeFilter('pin');
                                          }}
                                        >
                                          <MapPin className="h-3 w-3 text-blue-500" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="bottom">
                                        <p>Show pins only</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant={objectTypeFilter === 'line' ? 'default' : 'outline'}
                                          size="sm"
                                          className="h-6 w-6 p-0"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setObjectTypeFilter('line');
                                          }}
                                        >
                                          <Minus className="h-3 w-3 text-green-500" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="bottom">
                                        <p>Show lines only</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant={objectTypeFilter === 'area' ? 'default' : 'outline'}
                                          size="sm"
                                          className="h-6 w-6 p-0"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setObjectTypeFilter('area');
                                          }}
                                        >
                                          <Square className="h-3 w-3 text-red-500" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="bottom">
                                        <p>Show areas only</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>
                              )}

                              {/* Bulk selection controls - show when objects are selected */}
                              {selectedObjectIds.size > 0 && (
                                <div className="flex items-center justify-between p-2 bg-blue-100 dark:bg-blue-900/20 rounded text-xs border border-blue-400 mb-2">
                                  <span className="font-medium">
                                    {selectedObjectIds.size} object{selectedObjectIds.size !== 1 ? 's' : ''} selected
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={clearObjectSelection}
                                    className="h-6 px-2 text-xs"
                                  >
                                    Clear
                                  </Button>
                                </div>
                              )}

                              {/* Select All / Clear All button - show when in bulk delete mode or settings dialog is open */}
                              {totalObjects > 0 && (isBulkDeleteMode || showProjectSettingsDialog) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    if (selectedObjectIds.size > 0) {
                                      clearObjectSelection();
                                    } else {
                                      selectAllFilteredObjects();
                                    }
                                  }}
                                  className="w-full text-xs mb-2"
                                >
                                  {selectedObjectIds.size > 0 ? 'Deselect All' : 'Select All'}
                                </Button>
                              )}

                              {totalObjects === 0 ? (
                                <div className="text-xs text-muted-foreground text-center py-4">
                                  No objects in this project
                                </div>
                              ) : (
                                <div className="space-y-1 max-h-[50vh] overflow-y-auto pr-1">
                                  {/* All objects in one list */}
                                  {[
                                    ...projectPins.map(pin => ({ ...pin, type: 'pin' as const })),
                                    ...projectLines.map(line => ({ ...line, type: 'line' as const })),
                                    ...projectAreas.map(area => ({ ...area, type: 'area' as const }))
                                  ].filter(object => {
                                    if (objectTypeFilter === 'all') return true;
                                    return object.type === objectTypeFilter;
                                  }).map(object => (
                                    <div
                                      key={object.id}
                                      className={`w-full flex items-center gap-2 p-2 rounded text-xs transition-all ${
                                        selectedObjectIds.has(object.id)
                                          ? 'bg-blue-100 dark:bg-blue-900/30 border border-blue-400'
                                          : selectedObjectId === object.id
                                            ? 'bg-accent/20 border border-accent/40'
                                            : 'bg-muted/30'
                                      }`}
                                    >
                                      {/* Checkbox for multi-selection - show when in bulk delete mode or settings dialog is open */}
                                      {(isBulkDeleteMode || showProjectSettingsDialog) && (
                                        <Checkbox
                                          checked={selectedObjectIds.has(object.id)}
                                          onCheckedChange={() => toggleObjectSelection(object.id)}
                                          onClick={(e) => e.stopPropagation()}
                                          className="flex-shrink-0"
                                        />
                                      )}

                                      {object.type === 'pin' && (
                                        <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0"></div>
                                      )}
                                      {object.type === 'line' && (
                                        <div className="w-4 h-0.5 bg-green-500 flex-shrink-0"></div>
                                      )}
                                      {object.type === 'area' && (
                                        <div className="w-3 h-3 bg-red-500/30 border border-red-500 flex-shrink-0"></div>
                                      )}
                                      <button
                                        onClick={() => {
                                          if (!showProjectSettingsDialog && !isBulkDeleteMode) {
                                            setSelectedObjectId(selectedObjectId === object.id ? null : object.id);
                                            setItemToEdit(object);
                                          }
                                        }}
                                        className={`truncate flex-1 text-left ${!showProjectSettingsDialog && !isBulkDeleteMode ? 'hover:text-accent cursor-pointer' : 'cursor-default'}`}
                                      >
                                        {object.label || `Unnamed ${object.type.charAt(0).toUpperCase() + object.type.slice(1)}`}
                                      </button>

                                      <div className="flex items-center gap-1 ml-auto">
                                        {/* Data indicator for pins and areas with uploaded files */}
                                        {((object.type === 'pin' && (pinFiles[object.id]?.length > 0 || pinFileMetadata[object.id]?.length > 0)) ||
                                          (object.type === 'area' && areaFileMetadata[object.id]?.length > 0)) && (
                                          <div className="flex items-center gap-1">
                                            <Database className="h-3 w-3 text-accent" />
                                            <span className="text-xs text-accent font-medium">
                                              {object.type === 'pin'
                                                ? (pinFileMetadata[object.id]?.length || pinFiles[object.id]?.length || 0)
                                                : (areaFileMetadata[object.id]?.length || 0)}
                                            </span>
                                          </div>
                                        )}

                                        {/* Label visibility toggle */}
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleToggleLabel(object.id, object.type);
                                                }}
                                                className="p-1 hover:bg-accent/20 rounded"
                                              >
                                                {object.labelVisible !== false ? (
                                                  <Eye className="h-3 w-3" />
                                                ) : (
                                                  <EyeOff className="h-3 w-3 opacity-40" />
                                                )}
                                              </button>
                                            </TooltipTrigger>
                                            <TooltipContent side="right">
                                              <p>Toggle label</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>

                                        {/* Object visibility toggle */}
                                        <TooltipProvider>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleToggleObjectVisibility(object.id, object.type);
                                                }}
                                                className="p-1 hover:bg-accent/20 rounded"
                                              >
                                                {object.objectVisible !== false ? (
                                                  <MapPin className="h-3 w-3" />
                                                ) : (
                                                  <MapPin className="h-3 w-3 opacity-40" />
                                                )}
                                              </button>
                                            </TooltipTrigger>
                                            <TooltipContent side="right">
                                              <p>Toggle visibility</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    
                    {/* Project Menu */}
                    <Button 
                      variant="ghost"
                      size="sm" 
                      onClick={() => setShowProjectsDropdown(!showProjectsDropdown)}
                      className="w-full justify-between gap-3 h-12 text-base"
                    >
                      <div className="flex items-center gap-3">
                        <FolderOpen className="h-5 w-5" />
                        Project Menu
                      </div>
                      {showProjectsDropdown ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                    
                    {/* Projects Dropdown */}
                    {showProjectsDropdown && (
                      <div className="ml-4 space-y-1 border-l-2 border-muted pl-4">
                        <div className="text-xs text-muted-foreground mb-2">
                          <strong>Active:</strong> {dynamicProjects[activeProjectId]?.name || 'None'}
                        </div>
                        
                        {/* Sort projects with active project first */}
                        {Object.entries(dynamicProjects)
                          .sort(([keyA], [keyB]) => {
                            if (keyA === activeProjectId) return -1;
                            if (keyB === activeProjectId) return 1;
                            return 0;
                          })
                          .map(([key, location]) => {
                            // Get objects for this project
                            const projectPins = pins.filter(p => p.projectId === key);
                            const projectLines = lines.filter(l => l.projectId === key);
                            const projectAreas = areas.filter(a => a.projectId === key);
                            const totalObjects = projectPins.length + projectLines.length + projectAreas.length;
                            
                            return (
                              <div key={key} className="space-y-1">
                                <div className={`flex items-center justify-between p-2 rounded ${
                                  activeProjectId === key 
                                    ? 'bg-accent/20 border border-accent/40' 
                                    : 'bg-muted/30'
                                }`}>
                                  <div className="flex-1 min-w-0">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2">
                                        <div className="font-medium text-sm truncate">{location.name}</div>
                                        {activeProjectId === key && (
                                          <Crosshair className="h-3 w-3 text-accent flex-shrink-0" />
                                        )}
                                        {totalObjects > 0 && (
                                          <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded flex-shrink-0">
                                            {totalObjects}
                                          </span>
                                        )}
                                      </div>
                                      {activeProjectId === key && (
                                        <div className="text-xs font-medium text-accent">
                                          Active Project
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  
                                  {/* Actions */}
                                  <div className="flex items-center gap-1 ml-2">
                                    {/* Expand/Collapse Arrow */}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setShowProjectMenuInfo(showProjectMenuInfo === key ? null : key);
                                      }}
                                      className="h-6 w-6 p-0"
                                    >
                                      {showProjectMenuInfo === key ? (
                                        <ChevronDown className="h-3 w-3 text-muted-foreground hover:text-primary" />
                                      ) : (
                                        <ChevronRight className="h-3 w-3 text-muted-foreground hover:text-primary" />
                                      )}
                                    </Button>
                                    
                                    {/* Visibility Toggle */}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleProjectVisibility(key);
                                      }}
                                      className="h-6 w-6 p-0"
                                    >
                                      {projectVisibility[key] ? (
                                        <Eye className="h-3 w-3 text-primary" />
                                      ) : (
                                        <EyeOff className="h-3 w-3 text-muted-foreground" />
                                      )}
                                    </Button>
                                    
                                    {/* Activate/Visit Button */}
                                    {activeProjectId === key ? (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          goToProjectLocation(key);
                                        }}
                                        className="h-6 px-2 text-xs"
                                      >
                                        Visit
                                      </Button>
                                    ) : (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setActiveProject(key)}
                                        className="h-6 px-2 text-xs"
                                      >
                                        Activate
                                      </Button>
                                    )}
                                  </div>
                                </div>
                                
                                {/* Project Info Dropdown */}
                                {showProjectMenuInfo === key && (
                                  <div className="ml-2 p-3 bg-muted/40 rounded text-xs space-y-3 border-l-2 border-primary/30">
                                    {location.lat && location.lon && (
                                      <div>
                                        <span className="font-medium text-muted-foreground">GPS Coordinates:</span>
                                        <div className="mt-1 font-mono text-foreground">
                                          {location.lat.toFixed(6)}, {location.lon.toFixed(6)}
                                        </div>
                                      </div>
                                    )}
                                    <div>
                                      <span className="font-medium text-muted-foreground">Objects:</span>
                                      <div className="mt-1 text-foreground">
                                        {totalObjects === 0 ? (
                                          "No objects"
                                        ) : (
                                          `${totalObjects} total (${projectPins.length} pins, ${projectLines.length} lines, ${projectAreas.length} areas)`
                                        )}
                                      </div>
                                    </div>
                                    {/* Project Data and Settings Buttons */}
                                    {totalObjects > 0 && (
                                      <div className="pt-2 border-t border-muted-foreground/20">
                                        <div className="flex gap-2">
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 text-xs px-2 flex-1"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setCurrentProjectContext(key);
                                              setShowProjectDataDialog(true);
                                            }}
                                          >
                                            <Database className="h-3 w-3 mr-1" />
                                            Project Data
                                          </Button>
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 w-7 p-0"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setCurrentProjectContext(key);
                                              setProjectNameEdit(dynamicProjects[key]?.name || '');
                                              setShowProjectSettingsDialog(true);
                                            }}
                                          >
                                            <Settings className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                
                              </div>
                            );
                          })}
                        
                        {/* Add New Project Button */}
                        <div className="border-t border-muted-foreground/20 pt-3 mt-3">
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full justify-center gap-2 h-8"
                            onClick={() => {
                              setNewProjectName('');
                              setNewProjectDescription('');
                              setShowAddProjectDialog(true);
                            }}
                          >
                            <Plus className="h-3 w-3" />
                            Add New Project
                          </Button>
                        </div>
                      </div>
                    )}
                    
                  </div>
                </div>
              </div>
          </>
          {/* End of Sidebar Menu */}







          {/* Control Tools - Bottom Right, Vertical Layout (Individual Buttons) */}
          <div className="absolute bottom-4 right-4 z-[1000] flex flex-col gap-2">
            <TooltipProvider>
              {/* Current Location - Top */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost"
                    size="icon" 
                    onClick={centerOnCurrentLocation}
                    disabled={isGettingLocation}
                    className={`h-10 w-10 rounded-full shadow-lg text-primary-foreground border-0 backdrop-blur-sm transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed ${
                      locationPermission === 'denied' 
                        ? 'bg-destructive/90 hover:bg-destructive' 
                        : locationPermission === 'granted'
                        ? 'bg-accent/90 hover:bg-accent'
                        : 'bg-primary/90 hover:bg-primary'
                    }`}
                  >
                    {isGettingLocation ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Crosshair className="h-5 w-5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p>
                    {isGettingLocation 
                      ? 'Getting Location...' 
                      : locationPermission === 'denied'
                      ? 'Location Denied - Click to Enable'
                      : locationPermission === 'granted'
                      ? 'Center on Current Location'
                      : 'Get Current Location'
                    }
                  </p>
                </TooltipContent>
              </Tooltip>

              {/* Zoom In - Middle */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost"
                    size="icon" 
                    onClick={zoomIn}
                    className="h-10 w-10 rounded-full shadow-lg bg-primary/90 hover:bg-primary text-primary-foreground border-0 backdrop-blur-sm transition-all duration-200 hover:scale-105"
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p>Zoom In</p>
                </TooltipContent>
              </Tooltip>

              {/* Zoom Out - Bottom */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost"
                    size="icon" 
                    onClick={zoomOut}
                    className="h-10 w-10 rounded-full shadow-lg bg-primary/90 hover:bg-primary text-primary-foreground border-0 backdrop-blur-sm transition-all duration-200 hover:scale-105"
                  >
                    <MinusIcon className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p>Zoom Out</p>
                </TooltipContent>
              </Tooltip>

            </TooltipProvider>
          </div>

          {/* Scale Bar - Bottom Right */}
          {mapScale && (
            <div className="absolute bottom-4 right-20 z-[1000]">
              <div className="bg-transparent px-2 py-1 text-xs font-mono">
                <div className="flex items-center gap-2">
                  <div 
                    className="border-b-2 border-l-2 border-r-2 border-foreground h-2"
                    style={{ width: `${mapScale.pixels}px` }}
                  />
                  <span className="text-foreground drop-shadow-sm">
                    {mapScale.distance} {mapScale.unit}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Line Drawing Controls */}
          {isDrawingLine && (
            <div className="absolute top-16 right-4 z-[1000] flex flex-col gap-2">
              <div className="bg-black/80 text-white px-3 py-2 rounded-lg text-sm font-medium text-center backdrop-blur-sm shadow-lg">
                Drag map to set end point
              </div>
              <Button 
                onClick={handleLineConfirm} 
                className="h-10 px-4 bg-accent/90 hover:bg-accent text-primary-foreground border-0 backdrop-blur-sm transition-all duration-200 hover:scale-105 shadow-lg rounded-lg text-sm"
              >
                ✓ Confirm Line
              </Button>
              <Button 
                onClick={handleLineCancelDrawing} 
                className="h-10 px-4 bg-destructive/90 hover:bg-destructive text-destructive-foreground border-0 backdrop-blur-sm transition-all duration-200 hover:scale-105 shadow-lg rounded-lg text-sm"
              >
                ✗ Cancel Line
              </Button>
            </div>
          )}

          {/* Area Drawing Controls */}
          {isDrawingArea && (
            <div className="absolute top-16 right-4 z-[1000] flex flex-col gap-2">
              <div className="bg-black/80 text-white px-3 py-2 rounded-lg text-sm font-medium text-center backdrop-blur-sm shadow-lg">
                {pendingAreaPath.length === 1 ? 'Drag map to set corner' : `${pendingAreaPath.length} corners added`}
              </div>
              <Button 
                onClick={handleAreaAddCorner} 
                className="h-10 px-4 bg-primary/90 hover:bg-primary text-primary-foreground border-0 backdrop-blur-sm transition-all duration-200 hover:scale-105 shadow-lg rounded-lg text-sm"
              >
                + Add Corner
              </Button>
              {pendingAreaPath.length >= 3 && (
                <Button 
                  onClick={handleAreaFinish} 
                  className="h-10 px-4 bg-accent/90 hover:bg-accent text-primary-foreground border-0 backdrop-blur-sm transition-all duration-200 hover:scale-105 shadow-lg rounded-lg text-sm"
                >
                  ✓ Finish Area
                </Button>
              )}
              <Button 
                onClick={handleAreaCancelDrawing} 
                className="h-10 px-4 bg-destructive/90 hover:bg-destructive text-destructive-foreground border-0 backdrop-blur-sm transition-all duration-200 hover:scale-105 shadow-lg rounded-lg text-sm"
              >
                ✗ Cancel Area
              </Button>
            </div>
          )}
        </div>
      </main>
      
      {/* Projects Dialog */}
      <ProjectsDialog
        open={showProjectsDialog}
        onOpenChange={setShowProjectsDialog}
        dynamicProjects={dynamicProjects}
        activeProjectId={activeProjectId}
        pins={pins}
        lines={lines}
        areas={areas}
        projectVisibility={projectVisibility}
        pinFileMetadata={pinFileMetadata}
        areaFileMetadata={areaFileMetadata}
        onToggleProjectVisibility={toggleProjectVisibility}
        onSetActiveProject={setActiveProject}
        onGoToProjectLocation={goToProjectLocation}
        onShowProjectData={(projectId) => {
          setCurrentProjectContext(projectId);
          setShowProjectDataDialog(true);
        }}
        onShowProjectSettings={(projectId) => {
          setCurrentProjectContext(projectId);
          setShowProjectSettingsDialog(true);
        }}
      />

      {/* REMOVED: Migration Dialog - authentication-only mode means no legacy localStorage data exists */}

      {/* Marine Device Data Modal */}
      <MarineDeviceModal
        open={showMarineDeviceModal}
        onOpenChange={setShowMarineDeviceModal}
        selectedFileType={selectedFileType}
        selectedFiles={selectedFiles}
        isLoadingFromSavedPlot={isLoadingFromSavedPlot}
        onRequestFileSelection={handleRequestFileSelection}
        availableFilesForPlots={availableFilesForPlots}
        onDownloadFile={handleDownloadFileForPlot}
        objectGpsCoords={objectGpsCoords}
        objectName={objectName}
        multiFileMergeMode={multiFileMergeMode}
        allProjectFilesForTimeline={allProjectFilesForTimeline}
        getFileDateRange={getFileDateRange}
        projectId={currentProjectContext || activeProjectId}
        onRefreshFiles={reloadProjectFiles}
        availableProjects={Object.entries(dynamicProjects).map(([id, project]) => ({ id, name: project.name }))}
        onClose={() => {
          // Clear the selected files when closing
          setSelectedFileType(null);
          setSelectedFiles([]);
          setIsLoadingFromSavedPlot(false);
          // UI state is preserved - all panels stay as they were
        }}
      />

      {/* Share Dialog */}
      {selectedPinForShare && (
        <ShareDialogSimplified
          open={showShareDialog}
          onOpenChange={setShowShareDialog}
          pinId={selectedPinForShare.id}
          pinName={selectedPinForShare.label}
        />
      )}

      {/* Project Data Dialog */}
      <ProjectDataDialog
        open={showProjectDataDialog}
        onOpenChange={setShowProjectDataDialog}
        currentProjectContext={currentProjectContext}
        activeProjectId={activeProjectId}
        dynamicProjects={dynamicProjects}
        pins={pins}
        lines={lines}
        areas={areas}
        pinFileMetadata={pinFileMetadata}
        areaFileMetadata={areaFileMetadata}
        mergedFiles={mergedFiles}
        selectedPins={selectedPins}
        selectedTypes={selectedTypes}
        selectedSuffixes={selectedSuffixes}
        selectedDateRanges={selectedDateRanges}
        selectedFileSources={selectedFileSources}
        isUploadingFiles={isUploadingFiles}
        isLoadingMergedFiles={isLoadingMergedFiles}
        isPageLoading={isPageLoading}
        isInitialLoad={isInitialLoad}
        multiFileMergeMode={multiFileMergeMode}
        setCurrentProjectContext={setCurrentProjectContext}
        setShowUploadPinSelector={setShowUploadPinSelector}
        setSelectedUploadPinId={setSelectedUploadPinId}
        setPendingUploadFiles={setPendingUploadFiles}
        setSelectedPins={setSelectedPins}
        setSelectedTypes={setSelectedTypes}
        setSelectedSuffixes={setSelectedSuffixes}
        setSelectedDateRanges={setSelectedDateRanges}
        setSelectedFileSources={setSelectedFileSources}
        setPinFileMetadata={setPinFileMetadata}
        setAreaFileMetadata={setAreaFileMetadata}
        setMultiFileMergeMode={setMultiFileMergeMode}
        setMultiFileConfirmData={setMultiFileConfirmData}
        setShowMultiFileConfirmDialog={setShowMultiFileConfirmDialog}
        handleInitiateFileUpload={handleInitiateFileUpload}
        getProjectFiles={getProjectFiles}
        groupFilesByType={groupFilesByType}
        extractDateRange={extractDateRange}
        getFileDateRange={getFileDateRange}
        reloadProjectFiles={reloadProjectFiles}
        openMarineDeviceModal={openMarineDeviceModal}
      />

      {/* Pin Selector Dialog - Appears after files are selected */}
      <FileUploadDialog
        open={showUploadPinSelector}
        onOpenChange={(open) => {
          setShowUploadPinSelector(open);
          if (!open) {
            setPendingUploadFiles([]);
          }
        }}
        pendingUploadFiles={pendingUploadFiles}
        pins={pins}
        areas={areas}
        currentProjectId={currentProjectContext || activeProjectId}
        isUploadingFiles={isUploadingFiles}
        onUpload={(targetId, targetType) => handleFileUpload(targetId, targetType)}
        onCancel={() => {
          setShowUploadPinSelector(false);
          setPendingUploadFiles([]);
        }}
      />

      {/* Duplicate File Warning Dialog */}
      <Dialog open={showDuplicateWarning} onOpenChange={(open) => {
        if (!open) {
          handleCancelDuplicateUpload();
        }
      }}>
        <DialogContent className="sm:max-w-md z-[9999]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertCircle className="h-5 w-5" />
              Duplicate Files Detected
            </DialogTitle>
            <DialogDescription>
              The following file{duplicateFiles.length > 1 ? 's' : ''} already exist{duplicateFiles.length === 1 ? 's' : ''} for this pin.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Show duplicate files */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Duplicate Files:</label>
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-md p-3 max-h-32 overflow-y-auto">
                {duplicateFiles.map((dup, index) => (
                  <div key={index} className="text-xs font-mono text-amber-900 dark:text-amber-100 py-1 flex items-center gap-2">
                    <AlertCircle className="h-3 w-3 flex-shrink-0" />
                    <span>{dup.fileName}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-muted/50 rounded-md p-3 text-sm text-muted-foreground">
              <p className="font-medium mb-1">What would you like to do?</p>
              <ul className="space-y-1 text-xs">
                <li className="flex items-start gap-2">
                  <span className="font-bold text-amber-600">Replace:</span>
                  <span>Delete existing files and upload new ones</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold">Cancel:</span>
                  <span>Keep existing files, discard upload</span>
                </li>
              </ul>
            </div>

            {/* Action buttons */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelDuplicateUpload}
              >
                Cancel Upload
              </Button>
              <Button
                size="sm"
                variant="default"
                className="bg-amber-600 hover:bg-amber-700"
                onClick={handleReplaceDuplicates}
                disabled={isUploadingFiles}
              >
                {isUploadingFiles ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Replacing...
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Replace Files
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Date Input Dialog - for files without time columns */}
      {/* Batch Date Confirmation Dialog */}
      <BatchDateConfirmDialog
        open={showBatchDateConfirm}
        onOpenChange={setShowBatchDateConfirm}
        fileNames={filesWithoutDates.map(f => f.name)}
        onConfirmSameDate={handleBatchSameDate}
        onConfirmDifferentDates={handleBatchDifferentDates}
        onCancel={handleBatchDateCancel}
      />

      {/* Date Input Dialog */}
      <DateInputDialog
        open={showDateInputDialog}
        onOpenChange={setShowDateInputDialog}
        fileName={pendingDateFile?.file.name || ''}
        suggestedDate={
          pendingDateFile && isEdnaMetaFile(pendingDateFile.file.name)
            ? extractEdnaDate(pendingDateFile.file.name)
            : null
        }
        onDateConfirm={handleDateConfirm}
        onCancel={() => {
          setShowDateInputDialog(false);
          setPendingDateFile(null);
          setIsBatchDateMode(false);
        }}
        isBatchMode={isBatchDateMode}
        batchFileCount={filesWithoutDates.length}
      />

      {/* Project Settings Dialog */}
      <ProjectSettingsDialog
        open={showProjectSettingsDialog}
        onOpenChange={(open) => {
          if (!open) {
            setCurrentProjectContext('');
            clearObjectSelection(); // Clear selections when closing
          }
          setShowProjectSettingsDialog(open);
        }}
        projectName={dynamicProjects[currentProjectContext || activeProjectId]?.name || ''}
        selectedObjectIds={selectedObjectIds}
        selectedObjects={getSelectedObjects()}
        onDeleteProject={() => {
          setShowProjectSettingsDialog(false);
          setShowDeleteConfirmDialog(true);
        }}
        onBatchDelete={() => {
          setShowProjectSettingsDialog(false);
          setShowBatchDeleteConfirmDialog(true);
        }}
        onCancel={() => {
          setShowProjectSettingsDialog(false);
        }}
      />

      {/* Delete Project Confirmation Dialog */}
      <DeleteProjectConfirmDialog
        open={showDeleteConfirmDialog}
        onOpenChange={(open) => {
          if (!open) setCurrentProjectContext('');
          setShowDeleteConfirmDialog(open);
        }}
        projectName={dynamicProjects[currentProjectContext || activeProjectId]?.name || ''}
        projectId={currentProjectContext || activeProjectId}
        onConfirmDelete={async () => {
          console.log('🗑️ Delete Project button clicked');
          const projectId = currentProjectContext || activeProjectId;
          console.log('📂 Project context:', projectId);
          console.log('🚀 Calling projectService.deleteProject...');
          await projectService.deleteProject(projectId);
          console.log('✅ Project deleted successfully');
          setCurrentProjectContext('');
          console.log('🔄 Refreshing project list after deletion...');
          await loadDynamicProjects();
        }}
        onCancel={() => setShowDeleteConfirmDialog(false)}
      />

      {/* Batch Delete Confirmation Dialog */}
      <BatchDeleteConfirmDialog
        open={showBatchDeleteConfirmDialog}
        onOpenChange={setShowBatchDeleteConfirmDialog}
        selectedObjects={(() => {
          const selected = getSelectedObjects().map(obj => {
            const fileCount = obj.type === 'pin'
              ? (pinFileMetadata[obj.id]?.length || pinFiles[obj.id]?.length || 0)
              : obj.type === 'area'
              ? (areaFileMetadata[obj.id]?.length || 0)
              : 0;
            return { ...obj, fileCount };
          });
          return selected;
        })()}
        selectedCount={selectedObjectIds.size}
        onConfirmDelete={handleBatchDelete}
        onCancel={() => setShowBatchDeleteConfirmDialog(false)}
      />

      {/* Add New Project Dialog */}
      <AddProjectDialog
        open={showAddProjectDialog}
        onOpenChange={setShowAddProjectDialog}
        onProjectCreated={loadDynamicProjects}
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
            try {
              // Store the merge mode
              setMultiFileMergeMode(mode);

              // Import merge utilities
              const { mergeFiles } = await import('@/lib/multiFileValidator');
              const Papa = await import('papaparse');
              const { createMergedFileAction } = await import('@/app/api/merged-files/actions');

              // Perform the merge
              const mergedData = mergeFiles(multiFileConfirmData.parsedFiles, mode);

              // Convert merged data to CSV
              const csvContent = Papa.unparse({
                fields: mergedData.headers,
                data: mergedData.data.map(row =>
                  mergedData.headers.map(header => row[header])
                )
              });

              // Generate smart merged filename
              const fileNames = multiFileConfirmData.parsedFiles.map(f => f.fileName);

              // Function to generate smart merged filename
              const generateMergedFileName = (fileNames: string[]): string => {
                if (fileNames.length === 0) return `merged_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`;

                // Remove file extensions and split by underscore
                const nameParts = fileNames.map(name =>
                  name.replace(/\.(csv|txt)$/i, '').split('_')
                );

                // Find the minimum number of parts (in case files have different structures)
                const minParts = Math.min(...nameParts.map(parts => parts.length));

                // Check if this is a 24hr merge with same dates but different stations
                // Expected format: PROJECTNAME_DATATYPE_STATION_DIRECTION_DATE1_DATE2_24hr
                const is24hrMerge = nameParts.every(parts =>
                  parts.length >= 7 && parts[parts.length - 1] === '24hr'
                );

                if (is24hrMerge) {
                  // Extract station names (positions 2 and 3 combined, e.g., "C_S") and date ranges (positions 4-5)
                  const stations = nameParts.map(parts => `${parts[2]}_${parts[3]}`);
                  const dateRanges = nameParts.map(parts => `${parts[4]}_${parts[5]}`);

                  // Check if all files have the same date range
                  const sameDates = dateRanges.every(range => range === dateRanges[0]);

                  // Check if files have different stations
                  const differentStations = !stations.every(station => station === stations[0]);

                  // Check if files have different date ranges
                  const differentDates = !dateRanges.every(range => range === dateRanges[0]);

                  if (differentDates && differentStations) {
                    // MERGE_MERGE case: Different dates AND different stations
                    // Build filename: PROJECTNAME_DATATYPE_merge_merge_24hr
                    const mergedParts = [
                      nameParts[0][0],  // Project name
                      nameParts[0][1],  // Data type
                      'merge',          // First merge (for dates)
                      'merge',          // Second merge (for stations)
                      '24hr'
                    ];

                    console.log('📝 24hr MERGE_MERGE with different dates AND stations:', {
                      stations,
                      dateRanges,
                      mergedFileName: `${mergedParts.join('_')}.csv`
                    });

                    return `${mergedParts.join('_')}.csv`;
                  } else if (sameDates && differentStations) {
                    // Same dates, different stations only
                    // Combine unique station names and put in brackets
                    const uniqueStations = Array.from(new Set(stations)).sort().join('_');

                    // Build filename: PROJECTNAME_DATATYPE_[STATIONS]_DATE1_DATE2_24hr
                    // Note: [STATIONS] replaces both the station and direction fields
                    const mergedParts = [
                      nameParts[0][0],  // Project name
                      nameParts[0][1],  // Data type
                      `[${uniqueStations}]`,  // Station names in brackets (e.g., [C_S_C_W_F_L])
                      nameParts[0][4],  // Date start
                      nameParts[0][5],  // Date end
                      '24hr'
                    ];

                    console.log('📝 24hr merge with same dates, different stations:', {
                      stations,
                      dateRanges,
                      mergedFileName: `${mergedParts.join('_')}.csv`
                    });

                    return `${mergedParts.join('_')}.csv`;
                  }
                }

                // Build merged name part by part (default behavior)
                const mergedParts: string[] = [];
                for (let i = 0; i < minParts; i++) {
                  const partsAtPosition = nameParts.map(parts => parts[i]);
                  const firstPart = partsAtPosition[0];

                  // Check if all files have the same value at this position
                  const allSame = partsAtPosition.every(part => part === firstPart);

                  if (allSame) {
                    mergedParts.push(firstPart);
                  } else {
                    // Only add 'merge' if it's not already in the merged parts
                    if (!mergedParts.includes('merge')) {
                      mergedParts.push('merge');
                    }
                  }
                }

                return `${mergedParts.join('_')}.csv`;
              };

              const mergedFileName = generateMergedFileName(fileNames);

              // Get date range from merged data
              const timeColumn = mergedData.headers[0];
              const dates = mergedData.data
                .map(row => row[timeColumn])
                .filter(d => d)
                .map(d => new Date(d));

              const startDate = dates.length > 0 ? format(new Date(Math.min(...dates.map(d => d.getTime()))), 'yyyy-MM-dd') : undefined;
              const endDate = dates.length > 0 ? format(new Date(Math.max(...dates.map(d => d.getTime()))), 'yyyy-MM-dd') : undefined;

              // Get source file IDs and metadata
              const sourceFileIds = multiFileConfirmData.parsedFiles.map(f => f.fileId).filter(Boolean);
              const sourceFilesMetadata = multiFileConfirmData.parsedFiles.reduce((acc, f) => {
                if (f.fileId) {
                  acc[f.fileId] = {
                    fileName: f.fileName,
                    rowCount: f.data.length,
                    headers: f.headers
                  };
                }
                return acc;
              }, {} as Record<string, any>);

              // Get pin ID from selected files
              const pinId = multiFileConfirmData.selectedFiles[0]?.pinId;
              if (!pinId) {
                throw new Error('Could not determine pin ID');
              }

              // Save merged file
              const result = await createMergedFileAction({
                pinId,
                fileName: mergedFileName,
                csvContent,
                mergeMode: mode,
                mergeRules: mergeRules.filter(r => r.enabled),
                sourceFileIds,
                sourceFilesMetadata,
                startDate,
                endDate,
                projectId: activeProjectId
              });

              if (!result.success) {
                throw new Error(result.error || 'Failed to create merged file');
              }

              toast({
                title: "Merged File Created",
                description: `Successfully created ${mergedFileName}`
              });

              // Reload files to show the newly created merged file
              console.log('🔄 Reloading files after merge...');
              const updatedFileMetadata: Record<string, PinFile[]> = {};

              for (const pin of pins) {
                try {
                  const files = await fileStorageService.getPinFiles(pin.id);
                  if (files.length > 0) {
                    updatedFileMetadata[pin.id] = files;
                  }
                } catch (error) {
                  console.error(`Error reloading files for pin ${pin.id}:`, error);
                }
              }

              console.log('✅ Files reloaded, merged file should now be visible');
              setPinFileMetadata(updatedFileMetadata);

              // Reload merged files to show the newly created merged file
              console.log('🔄 Reloading merged files list...');
              await fetchMergedFiles();
              console.log('✅ Merged files list updated');

              // Close dialog and reset state
              setShowMultiFileConfirmDialog(false);
              setMultiFileConfirmData(null);
              setMultiFileMergeMode(false); // Reset merge mode to show "+ Merge" button again
            } catch (error) {
              console.error('Error creating merged file:', error);
              toast({
                variant: "destructive",
                title: "Merge Failed",
                description: error instanceof Error ? error.message : 'Failed to create merged file'
              });
            }
          }}
          onCancel={() => {
            setShowMultiFileConfirmDialog(false);
            setMultiFileConfirmData(null);
          }}
        />
      )}

      {/* Data Restore Notifications */}
      <DataRestoreNotifications
        isActive={showDataRestore}
        onComplete={() => {
          setShowDataRestore(false);
          // Force refresh of data after restore
          forceSync();
        }}
      />

      {/* ================================================================ */}
      {/* DATA EXPLORER PANEL - NEW ADDITION (Safe to remove/disable)     */}
      {/* ================================================================ */}
      {isFeatureEnabled('DATA_EXPLORER_PANEL') && (
        <LazyDataExplorerPanel
          open={showDataExplorerPanel}
          onOpenChange={setShowDataExplorerPanel}

          // Files tab
          files={allProjectFilesForTimeline}
          isLoadingFiles={false}
          onFileClick={handleFileClickFromPanel}
          onFileDelete={handleDeleteFileForPlot}
          onFileRename={handleRenameFileForPlot}
          getFileDateRange={getFileDateRange}
          onOpenStackedPlots={handleOpenStackedPlotsFromPanel}

          // Saved plots tab
          savedPlots={savedPlots}
          isLoadingPlots={isLoadingSavedPlots}
          onPlotClick={handlePlotClickFromPanel}
          onPlotDelete={handlePlotDeleteFromPanel}
          onPlotEdit={handlePlotEditFromPanel}
        />
      )}
      {/* ================================================================ */}
      {/* END DATA EXPLORER PANEL                                         */}
      {/* ================================================================ */}

    </>
  );
}

export default function MapDrawingPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
      <MapDrawingPageContent />
    </Suspense>
  );
}
