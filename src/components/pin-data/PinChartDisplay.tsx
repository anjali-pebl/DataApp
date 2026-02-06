"use client";

import React, { useState, useMemo, useCallback } from "react";
import dynamic from 'next/dynamic';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Brush, Tooltip as RechartsTooltip, ReferenceLine, ReferenceArea } from 'recharts';
import SunCalc from 'suncalc';
import { format, parseISO, isValid } from 'date-fns';
import { formatDateUTC } from '@/lib/timezone-utils';
import { HexColorPicker } from 'react-colorful';
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useFileViewTracking } from "@/hooks/use-analytics";
import { ChevronUp, ChevronDown, BarChart3, Info, TableIcon, ChevronRight, ChevronLeft, Settings, Circle, Filter, AlertCircle, Database, Clock, Palette, Eye, Grid3x3, Ruler, Network, RefreshCw } from "lucide-react";
import { cn } from '@/lib/utils';
import { getParameterLabelWithUnit } from '@/lib/units';
import type { ParsedDataPoint } from './csvParser';
import { fileStorageService } from '@/lib/supabase/file-storage-service';
import { DEFAULT_STYLE_RULES, STYLE_RULES_VERSION, type StyleRule, StylingRulesDialog } from './StylingRulesDialog';
import { ParameterFilterPanel } from './ParameterFilterPanel';
import { PinChartDisplaySpotSample } from './PinChartDisplaySpotSample';
import { HeatmapDisplay } from '@/components/dataflow/HeatmapDisplay';
import { HaplotypeHeatmap } from './HaplotypeHeatmap';
import type { HaplotypeParseResult } from './csvParser';
import { BrushPanHandle } from './BrushPanHandle';
import { TaxonomicTreeView } from './TaxonomicTreeView';
import { buildTaxonomicTree, flattenTreeForHeatmap } from '@/lib/taxonomic-tree-builder';
import { lookupSpeciesBatch } from '@/lib/taxonomy-service';

// Lazy load RawCsvViewer - only loads when user clicks on unrecognized species
const RawCsvViewer = dynamic(
  () => import('@/components/data-explorer/RawCsvViewer').then(mod => ({ default: mod.RawCsvViewer })),
  { ssr: false, loading: () => <div className="animate-pulse p-4">Loading CSV viewer...</div> }
);

interface PinChartDisplayProps {
  data: ParsedDataPoint[];
  fileType: 'GP' | 'FPOD' | 'Subcam';
  timeColumn: string | null;
  showYAxisLabels?: boolean;
  fileName?: string;
  dataSource?: 'csv' | 'marine';
  // File metadata for header display
  pinLabel?: string; // Location name (e.g., "Control_S", "Farm_AS")
  startDate?: Date; // Start date of data
  endDate?: Date; // End date of data
  fileCategories?: string[]; // Categories (e.g., ["Sediment", "Haplotypes"])
  // Display overrides for paired FPOD plots
  hideBrush?: boolean;
  showDateTimeAxis?: boolean;
  // Location coordinates for sunrise/sunset shading
  coordinates?: { lat: number; lng: number };
  // Time synchronization props
  timeAxisMode?: 'separate' | 'common';
  globalTimeRange?: { min: Date | null; max: Date | null };
  globalBrushRange?: { startIndex: number; endIndex: number | undefined };
  onBrushChange?: (brushData: { startIndex?: number; endIndex?: number }) => void;
  isLastPlot?: boolean;
  // Visibility tracking for merge feature
  onVisibilityChange?: (
    visibleParams: string[],
    paramColors: Record<string, string>,
    paramSettings?: Record<string, Partial<ParameterState>>,
    plotSettings?: {
      axisMode?: 'single' | 'multi';
      customYAxisLabel?: string;
      compactView?: boolean;
      customParameterNames?: Record<string, string>;
    }
  ) => void;
  // Initial state for restoring saved views
  initialVisibleParameters?: string[];
  initialParameterColors?: Record<string, string>;
  initialParameterSettings?: Record<string, Partial<ParameterState>>;
  initialAxisMode?: 'single' | 'multi';
  initialCustomYAxisLabel?: string;
  initialCompactView?: boolean;
  initialCustomParameterNames?: Record<string, string>;
  // Default settings (for merged plots)
  defaultAxisMode?: 'single' | 'multi';
  defaultParametersExpanded?: boolean;
  // Date format toggle
  currentDateFormat?: 'DD/MM/YYYY' | 'MM/DD/YYYY';
  onDateFormatChange?: (format: 'DD/MM/YYYY' | 'MM/DD/YYYY') => void;
  // Raw CSV file for viewing original data
  rawFiles?: File[];
  // Pin ID for saving corrected files to database
  pinId?: string;
  // Spot-sample data props (for CROP, CHEM, WQ, EDNA files)
  detectedSampleIdColumn?: string | null;
  headers?: string[];
  diagnosticLogs?: string[];
  // Haplotype data (for EDNA hapl files)
  haplotypeData?: HaplotypeParseResult;
  // Subtracted plot settings (for computed/subtracted plots)
  isSubtractedPlot?: boolean;
  includeZeroValues?: boolean;
  onIncludeZeroValuesChange?: (include: boolean) => void;
  // Methodology modal props
  projectId?: string;
  tileName?: 'SubCam' | 'GrowProbe' | 'FPOD' | 'Water and Crop Samples' | 'eDNA';
}

// Color palette matching the marine data theme
// Chart color CSS variables reordered to alternate cool-warm
// This ensures sequential parameters get mixed warm/cool colors
const CHART_COLORS = [
  '--chart-1', // Blue (cool)
  '--chart-2', // Red/pink (warm)
  '--chart-5', // Cyan (cool)
  '--chart-7', // Burnt orange (warm)
  '--chart-3', // Green (cool)
  '--chart-6', // Purple (warm)
  '--chart-9', // Steel blue (cool)
  '--chart-4', // Olive yellow (warm)
  '--chart-8', // Grey (neutral)
];

// Colorblind-friendly palette for quick picking (Paul Tol scheme)
// Ordered to alternate cool-warm so sequential parameters get mixed colors
const DEFAULT_COLOR_PALETTE = [
  '#4477AA', // Blue (cool)
  '#EE6677', // Red/pink (warm)
  '#66CCEE', // Cyan (cool)
  '#CC6644', // Burnt orange (warm)
  '#228833', // Green (cool)
  '#AA3377', // Purple (warm)
  '#336688', // Steel blue (cool)
  '#CCBB44', // Olive yellow (warm)
  '#BBBBBB', // Grey (neutral)
];

// Common names for GrowProbe parameters (used for tooltips and Y-axis labels)
// Keys are normalized (lowercase, no special chars) for flexible matching
const GROWPROBE_COMMON_NAMES: Record<string, string> = {
  'temp': 'Temperature (degrees Celsius)',
  'ir': 'Turbidity (arbitrary units)',
  'vis': 'Visible Light (arbitrary units)',
  'light': 'Light Intensity (Lux)',
  'lux': 'Light Intensity (Lux)',
  'accel_x': 'Acceleration X-axis (g-force)',
  'accel_y': 'Acceleration Y-axis (g-force)',
  'accel_z': 'Acceleration Z-axis (g-force)',
  'tilt': 'Tilt Angle (device orientation)',
  'mag_x': 'Magnetic Field X-axis',
  'mag_y': 'Magnetic Field Y-axis',
  'mag_z': 'Magnetic Field Z-axis',
  'direction': 'Compass Direction (degrees from North)',
  'h.angle': 'Compass Direction (degrees from North)',
  'battery': 'Battery Voltage (Volts)',
  'vbat': 'Battery Voltage (Volts)',
};

// Helper function to get GrowProbe common name with flexible matching
function getGrowProbeCommonName(parameter: string): string | null {
  // Normalize the parameter name: lowercase, extract the base name before any units/parentheses
  const normalized = parameter.toLowerCase().split(/[\s(]/)[0].trim();
  return GROWPROBE_COMMON_NAMES[normalized] || null;
}

// Hidden sensor parameters (accelerometer, magnetic field, visible light) - shown via toggle
const HIDDEN_SENSOR_PARAMS_PATTERNS = ['accel_', 'mag_', 'vis'];

// Helper to check if parameter is a hidden sensor param
function isHiddenSensorParam(parameter: string): boolean {
  const lower = parameter.toLowerCase();
  return HIDDEN_SENSOR_PARAMS_PATTERNS.some(pattern => lower.startsWith(pattern));
}

interface ParameterState {
  visible: boolean;
  color: string;
  opacity?: number; // 0-1 range, defaults to 1 (fully opaque)
  lineStyle?: 'solid' | 'dashed'; // Line style, defaults to 'solid'
  lineWidth?: number; // 0.5-4 range, defaults to 2 (position 4 of 8 options)
  isSolo?: boolean;
  timeFilter?: {
    enabled: boolean;
    excludeStart: string; // "HH:mm" format
    excludeEnd: string;
  };
  movingAverage?: {
    enabled: boolean;
    windowDays: number;
    showLine: boolean;
  };
  yAxisRange?: {
    min?: number;
    max?: number;
  };
}

const formatDateTick = (timeValue: string | number, dataSource?: 'csv' | 'marine', showYear?: boolean): string => {
  try {
    const dateObj = typeof timeValue === 'string' ? parseISO(timeValue) : new Date(timeValue);
    if (!isValid(dateObj)) return String(timeValue);
    // Use dd/MM or dd/MM/yy format based on showYear parameter
    return format(dateObj, showYear ? 'dd/MM/yy' : 'dd/MM');
  } catch (e) {
    return String(timeValue);
  }
};

// Format time as HH:MM for 24-hour data
const format24HourTick = (timeValue: string | number): string => {
  try {
    const dateObj = typeof timeValue === 'string' ? parseISO(timeValue) : new Date(timeValue);
    if (!isValid(dateObj)) return String(timeValue);
    return format(dateObj, 'HH:mm');
  } catch (e) {
    return String(timeValue);
  }
};

// Estimate timezone offset (in hours) from longitude
// This is an approximation: each 15 degrees of longitude = 1 hour offset
// More accurate than using local machine timezone for remote locations
const getTimezoneOffsetFromLongitude = (lng: number): number => {
  return Math.round(lng / 15);
};

// Format UTC date to a specific timezone offset (in hours)
const formatDateInTimezone = (date: Date, offsetHours: number, formatStr: string): string => {
  // Create a new date adjusted for the timezone offset
  const utcTime = date.getTime();
  const offsetMs = offsetHours * 60 * 60 * 1000;
  const adjustedDate = new Date(utcTime + offsetMs);

  // Format using UTC methods to avoid double-conversion
  const day = String(adjustedDate.getUTCDate()).padStart(2, '0');
  const month = String(adjustedDate.getUTCMonth() + 1).padStart(2, '0');
  const hours = String(adjustedDate.getUTCHours()).padStart(2, '0');
  const minutes = String(adjustedDate.getUTCMinutes()).padStart(2, '0');

  if (formatStr === 'dd/MM HH:mm') {
    return `${day}/${month} ${hours}:${minutes}`;
  }
  return `${day}/${month} ${hours}:${minutes}`;
};

// Format as date + time for 24hr average FPOD data
// If coordinates provided, uses location's timezone; otherwise falls back to local
// If timeOnly is true, only shows HH:mm (for 24hr averaged files)
const formatDateTimeTick = (timeValue: string | number, coordinates?: { lat: number; lng: number }, timeOnly?: boolean): string => {
  try {
    const dateObj = typeof timeValue === 'string' ? parseISO(timeValue) : new Date(timeValue);
    if (!isValid(dateObj)) return String(timeValue);

    // If coordinates provided, format in the location's estimated timezone
    if (coordinates) {
      const offsetHours = getTimezoneOffsetFromLongitude(coordinates.lng);
      const utcTime = dateObj.getTime();
      const offsetMs = offsetHours * 60 * 60 * 1000;
      const adjustedDate = new Date(utcTime + offsetMs);

      const hours = String(adjustedDate.getUTCHours()).padStart(2, '0');
      const minutes = String(adjustedDate.getUTCMinutes()).padStart(2, '0');

      if (timeOnly) {
        return `${hours}:${minutes}`;
      }

      const day = String(adjustedDate.getUTCDate()).padStart(2, '0');
      const month = String(adjustedDate.getUTCMonth() + 1).padStart(2, '0');
      return `${day}/${month} ${hours}:${minutes}`;
    }

    // Fallback to local timezone
    return format(dateObj, timeOnly ? 'HH:mm' : 'dd/MM HH:mm');
  } catch (e) {
    return String(timeValue);
  }
};

// Custom tooltip that sorts items by visual position on chart (highest line first)
// Accepts optional coordinates to display time in location's timezone
// Accepts optional parameterDomains to normalize values for visual sorting in multi-axis mode
const CustomChartTooltip = ({ active, payload, label, coordinates, parameterDomains }: any) => {
  if (!active || !payload || payload.length === 0) return null;

  let formattedLabel = String(label);
  try {
    const date = parseISO(String(label));
    if (isValid(date)) {
      if (coordinates) {
        // Format in location's timezone
        const offsetHours = getTimezoneOffsetFromLongitude(coordinates.lng);
        const utcTime = date.getTime();
        const offsetMs = offsetHours * 60 * 60 * 1000;
        const adjustedDate = new Date(utcTime + offsetMs);

        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const dayName = days[adjustedDate.getUTCDay()];
        const monthName = months[adjustedDate.getUTCMonth()];
        const dayNum = String(adjustedDate.getUTCDate()).padStart(2, '0');
        const hours = String(adjustedDate.getUTCHours()).padStart(2, '0');
        const minutes = String(adjustedDate.getUTCMinutes()).padStart(2, '0');
        const seconds = String(adjustedDate.getUTCSeconds()).padStart(2, '0');
        formattedLabel = `${dayName}, ${monthName} ${dayNum}, ${hours}:${minutes}:${seconds}`;
      } else {
        formattedLabel = format(date, 'EEE, MMM dd, HH:mm:ss');
      }
    }
  } catch { /* keep raw label */ }

  // Sort by visual position on chart (highest line visually = first in tooltip)
  // In multi-axis mode, normalize each value to 0-1 based on its axis domain
  const sorted = [...payload]
    .filter((entry: any) => entry.value != null)
    .sort((a: any, b: any) => {
      const aValue = Number(a.value) || 0;
      const bValue = Number(b.value) || 0;

      // If we have parameter domains, sort by normalized visual position
      if (parameterDomains) {
        const aDomain = parameterDomains[a.dataKey];
        const bDomain = parameterDomains[b.dataKey];

        if (aDomain && bDomain) {
          // Normalize to 0-1 range (where 1 = top of axis, 0 = bottom)
          const aNormalized = (aValue - aDomain[0]) / (aDomain[1] - aDomain[0]);
          const bNormalized = (bValue - bDomain[0]) / (bDomain[1] - bDomain[0]);
          return bNormalized - aNormalized; // Descending (higher visual position first)
        }
      }

      // Fallback: sort by raw value descending
      return bValue - aValue;
    });

  return (
    <div style={{
      backgroundColor: 'hsl(var(--background))',
      border: '1px solid hsl(var(--border))',
      fontSize: '0.7rem',
      padding: '8px',
      borderRadius: '6px',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    }}>
      <div style={{ marginBottom: 4, fontWeight: 600, color: 'hsl(var(--foreground))' }}>{formattedLabel}</div>
      {sorted.map((entry: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0', color: 'hsl(var(--foreground))' }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            backgroundColor: entry.color, display: 'inline-block', flexShrink: 0,
          }} />
          <span>{entry.name}:</span>
          <span style={{ fontWeight: 500 }}>
            {typeof entry.value === 'number'
              ? entry.value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 3 })
              : 'N/A'}
          </span>
        </div>
      ))}
    </div>
  );
};

// Calculate nice round numbers for Y-axis scaling
const calculateNiceYAxisDomain = (min: number, max: number): { domain: [number, number], tickInterval: number } => {
  const range = max - min;

  // Determine the order of magnitude
  const magnitude = Math.pow(10, Math.floor(Math.log10(range)));

  // Calculate nice intervals based on range
  let niceInterval: number;
  const normalizedRange = range / magnitude;

  if (normalizedRange <= 1.5) {
    niceInterval = magnitude * 0.2; // e.g., 200 for range 1000
  } else if (normalizedRange <= 3) {
    niceInterval = magnitude * 0.5; // e.g., 500 for range 2500
  } else if (normalizedRange <= 7) {
    niceInterval = magnitude * 1; // e.g., 1000 for range 5000
  } else {
    niceInterval = magnitude * 2; // e.g., 2000 for range 15000
  }

  // Round min down and max up to nearest interval
  const niceMin = Math.floor(min / niceInterval) * niceInterval;
  const niceMax = Math.ceil(max / niceInterval) * niceInterval;

  return {
    domain: [Math.max(0, niceMin), niceMax], // Ensure min is at least 0
    tickInterval: niceInterval
  };
};

// Generate a lighter shade of a hex color for MA parameters
const lightenColor = (hex: string, percent: number): string => {
  // Handle CSS variable colors (like '--chart-1')
  if (hex.startsWith('--')) {
    return hex; // Return as-is for CSS variables
  }

  // Remove # if present
  const cleanHex = hex.replace('#', '');

  // Convert to RGB
  const num = parseInt(cleanHex, 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;

  // Lighten by blending with white
  const newR = Math.min(255, Math.floor(r + (255 - r) * percent));
  const newG = Math.min(255, Math.floor(g + (255 - g) * percent));
  const newB = Math.min(255, Math.floor(b + (255 - b) * percent));

  // Convert back to hex
  return `#${((newR << 16) | (newG << 8) | newB).toString(16).padStart(6, '0')}`;
};

// Intelligent Y-axis formatter with nice rounded tick spacings
const formatYAxisTick = (value: number, dataRange: number, dataMax: number): string => {
  if (!isFinite(value) || isNaN(value)) return '0';

  const absMax = Math.abs(dataMax);
  const absValue = Math.abs(value);

  // Determine decimal places based on data scale
  let decimals = 0;

  if (absMax >= 1000) {
    decimals = 0; // Large values: no decimals (e.g., 1500)
  } else if (absMax >= 100) {
    decimals = dataRange < 10 ? 1 : 0; // Medium-large: 1 decimal if small range
  } else if (absMax >= 10) {
    decimals = dataRange < 1 ? 2 : 1; // Medium: 1-2 decimals
  } else if (absMax >= 1) {
    decimals = dataRange < 0.5 ? 2 : 1; // Small: 1-2 decimals
  } else if (absMax >= 0.1) {
    decimals = 2; // Tiny: 2 decimals
  } else {
    decimals = 3; // Very tiny: 3 decimals
  }

  return value.toFixed(decimals);
};

// Split long Y-axis title into multiple lines at halfway point
const splitYAxisTitle = (title: string, wordThreshold: number = 3): string[] => {
  const words = title.trim().split(/\s+/);

  // If fewer words than threshold, don't split
  if (words.length < wordThreshold) {
    return [title];
  }

  // Split at halfway point
  const midpoint = Math.ceil(words.length / 2);
  const firstLine = words.slice(0, midpoint).join(' ');
  const secondLine = words.slice(midpoint).join(' ');

  return [firstLine, secondLine];
};

// Custom Y-axis label component for multi-line rendering
const MultiLineYAxisLabel = ({
  viewBox,
  value,
  angle = -90,
  offset = 0,
  style = {}
}: any) => {
  const lines = Array.isArray(value) ? value : [value];
  const { x, y, width, height } = viewBox;

  // Calculate center position
  const cx = x + offset;
  const cy = y + height / 2;

  // Line height in pixels
  const lineHeight = 12;
  const totalHeight = lines.length * lineHeight;

  return (
    <g transform={`translate(${cx}, ${cy})`}>
      <text
        transform={`rotate(${angle})`}
        textAnchor="middle"
        style={style}
      >
        {lines.map((line: string, index: number) => (
          <tspan
            key={index}
            x={0}
            dy={index === 0 ? -(totalHeight / 2) + lineHeight : lineHeight}
          >
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
};

// Fallback color palette when CSS variables aren't loaded (Paul Tol colorblind-friendly)
// Fallback colors for CSS variables (ordered to alternate cool-warm)
const FALLBACK_COLORS: Record<string, string> = {
  '--chart-1': '#4477AA', // Blue (cool)
  '--chart-2': '#EE6677', // Red/pink (warm)
  '--chart-3': '#66CCEE', // Cyan (cool)
  '--chart-4': '#CC6644', // Burnt orange (warm)
  '--chart-5': '#228833', // Green (cool)
  '--chart-6': '#AA3377', // Purple (warm)
  '--chart-7': '#336688', // Steel blue (cool)
  '--chart-8': '#CCBB44', // Olive yellow (warm)
  '--chart-9': '#BBBBBB', // Grey (neutral)
};

// Convert HSL CSS variable to hex color
const cssVarToHex = (cssVar: string): string => {
  if (cssVar.startsWith('#')) return cssVar; // Already hex

  const hslValue = getComputedStyle(document.documentElement)
    .getPropertyValue(cssVar.replace('--', ''))
    .trim();

  if (!hslValue) return FALLBACK_COLORS[cssVar] || '#4477AA'; // Use fallback palette (colorblind-friendly)

  // Parse HSL string like "220 100% 50%"
  const matches = hslValue.match(/(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
  if (!matches) return FALLBACK_COLORS[cssVar] || '#4477AA'; // Colorblind-friendly blue

  const h = parseFloat(matches[1]) / 360;
  const s = parseFloat(matches[2]) / 100;
  const l = parseFloat(matches[3]) / 100;

  // HSL to RGB conversion
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1/3) * 255);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

// Convert hex to HSL CSS variable format
const hexToHslVar = (hex: string): string => {
  // Remove # if present
  hex = hex.replace('#', '');

  // Convert to RGB
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
};

export function PinChartDisplay({
  data,
  fileType,
  timeColumn,
  showYAxisLabels = false,
  fileName,
  dataSource = 'csv',
  pinLabel,
  startDate,
  endDate,
  fileCategories,
  hideBrush,
  showDateTimeAxis,
  coordinates,
  timeAxisMode = 'separate',
  globalTimeRange,
  globalBrushRange,
  onBrushChange,
  isLastPlot = true,
  onVisibilityChange,
  initialVisibleParameters,
  initialParameterColors,
  initialParameterSettings,
  initialAxisMode,
  initialCustomYAxisLabel,
  initialCompactView,
  initialCustomParameterNames,
  defaultAxisMode = 'multi',
  defaultParametersExpanded = false,
  currentDateFormat,
  onDateFormatChange,
  rawFiles,
  pinId,
  detectedSampleIdColumn,
  headers,
  diagnosticLogs,
  haplotypeData,
  isSubtractedPlot = false,
  includeZeroValues = false,
  onIncludeZeroValuesChange,
  projectId,
  tileName
}: PinChartDisplayProps) {
  console.log('📊 [PinChartDisplay] Received props:', {
    fileName,
    fileType,
    pinLabel,
    startDate,
    endDate,
    fileCategories
  });

  // 🧬 HAPL_DEBUG: Log incoming data for haplotype files
  const isHaplotypeFile = fileName?.toLowerCase().includes('hapl');
  React.useEffect(() => {
    if (isHaplotypeFile) {
      console.log('═════════════════════════════════════════════════════════════');
      console.log('🧬 HAPL_DEBUG: PinChartDisplay received data');
      console.log('🧬 HAPL_DEBUG: File name:', fileName);
      console.log('🧬 HAPL_DEBUG: File type:', fileType);
      console.log('🧬 HAPL_DEBUG: Time column:', timeColumn);
      console.log('🧬 HAPL_DEBUG: Data source:', dataSource);
      console.log('🧬 HAPL_DEBUG: Total data points:', data.length);
      console.log('🧬 HAPL_DEBUG: First 3 data points:');
      data.slice(0, 3).forEach((point, idx) => {
        console.log(`🧬 HAPL_DEBUG:   Point ${idx}:`, point);
      });
      if (data.length > 0) {
        console.log('🧬 HAPL_DEBUG: Last data point:', data[data.length - 1]);
        console.log('🧬 HAPL_DEBUG: Data keys (parameters):', Object.keys(data[0]));
      }
      console.log('🧬 HAPL_DEBUG: Headers:', headers);
      console.log('🧬 HAPL_DEBUG: Detected sample ID column:', detectedSampleIdColumn);
      console.log('🧬 HAPL_DEBUG: Diagnostic logs:', diagnosticLogs);
      console.log('🧬 HAPL_DEBUG: Has haplotypeData?', !!haplotypeData);
      if (haplotypeData) {
        console.log('🧬 HAPL_DEBUG: Haplotype species count:', haplotypeData.species.length);
        console.log('🧬 HAPL_DEBUG: Haplotype sites count:', haplotypeData.sites.length);
        console.log('🧬 HAPL_DEBUG: Haplotype total cells:', haplotypeData.data.length);
        console.log('🧬 HAPL_DEBUG: Haplotype summary:', haplotypeData.summary);
      }
      console.log('═════════════════════════════════════════════════════════════');
    }
  }, [data, fileName, isHaplotypeFile, haplotypeData]);

  // Log initial settings for debugging restoration
  React.useEffect(() => {
    if (initialCompactView !== undefined || initialCustomYAxisLabel !== undefined || initialAxisMode !== undefined) {
      console.log('🔍 [PIN CHART DISPLAY] Received initial settings:', {
        initialCompactView,
        initialCustomYAxisLabel,
        initialAxisMode,
        initialCustomParameterNames,
        initialParameterSettings: initialParameterSettings ? Object.keys(initialParameterSettings) : []
      });
    }
  }, []);

  // Track file viewing for analytics
  useFileViewTracking(fileName, fileType, {
    pin_id: pinId,
    data_source: dataSource,
    is_haplotype: isHaplotypeFile,
    is_subtracted: isSubtractedPlot,
    data_points: data.length
  });

  // Unified view mode for all file types
  type ViewMode = 'chart' | 'table' | 'heatmap' | 'tree';
  const [viewMode, setViewMode] = useState<ViewMode>('chart');
  const [highlightedTaxon, setHighlightedTaxon] = useState<string | null>(null);

  // Legacy support: derive old state variables from unified viewMode
  const showTable = viewMode === 'table';
  const nmaxViewMode = viewMode === 'table' ? 'chart' : (viewMode as 'chart' | 'heatmap' | 'tree');
  const showHeatmap = viewMode === 'heatmap';
  const [heatmapColor, setHeatmapColor] = useState('#1e3a8a'); // Dark blue default

  // Heatmap refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { toast } = useToast();

  // Species selection panel state (collapsed by default)
  const [isSpeciesPanelExpanded, setIsSpeciesPanelExpanded] = useState(false);

  // Taxonomy enrichment for nmax species
  const [nmaxTaxonomyData, setNmaxTaxonomyData] = useState<Map<string, any>>(new Map());
  const [isFetchingNmaxTaxonomy, setIsFetchingNmaxTaxonomy] = useState(false);
  const [nmaxFetchedSpeciesList, setNmaxFetchedSpeciesList] = useState<string>(''); // Track which species we've fetched

  // Adjustable cell dimensions for subcam nmax heatmaps
  const [adjustableNmaxRowHeight, setAdjustableNmaxRowHeight] = useState(15);
  const [adjustableNmaxCellWidth, setAdjustableNmaxCellWidth] = useState(12);

  // Haplotype heatmap view state - for EDNA hapl files (default to true for hapl files)
  const [showHaplotypeHeatmap, setShowHaplotypeHeatmap] = useState(isHaplotypeFile && !!haplotypeData);

  // Update showHaplotypeHeatmap when haplotypeData becomes available
  React.useEffect(() => {
    if (isHaplotypeFile && haplotypeData && !showHaplotypeHeatmap) {
      setShowHaplotypeHeatmap(true);
    }
  }, [isHaplotypeFile, haplotypeData, showHaplotypeHeatmap]);

  // Raw CSV viewer state for haplotype editing
  const [showRawViewer, setShowRawViewer] = useState(false);
  const [selectedFileForRaw, setSelectedFileForRaw] = useState<{
    id: string;
    name: string;
    highlightSpecies?: string;
  } | null>(null);

  // Helper to get file info for raw editing
  // Note: rawFiles contains browser File objects, not database IDs
  // We'll use pinId as the fileId since RawCsvViewer can work with pinId
  const rawFileInfo = useMemo(() => {
    if (!rawFiles || rawFiles.length === 0 || !pinId) {
      console.log('[RAW FILE INFO] Missing data:', {
        hasRawFiles: !!rawFiles,
        rawFilesLength: rawFiles?.length,
        hasPinId: !!pinId,
        fileName
      });
      return null;
    }

    const info = {
      id: pinId, // Using pinId as fileId - RawCsvViewer will need to adapt
      name: fileName || rawFiles[0].name,
      file: rawFiles[0]
    };

    console.log('[RAW FILE INFO] Created:', info);
    return info;
  }, [rawFiles, pinId, fileName]);

  // Compact view state - shows only selected parameters without borders
  const [compactView, setCompactView] = useState(initialCompactView ?? false);

  // Compact view parameter name filtering
  const [hideUnits, setHideUnits] = useState(false);
  const [hideDates, setHideDates] = useState(false);
  const [hideStations, setHideStations] = useState(false);
  const [hideParameterName, setHideParameterName] = useState(false);

  // Show/hide sensor parameters (accelerometer, magnetic field)
  const [showSensorParams, setShowSensorParams] = useState(false);

  // Custom parameter names for direct editing in compact view
  const [customParameterNames, setCustomParameterNames] = useState<Record<string, string>>(initialCustomParameterNames || {});

// Axis mode state - default to single for SubCam and FPOD, multi for everything else
  const [axisMode, setAxisMode] = useState<'single' | 'multi'>(
    (fileType === 'Subcam' || fileType === 'FPOD') ? 'single' : (initialAxisMode || defaultAxisMode || 'multi')
  );

  // MA update counter to force data recalculation
  const [maUpdateCounter, setMaUpdateCounter] = useState(0);

  // Store MA-enriched data separately
  const [dataWithMA, setDataWithMA] = useState<ParsedDataPoint[]>([]);

  // Log axis mode changes for MA debugging
  // React.useEffect(() => {
  //   console.log('[MA DEBUG] Current axis mode:', axisMode);
  // }, [axisMode]);

  // Parameter panel expansion state
  const [isParameterPanelExpanded, setIsParameterPanelExpanded] = useState(defaultParametersExpanded);

  // Parameter filter state (for 24hr style parameters)
  // Default to DPM for 24hr files - now using arrays for multi-select
  const is24hrFile = fileName?.endsWith('_24hr.csv') || false;
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState<string[]>([]);
  const [unitFilter, setUnitFilter] = useState<string[]>(is24hrFile ? ['DPM'] : []);
  const [stationFilter, setStationFilter] = useState<string[]>([]);

  // FPOD unit toggle - switches all parameters between Clicks and DPM
  const [fpodUnitMode, setFpodUnitMode] = useState<'DPM' | 'Clicks'>('DPM');

  // Reset filters to default when file changes
  React.useEffect(() => {
    if (fileName?.endsWith('_24hr.csv')) {
      setUnitFilter(['DPM']);
    } else {
      setUnitFilter([]);
    }
    setSourceFilter([]);
    setDateFilter([]);
    setStationFilter([]);
  }, [fileName]);

  // FPOD unit toggle effect - show only matching unit parameters
  React.useEffect(() => {
    if (fileType !== 'FPOD') return;
    setParameterStates(prev => {
      const updated = { ...prev };
      for (const param of Object.keys(updated)) {
        const isDPM = param.includes('(DPM)');
        const isClicks = param.includes('(Clicks)');
        if (isDPM || isClicks) {
          updated[param] = {
            ...updated[param],
            visible: fpodUnitMode === 'DPM' ? isDPM : isClicks,
          };
        }
      }
      return updated;
    });
  }, [fpodUnitMode, fileType]);

  // X-axis year display toggle
  const [showYearInXAxis, setShowYearInXAxis] = useState(false);

  // X-axis days from start toggle (for _nmax files)
  const [showDaysFromStart, setShowDaysFromStart] = useState(false);
  const [maxDaysToShow, setMaxDaysToShow] = useState<number | ''>(''); // Empty means show all

  // Custom Y-axis label
  const [customYAxisLabel, setCustomYAxisLabel] = useState<string>(initialCustomYAxisLabel || '');

  // Date format preview dialog state
  const [showDateFormatDialog, setShowDateFormatDialog] = useState(false);
  const [pendingDateFormat, setPendingDateFormat] = useState<'DD/MM/YYYY' | 'MM/DD/YYYY' | null>(null);

  // Y-axis range dialog state
  const [showYAxisRangeDialog, setShowYAxisRangeDialog] = useState(false);
  const [yAxisRangeParameter, setYAxisRangeParameter] = useState<string | null>(null);
  const [yAxisRangeMin, setYAxisRangeMin] = useState<string>('');
  const [yAxisRangeMax, setYAxisRangeMax] = useState<string>('');

  // Temporary Y-axis range state for pending changes (before Apply is clicked)
  const [pendingYAxisRanges, setPendingYAxisRanges] = useState<Record<string, { min: string; max: string }>>({});

  // Raw CSV viewing state
  const [showRawCSV, setShowRawCSV] = useState(false);
  const [rawCSVContent, setRawCSVContent] = useState<string>('');

  // Time format detection state
  const [showFormatDetection, setShowFormatDetection] = useState(false);
  const [detectedFormat, setDetectedFormat] = useState<string>('');
  const [selectedFormat, setSelectedFormat] = useState<string>('');

  // Modified CSV state
  const [showModifiedCSV, setShowModifiedCSV] = useState(false);
  const [modifiedCSVContent, setModifiedCSVContent] = useState<string>('');

  // Styling rules state - load from localStorage if available
  const [showStylingRules, setShowStylingRules] = useState(false);
  const [styleRules, setStyleRules] = useState<StyleRule[]>(() => {
    // Load saved style rules from localStorage
    if (typeof window !== 'undefined') {
      try {
        const savedVersion = localStorage.getItem('pinChartStyleRulesVersion');
        const saved = localStorage.getItem('pinChartStyleRules');

        // Check if version matches - if not, clear localStorage and use new defaults
        const currentVersion = STYLE_RULES_VERSION;
        if (savedVersion !== String(currentVersion)) {
          console.log('🔄 Style rules version mismatch. Clearing localStorage and using new defaults.');
          localStorage.removeItem('pinChartStyleRules');
          localStorage.setItem('pinChartStyleRulesVersion', String(currentVersion));
          return DEFAULT_STYLE_RULES;
        }

        if (saved) {
          const savedRules = JSON.parse(saved) as StyleRule[];
          // Merge saved customizations with defaults (in case new rules were added)
          return DEFAULT_STYLE_RULES.map(defaultRule => {
            const savedRule = savedRules.find(r => r.suffix === defaultRule.suffix);
            return savedRule ? { ...defaultRule, ...savedRule } : defaultRule;
          });
        }
      } catch (error) {
        console.error('Failed to load saved style rules:', error);
      }
    }
    return DEFAULT_STYLE_RULES;
  });

  // Detect applicable styling rule based on filename
  const appliedStyleRule = useMemo(() => {
    if (!fileName) return null;

    // Find matching rule that is enabled
    const matchingRule = styleRules.find(rule =>
      rule.enabled && fileName.endsWith(rule.suffix)
    );

    // console.log('🎨 appliedStyleRule recalculated:', {
    //   fileName,
    //   matchingRule: matchingRule ? {
    //     suffix: matchingRule.suffix,
    //     styleName: matchingRule.styleName,
    //     yAxisTitle: matchingRule.properties.yAxisTitle,
    //     xAxisTitle: matchingRule.properties.xAxisTitle
    //   } : null
    // });

    return matchingRule || null;
  }, [fileName, styleRules]);

  // Log when data changes
  // React.useEffect(() => {
  //   if (data.length > 0) {
  //     console.log('[CHART DISPLAY] Data updated! First 3 timestamps:', data.slice(0, 3).map(d => d.time));
  //     console.log('[CHART DISPLAY] currentDateFormat:', currentDateFormat);
  //   }
  // }, [data, currentDateFormat]);

  // Apply styling rule defaults when rule changes (only watch defaultAxisMode specifically)
  // Skip for SubCam files which always use single axis
  React.useEffect(() => {
    if (fileType === 'Subcam') return;
    if (appliedStyleRule?.properties.defaultAxisMode) {
      setAxisMode(prev => {
        const newMode = appliedStyleRule.properties.defaultAxisMode;
        return newMode && newMode !== prev ? newMode : prev;
      });
    }
  }, [appliedStyleRule?.properties.defaultAxisMode, fileType]);

  // Get all parameters (for table view)
  const allParameters = useMemo(() => {
    if (data.length === 0) return [];
    
    const firstRow = data[0];
    return Object.keys(firstRow).filter(key => key !== 'time' && key !== timeColumn);
  }, [data, timeColumn]);
  
  // Get all numeric parameters (excluding time)
  const numericParameters = useMemo(() => {
    if (data.length === 0) return [];

    const firstRow = data[0];
    const params = Object.keys(firstRow)
      .filter(key => key !== 'time' && key !== timeColumn)
      .filter(key => {
        // Check if parameter has numeric values
        return data.some(row => {
          const value = row[key];
          return typeof value === 'number' && !isNaN(value);
        });
      });

    // console.log('📊 PinChartDisplay received data:', {
    //   dataLength: data.length,
    //   numericParameters: params,
    //   firstDataPoint: data[0],
    //   lastDataPoint: data[data.length - 1],
    //   fileName
    // });

    return params;
  }, [data, timeColumn, fileName]);

  // Detect if this is a Subcam nmax file and identify species columns
  const { isSubcamNmaxFile, speciesColumns } = useMemo(() => {
    const isNmaxFile = fileType === 'Subcam' && fileName?.toLowerCase().includes('nmax');

    if (!isNmaxFile || allParameters.length === 0) {
      return { isSubcamNmaxFile: false, speciesColumns: [] };
    }

    // Keywords to identify metadata columns (first 4-6 columns typically)
    const metadataKeywords = ['total', 'cumulative', 'observation', 'unique', 'recording', 'timestamp', 'date', 'time'];

    // Find the first column that doesn't match metadata keywords
    // Default to 6 (assume first 6 are metadata) if all match
    let firstSpeciesIndex = 6;
    for (let i = 0; i < Math.min(allParameters.length, 6); i++) {
      const paramLower = allParameters[i].toLowerCase();
      const isMetadata = metadataKeywords.some(keyword => paramLower.includes(keyword));
      if (!isMetadata) {
        firstSpeciesIndex = i;
        break;
      }
    }

    // Get species columns (all columns after metadata columns)
    const species = allParameters.slice(firstSpeciesIndex);

    console.log(`[SUBCAM HEATMAP] ${fileName}: ${species.length} species (${allParameters.length} total params)`);

    return { isSubcamNmaxFile: true, speciesColumns: species };
  }, [fileType, fileName, allParameters]);

  // Initialize parameter visibility state
  const [parameterStates, setParameterStates] = useState<Record<string, ParameterState>>(() => {
    const initialState: Record<string, ParameterState> = {};
    // Show only first 4 parameters by default (unless initial values provided)
    const defaultVisibleCount = 4;

    // GrowProbe priority parameters that should always be visible by default
    const gpPriorityParams = ['temp', 'ir', 'lux', 'light'];

    // Check if we have initial visibility settings from a saved view
    const hasInitialSettings = initialVisibleParameters && initialVisibleParameters.length > 0;

    // console.log('[PINCHART INIT] Initializing parameter states:', {
    //   fileName,
    //   numParams: numericParameters.length,
    //   hasInitialSettings,
    //   initialVisibleParams: initialVisibleParameters,
    //   initialColors: initialParameterColors ? Object.keys(initialParameterColors) : []
    // });

    // Separate parameters into non-hidden and hidden for color assignment
    // Non-hidden parameters get colors first to avoid duplicates in the default view
    const nonHiddenParams = numericParameters.filter(p => !isHiddenSensorParam(p));
    const hiddenParams = numericParameters.filter(p => isHiddenSensorParam(p));
    let orderedParams = [...nonHiddenParams, ...hiddenParams];

    // For FPOD files, group DPM and Click parameters together so each group
    // gets mixed warm/cool colors from the alternating palette
    if (fileType === 'FPOD') {
      const dpmParams = orderedParams.filter(p => p.includes('(DPM)'));
      const clickParams = orderedParams.filter(p => p.includes('(Clicks)'));
      const otherParams = orderedParams.filter(p => !p.includes('(DPM)') && !p.includes('(Clicks)'));
      orderedParams = [...dpmParams, ...clickParams, ...otherParams];
    }

    // Create a color index map based on the reordered parameters
    const colorIndexMap = new Map<string, number>();
    orderedParams.forEach((param, idx) => colorIndexMap.set(param, idx));

    numericParameters.forEach((param, index) => {
      // Use the reordered color index so hidden params get colors last
      const colorIndex = colorIndexMap.get(param) ?? index;
      const cssVar = CHART_COLORS[colorIndex % CHART_COLORS.length];
      const hexColor = cssVarToHex(cssVar);

      // For GrowProbe files, show priority parameters by default
      const isGPPriority = fileType === 'GP' && gpPriorityParams.includes(param.toLowerCase());

      // Determine visibility: use initial if provided, otherwise default to first N (or GP priority)
      const visible = hasInitialSettings
        ? initialVisibleParameters.includes(param)
        : (index < defaultVisibleCount || isGPPriority);

      // Get color: use initial if provided, otherwise generate default
      const color = (initialParameterColors && initialParameterColors[param]) || hexColor;

      // Get other settings if provided
      const settings = initialParameterSettings?.[param] || {};

      initialState[param] = {
        visible,
        color,
        opacity: settings.opacity ?? appliedStyleRule?.properties.defaultOpacity ?? 1.0,
        lineStyle: settings.lineStyle ?? appliedStyleRule?.properties.defaultLineStyle ?? 'solid',
        lineWidth: settings.lineWidth ?? appliedStyleRule?.properties.defaultLineWidth ?? 1,
        timeFilter: settings.timeFilter,
        movingAverage: settings.movingAverage,
        yAxisRange: settings.yAxisRange
      };

      // console.log(`[PINCHART INIT] Parameter "${param}":`, {
      //   visible,
      //   color,
      //   hasSettings: !!settings
      // });
    });
    return initialState;
  });

  // For nmax chart view: on initial load, only show "Total Observations" and "Cumulative Observations"
  React.useEffect(() => {
    if (!isSubcamNmaxFile || viewMode !== 'chart') return;
    setParameterStates(prev => {
      const updated = { ...prev };
      const metadataParams = allParameters.slice(0, Math.min(6, allParameters.length));
      metadataParams.forEach(param => {
        if (updated[param]) {
          const paramLower = param.toLowerCase().trim();
          updated[param] = {
            ...updated[param],
            visible: paramLower === 'total observations' || paramLower === 'cumulative observations'
          };
        }
      });
      speciesColumns.forEach(species => {
        if (updated[species]) {
          updated[species] = { ...updated[species], visible: false };
        }
      });
      return updated;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubcamNmaxFile]);

  // Default to heatmap view for SubCam nmax files
  React.useEffect(() => {
    if (isSubcamNmaxFile && speciesColumns.length > 0) {
      setViewMode('heatmap');
      // Make all species visible for heatmap (same logic as handleViewModeChange('heatmap'))
      setParameterStates(prev => {
        const updated = { ...prev };
        const metadataParams = allParameters.slice(0, Math.min(6, allParameters.length));
        metadataParams.forEach(param => {
          if (updated[param]) {
            updated[param] = { ...updated[param], visible: false };
          }
        });
        speciesColumns.forEach(species => {
          if (updated[species]) {
            updated[species] = { ...updated[species], visible: true };
          }
        });
        return updated;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubcamNmaxFile]);

  // Update parameter states when numericParameters changes (e.g., new data loaded)
  React.useEffect(() => {
    setParameterStates(prev => {
      // Check if parameters have actually changed
      const prevParams = Object.keys(prev).filter(k => !k.endsWith('_ma'));
      const currentParams = numericParameters;

      // If parameters haven't changed, return the same state object to prevent unnecessary re-renders
      if (prevParams.length === currentParams.length &&
          prevParams.every(p => currentParams.includes(p))) {
        // Parameters are the same - check if we need to update any MA states
        const needsUpdate = Object.keys(prev).some(param => {
          const state = prev[param];
          const maKey = `${param}_ma`;

          // Check if MA state needs to be added or removed
          if (state?.movingAverage?.enabled && state?.movingAverage?.showLine !== false) {
            return !prev[maKey]; // Needs update if MA is enabled but state doesn't exist
          } else {
            return !!prev[maKey]; // Needs update if MA is disabled but state exists
          }
        });

        if (!needsUpdate) {
          return prev; // Return same object to prevent re-render
        }
      }

      const newState: Record<string, ParameterState> = {};
      // For merged plots (small number of params), show all by default
      const defaultVisibleCount = numericParameters.length <= 3 ? numericParameters.length :
                                   ((fileType === 'GP' || dataSource === 'marine') ? 4 : 5);

      // GrowProbe priority parameters that should always be visible by default
      const gpPriorityParams = ['temp', 'ir', 'lux', 'light'];

      // Separate parameters into non-hidden and hidden for color assignment
      // Non-hidden parameters get colors first to avoid duplicates in the default view
      const nonHiddenParams = numericParameters.filter(p => !isHiddenSensorParam(p));
      const hiddenParams = numericParameters.filter(p => isHiddenSensorParam(p));
      let orderedParams = [...nonHiddenParams, ...hiddenParams];

      // For FPOD files, group DPM and Click parameters together so each group
      // gets mixed warm/cool colors from the alternating palette
      if (fileType === 'FPOD') {
        const dpmParams = orderedParams.filter(p => p.includes('(DPM)'));
        const clickParams = orderedParams.filter(p => p.includes('(Clicks)'));
        const otherParams = orderedParams.filter(p => !p.includes('(DPM)') && !p.includes('(Clicks)'));
        orderedParams = [...dpmParams, ...clickParams, ...otherParams];
      }

      // Create a color index map based on the reordered parameters
      const colorIndexMap = new Map<string, number>();
      orderedParams.forEach((param, idx) => colorIndexMap.set(param, idx));

      numericParameters.forEach((param, index) => {
        // Preserve existing state if parameter already exists
        if (prev[param]) {
          newState[param] = prev[param];
        } else {
          // Use the reordered color index so hidden params get colors last
          const colorIndex = colorIndexMap.get(param) ?? index;
          const cssVar = CHART_COLORS[colorIndex % CHART_COLORS.length];
          const hexColor = cssVarToHex(cssVar);
          // For GrowProbe files, show priority parameters by default
          const isGPPriority = fileType === 'GP' && gpPriorityParams.includes(param.toLowerCase());
          newState[param] = {
            visible: index < defaultVisibleCount || isGPPriority,
            color: hexColor, // Store as hex, not CSS variable
            opacity: appliedStyleRule?.properties.defaultOpacity ?? 1.0,
            lineStyle: appliedStyleRule?.properties.defaultLineStyle ?? 'solid',
            lineWidth: appliedStyleRule?.properties.defaultLineWidth ?? 1
          };
        }
      });

      // Manage MA parameter states based on base parameters
      Object.keys(newState).forEach(param => {
        const state = newState[param];
        const maKey = `${param}_ma`;

        if (state?.movingAverage?.enabled && state?.movingAverage?.showLine !== false) {
          // Create or update MA parameter state
          if (!newState[maKey]) {
            // Check if there are saved settings for this MA parameter
            const savedMASettings = initialParameterSettings?.[maKey] || {};

            console.log('[MA DEBUG] Creating MA parameter state:', {
              baseParam: param,
              maKey,
              baseColor: state.color,
              maColor: lightenColor(state.color, 0.3),
              savedSettings: savedMASettings
            });

            newState[maKey] = {
              visible: true, // MA parameters are always visible when enabled
              color: savedMASettings.color ?? '#6b7280', // Dark grey by default (Tailwind gray-500)
              opacity: savedMASettings.opacity ?? 1.0, // Full opacity by default
              lineStyle: savedMASettings.lineStyle ?? 'solid', // Solid line by default
              lineWidth: savedMASettings.lineWidth ?? 1 // 1px thickness by default
            };
          } else {
            // Update existing MA parameter to ensure visibility matches showLine
            newState[maKey] = {
              ...newState[maKey],
              visible: true
            };
          }
        } else {
          // Remove MA parameter state if MA is disabled or showLine is false
          if (newState[maKey]) {
            console.log('[MA DEBUG] Removing MA parameter state:', { baseParam: param, maKey });
          }
          delete newState[maKey];
        }
      });

      return newState;
    });
  }, [numericParameters.join(','), fileType, dataSource, appliedStyleRule]); // Use join to avoid array reference changes

  // NOTE: MA parameter states are now created directly in updateMovingAverage()
  // to avoid timing issues with useEffect watching parameterStates

  // Brush state for time range selection (local state for separate mode)
  const [brushStartIndex, setBrushStartIndex] = useState<number>(0);
  const [brushEndIndex, setBrushEndIndex] = useState<number | undefined>(undefined);

  // Get visible parameters (also filter out hidden sensor params for GrowProbe when toggle is off)
  const visibleParameters = useMemo(() => {
    let params = numericParameters.filter(param => parameterStates[param]?.visible);
    // Hide accelerometer/magnetic field params unless showSensorParams is enabled
    if (!showSensorParams && fileType === 'GP') {
      params = params.filter(param => !isHiddenSensorParam(param));
    }
    // For nmax chart view: put Cumulative before Daily in tooltip/render order
    if (isSubcamNmaxFile) {
      params.sort((a, b) => {
        const aIsCumulative = a.toLowerCase().includes('cumulative');
        const bIsCumulative = b.toLowerCase().includes('cumulative');
        if (aIsCumulative && !bIsCumulative) return -1;
        if (!aIsCumulative && bIsCumulative) return 1;
        return 0;
      });
    }
    return params;
  }, [numericParameters, parameterStates, showSensorParams, fileType, isSubcamNmaxFile]);

  // Calculate dynamic chart height based on number of visible parameters
  const dynamicChartHeight = useMemo(() => {
    // For heatmap mode, calculate height based on number of visible species
    if (showHeatmap && isSubcamNmaxFile) {
      const visibleSpeciesCount = speciesColumns.filter(species => parameterStates[species]?.visible).length;
      // Use adjustable row height
      const rowHeight = adjustableNmaxRowHeight;
      // Calculate height: (rowHeight per species row) + margins (150px for margins/axes/brush)
      const heatmapHeight = Math.max(300, (visibleSpeciesCount * rowHeight) + 150);
      return heatmapHeight;
    }

    // For haplotype heatmap/rarefaction view, return a fixed larger height
    if (showHaplotypeHeatmap && isHaplotypeFile && haplotypeData) {
      return 8000; // Double height to show more of the taxonomic tree without scrolling
    }

    // For nmax tree view, return a fixed larger height to show the entire taxonomic tree
    if (nmaxViewMode === 'tree' && isSubcamNmaxFile) {
      return 8000; // Large height to minimize scrolling in tree view
    }

    const baseHeight = appliedStyleRule?.properties.chartHeight || 208;
    const visibleCount = visibleParameters.length;
    const hasExplicitHeight = appliedStyleRule?.properties.chartHeight !== undefined;

    // FPOD files: taller charts since parameter panel and info banner are hidden
    if (fileType === 'FPOD' && !hasExplicitHeight) {
      return 350;
    }

    // If a styling rule explicitly sets chartHeight, always use it (don't cap it)
    if (hasExplicitHeight) {
      return baseHeight;
    }

    // For plots WITHOUT explicit height styling, use larger heights for better visibility
    // Extra height added to accommodate x-axis labels
    if (visibleCount === 1) {
      return Math.min(baseHeight, 270);
    } else if (visibleCount === 2) {
      return Math.min(baseHeight, 300);
    } else if (visibleCount === 3) {
      return Math.min(baseHeight, 330);
    }

    // For 4+ parameters, use larger height
    return Math.max(baseHeight, 350);
  }, [visibleParameters.length, appliedStyleRule?.properties.chartHeight, appliedStyleRule?.properties.heatmapRowHeight, fileName, appliedStyleRule?.styleName, showHeatmap, isSubcamNmaxFile, speciesColumns, parameterStates, showHaplotypeHeatmap, isHaplotypeFile, haplotypeData, adjustableNmaxRowHeight, nmaxViewMode]);

  // Get moving average parameters (for display in parameter list)
  const movingAverageParameters = useMemo(() => {
    const maParams: string[] = [];

    Object.entries(parameterStates).forEach(([param, state]) => {
      // Only add MA parameters for base parameters (not for MA parameters themselves)
      if (!param.endsWith('_ma') && state?.movingAverage?.enabled && state?.movingAverage?.showLine !== false) {
        console.log('[MA DEBUG] Adding MA parameter:', {
          baseParam: param,
          maParam: `${param}_ma`,
          windowDays: state.movingAverage.windowDays,
          showLine: state.movingAverage.showLine
        });
        maParams.push(`${param}_ma`);
      }
    });

    // console.log('[MA DEBUG] movingAverageParameters:', maParams);
    return maParams;
  }, [parameterStates]);

  // Combine base parameters and MA parameters for display
  const allDisplayParameters = useMemo(() => {
    const combined = [...visibleParameters, ...movingAverageParameters];
    // console.log('[MA DEBUG] allDisplayParameters:', {
    //   visibleParameters,
    //   movingAverageParameters,
    //   combined
    // });
    return combined;
  }, [visibleParameters, movingAverageParameters]);

  // Track previous visibility state to avoid infinite loops
  const prevVisibilityRef = React.useRef<string>('');

  // Notify parent when visibility changes (for merge feature)
  React.useEffect(() => {
    if (!onVisibilityChange) return;

    // Extract colors for visible parameters
    const colors = visibleParameters.reduce((acc, param) => {
      acc[param] = parameterStates[param]?.color || '--chart-1';
      return acc;
    }, {} as Record<string, string>);

    // Extract full parameter settings (MA, opacity, line styles, Y-axis range, etc.)
    const settings = Object.keys(parameterStates).reduce((acc, param) => {
      const state = parameterStates[param];
      if (state) {
        // Only include settings that are different from defaults
        const paramSettings: Partial<ParameterState> = {};
        if (state.opacity !== undefined && state.opacity !== 1) paramSettings.opacity = state.opacity;
        if (state.lineStyle && state.lineStyle !== 'solid') paramSettings.lineStyle = state.lineStyle;
        if (state.lineWidth !== undefined && state.lineWidth !== 2) paramSettings.lineWidth = state.lineWidth;
        if (state.movingAverage) paramSettings.movingAverage = state.movingAverage;
        if (state.timeFilter) paramSettings.timeFilter = state.timeFilter;
        if (state.yAxisRange) paramSettings.yAxisRange = state.yAxisRange;

        if (Object.keys(paramSettings).length > 0) {
          acc[param] = paramSettings;
        }
      }
      return acc;
    }, {} as Record<string, Partial<ParameterState>>);

    // Plot-level settings
    const plotSettings = {
      axisMode,
      customYAxisLabel: customYAxisLabel || undefined,
      compactView,
      customParameterNames: Object.keys(customParameterNames).length > 0 ? customParameterNames : undefined
    };

    // Create a stable key for comparison
    const currentKey = JSON.stringify({ params: visibleParameters, colors, settings, plotSettings });

    // Only call callback if values actually changed
    if (currentKey !== prevVisibilityRef.current) {
      prevVisibilityRef.current = currentKey;
      onVisibilityChange(visibleParameters, colors, settings, plotSettings);
    }
  }, [visibleParameters, parameterStates, axisMode, customYAxisLabel, compactView, customParameterNames, onVisibilityChange]);

  // Helper function to check if a time falls within an exclusion range
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

  // Handle view mode change (unified for all file types)
  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);

    // Adjust visibility for nmax files based on view mode
    if (isSubcamNmaxFile && speciesColumns.length > 0) {
      if (mode === 'heatmap' || mode === 'tree') {
        setParameterStates(prev => {
          const updated = { ...prev };

          // Hide all aggregated metadata parameters (first 6)
          const metadataParams = allParameters.slice(0, Math.min(6, allParameters.length));
          metadataParams.forEach(param => {
            if (updated[param]) {
              updated[param] = { ...updated[param], visible: false };
            }
          });

          // Show ALL species columns (Latin names) by default for nmax files
          speciesColumns.forEach((species) => {
            if (updated[species]) {
              updated[species] = { ...updated[species], visible: true };
            }
          });

          console.log('[NMAX VIEW MODE] Updated parameter visibility:', {
            mode,
            hiddenMetadata: metadataParams,
            visibleSpecies: speciesColumns,
            totalSpecies: speciesColumns.length
          });

          return updated;
        });
      } else if (mode === 'chart') {
        // Chart mode for nmax: show only "Total Observations" and "Cumulative Observations", hide species
        setParameterStates(prev => {
          const updated = { ...prev };

          // Show only exact "Total Observations" and "Cumulative Observations"
          const metadataParams = allParameters.slice(0, Math.min(6, allParameters.length));
          metadataParams.forEach(param => {
            const paramLower = param.toLowerCase().trim();
            if (updated[param]) {
              updated[param] = {
                ...updated[param],
                visible: paramLower === 'total observations' || paramLower === 'cumulative observations'
              };
            }
          });

          // Hide ALL species columns in chart mode
          speciesColumns.forEach((species) => {
            if (updated[species]) {
              updated[species] = { ...updated[species], visible: false };
            }
          });

          return updated;
        });
      }
    }
  };

  // Legacy handler for backward compatibility (used by Switch component)
  const handleHeatmapToggle = (enabled: boolean) => {
    handleViewModeChange(enabled ? 'heatmap' : 'chart');
  };

  // Fetch taxonomy data for nmax species ONLY when in heatmap or tree view (lazy loading for performance)
  React.useEffect(() => {
    // Only fetch taxonomy if user is viewing heatmap or tree mode
    const needsTaxonomy = nmaxViewMode === 'heatmap' || nmaxViewMode === 'tree';

    if (isSubcamNmaxFile && speciesColumns.length > 0 && needsTaxonomy && !isFetchingNmaxTaxonomy) {
      const currentSpeciesList = speciesColumns.join(',');

      // Only fetch if we haven't fetched this exact species list before
      if (currentSpeciesList !== nmaxFetchedSpeciesList) {
        console.log('🔬 Fetching taxonomy for nmax species (lazy load on view mode change):', speciesColumns);
        setIsFetchingNmaxTaxonomy(true);

        // Increased concurrency from 5 to 15 for faster parallel processing
        lookupSpeciesBatch(speciesColumns, 15)
          .then(taxonomyMap => {
            setNmaxTaxonomyData(taxonomyMap);
            setNmaxFetchedSpeciesList(currentSpeciesList); // Mark this species list as fetched
            console.log(`✅ Taxonomy data enriched for ${taxonomyMap.size}/${speciesColumns.length} nmax species`);
          })
          .catch(error => {
            console.error('⚠️ Taxonomy lookup failed:', error);
            setNmaxFetchedSpeciesList(currentSpeciesList); // Mark as attempted even on failure
          })
          .finally(() => {
            setIsFetchingNmaxTaxonomy(false);
          });
      }
    }
  }, [nmaxViewMode, isSubcamNmaxFile, speciesColumns.join(','), nmaxFetchedSpeciesList, isFetchingNmaxTaxonomy]);

  // Build taxonomic tree for nmax species (only when in heatmap or tree view for performance)
  const nmaxTaxonomicTree = useMemo(() => {
    // Skip tree building if not in heatmap or tree view mode
    const needsTree = nmaxViewMode === 'heatmap' || nmaxViewMode === 'tree';

    if (!needsTree) {
      return null; // Early return for performance
    }

    console.log('[NMAX TREE BUILD] Conditions check:', {
      isSubcamNmaxFile,
      speciesColumnsLength: speciesColumns.length,
      nmaxTaxonomyDataSize: nmaxTaxonomyData.size,
      viewMode: nmaxViewMode
    });

    if (!isSubcamNmaxFile || speciesColumns.length === 0 || nmaxTaxonomyData.size === 0) {
      console.log('[NMAX TREE BUILD] Returning null - one or more conditions failed');
      return null;
    }

    console.log('[NMAX TREE BUILD] All conditions passed - building tree');

    // Convert nmax species and taxonomy data to haplotype-like cell data format
    const cellData = speciesColumns.map(species => {
      const taxonomy = nmaxTaxonomyData.get(species);
      return {
        species,
        site: 'nmax', // Dummy site since nmax doesn't have sites
        count: 1,
        metadata: {
          credibility: 'high',
          phylum: taxonomy?.hierarchy?.phylum || 'Unknown',
          fullHierarchy: taxonomy?.hierarchy || {},
          taxonomySource: taxonomy?.source as 'worms' | 'gbif' | 'unknown' | undefined,
          taxonId: taxonomy?.taxonId,
          commonNames: taxonomy?.commonNames || [],
          taxonomyConfidence: taxonomy?.confidence,
          taxonomyRank: taxonomy?.rank
        }
      };
    });

    return buildTaxonomicTree(cellData);
  }, [isSubcamNmaxFile, speciesColumns, nmaxTaxonomyData, nmaxViewMode]);

  // Create taxonomically ordered species list (CSV entries + their parent nodes for hierarchy visualization)
  const taxonomicallyOrderedSpecies = useMemo(() => {
    if (!nmaxTaxonomicTree) {
      return speciesColumns; // Fallback to original order if no tree
    }

    // Flatten the tree
    const flattenedTree = flattenTreeForHeatmap(nmaxTaxonomicTree);

    // Step 1: Get all CSV entries (leaf nodes that exist in the actual data)
    const csvEntries = flattenedTree.filter(taxon => taxon.node.csvEntry);

    // Step 2: Build set of all nodes needed (CSV entries + their ancestors)
    const neededNodeNames = new Set<string>();
    csvEntries.forEach(entry => {
      // Add the entry itself
      const entryName = entry.node.originalName || entry.name;
      neededNodeNames.add(entryName);

      // Add all ancestors in the path
      entry.path.forEach(ancestorName => neededNodeNames.add(ancestorName));
    });

    // Step 3: Filter to include both CSV entries and their parent nodes
    const orderedSpeciesWithParents = flattenedTree
      .filter(taxon => neededNodeNames.has(taxon.node.originalName || taxon.name))
      .map(taxon => taxon.node.originalName || taxon.name);

    console.log('[Taxonomic Ordering] Total species in tree:', flattenedTree.length);
    console.log('[Taxonomic Ordering] CSV entries (leaf nodes):', csvEntries.length);
    console.log('[Taxonomic Ordering] Including parent nodes, total:', orderedSpeciesWithParents.length);
    console.log('[Taxonomic Ordering] Parent count:', orderedSpeciesWithParents.length - csvEntries.length);
    console.log('[Taxonomic Ordering] Ordered species with parents:', orderedSpeciesWithParents);

    return orderedSpeciesWithParents;
  }, [nmaxTaxonomicTree, speciesColumns]);

  // Create species indentation map for heatmap display (includes both CSV entries and parent nodes)
  const speciesIndentMap = useMemo(() => {
    if (!nmaxTaxonomicTree) {
      return new Map<string, number>();
    }

    const flattenedTree = flattenTreeForHeatmap(nmaxTaxonomicTree);
    const indentMap = new Map<string, number>();

    // Include ALL taxa in the ordered list (both CSV entries and their parents)
    flattenedTree.forEach(taxon => {
      // Use original name if available (preserves rank annotations like "(gen.)")
      const key = taxon.node.originalName || taxon.name;
      indentMap.set(key, taxon.indentLevel);
    });

    console.log('[Taxonomic Ordering] Indentation map size:', indentMap.size);

    return indentMap;
  }, [nmaxTaxonomicTree]);

  // Create species rank map for heatmap display (includes both CSV entries and parent nodes)
  const speciesRankMap = useMemo(() => {
    const rankMap = new Map<string, string>();

    if (!nmaxTaxonomicTree) {
      // Fallback: Extract rank directly from CSV species names
      speciesColumns.forEach(speciesName => {
        const suffixMatch = speciesName.match(/\((phyl|gigaclass|infraclass|class|ord|fam|gen|sp)\.\)/);
        if (suffixMatch) {
          rankMap.set(speciesName, suffixMatch[1]);
        }
      });
      return rankMap;
    }

    // Build rank map from flattened tree (includes all nodes, not just CSV entries)
    const flattenedTree = flattenTreeForHeatmap(nmaxTaxonomicTree);
    flattenedTree.forEach(taxon => {
      const key = taxon.node.originalName || taxon.name;
      const rankMapping: Record<string, string> = {
        'kingdom': 'kingdom',
        'phylum': 'phyl',
        'class': 'class',
        'order': 'ord',
        'family': 'fam',
        'genus': 'gen',
        'species': 'sp'
      };
      const mappedRank = rankMapping[taxon.rank] || taxon.rank;
      rankMap.set(key, mappedRank);
    });

    console.log('[Taxonomic Ordering] Rank map size:', rankMap.size);
    console.log('[Taxonomic Ordering] Rank map entries:', Array.from(rankMap.entries()));

    return rankMap;
  }, [speciesColumns, nmaxTaxonomicTree]);

  // Create filtered flattened tree for parent-child connection lines
  const filteredFlattenedTree = useMemo(() => {
    console.log('[FILTERED TREE] nmaxTaxonomicTree:', nmaxTaxonomicTree ? 'exists' : 'null/undefined');

    if (!nmaxTaxonomicTree) {
      console.log('[FILTERED TREE] Returning empty array - nmaxTaxonomicTree is null/undefined');
      return [];
    }

    const flattenedTree = flattenTreeForHeatmap(nmaxTaxonomicTree);
    console.log('[FILTERED TREE] flattenedTree length:', flattenedTree.length);

    // Get the same set of needed nodes as in taxonomicallyOrderedSpecies
    const csvEntries = flattenedTree.filter(taxon => taxon.node.csvEntry);
    console.log('[FILTERED TREE] csvEntries length:', csvEntries.length);

    const neededNodeNames = new Set<string>();
    csvEntries.forEach(entry => {
      const entryName = entry.node.originalName || entry.name;
      neededNodeNames.add(entryName);
      entry.path.forEach(ancestorName => neededNodeNames.add(ancestorName));
    });
    console.log('[FILTERED TREE] neededNodeNames size:', neededNodeNames.size);

    // Filter to only include nodes that are being displayed
    const result = flattenedTree.filter(taxon =>
      neededNodeNames.has(taxon.node.originalName || taxon.name)
    );
    console.log('[FILTERED TREE] Final result length:', result.length);

    return result;
  }, [nmaxTaxonomicTree]);

  // Create parent-child relationship map for visual indicators
  // Each parent gets one color, all its direct children adopt that same color
  // Taxa that are both children AND parents get two triangles (one for each role)
  const parentChildRelationships = useMemo(() => {
    const relationships = new Map<string, { asParent?: { color: string; childIsDual?: boolean }; asChild?: { color: string } }>();

    if (!filteredFlattenedTree || filteredFlattenedTree.length === 0) {
      return relationships;
    }

    // Define colors for parents (Paul Tol colorblind-friendly palette)
    const colors = [
      '#4477AA', // Blue
      '#EE6677', // Red/pink
      '#228833', // Green
      '#CCBB44', // Olive yellow
      '#66CCEE', // Cyan
      '#AA3377', // Purple
      '#CC6644', // Burnt orange
      '#BBBBBB', // Grey
    ];

    let colorIndex = 0;

    // Find all parent-child relationships where both are CSV entries
    const visibleSpecies = taxonomicallyOrderedSpecies.filter(species => parameterStates[species]?.visible);

    // First pass: identify all parents and their children
    const parentChildMap = new Map<string, string[]>();

    filteredFlattenedTree.forEach((taxon, index) => {
      const taxonName = taxon.node.originalName || taxon.name;

      if (!visibleSpecies.includes(taxonName) || !taxon.node.csvEntry) {
        return;
      }

      const children: string[] = [];

      for (let i = index + 1; i < filteredFlattenedTree.length; i++) {
        const potentialChild = filteredFlattenedTree[i];
        const childName = potentialChild.node.originalName || potentialChild.name;

        if (potentialChild.indentLevel <= taxon.indentLevel) {
          break;
        }

        const isDirectChild = (
          potentialChild.indentLevel === taxon.indentLevel + 1 &&
          potentialChild.path.includes(taxon.name) &&
          potentialChild.node.csvEntry &&
          visibleSpecies.includes(childName)
        );

        if (isDirectChild) {
          children.push(childName);
        }
      }

      if (children.length > 0) {
        parentChildMap.set(taxonName, children);
      }
    });

    // Second pass: assign colors and check if children are also parents (dual)
    filteredFlattenedTree.forEach((taxon) => {
      const taxonName = taxon.node.originalName || taxon.name;
      const children = parentChildMap.get(taxonName);

      if (children && children.length > 0) {
        const parentColor = colors[colorIndex % colors.length];
        colorIndex++;

        // Check if any child is also a parent (will have dual arrows)
        const childIsDual = children.some(childName => parentChildMap.has(childName));

        // Mark as parent - preserve any existing child role
        const existing = relationships.get(taxonName) || {};
        relationships.set(taxonName, { ...existing, asParent: { color: parentColor, childIsDual } });

        // Mark all children with parent's color
        children.forEach(childName => {
          const existingChild = relationships.get(childName) || {};
          relationships.set(childName, { ...existingChild, asChild: { color: parentColor } });
        });
      }
    });

    console.log('[PARENT-CHILD RELATIONSHIPS] relationships:', Array.from(relationships.entries()));
    return relationships;
  }, [filteredFlattenedTree, taxonomicallyOrderedSpecies, parameterStates]);

  // Determine which brush indices to use based on mode
  const activeBrushStart = timeAxisMode === 'common' && globalBrushRange ? (globalBrushRange.startIndex ?? 0) : (brushStartIndex ?? 0);
  const activeBrushEnd = timeAxisMode === 'common' && globalBrushRange
    ? (globalBrushRange.endIndex ?? data.length - 1)  // Fix: fallback for global brush range
    : (brushEndIndex ?? data.length - 1);             // Fix: fallback for local brush index

  // Get data slice for current brush selection
  // Create a stable key for MA settings to track changes
  const maSettingsKey = useMemo(() => {
    return Object.entries(parameterStates)
      .filter(([param, state]) => !param.endsWith('_ma') && state?.movingAverage?.enabled)
      .map(([param, state]) => `${param}:${state?.movingAverage?.windowDays}:${state?.movingAverage?.showLine}`)
      .join('|');
  }, [parameterStates]);

  const displayData = useMemo(() => {
    // console.log('[MA DEBUG] displayData useMemo RUNNING. maSettingsKey:', maSettingsKey, 'maUpdateCounter:', maUpdateCounter);

    if (data.length === 0) return [];

    // Step 1: Get base data based on brush/time range
    let baseData: ParsedDataPoint[];

    // In common mode with global time range, filter by actual time values for marine data
    if (timeAxisMode === 'common' && globalTimeRange && globalTimeRange.min && globalTimeRange.max && dataSource === 'marine') {
      baseData = data.filter(point => {
        try {
          const pointDate = parseISO(point.time);
          if (!isValid(pointDate)) return false;
          return pointDate >= globalTimeRange.min! && pointDate <= globalTimeRange.max!;
        } catch {
          return false;
        }
      });
    } else {
      // For CSV data or separate mode, use brush indices
      const start = Math.max(0, activeBrushStart);
      const end = Math.min(data.length - 1, activeBrushEnd ?? data.length - 1);
      baseData = data.slice(start, end + 1);
    }

    // Step 2: Apply time-of-day filters (if any parameter has them enabled)
    const hasTimeFilters = Object.values(parameterStates).some(state => state?.timeFilter?.enabled);

    // console.log('[MA DEBUG] Step 2: hasTimeFilters:', hasTimeFilters);

    // Apply time filters (if any enabled)
    const filteredData = !hasTimeFilters ? baseData : baseData.map(point => {
      const newPoint = { ...point };

      // For each parameter with time filter enabled
      Object.keys(parameterStates).forEach(param => {
        const state = parameterStates[param];
        if (state?.timeFilter?.enabled && state.timeFilter.excludeStart && state.timeFilter.excludeEnd) {
          // Check if this time should be excluded
          if (isTimeExcluded(point.time, state.timeFilter.excludeStart, state.timeFilter.excludeEnd)) {
            // Set to null to create gap in line
            newPoint[param] = null;
          }
        }
      });

      return newPoint;
    });

    // Step 3: Calculate moving averages (if any parameter has them enabled)
    const hasMovingAverages = Object.values(parameterStates).some(state => state?.movingAverage?.enabled);

    // console.log('[MA DEBUG] hasMovingAverages:', hasMovingAverages);
    // console.log('[MA DEBUG] parameterStates:', parameterStates);

    if (!hasMovingAverages) {
      // console.log('[MA DEBUG] No MA enabled, returning filtered data without MA calculation');
      return filteredData; // No MA, return filtered data
    }

    // Calculate moving averages and add MA data keys
    const maEnabledParams = Object.entries(parameterStates)
      .filter(([param, state]) => state?.movingAverage?.enabled)
      .map(([param]) => param);

    if (maEnabledParams.length > 0) {
      console.log('[MA DEBUG] MA enabled for parameters:', maEnabledParams);
    }

    // Calculate actual data frequency from timestamps to convert days to data points
    let pointsPerDay = 24; // Default: assume hourly data
    if (filteredData.length > 1) {
      try {
        const time1 = parseISO(filteredData[0].time);
        const time2 = parseISO(filteredData[1].time);
        if (isValid(time1) && isValid(time2)) {
          const intervalMs = Math.abs(time2.getTime() - time1.getTime());
          const intervalHours = intervalMs / (1000 * 60 * 60);
          pointsPerDay = Math.round(24 / intervalHours);
          console.log('[MA DEBUG] Data frequency:', intervalHours, 'hours between points,', pointsPerDay, 'points per day');
        }
      } catch (e) {
        console.warn('[MA DEBUG] Could not calculate data frequency, using default (hourly)');
      }
    }

    return filteredData.map((point, index) => {
      const newPoint = { ...point };

      // For each parameter with MA enabled
      Object.keys(parameterStates).forEach(param => {
        const state = parameterStates[param];
        if (state?.movingAverage?.enabled) {
          const windowDays = state.movingAverage.windowDays || 1;

          // Calculate window size based on actual data frequency
          const windowSize = windowDays * pointsPerDay;

          // Collect values in window (looking backward from current index)
          const windowStart = Math.max(0, index - windowSize + 1);
          const windowValues: number[] = [];

          for (let i = windowStart; i <= index; i++) {
            const value = filteredData[i][param];
            if (typeof value === 'number' && !isNaN(value) && value !== null) {
              windowValues.push(value);
            }
          }

          // Calculate average
          if (windowValues.length > 0) {
            const sum = windowValues.reduce((a, b) => a + b, 0);
            newPoint[`${param}_ma`] = sum / windowValues.length;

            // Log first few points for debugging
            if (index < 3) {
              console.log('[MA DEBUG] Calculated MA for point', index, {
                param,
                maKey: `${param}_ma`,
                windowDays,
                pointsPerDay,
                windowSize,
                windowValues: windowValues.length,
                maValue: newPoint[`${param}_ma`],
                originalValue: point[param]
              });
            }
          } else {
            newPoint[`${param}_ma`] = null;
          }
        }
      });

      return newPoint;
    });
  }, [data, activeBrushStart, activeBrushEnd, timeAxisMode, globalTimeRange, dataSource, parameterStates, maUpdateCounter, maSettingsKey]);

  // Log displayData sample for debugging MA
  React.useEffect(() => {
    if (displayData.length > 0) {
      const firstPoint = displayData[0];
      const maKeys = Object.keys(firstPoint).filter(k => k.endsWith('_ma'));
      if (maKeys.length > 0) {
        console.log('[MA DEBUG] displayData contains MA keys:', maKeys);
        console.log('[MA DEBUG] Sample data point:', firstPoint);
      }
    }
  }, [displayData]);

  // Transform data for "days from start" mode (for _nmax files)
  const finalDisplayData = useMemo(() => {
    if (!showDaysFromStart || !isSubcamNmaxFile || displayData.length === 0) {
      return displayData;
    }

    // Calculate day numbers from start date
    const startDate = parseISO(displayData[0].time);
    if (!isValid(startDate)) {
      console.warn('[DAYS MODE] Invalid start date, falling back to regular display');
      return displayData;
    }

    const dataWithDays = displayData.map((point) => {
      const pointDate = parseISO(point.time);
      if (!isValid(pointDate)) {
        return { ...point, dayNumber: 0 };
      }

      // Calculate days from start (can be fractional)
      const diffMs = pointDate.getTime() - startDate.getTime();
      const dayNumber = diffMs / (1000 * 60 * 60 * 24);

      return {
        ...point,
        dayNumber: Math.round(dayNumber * 100) / 100, // Round to 2 decimal places
      };
    });

    // Filter by max days if specified
    if (maxDaysToShow !== '' && maxDaysToShow > 0) {
      return dataWithDays.filter(point => point.dayNumber <= maxDaysToShow);
    }

    return dataWithDays;
  }, [displayData, showDaysFromStart, isSubcamNmaxFile, maxDaysToShow]);

  // Calculate nighttime periods for 24hr FPOD charts based on sunrise/sunset
  // For 24hr averaged files, we calculate AVERAGE sunrise/sunset across the file's date range
  const nighttimePeriods = useMemo(() => {
    // Only calculate for 24hr files with coordinates
    if (!showDateTimeAxis || !coordinates || finalDisplayData.length === 0) {
      return [];
    }

    const { lat, lng } = coordinates;

    // Get data point times sorted
    const dataTimestamps = finalDisplayData
      .filter(point => point.time)
      .map(point => ({
        time: point.time,
        timestamp: new Date(point.time).getTime()
      }))
      .sort((a, b) => a.timestamp - b.timestamp);

    if (dataTimestamps.length === 0) return [];

    // Helper: find nearest data point time that is >= target hour (0-23)
    const findDataPointNearHour = (targetHour: number): string | null => {
      // Data points are like "2025-03-13T06:00:00.000Z" - we need to match by hour
      for (const dp of dataTimestamps) {
        const hour = new Date(dp.time).getUTCHours();
        if (hour >= targetHour) return dp.time;
      }
      return null;
    };

    // Helper: find nearest data point time that is <= target hour
    const findDataPointBeforeHour = (targetHour: number): string | null => {
      for (let i = dataTimestamps.length - 1; i >= 0; i--) {
        const hour = new Date(dataTimestamps[i].time).getUTCHours();
        if (hour <= targetHour) return dataTimestamps[i].time;
      }
      return null;
    };

    // Parse date range from filename (e.g., "_2503_2506" = March 2025 to June 2025)
    // Format: YYMM_YYMM
    const parseDateRangeFromFilename = (name: string): { startDate: Date; endDate: Date } | null => {
      // Look for pattern like _2503_2506 or _2406_2407
      const match = name.match(/_(\d{2})(\d{2})_(\d{2})(\d{2})/);
      if (match) {
        const [, startYear, startMonth, endYear, endMonth] = match;
        const startDate = new Date(2000 + parseInt(startYear), parseInt(startMonth) - 1, 15); // Mid-month
        const endDate = new Date(2000 + parseInt(endYear), parseInt(endMonth) - 1, 15);
        return { startDate, endDate };
      }
      return null;
    };

    const dateRange = fileName ? parseDateRangeFromFilename(fileName) : null;

    // Calculate average sunrise/sunset times across the date range
    let avgSunriseHour = 6; // Default fallback
    let avgSunsetHour = 18; // Default fallback

    if (dateRange) {
      const { startDate, endDate } = dateRange;
      const sunriseHours: number[] = [];
      const sunsetHours: number[] = [];

      // Sample dates across the range (every 7 days)
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const sunTimes = SunCalc.getTimes(currentDate, lat, lng);

        if (sunTimes.sunrise && isValid(sunTimes.sunrise)) {
          // Get hour in UTC (since data is in UTC)
          sunriseHours.push(sunTimes.sunrise.getUTCHours() + sunTimes.sunrise.getUTCMinutes() / 60);
        }
        if (sunTimes.sunset && isValid(sunTimes.sunset)) {
          sunsetHours.push(sunTimes.sunset.getUTCHours() + sunTimes.sunset.getUTCMinutes() / 60);
        }

        currentDate.setDate(currentDate.getDate() + 7); // Sample every 7 days
      }

      if (sunriseHours.length > 0) {
        avgSunriseHour = sunriseHours.reduce((a, b) => a + b, 0) / sunriseHours.length;
      }
      if (sunsetHours.length > 0) {
        avgSunsetHour = sunsetHours.reduce((a, b) => a + b, 0) / sunsetHours.length;
      }

      console.log('[NIGHTTIME] ═══════════════════════════════════════');
      console.log('[NIGHTTIME] File:', fileName);
      console.log('[NIGHTTIME] Date range:', startDate.toDateString(), 'to', endDate.toDateString());
      console.log('[NIGHTTIME] Coordinates: lat=' + lat + ', lng=' + lng);
      console.log('[NIGHTTIME] Sampled', sunriseHours.length, 'dates');
      console.log('[NIGHTTIME] Avg sunrise hour (UTC):', avgSunriseHour.toFixed(2), '(' + Math.floor(avgSunriseHour) + ':' + Math.round((avgSunriseHour % 1) * 60).toString().padStart(2, '0') + ')');
      console.log('[NIGHTTIME] Avg sunset hour (UTC):', avgSunsetHour.toFixed(2), '(' + Math.floor(avgSunsetHour) + ':' + Math.round((avgSunsetHour % 1) * 60).toString().padStart(2, '0') + ')');
      console.log('[NIGHTTIME] ═══════════════════════════════════════');
    } else {
      // Fallback: use a single representative date if filename parsing fails
      const representativeDate = new Date(dataTimestamps[0].time);
      const sunTimes = SunCalc.getTimes(representativeDate, lat, lng);
      if (sunTimes.sunrise && isValid(sunTimes.sunrise)) {
        avgSunriseHour = sunTimes.sunrise.getUTCHours() + sunTimes.sunrise.getUTCMinutes() / 60;
      }
      if (sunTimes.sunset && isValid(sunTimes.sunset)) {
        avgSunsetHour = sunTimes.sunset.getUTCHours() + sunTimes.sunset.getUTCMinutes() / 60;
      }
      console.log('[NIGHTTIME] No date range in filename, using representative date');
    }

    const periods: Array<{ start: string; end: string }> = [];

    // Validate reasonable sunrise/sunset hours (sanity check)
    // Sunrise should be between 3-10 UTC, Sunset between 15-23 UTC for most locations
    const validSunrise = avgSunriseHour >= 3 && avgSunriseHour <= 12;
    const validSunset = avgSunsetHour >= 15 && avgSunsetHour <= 23;

    if (!validSunrise || !validSunset) {
      console.warn('[NIGHTTIME] Invalid sunrise/sunset hours detected:', {
        avgSunriseHour,
        avgSunsetHour,
        validSunrise,
        validSunset
      });
      // Fall back to reasonable defaults
      if (!validSunrise) avgSunriseHour = 6;
      if (!validSunset) avgSunsetHour = 20;
    }

    // Find daytime boundaries (hours >= sunrise AND < sunset)
    // This handles wrap-around when data starts late in the day (e.g., 23:00)
    const sunriseHourRounded = Math.round(avgSunriseHour);
    const sunsetHourRounded = Math.round(avgSunsetHour);

    // Helper to check if an hour is during daytime
    const isDaytime = (hour: number) => hour >= sunriseHourRounded && hour < sunsetHourRounded;

    // Find where daytime STARTS (first hour that is daytime)
    let daytimeStartIndex = -1;
    for (let i = 0; i < dataTimestamps.length; i++) {
      const hour = new Date(dataTimestamps[i].time).getUTCHours();
      if (isDaytime(hour)) {
        daytimeStartIndex = i;
        break;
      }
    }

    // Find where daytime ENDS (last hour that is daytime)
    let daytimeEndIndex = -1;
    for (let i = dataTimestamps.length - 1; i >= 0; i--) {
      const hour = new Date(dataTimestamps[i].time).getUTCHours();
      if (isDaytime(hour)) {
        daytimeEndIndex = i;
        break;
      }
    }

    console.log('[NIGHTTIME] Daytime range: index', daytimeStartIndex, 'to', daytimeEndIndex,
      '(hours ' + (daytimeStartIndex >= 0 ? new Date(dataTimestamps[daytimeStartIndex].time).getUTCHours() : 'N/A') +
      ' to ' + (daytimeEndIndex >= 0 ? new Date(dataTimestamps[daytimeEndIndex].time).getUTCHours() : 'N/A') + ')');

    // Left nighttime: from data start to just before daytime starts
    if (daytimeStartIndex > 0) {
      const leftStart = dataTimestamps[0].time;
      const leftEnd = dataTimestamps[daytimeStartIndex - 1].time;
      periods.push({ start: leftStart, end: leftEnd });
      console.log('[NIGHTTIME] Left nighttime: index 0 to', daytimeStartIndex - 1,
        '(hours ' + new Date(leftStart).getUTCHours() + ' to ' + new Date(leftEnd).getUTCHours() + ')');
    }

    // Right nighttime: from just after daytime ends to data end
    if (daytimeEndIndex !== -1 && daytimeEndIndex < dataTimestamps.length - 1) {
      const rightStart = dataTimestamps[daytimeEndIndex + 1].time;
      const rightEnd = dataTimestamps[dataTimestamps.length - 1].time;
      periods.push({ start: rightStart, end: rightEnd });
      console.log('[NIGHTTIME] Right nighttime: index', daytimeEndIndex + 1, 'to', dataTimestamps.length - 1,
        '(hours ' + new Date(rightStart).getUTCHours() + ' to ' + new Date(rightEnd).getUTCHours() + ')');
    }

    // Log all data hours for debugging
    const dataHours = dataTimestamps.map(d => new Date(d.time).getUTCHours());
    console.log('[NIGHTTIME] Data hours:', dataHours.join(', '));
    console.log('[NIGHTTIME] Final periods:', periods.length, '- Sunrise ~' + sunriseHourRounded + ':00 UTC, Sunset ~' + sunsetHourRounded + ':00 UTC');
    console.log('[NIGHTTIME] Period details:', JSON.stringify(periods.map(p => ({
      start: new Date(p.start).getUTCHours() + ':00',
      end: new Date(p.end).getUTCHours() + ':00'
    }))));
    return periods;
  }, [showDateTimeAxis, coordinates, finalDisplayData, fileName]);

  // Calculate Y-axis domain based on visible parameters in finalDisplayData (for single axis mode)
  const yAxisDomain = useMemo(() => {
    if (finalDisplayData.length === 0 || visibleParameters.length === 0) {
      return [0, 100]; // Default domain
    }

    // Check if any visible parameters have custom Y-axis ranges
    const customRanges = visibleParameters
      .map(param => parameterStates[param]?.yAxisRange)
      .filter(range => range?.min !== undefined && range?.max !== undefined);

    // console.log('[Y-AXIS DEBUG] yAxisDomain calculation:', {
    //   visibleParameters,
    //   customRanges,
    //   parameterStates: Object.keys(parameterStates).reduce((acc, key) => {
    //     if (visibleParameters.includes(key)) {
    //       acc[key] = parameterStates[key]?.yAxisRange;
    //     }
    //     return acc;
    //   }, {} as Record<string, any>)
    // });

    // If all visible parameters have custom ranges, use them
    if (customRanges.length === visibleParameters.length && customRanges.length > 0) {
      const min = Math.min(...customRanges.map(r => r!.min!));
      const max = Math.max(...customRanges.map(r => r!.max!));
      // console.log('[Y-AXIS DEBUG] Using all custom ranges:', { min, max });
      return [min, max];
    }

    // Otherwise, calculate from data (may include parameters with custom ranges mixed with auto-scaled ones)
    let min = Infinity;
    let max = -Infinity;

    visibleParameters.forEach(param => {
      const customRange = parameterStates[param]?.yAxisRange;

      // If this parameter has a custom range, include it in the calculation
      if (customRange?.min !== undefined && customRange?.max !== undefined) {
        // console.log('[Y-AXIS DEBUG] Using custom range for param:', param, customRange);
        min = Math.min(min, customRange.min);
        max = Math.max(max, customRange.max);
      } else {
        // Otherwise, calculate from data
        finalDisplayData.forEach(point => {
          const value = point[param];
          if (typeof value === 'number' && !isNaN(value)) {
            min = Math.min(min, value);
            max = Math.max(max, value);
          }
        });
      }
    });

    // Use nice round numbers for 24hr_style, std_style, and stddiff_style, otherwise add 5% padding
    if (appliedStyleRule?.styleName === '24hr_style' || appliedStyleRule?.styleName === 'std_style' || appliedStyleRule?.styleName === 'stddiff_style') {
      const { domain } = calculateNiceYAxisDomain(min, max);
      // console.log('[Y-AXIS DEBUG] Using nice domain (styled):', domain);
      return domain;
    } else {
      const padding = (max - min) * 0.05;
      const finalDomain = [min - padding, max + padding];
      // console.log('[Y-AXIS DEBUG] Using padded domain:', finalDomain);
      return finalDomain;
    }
  }, [finalDisplayData, visibleParameters, appliedStyleRule, parameterStates]);

  // Calculate tick interval for 24hr_style, std_style, and stddiff_style
  const yAxisTickInterval = useMemo(() => {
    if ((appliedStyleRule?.styleName === '24hr_style' || appliedStyleRule?.styleName === 'std_style' || appliedStyleRule?.styleName === 'stddiff_style') && finalDisplayData.length > 0 && visibleParameters.length > 0) {
      let min = Infinity;
      let max = -Infinity;

      visibleParameters.forEach(param => {
        const customRange = parameterStates[param]?.yAxisRange;

        // If this parameter has a custom range, include it in the calculation
        if (customRange?.min !== undefined && customRange?.max !== undefined) {
          min = Math.min(min, customRange.min);
          max = Math.max(max, customRange.max);
        } else {
          // Otherwise, calculate from data
          finalDisplayData.forEach(point => {
            const value = point[param];
            if (typeof value === 'number' && !isNaN(value)) {
              min = Math.min(min, value);
              max = Math.max(max, value);
            }
          });
        }
      });

      const { tickInterval } = calculateNiceYAxisDomain(min, max);
      return tickInterval;
    }
    return undefined;
  }, [finalDisplayData, visibleParameters, appliedStyleRule, parameterStates]);

  // Calculate data range and max for Y-axis formatting
  const dataRange = useMemo(() => {
    if (yAxisDomain[1] - yAxisDomain[0] === 0) return 1;
    return Math.abs(yAxisDomain[1] - yAxisDomain[0]);
  }, [yAxisDomain]);

  const dataMax = useMemo(() => {
    return Math.max(Math.abs(yAxisDomain[0]), Math.abs(yAxisDomain[1]));
  }, [yAxisDomain]);

  // Calculate the maximum number of digits in y-axis tick labels (for single axis)
  const maxTickDigits = useMemo(() => {
    const maxValue = Math.max(Math.abs(yAxisDomain[0]), Math.abs(yAxisDomain[1]));
    const formatted = formatYAxisTick(maxValue, dataRange, dataMax);
    return formatted.length;
  }, [yAxisDomain, dataRange, dataMax]);

  // Calculate label offset based on tick label width (for single axis)
  const getLabelOffset = (digitCount: number) => {
    if (digitCount <= 2) return 15;
    if (digitCount === 3) return 20;
    return 25; // 4+ digits
  };

  // Calculate offset for multi-axis based on parameter domain
  // More positive = title closer to axis scale
  const getMultiAxisLabelOffset = (domain: [number, number], dataRange: number, dataMax: number) => {
    const maxValue = Math.max(Math.abs(domain[0]), Math.abs(domain[1]));
    const formatted = formatYAxisTick(maxValue, dataRange, dataMax);
    const digitCount = formatted.length;

    if (digitCount <= 2) return 10;
    if (digitCount === 3) return 12;
    return 15; // 4+ digits
  };

  // Calculate individual Y-axis domains for each parameter (for multi-axis mode)
  const parameterDomains = useMemo(() => {
    const domains: Record<string, [number, number]> = {};

    if (finalDisplayData.length === 0) {
      return domains;
    }

    visibleParameters.forEach(param => {
      const paramState = parameterStates[param];

      // Use custom y-axis range if enabled
      if (paramState?.yAxisRange?.min !== undefined && paramState?.yAxisRange?.max !== undefined) {
        domains[param] = [paramState.yAxisRange.min, paramState.yAxisRange.max];
        return;
      }

      // Otherwise calculate from data
      let min = Infinity;
      let max = -Infinity;

      finalDisplayData.forEach(point => {
        const value = point[param];
        if (typeof value === 'number' && !isNaN(value)) {
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      });

      // Add 5% padding to top and bottom
      const padding = (max - min) * 0.05;
      domains[param] = [min - padding, max + padding];
    });

    return domains;
  }, [finalDisplayData, visibleParameters, parameterStates]);

  // Set initial brush end index
  React.useEffect(() => {
    if (data.length > 0 && brushEndIndex === undefined) {
      setBrushEndIndex(data.length - 1);
    }
  }, [data.length, brushEndIndex]);

  const handleBrushChange = (brushData: { startIndex?: number; endIndex?: number }) => {
    if (timeAxisMode === 'common' && onBrushChange) {
      // In common mode, propagate to parent
      onBrushChange(brushData);
    } else {
      // In separate mode, update local state
      setBrushStartIndex(brushData.startIndex ?? 0);
      setBrushEndIndex(brushData.endIndex);
    }
  };

  const handleHeatmapRefresh = useCallback(() => {
    setIsRefreshing(true);

    try {
      console.log('[Heatmap Refresh] Starting validation checks...');

      // Get visible species for validation
      const visibleSpecies = speciesColumns.filter(species => parameterStates[species]?.visible);

      // 1. Validation Checks (log warnings/errors)
      const validationResults = {
        totalSeries: visibleSpecies.length,
        ranksDetected: new Set<string>(),
        orphanedTaxa: [] as string[],
        duplicates: [] as string[],
        missingData: [] as string[]
      };

      // Check for taxonomic rank detection
      visibleSpecies.forEach(series => {
        const match = series.match(/\((phyl|gigaclass|infraclass|class|ord|fam|gen|sp)\.\)/);
        if (match) {
          validationResults.ranksDetected.add(match[1]);
        }
      });

      // Check for duplicates
      const nameMap = new Map<string, number>();
      visibleSpecies.forEach(name => {
        nameMap.set(name, (nameMap.get(name) || 0) + 1);
      });
      nameMap.forEach((count, name) => {
        if (count > 1) validationResults.duplicates.push(name);
      });

      console.log('[Heatmap Refresh] Validation results:', {
        totalSeries: validationResults.totalSeries,
        ranksDetected: Array.from(validationResults.ranksDetected),
        duplicatesCount: validationResults.duplicates.length,
        duplicates: validationResults.duplicates
      });

      // Show validation warnings if needed
      if (validationResults.duplicates.length > 0) {
        console.warn('[Heatmap Refresh] Found duplicate taxa:', validationResults.duplicates);
      }

      // 2. Force recalculation by incrementing key
      // This causes React to unmount/remount HeatmapDisplay with fresh memoization
      setRefreshKey(prev => prev + 1);

      // 3. Reset brush to full range to show all data
      if (timeAxisMode === 'separate') {
        setBrushStartIndex(0);
        setBrushEndIndex(data.length - 1);
      }

      console.log('[Heatmap Refresh] Heatmap structure refreshed successfully');

      // Show success toast
      toast({
        title: 'Heatmap Refreshed',
        description: `Processed ${validationResults.totalSeries} taxa with ${validationResults.ranksDetected.size} taxonomic rank${validationResults.ranksDetected.size !== 1 ? 's' : ''}`,
      });

    } catch (error) {
      console.error('[Heatmap Refresh] Error during refresh:', error);
      toast({
        variant: 'destructive',
        title: 'Refresh Failed',
        description: 'Failed to refresh heatmap structure. Check console for details.',
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [speciesColumns, parameterStates, data, toast, timeAxisMode]);

  const handleStyleRuleToggle = (suffix: string, enabled: boolean) => {
    setStyleRules(prev => {
      const updated = prev.map(rule =>
        rule.suffix === suffix ? { ...rule, enabled } : rule
      );

      // Save to localStorage with version
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('pinChartStyleRules', JSON.stringify(updated));
          localStorage.setItem('pinChartStyleRulesVersion', String(STYLE_RULES_VERSION));
          console.log('✅ Style rules saved to localStorage');
        } catch (error) {
          console.error('❌ Failed to save style rules to localStorage:', error);
        }
      }

      return updated;
    });
  };

  const handleStyleRuleUpdate = (suffix: string, properties: Partial<import('./StylingRulesDialog').StyleProperties>) => {
    setStyleRules(prev => {
      const updated = prev.map(rule => {
        if (rule.suffix !== suffix) return rule;

        // Deep merge spotSample and secondaryYAxis properties if they exist
        const updatedProperties = { ...rule.properties };

        if (properties.spotSample && rule.properties.spotSample) {
          updatedProperties.spotSample = {
            ...rule.properties.spotSample,
            ...properties.spotSample
          };
        } else if (properties.spotSample) {
          updatedProperties.spotSample = properties.spotSample;
        }

        if (properties.secondaryYAxis && rule.properties.secondaryYAxis) {
          updatedProperties.secondaryYAxis = {
            ...rule.properties.secondaryYAxis,
            ...properties.secondaryYAxis
          };
        } else if (properties.secondaryYAxis) {
          updatedProperties.secondaryYAxis = properties.secondaryYAxis;
        }

        // Merge other top-level properties
        Object.keys(properties).forEach(key => {
          if (key !== 'spotSample' && key !== 'secondaryYAxis') {
            updatedProperties[key as keyof import('./StylingRulesDialog').StyleProperties] = properties[key as keyof import('./StylingRulesDialog').StyleProperties] as any;
          }
        });

        return { ...rule, properties: updatedProperties };
      });

      // Save to localStorage asynchronously (use queueMicrotask to avoid blocking the main thread)
      if (typeof window !== 'undefined') {
        queueMicrotask(() => {
          try {
            localStorage.setItem('pinChartStyleRules', JSON.stringify(updated));
            localStorage.setItem('pinChartStyleRulesVersion', String(STYLE_RULES_VERSION));
          } catch (error) {
            console.error('Failed to save style rules:', error);
          }
        });
      }

      return updated;
    });
  };

  const toggleParameterVisibility = (parameter: string) => {
    console.log('[TOGGLE VISIBILITY] Called for parameter:', parameter);
    console.log('[TOGGLE VISIBILITY] Current state:', parameterStates[parameter]);

    setParameterStates(prev => {
      const newValue = !prev[parameter]?.visible;
      console.log('[TOGGLE VISIBILITY] Setting visible to:', newValue);
      console.log('[TOGGLE VISIBILITY] All parameters before update:', Object.keys(prev).map(k => ({ name: k, visible: prev[k]?.visible })));

      const updated = {
        ...prev,
        [parameter]: {
          ...prev[parameter],
          visible: newValue
        }
      };

      console.log('[TOGGLE VISIBILITY] All parameters after update:', Object.keys(updated).map(k => ({ name: k, visible: updated[k]?.visible })));
      return updated;
    });
  };

  const toggleSolo = (parameter: string) => {
    console.log('[TOGGLE SOLO] Called for parameter:', parameter);

    setParameterStates(prev => {
      const newState = { ...prev };
      const currentlySolo = newState[parameter]?.isSolo || false;

      console.log('[TOGGLE SOLO] Currently solo?:', currentlySolo);
      console.log('[TOGGLE SOLO] Before update - All parameters:', Object.keys(newState).map(k => ({
        name: k,
        visible: newState[k]?.visible,
        isSolo: newState[k]?.isSolo
      })));

      // If this parameter is currently solo, turn off solo and show all
      // If not solo, make this one solo and hide others
      Object.keys(newState).forEach(key => {
        if (key === parameter) {
          newState[key] = {
            ...newState[key],
            visible: true,
            isSolo: !currentlySolo
          };
        } else {
          newState[key] = {
            ...newState[key],
            visible: currentlySolo ? true : false, // If turning off solo, show others; if turning on, hide them
            isSolo: false
          };
        }
      });

      console.log('[TOGGLE SOLO] After update - All parameters:', Object.keys(newState).map(k => ({
        name: k,
        visible: newState[k]?.visible,
        isSolo: newState[k]?.isSolo
      })));

      return newState;
    });
  };

  const showOnlyParameter = (parameter: string) => {
    console.log('[SHOW ONLY] Called for parameter:', parameter);

    setParameterStates(prev => {
      const newState = { ...prev };

      console.log('[SHOW ONLY] Before update - All parameters:', Object.keys(newState).map(k => ({
        name: k,
        visible: newState[k]?.visible
      })));

      // Hide all parameters except the clicked one
      Object.keys(newState).forEach(key => {
        newState[key] = {
          ...newState[key],
          visible: key === parameter
        };
      });

      console.log('[SHOW ONLY] After update - All parameters:', Object.keys(newState).map(k => ({
        name: k,
        visible: newState[k]?.visible
      })));

      return newState;
    });
  };

  const updateParameterColor = (parameter: string, hexColor: string) => {
    setParameterStates(prev => ({
      ...prev,
      [parameter]: {
        ...prev[parameter],
        color: hexColor // Store hex directly instead of CSS var
      }
    }));
  };

  const updateParameterOpacity = (parameter: string, opacity: number) => {
    setParameterStates(prev => ({
      ...prev,
      [parameter]: {
        ...prev[parameter],
        opacity: Math.max(0, Math.min(1, opacity)) // Clamp between 0 and 1
      }
    }));
  };

  const updateParameterLineStyle = (parameter: string, lineStyle: 'solid' | 'dashed') => {
    setParameterStates(prev => ({
      ...prev,
      [parameter]: {
        ...prev[parameter],
        lineStyle
      }
    }));
  };

  const updateParameterLineWidth = (parameter: string, lineWidth: number) => {
    setParameterStates(prev => ({
      ...prev,
      [parameter]: {
        ...prev[parameter],
        lineWidth: Math.max(0.5, Math.min(4, lineWidth)) // Clamp between 0.5 and 4
      }
    }));
  };

  const updateTimeFilter = (parameter: string, enabled: boolean, excludeStart?: string, excludeEnd?: string) => {
    setParameterStates(prev => ({
      ...prev,
      [parameter]: {
        ...prev[parameter],
        timeFilter: {
          enabled,
          excludeStart: excludeStart || '05:00',
          excludeEnd: excludeEnd || '20:00'
        }
      }
    }));
  };

  const updateYAxisRange = (parameter: string, min?: number, max?: number) => {
    console.log('[Y-AXIS DEBUG] updateYAxisRange called:', { parameter, min, max });
    setParameterStates(prev => {
      const updated = {
        ...prev,
        [parameter]: {
          ...prev[parameter],
          yAxisRange: (min !== undefined || max !== undefined) ? { min, max } : undefined
        }
      };
      console.log('[Y-AXIS DEBUG] Updated parameterStates:', updated[parameter]);
      return updated;
    });
  };

  const updateMovingAverage = (parameter: string, enabled: boolean, windowDays?: number, showLine?: boolean) => {
    console.log('[MA DEBUG] updateMovingAverage called:', { parameter, enabled, windowDays, showLine });

    setParameterStates(prev => {
      const updated = { ...prev };
      const maKey = `${parameter}_ma`;

      // Update base parameter's MA settings
      updated[parameter] = {
        ...prev[parameter],
        movingAverage: {
          enabled,
          windowDays: windowDays || 7,
          showLine: showLine !== undefined ? showLine : true
        }
      };

      // Immediately create/update/remove MA parameter state
      if (enabled && (showLine !== false)) {
        // Create or update MA parameter state
        if (!updated[maKey]) {
          // Check if there are saved settings for this MA parameter
          const savedMASettings = initialParameterSettings?.[maKey] || {};

          console.log('[MA DEBUG] Creating MA parameter state in updateMovingAverage:', {
            maKey,
            savedSettings: savedMASettings
          });

          updated[maKey] = {
            visible: true,
            color: lightenColor(prev[parameter].color, 0.3),
            opacity: savedMASettings.opacity ?? 0.8,
            lineStyle: savedMASettings.lineStyle ?? 'dashed',
            lineWidth: savedMASettings.lineWidth
          };
        } else {
          updated[maKey] = {
            ...updated[maKey],
            visible: true
          };
        }
      } else {
        // Remove MA parameter state
        if (updated[maKey]) {
          console.log('[MA DEBUG] Removing MA parameter state in updateMovingAverage:', maKey);
          delete updated[maKey];
        }
      }

      console.log('[MA DEBUG] Updated parameterStates:', updated);
      return updated;
    });

    // CRITICAL: Force data recalculation by incrementing a counter
    setMaUpdateCounter(prev => prev + 1);
  };

  // Helper to get color value for rendering (supports both CSS vars and hex, with opacity)
  const getColorValue = (colorString: string, opacity: number = 1.0): string => {
    // Convert hex to rgba with opacity
    if (colorString.startsWith('#')) {
      const hex = colorString.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }

    // For CSS variables, we need to convert HSL to rgba
    const hslValue = getComputedStyle(document.documentElement)
      .getPropertyValue(colorString.replace('--', ''))
      .trim();

    if (!hslValue) return `rgba(59, 130, 246, ${opacity})`; // fallback blue with opacity

    // Parse HSL string like "220 100% 50%" and convert to RGB
    const matches = hslValue.match(/(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
    if (!matches) return `rgba(59, 130, 246, ${opacity})`;

    const h = parseFloat(matches[1]) / 360;
    const s = parseFloat(matches[2]) / 100;
    const l = parseFloat(matches[3]) / 100;

    // HSL to RGB conversion
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
    const g = Math.round(hue2rgb(p, q, h) * 255);
    const b = Math.round(hue2rgb(p, q, h - 1/3) * 255);

    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  // Generate preview timestamps showing what they'll look like with swapped format
  const generatePreviewTimestamps = (format: 'DD/MM/YYYY' | 'MM/DD/YYYY') => {
    // Take first 5 rows as examples
    return data.slice(0, 5).map(row => {
      const currentTime = row.time;
      if (!currentTime) return { current: 'N/A', preview: 'N/A' };

      // Parse current timestamp and extract date parts
      // Format: "2025-02-05T06:05:50Z" -> need to show what it would be with swapped month/day
      const match = currentTime.match(/^(\d{4})-(\d{2})-(\d{2})T(.+)$/);
      if (!match) return { current: currentTime, preview: 'N/A' };

      const [, year, month, day, timePart] = match;

      // Show what the NEW timestamp will be if we swap month and day
      // Current format shows YYYY-MM-DD, but this came from either DD/MM or MM/DD in the file
      // If we're switching TO DD/MM/YYYY, it means the file currently has MM/DD/YYYY
      // So we need to reinterpret month as day and day as month
      const newTimestamp = format === 'DD/MM/YYYY'
        ? `${year}-${day}-${month}T${timePart}` // Swap: month becomes day, day becomes month
        : `${year}-${month}-${day}T${timePart}`; // Keep as is

      return {
        current: currentTime,
        preview: newTimestamp,
        changed: currentTime !== newTimestamp
      };
    });
  };

  const handleDateFormatClick = (format: 'DD/MM/YYYY' | 'MM/DD/YYYY') => {
    console.log('[DATE FORMAT] Button clicked:', format);
    console.log('[DATE FORMAT] Current format:', currentDateFormat);
    console.log('[DATE FORMAT] onDateFormatChange available:', !!onDateFormatChange);

    if (format === currentDateFormat) {
      console.log('[DATE FORMAT] Already using this format, ignoring');
      return; // Already using this format
    }

    console.log('[DATE FORMAT] Opening dialog with pending format:', format);
    setPendingDateFormat(format);
    setShowDateFormatDialog(true);
  };

  const handleConfirmDateFormat = () => {
    console.log('[DATE FORMAT] Confirm clicked, pending format:', pendingDateFormat);
    if (pendingDateFormat && onDateFormatChange) {
      console.log('[DATE FORMAT] Calling onDateFormatChange with:', pendingDateFormat);
      onDateFormatChange(pendingDateFormat);
    }
    setShowDateFormatDialog(false);
    setPendingDateFormat(null);
  };

  const handleSaveAsCsv = () => {
    console.log('[SAVE CSV] Exporting data with corrected timestamps');

    if (data.length === 0) {
      console.log('[SAVE CSV] No data to export');
      return;
    }

    // Get all parameter keys from the first data point
    const firstDataPoint = data[0];
    const parameterKeys = Object.keys(firstDataPoint).filter(key => key !== 'time');

    // Build CSV header
    const header = ['Time', ...parameterKeys].join(',');

    // Build CSV rows
    const rows = data.map(point => {
      const timeStr = point.time;
      const values = parameterKeys.map(key => point[key] ?? '');
      return [timeStr, ...values].join(',');
    });

    // Combine header and rows
    const csvContent = [header, ...rows].join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `corrected_data_${currentDateFormat?.replace(/\//g, '')}_${timestamp}.csv`;

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log('[SAVE CSV] CSV file downloaded:', filename);
  };

  const handleSaveToDatabase = async () => {
    console.log('[SAVE DB] Saving corrected data to database');

    if (data.length === 0) {
      console.log('[SAVE DB] No data to save');
      return;
    }

    if (!pinId) {
      console.log('[SAVE DB] No pin ID provided');
      alert('Cannot save to database: No pin ID available');
      return;
    }

    try {
      // Get all parameter keys from the first data point
      const firstDataPoint = data[0];
      const parameterKeys = Object.keys(firstDataPoint).filter(key => key !== 'time');

      // Build CSV header
      const header = ['Time', ...parameterKeys].join(',');

      // Build CSV rows
      const rows = data.map(point => {
        const timeStr = point.time;
        const values = parameterKeys.map(key => point[key] ?? '');
        return [timeStr, ...values].join(',');
      });

      // Combine header and rows
      const csvContent = [header, ...rows].join('\n');

      // Create a File object from the CSV content
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const originalFileName = rawFiles && rawFiles.length > 0 ? rawFiles[0].name : 'data.csv';
      const baseName = originalFileName.replace(/\.csv$/i, '');
      const newFileName = `${baseName}_corrected_${currentDateFormat?.replace(/\//g, '')}_${timestamp}.csv`;

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const file = new File([blob], newFileName, { type: 'text/csv' });

      console.log('[SAVE DB] Uploading file:', newFileName, 'Size:', file.size, 'bytes');

      // Upload to Supabase
      const result = await fileStorageService.uploadPinFile(pinId, file);

      if (result) {
        console.log('[SAVE DB] File saved successfully:', result);
        alert(`File saved to database successfully!\n\nFile: ${newFileName}\nSize: ${(file.size / 1024).toFixed(2)} KB`);
      } else {
        console.error('[SAVE DB] Failed to save file');
        alert('Failed to save file to database. Please check the console for details.');
      }
    } catch (error) {
      console.error('[SAVE DB] Error saving to database:', error);
      alert('Error saving file to database. Please check the console for details.');
    }
  };

  const handleSavePreviewAsCsv = async () => {
    console.log('[SAVE CSV] Starting with SWAP approach');
    console.log('[SAVE CSV] Pending format:', pendingDateFormat);

    if (!pendingDateFormat || data.length === 0) {
      alert('No data to export');
      return;
    }

    try {
      // Import swap function
      const { swapDatesInData } = await import('./swapDates');
      
      // Show before
      console.log('[SWAP VALIDATION] BEFORE (first 5):');
      data.slice(0, 5).forEach((point, i) => {
        console.log(`  [${i}] ${point.time}`);
      });
      
      // Swap dates
      const swappedData = swapDatesInData(data);
      
      // Show after
      console.log('[SWAP VALIDATION] AFTER (first 5):');
      swappedData.slice(0, 5).forEach((point, i) => {
        console.log(`  [${i}] ${point.time}`);
      });
      
      // Validate swap worked
      let changedCount = 0;
      for (let i = 0; i < Math.min(5, data.length); i++) {
        if (data[i].time !== swappedData[i].time) {
          changedCount++;
        }
      }
      
      if (changedCount === 0) {
        console.error('[SWAP] ERROR: No dates changed!');
        alert('ERROR: Date swap failed - no timestamps changed.');
        return;
      }
      
      console.log(`[SWAP] SUCCESS: ${changedCount} dates swapped`);
      
      // Build CSV
      const firstDataPoint = swappedData[0];
      const parameterKeys = Object.keys(firstDataPoint).filter(key => key !== 'time');
      const header = ['Time', ...parameterKeys].join(',');
      const rows = swappedData.map(point => {
        const timeStr = point.time;
        const values = parameterKeys.map(key => point[key] ?? '');
        return [timeStr, ...values].join(',');
      });
      const csvContent = [header, ...rows].join('\n');
      
      // Download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `swapped_dates_${timestamp}.csv`;
      
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      console.log('[SAVE CSV] Downloaded:', filename);
      alert(`SUCCESS!\n\nFile: ${filename}\n\nSwapped ${changedCount} timestamps\n\nBefore: ${data[0].time}\nAfter: ${swappedData[0].time}`);
    } catch (error) {
      console.error('[SAVE CSV] Error:', error);
      alert('Failed to export. Check console.');
    }
  };

  const handleSavePreviewToDatabase = async () => {
    console.log('[SAVE PREVIEW DB] Saving preview data to database');

    if (!pendingDateFormat || !rawFiles || rawFiles.length === 0) {
      console.log('[SAVE PREVIEW DB] Missing required data');
      return;
    }

    if (!pinId) {
      console.log('[SAVE PREVIEW DB] No pin ID provided');
      alert('Cannot save to database: No pin ID available');
      return;
    }

    try {
      // Re-parse the file with the pending format to get corrected data
      const { parseMultipleCSVFiles } = await import('./csvParser');
      const result = await parseMultipleCSVFiles(rawFiles, fileType, pendingDateFormat);

      if (result.data.length === 0) {
        alert('No data to save');
        return;
      }

      // Get all parameter keys from the first data point
      const firstDataPoint = result.data[0];
      const parameterKeys = Object.keys(firstDataPoint).filter(key => key !== 'time');

      // Build CSV header
      const header = ['Time', ...parameterKeys].join(',');

      // Build CSV rows
      const rows = result.data.map(point => {
        const timeStr = point.time;
        const values = parameterKeys.map(key => point[key] ?? '');
        return [timeStr, ...values].join(',');
      });

      // Combine header and rows
      const csvContent = [header, ...rows].join('\n');

      // Create a File object from the CSV content
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const originalFileName = rawFiles[0].name;
      const baseName = originalFileName.replace(/\.csv$/i, '');
      const newFileName = `${baseName}_corrected_${pendingDateFormat.replace(/\//g, '')}_${timestamp}.csv`;

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const file = new File([blob], newFileName, { type: 'text/csv' });

      console.log('[SAVE PREVIEW DB] Uploading file:', newFileName, 'Size:', file.size, 'bytes');

      // Upload to Supabase
      const result2 = await fileStorageService.uploadPinFile(pinId, file);

      if (result2) {
        console.log('[SAVE PREVIEW DB] File saved successfully:', result2);
        alert(`File saved to database successfully!\n\nFile: ${newFileName}\nSize: ${(file.size / 1024).toFixed(2)} KB`);
      } else {
        console.error('[SAVE PREVIEW DB] Failed to save file');
        alert('Failed to save file to database. Please check the console for details.');
      }
    } catch (error) {
      console.error('[SAVE PREVIEW DB] Error saving to database:', error);
      alert('Error saving file to database. Please check the console for details.');
    }
  };

  const handleCancelDateFormat = () => {
    console.log('[DATE FORMAT] Cancel clicked');
    setShowDateFormatDialog(false);
    setPendingDateFormat(null);
  };

  const handleViewRawCSV = async () => {
    if (!rawFiles || rawFiles.length === 0) {
      console.log('[RAW CSV] No raw files available');
      return;
    }

    try {
      const file = rawFiles[0]; // Take first file
      const text = await file.text();
      setRawCSVContent(text);
      setShowRawCSV(true);
      console.log('[RAW CSV] Loaded raw CSV, length:', text.length);
    } catch (error) {
      console.error('[RAW CSV] Error reading file:', error);
    }
  };

  const detectTimeFormat = (csvContent: string): string => {
    try {
      const lines = csvContent.split('\n').filter(line => line.trim().length > 0);
      if (lines.length < 2) return 'Unknown';

      // Get header and first data row
      const header = lines[0].toLowerCase();
      const firstDataRow = lines[1];

      // Find time column index
      const headers = header.split(',');
      const timeIndex = headers.findIndex(h => h.trim() === 'time');

      if (timeIndex === -1) return 'No Time column found';

      // Get first time value
      const values = firstDataRow.split(',');
      if (timeIndex >= values.length) return 'Unknown';

      const timeValue = values[timeIndex].trim();
      console.log('[FORMAT DETECT] Time value:', timeValue);

      // Detect format patterns
      // Pattern: DD/MM/YYYY HH:mm
      if (/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/.test(timeValue)) {
        return 'DD/MM/YYYY HH:mm';
      }

      // Pattern: MM/DD/YYYY HH:mm
      if (/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/.test(timeValue)) {
        return 'MM/DD/YYYY HH:mm';
      }

      // Pattern: YYYY-MM-DD HH:mm
      if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(timeValue)) {
        return 'YYYY-MM-DD HH:mm';
      }

      // Pattern: YYYY/MM/DD HH:mm
      if (/^\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}/.test(timeValue)) {
        return 'YYYY/MM/DD HH:mm';
      }

      // Pattern: ISO 8601 (YYYY-MM-DDTHH:mm:ss)
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(timeValue)) {
        return 'ISO 8601 (YYYY-MM-DDTHH:mm:ss)';
      }

      return `Unknown format (sample: ${timeValue})`;
    } catch (error) {
      console.error('[FORMAT DETECT] Error:', error);
      return 'Error detecting format';
    }
  };

  const handleDetectFormat = () => {
    if (!rawCSVContent) {
      console.log('[FORMAT DETECT] No CSV content available');
      return;
    }

    const format = detectTimeFormat(rawCSVContent);
    setDetectedFormat(format);
    setSelectedFormat(format);
    setShowFormatDetection(true);
    console.log('[FORMAT DETECT] Detected format:', format);
  };

  const convertTimeFormat = (timeValue: string, fromFormat: string, toFormat: string): string => {
    try {
      // Parse based on source format
      let date: Date | null = null;

      if (fromFormat.startsWith('DD/MM/YYYY')) {
        // DD/MM/YYYY HH:mm
        const match = timeValue.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
        if (match) {
          const [, day, month, year, hour, minute] = match;
          date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
        }
      } else if (fromFormat.startsWith('MM/DD/YYYY')) {
        // MM/DD/YYYY HH:mm
        const match = timeValue.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
        if (match) {
          const [, month, day, year, hour, minute] = match;
          date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
        }
      } else if (fromFormat.startsWith('YYYY-MM-DD')) {
        // YYYY-MM-DD HH:mm
        const match = timeValue.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
        if (match) {
          const [, year, month, day, hour, minute] = match;
          date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
        }
      } else if (fromFormat.startsWith('YYYY/MM/DD')) {
        // YYYY/MM/DD HH:mm
        const match = timeValue.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
        if (match) {
          const [, year, month, day, hour, minute] = match;
          date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
        }
      }

      if (!date || isNaN(date.getTime())) {
        return timeValue; // Return original if parsing failed
      }

      // Format to target format
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hour = String(date.getHours()).padStart(2, '0');
      const minute = String(date.getMinutes()).padStart(2, '0');

      if (toFormat.startsWith('DD/MM/YYYY')) {
        return `${day}/${month}/${year} ${hour}:${minute}`;
      } else if (toFormat.startsWith('MM/DD/YYYY')) {
        return `${month}/${day}/${year} ${hour}:${minute}`;
      } else if (toFormat.startsWith('YYYY-MM-DD')) {
        return `${year}-${month}-${day} ${hour}:${minute}`;
      } else if (toFormat.startsWith('YYYY/MM/DD')) {
        return `${year}/${month}/${day} ${hour}:${minute}`;
      }

      return timeValue; // Fallback
    } catch (error) {
      console.error('[FORMAT CONVERT] Error:', error);
      return timeValue;
    }
  };

  const modifyCSVTimeFormat = (csvContent: string, fromFormat: string, toFormat: string): string => {
    try {
      const lines = csvContent.split('\n');
      if (lines.length < 2) return csvContent;

      // Get header
      const header = lines[0];
      const headers = header.split(',');
      const timeIndex = headers.findIndex(h => h.trim().toLowerCase() === 'time');

      if (timeIndex === -1) {
        console.error('[CSV MODIFY] No Time column found');
        return csvContent;
      }

      // Process data rows
      const modifiedLines = [header]; // Keep header unchanged

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
          modifiedLines.push(line);
          continue;
        }

        const values = line.split(',');
        if (timeIndex < values.length) {
          const oldTime = values[timeIndex].trim();
          const newTime = convertTimeFormat(oldTime, fromFormat, toFormat);
          values[timeIndex] = newTime;
        }

        modifiedLines.push(values.join(','));
      }

      return modifiedLines.join('\n');
    } catch (error) {
      console.error('[CSV MODIFY] Error:', error);
      return csvContent;
    }
  };

  const handleConfirmFormatChange = () => {
    if (!rawCSVContent || !selectedFormat || selectedFormat === detectedFormat) {
      console.log('[FORMAT CHANGE] No change needed');
      setShowFormatDetection(false);
      return;
    }

    console.log('[FORMAT CHANGE] Converting from', detectedFormat, 'to', selectedFormat);
    const modified = modifyCSVTimeFormat(rawCSVContent, detectedFormat, selectedFormat);
    setModifiedCSVContent(modified);
    setShowFormatDetection(false);
    setShowModifiedCSV(true);
  };

  const handleDownloadModifiedCSV = () => {
    if (!modifiedCSVContent) {
      alert('No modified content to download');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const fileName = `MOD_converted_${timestamp}.csv`;

    const blob = new Blob([modifiedCSVContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log('[DOWNLOAD MODIFIED] Downloaded:', fileName);
  };

  const handleSaveModifiedCSV = async () => {
    console.log('[SAVE MODIFIED] Starting save...', {
      hasModifiedContent: !!modifiedCSVContent,
      hasPinId: !!pinId,
      hasRawFiles: !!rawFiles,
      rawFilesLength: rawFiles?.length,
      pinId
    });

    if (!modifiedCSVContent) {
      alert('Cannot save: No modified content available');
      return;
    }

    if (!pinId) {
      alert('Cannot save: No pin ID available. Please save from the pin file view.');
      return;
    }

    if (!rawFiles || rawFiles.length === 0) {
      alert('Cannot save: Original file information not available');
      return;
    }

    try {
      const originalFileName = rawFiles[0].name;
      const baseName = originalFileName.replace(/\.csv$/i, '');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const newFileName = `MOD_${baseName}_${timestamp}.csv`;

      const blob = new Blob([modifiedCSVContent], { type: 'text/csv;charset=utf-8;' });
      const file = new File([blob], newFileName, { type: 'text/csv' });

      console.log('[SAVE MODIFIED] Uploading file:', newFileName);

      const result = await fileStorageService.uploadPinFile(pinId, file);

      if (result) {
        alert(`Modified CSV saved successfully!\n\nFile: ${newFileName}`);
        setShowModifiedCSV(false);
        setShowRawCSV(false);
      } else {
        alert('Failed to save modified CSV');
      }
    } catch (error) {
      console.error('[SAVE MODIFIED] Error:', error);
      alert('Error saving modified CSV');
    }
  };

  // Get source label abbreviation
  const getSourceLabel = (): string => {
    if (dataSource === 'marine') return 'OM';
    if (fileType === 'Subcam') return 'SC';
    return fileType; // Returns 'GP' or 'FPOD'
  };

  // Format parameter label with source
  const formatParameterWithSource = (parameter: string, includeSource: boolean = true): string => {
    // Check if this is a moving average parameter
    if (parameter.endsWith('_ma')) {
      const baseParam = parameter.replace('_ma', '');
      const baseParamState = parameterStates[baseParam];
      const windowDays = baseParamState?.movingAverage?.windowDays || 1;
      const daysText = windowDays === 1 ? '1day' : `${windowDays}days`;
      return `Moving average (${daysText})`;
    }

    const baseLabel = getParameterLabelWithUnit(parameter);

    // Check if parameter already has a source label (e.g., "IR [GP]")
    const hasSourceLabel = /\[(?:GP|FPOD|SC|Subcam|OM)\]$/.test(baseLabel);

    if (!includeSource && hasSourceLabel) {
      // Remove source label if it exists and includeSource is false
      return baseLabel.replace(/\s*\[(?:GP|FPOD|SC|Subcam|OM)\]$/, '');
    }

    if (hasSourceLabel) {
      // Already has source label, return as-is
      return baseLabel;
    }

    // Add source label if includeSource is true
    if (includeSource) {
      const sourceLabel = getSourceLabel();
      return `${baseLabel} [${sourceLabel}]`;
    }

    return baseLabel;
  };

  // Format parameter name based on compact view settings
  const formatParameterName = (parameter: string): string => {
    // Check if there's a custom name set for this parameter
    if (customParameterNames[parameter]) {
      return customParameterNames[parameter];
    }

    let formatted = getParameterLabelWithUnit(parameter);

    // Hide parameter name (e.g., "Dolphin", "Porpoise clicks")
    // Parameter name is the part before any parentheses or brackets
    if (hideParameterName) {
      // Extract only the parts in parentheses and brackets
      const units = formatted.match(/\([^)]+\)/g) || [];
      const brackets = formatted.match(/\[[^\]]+\]/g) || [];
      formatted = [...units, ...brackets].join(' ').trim();
    }

    // Hide units in parentheses (e.g., "(DPM)", "(Clicks)", "(°C)")
    if (hideUnits) {
      formatted = formatted.replace(/\s*\([^)]+\)\s*/g, ' ').trim();
    }

    // Hide dates in brackets (e.g., "[2406_2407]", "[2408_2409]")
    // Dates match pattern: 4 digits, separator, 4 digits
    if (hideDates) {
      formatted = formatted.replace(/\s*\[\d{4}[_\-]\d{4}\]\s*/g, ' ').trim();
    }

    // Hide station identifiers in brackets (e.g., "[C_S]", "[F_L]")
    // Stations are brackets that DON'T match the date pattern
    if (hideStations) {
      formatted = formatted.replace(/\s*\[(?!\d{4}[_\-]\d{4}\])[^\]]+\]\s*/g, ' ').trim();
    }

    // Clean up any double spaces that may have been created
    formatted = formatted.replace(/\s+/g, ' ').trim();

    return formatted;
  };

  // Display name override for nmax chart view parameters (no-op, keep original names)
  const getLITUDisplayName = (_parameter: string): string | null => {
    return null;
  };

  const moveParameter = (parameter: string, direction: 'up' | 'down') => {
    // This would implement parameter reordering - simplified for now
    console.log(`Move ${parameter} ${direction}`);
  };

  // Allow haplotype files to bypass the "no data" check since they use a different data structure
  if (data.length === 0 && !haplotypeData) {
    return (
      <div className="flex items-center justify-center h-48 text-center">
        <div className="text-muted-foreground">
          <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-xs">No data to display</p>
        </div>
      </div>
    );
  }

  // Allow haplotype files to bypass the "no numeric parameters" check
  if (numericParameters.length === 0 && !haplotypeData) {
    return (
      <div className="flex items-center justify-center h-48 text-center">
        <div className="text-muted-foreground">
          <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-xs">No numeric parameters found</p>
          <p className="text-xs opacity-70">Check data format</p>
        </div>
      </div>
    );
  }

  // Detect discrete/spot-sample files (CROP, CHEM, WQ, EDNA, _Cred)
  const isDiscreteFile = useMemo(() => {
    if (!fileName) return false;
    return /(crop|chemsw|chemwq|edna|_cred)/i.test(fileName);
  }, [fileName]);

  // Check if this is a _Cred file (doesn't need Sample ID column)
  const isCredFile = useMemo(() => {
    if (!fileName) return false;
    return /_cred\.csv$/i.test(fileName);
  }, [fileName]);

  // If discrete file detected and we have the necessary data, use spot-sample component
  // _Cred files don't need detectedSampleIdColumn
  // Accept empty strings as valid sample ID columns (for files with unnamed columns)
  if (isDiscreteFile && headers && ((detectedSampleIdColumn !== null && detectedSampleIdColumn !== undefined) || isCredFile)) {
    return (
      <PinChartDisplaySpotSample
        data={data}
        timeColumn={timeColumn}
        detectedSampleIdColumn={detectedSampleIdColumn}
        headers={headers}
        fileName={fileName}
        diagnosticLogs={diagnosticLogs}
        pinLabel={pinLabel}
        startDate={startDate}
        endDate={endDate}
        fileCategories={fileCategories}
        projectId={projectId}
        tileName={tileName}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Toggle Switches - at the top */}
      <div className="flex items-stretch gap-3">
        {/* File header - location, time period, category, and filename */}
        <div className="flex flex-col gap-0.5 flex-1">
          {/* Main header: Location • Time Period (Categories) */}
          {/* For 24hr avg: Location [Category] within [date range] */}
          {(pinLabel || startDate || endDate || (fileCategories && fileCategories.length > 0)) && (
            <div className="text-xs font-semibold text-foreground flex items-center gap-2">
              {/* Location */}
              {pinLabel && <span>{pinLabel}</span>}

              {/* Time Period - shown with bullet for regular plots */}
              {!showDateTimeAxis && (startDate || endDate) && (
                <>
                  {pinLabel && <span className="text-muted-foreground">•</span>}
                  <span className="font-normal">
                    {startDate && endDate
                      ? `${format(startDate, 'MMM d, yyyy')} - ${format(endDate, 'MMM d, yyyy')}`
                      : startDate
                      ? `From ${format(startDate, 'MMM d, yyyy')}`
                      : endDate
                      ? `Until ${format(endDate, 'MMM d, yyyy')}`
                      : ''}
                  </span>
                </>
              )}

              {/* Categories - multiple badges */}
              {fileCategories && fileCategories.map((category, index) => (
                <span key={index} className="text-xs px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium">
                  {category}
                </span>
              ))}

              {/* Date range for 24hr avg plots - "within" between badge and dates */}
              {showDateTimeAxis && (startDate || endDate) && (
                <>
                  <span className="font-normal italic text-muted-foreground">within</span>
                  <span className="font-normal">
                    {startDate && endDate
                      ? `${formatDateUTC(startDate, 'MMM d, yyyy')} - ${formatDateUTC(endDate, 'MMM d, yyyy')}`
                      : startDate
                      ? formatDateUTC(startDate, 'MMM d, yyyy')
                      : endDate
                      ? formatDateUTC(endDate, 'MMM d, yyyy')
                      : ''}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Raw filename in smaller font */}
          {fileName && (
            <div className="text-xs text-muted-foreground font-mono">
              {fileName}
            </div>
          )}
        </div>

        {/* View Controls - always consistent layout */}
        <div className="flex items-center gap-3">
          {/* FPOD Unit Toggle - Clicks / DPM */}
          {fileType === 'FPOD' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">Unit:</span>
              <div className="flex items-center gap-1 border rounded-md p-1 bg-gray-50">
                <Button
                  variant={fpodUnitMode === 'DPM' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setFpodUnitMode('DPM')}
                  className="h-7 px-2 text-xs"
                >
                  DPM
                </Button>
                <Button
                  variant={fpodUnitMode === 'Clicks' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setFpodUnitMode('Clicks')}
                  className="h-7 px-2 text-xs"
                >
                  Clicks
                </Button>
              </div>
            </div>
          )}

          {/* Unified View Mode Selector - hide for haplotype files which have their own internal view mode */}
          {!isHaplotypeFile && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">View:</span>
              <div className="flex items-center gap-1 border rounded-md p-1 bg-gray-50">
                <Button
                  variant={viewMode === 'chart' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => handleViewModeChange('chart')}
                  className="h-7 px-2 text-xs"
                >
                  <BarChart3 className="h-3 w-3 mr-1" />
                  Chart
                </Button>
                <Button
                  variant={viewMode === 'table' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => handleViewModeChange('table')}
                  className="h-7 px-2 text-xs"
                >
                  <TableIcon className="h-3 w-3 mr-1" />
                  Table
                </Button>
                <Button
                  variant={viewMode === 'heatmap' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => handleViewModeChange('heatmap')}
                  className="h-7 px-2 text-xs"
                  disabled={!isSubcamNmaxFile}
                  title={!isSubcamNmaxFile ? 'Heatmap view only available for nmax files' : ''}
                >
                  <Grid3x3 className="h-3 w-3 mr-1" />
                  Heatmap
                </Button>
                <Button
                  variant={viewMode === 'tree' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => handleViewModeChange('tree')}
                  className="h-7 px-2 text-xs"
                  disabled={!isSubcamNmaxFile}
                  title={!isSubcamNmaxFile ? 'Tree view only available for nmax files' : ''}
                >
                  <Network className="h-3 w-3 mr-1" />
                  Tree
                </Button>
              </div>
            </div>
          )}

          {/* Refresh & Settings - always in same position, shown only for Chart and Heatmap views (not for haplotype files which have their own controls) */}
          {!isHaplotypeFile && (viewMode === 'chart' || viewMode === 'heatmap') && (
            <div className="flex items-center gap-0.5">
              {/* Refresh Button - shown only for Heatmap view on NMAX files */}
              {viewMode === 'heatmap' && isSubcamNmaxFile && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title="Refresh heatmap structure and recalculate hierarchy"
                  onClick={handleHeatmapRefresh}
                  disabled={isRefreshing}
                >
                  <RefreshCw
                    className={cn(
                      "h-3.5 w-3.5 text-muted-foreground",
                      isRefreshing && "animate-spin"
                    )}
                  />
                </Button>
              )}

              {/* Chart/Heatmap Settings */}
              {viewMode === 'heatmap' && isSubcamNmaxFile ? (
                <StylingRulesDialog
                  open={showStylingRules}
                  onOpenChange={setShowStylingRules}
                  styleRules={styleRules}
                  onStyleRuleToggle={handleStyleRuleToggle}
                  onStyleRuleUpdate={handleStyleRuleUpdate}
                  currentFileName={fileName}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    title="Heatmap settings"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowStylingRules(true);
                    }}
                  >
                    <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </StylingRulesDialog>
              ) : (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      title="Chart settings"
                      data-testid="chart-settings-button"
                    >
                      <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-3" align="end">
                    <div className="space-y-3">
                      {/* Chart Settings header and axis toggle - hidden for SubCam nmax */}
                      {!isSubcamNmaxFile && (
                        <>
                          <p className="text-xs font-semibold border-b pb-2">Chart Settings</p>

                          {/* Single/Multi Axis Toggle */}
                          <div className="flex items-center justify-between">
                            <Label htmlFor="axis-mode" className="text-xs cursor-pointer">
                              Single-Axis Mode
                            </Label>
                            <Switch
                              id="axis-mode"
                              checked={axisMode === 'single'}
                              onCheckedChange={(checked) => setAxisMode(checked ? 'single' : 'multi')}
                              className="shrink-0"
                            />
                          </div>
                          <p className="text-[0.65rem] text-muted-foreground">
                            Removes multiple axes for a cleaner look
                          </p>
                        </>
                      )}

                      {/* Show Sensor Parameters Toggle - only for GrowProbe files */}
                      {fileType === 'GP' && (
                        <>
                          <div className="flex items-center justify-between pt-2 border-t">
                            <Label htmlFor="show-sensors" className="text-xs cursor-pointer">
                              Show Sensor Data
                            </Label>
                            <Switch
                              id="show-sensors"
                              checked={showSensorParams}
                              onCheckedChange={setShowSensorParams}
                              className="shrink-0"
                            />
                          </div>
                          <p className="text-[0.65rem] text-muted-foreground">
                            Show accelerometer and magnetic field data
                          </p>
                        </>
                      )}

                      {/* X-Axis Settings Section - hidden for 24hr FPOD files */}
                      {!showDateTimeAxis && (
                        <>
                      <p className="text-xs font-semibold border-b pb-2 pt-2">X-Axis Settings</p>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="show-year" className="text-xs cursor-pointer">
                        Show year (/YY)
                      </Label>
                      <Switch
                        id="show-year"
                        checked={showYearInXAxis}
                        onCheckedChange={setShowYearInXAxis}
                        className="shrink-0"
                      />
                    </div>
                    <p className="text-[0.65rem] text-muted-foreground">
                      {showYearInXAxis ? 'Format: DD/MM/YY' : 'Format: DD/MM'}
                    </p>
                        </>
                      )}

                    {/* Days from start toggle - only show for nmax files */}
                    {isSubcamNmaxFile && (
                      <>
                        <div className="flex items-center justify-between pt-2 border-t">
                          <Label htmlFor="show-days" className="text-xs cursor-pointer">
                            Show days from start
                          </Label>
                          <Switch
                            id="show-days"
                            checked={showDaysFromStart}
                            onCheckedChange={setShowDaysFromStart}
                            className="shrink-0"
                          />
                        </div>
                        <p className="text-[0.65rem] text-muted-foreground">
                          {showDaysFromStart ? 'X-axis: Day 0, 1, 2...' : 'X-axis: Dates'}
                        </p>
                        {/* Max days input - only show when days from start is enabled */}
                        {showDaysFromStart && (
                          <div className="space-y-2">
                            <Label htmlFor="max-days" className="text-xs font-medium">
                              Max Days to Show
                            </Label>
                            <Input
                              id="max-days"
                              type="number"
                              min="1"
                              value={maxDaysToShow}
                              onChange={(e) => setMaxDaysToShow(e.target.value === '' ? '' : Number(e.target.value))}
                              placeholder="All days"
                              className="h-8 text-xs"
                            />
                            <p className="text-[0.65rem] text-muted-foreground">
                              Leave empty to show all days
                            </p>
                          </div>
                        )}
                      </>
                    )}

                    {/* Custom Y-Axis Label */}
                    <div className="pt-2 border-t space-y-2">
                      <Label htmlFor="custom-y-label" className="text-xs font-medium">
                        Custom Left Y-Axis Label
                      </Label>
                      <Input
                        id="custom-y-label"
                        value={customYAxisLabel}
                        onChange={(e) => setCustomYAxisLabel(e.target.value)}
                        placeholder="e.g., Difference (DPM)"
                        className="h-8 text-xs"
                      />
                      <p className="text-[0.65rem] text-muted-foreground">
                        Leave empty to use default label
                      </p>
                    </div>

                    {/* Heatmap Color Picker - only show for Subcam nmax files */}
                    {isSubcamNmaxFile && (
                      <div className="pt-2 border-t space-y-2">
                        <Label className="text-xs font-medium flex items-center gap-2">
                          <Palette className="h-3.5 w-3.5" />
                          Heatmap Color
                        </Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full h-8 justify-start gap-2"
                            >
                              <div
                                className="h-4 w-4 rounded border"
                                style={{ backgroundColor: heatmapColor }}
                              />
                              <span className="text-xs">{heatmapColor}</span>
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-3" side="left">
                            <HexColorPicker color={heatmapColor} onChange={setHeatmapColor} />
                          </PopoverContent>
                        </Popover>
                        <p className="text-[0.65rem] text-muted-foreground">
                          Primary color for heatmap visualization
                        </p>
                      </div>
                    )}

                    {/* Styling Rules Button */}
                    <div className="pt-2 border-t">
                      <StylingRulesDialog
                        open={showStylingRules}
                        onOpenChange={setShowStylingRules}
                        styleRules={styleRules}
                        onStyleRuleToggle={handleStyleRuleToggle}
                        onStyleRuleUpdate={handleStyleRuleUpdate}
                        currentFileName={fileName}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full h-8 text-xs justify-start gap-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowStylingRules(true);
                          }}
                        >
                          <Settings className="h-3.5 w-3.5" />
                          Plot Styling
                        </Button>
                      </StylingRulesDialog>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              )}

            </div>
          )}
        </div>

      </div>

      {/* Chart or Table View */}
      {showTable ? (
        // Table View
        <div className="space-y-2">
          {console.log('[TABLE VIEW] Rendering table view. onDateFormatChange:', !!onDateFormatChange, 'rawFiles:', !!rawFiles)}
          {/* Table controls - single row with date format and raw CSV button */}
          {(onDateFormatChange || (rawFiles && rawFiles.length > 0)) && (
            <div className="flex items-center justify-between gap-3 px-3 py-2 bg-muted/30 rounded-md border">
              {/* Left side: Date format controls */}
              {onDateFormatChange && (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Settings className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs font-medium">Date Format:</span>
                    {currentDateFormat ? (
                      <span className="text-xs px-2 py-0.5 bg-primary text-primary-foreground rounded font-semibold">
                        {currentDateFormat}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100 rounded font-semibold">
                        Auto-Detected
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Switch to:</span>
                    <Button
                      variant={currentDateFormat === 'DD/MM/YYYY' ? 'default' : 'outline'}
                      size="sm"
                      className="h-7 text-xs px-3"
                      onClick={() => handleDateFormatClick('DD/MM/YYYY')}
                      disabled={currentDateFormat === 'DD/MM/YYYY'}
                    >
                      DD/MM/YYYY
                    </Button>
                    <Button
                      variant={currentDateFormat === 'MM/DD/YYYY' ? 'default' : 'outline'}
                      size="sm"
                      className="h-7 text-xs px-3"
                      onClick={() => handleDateFormatClick('MM/DD/YYYY')}
                      disabled={currentDateFormat === 'MM/DD/YYYY'}
                    >
                      MM/DD/YYYY
                    </Button>
                  </div>
                </div>
              )}

              {/* Right side: Action buttons */}
              <div className="flex items-center gap-2">
                {rawFiles && rawFiles.length > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 text-xs px-4 font-semibold"
                    onClick={handleViewRawCSV}
                  >
                    <TableIcon className="h-4 w-4 mr-2" />
                    View Original CSV
                  </Button>
                )}
                {currentDateFormat && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs px-4 font-semibold"
                      onClick={handleSaveAsCsv}
                    >
                      Save as CSV
                    </Button>
                    {pinId && (
                      <Button
                        variant="default"
                        size="sm"
                        className="h-8 text-xs px-4 font-semibold"
                        onClick={handleSaveToDatabase}
                      >
                        <Database className="h-4 w-4 mr-2" />
                        Save to Database
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          <div className="h-96 overflow-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Time</TableHead>
                  {allParameters.map(param => (
                    <TableHead key={param} className="text-xs">{param}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.slice(0, 100).map((row, index) => (
                  <TableRow key={index}>
                    <TableCell className="text-xs font-mono">
                      {row.time || 'N/A'}
                    </TableCell>
                    {allParameters.map(param => (
                      <TableCell key={param} className="text-xs">
                        {row[param] !== null && row[param] !== undefined
                          ? (typeof row[param] === 'number'
                            ? Number(row[param]).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 3})
                            : String(row[param])
                          )
                          : 'N/A'
                        }
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.length > 100 && (
              <div className="p-2 text-xs text-center text-muted-foreground border-t">
                Showing first 100 of {data.length} rows
              </div>
            )}
          </div>
        </div>
      ) : nmaxViewMode === 'tree' && isSubcamNmaxFile ? (
        // Tree View for Subcam nmax files
        <div className="flex-1">
          {isFetchingNmaxTaxonomy ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-sm text-muted-foreground">Fetching taxonomy data...</p>
              </div>
            </div>
          ) : nmaxTaxonomicTree ? (
            <TaxonomicTreeView
              tree={nmaxTaxonomicTree}
              containerHeight={dynamicChartHeight}
              highlightedTaxon={highlightedTaxon}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">No taxonomy data available</p>
            </div>
          )}
        </div>
      ) : showHeatmap && isSubcamNmaxFile ? (
        // Heatmap View for Subcam nmax files
        <div className="flex overflow-hidden" style={{ gap: `${appliedStyleRule?.properties.plotToParametersGap ?? 12}px` }}>
          {/* Main Heatmap - Takes up most space */}
          <div className="flex-1 min-w-0">
            <HeatmapDisplay
              key={refreshKey}
              data={finalDisplayData}
              series={taxonomicallyOrderedSpecies.filter(species => parameterStates[species]?.visible)}
              speciesIndentMap={speciesIndentMap}
              speciesRankMap={speciesRankMap}
              filteredFlattenedTree={filteredFlattenedTree}
              parentChildRelationships={parentChildRelationships}
              containerHeight={dynamicChartHeight}
              brushStartIndex={activeBrushStart}
              brushEndIndex={activeBrushEnd}
              onBrushChange={timeAxisMode === 'separate' && !isSubcamNmaxFile ? handleBrushChange : undefined}
              timeFormat={showYearInXAxis ? 'full' : 'short'}
              customColor={heatmapColor}
              customMaxValue={appliedStyleRule?.properties.heatmapMaxValue}
              cellWidth={appliedStyleRule?.properties.heatmapCellWidth ?? 10}
              rowHeight={appliedStyleRule?.properties.heatmapRowHeight ?? 35}
              onShowInTree={(species) => {
                setHighlightedTaxon(species);
                handleViewModeChange('tree');
                setTimeout(() => setHighlightedTaxon(null), 4000);
              }}
            />
          </div>

          {/* Taxa Selection Panel - Right sidebar - Collapsible */}
          <div className={cn(
            "border rounded-md bg-card transition-all duration-300 ease-in-out shrink-0",
            isSpeciesPanelExpanded ? "w-64" : "w-12"
          )}>
            {isSpeciesPanelExpanded ? (
              <>
                <div className="p-3 border-b flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold">Taxa</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {taxonomicallyOrderedSpecies.filter(s => parameterStates[s]?.visible).length} of {taxonomicallyOrderedSpecies.length} visible
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => setIsSpeciesPanelExpanded(false)}
                    title="Collapse panel"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                <div className="p-2 max-h-[600px] overflow-y-auto space-y-1">
                  {taxonomicallyOrderedSpecies.map((species) => (
                    <div key={species} className="flex items-center gap-2 p-2 rounded hover:bg-accent/50 transition-colors">
                      <Checkbox
                        id={`species-${species}`}
                        checked={parameterStates[species]?.visible ?? false}
                        onCheckedChange={(checked) => {
                          setParameterStates(prev => ({
                            ...prev,
                            [species]: {
                              ...prev[species],
                              visible: checked as boolean
                            }
                          }));
                        }}
                      />
                      <Label
                        htmlFor={`species-${species}`}
                        className="text-xs cursor-pointer flex-1"
                      >
                        {species}
                      </Label>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center py-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setIsSpeciesPanelExpanded(true)}
                  title={`Show taxa selection (${taxonomicallyOrderedSpecies.filter(s => parameterStates[s]?.visible).length}/${taxonomicallyOrderedSpecies.length} visible)`}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="mt-2 -rotate-90 whitespace-nowrap text-xs text-muted-foreground font-medium origin-center">
                  Taxa
                </div>
              </div>
            )}
          </div>
        </div>
      ) : showHaplotypeHeatmap && isHaplotypeFile && haplotypeData ? (
        // Haplotype Heatmap View for EDNA hapl files
        <div className="flex-1">
          <HaplotypeHeatmap
            haplotypeData={haplotypeData}
            containerHeight={dynamicChartHeight}
            spotSampleStyles={appliedStyleRule?.properties.spotSample}
            onStyleRuleUpdate={handleStyleRuleUpdate}
            rawFileId={rawFileInfo?.id}
            rawFileName={rawFileInfo?.name}
            pinId={pinId}
            onOpenRawEditor={(fileId, fileName, speciesName) => {
              console.log('[OPEN RAW EDITOR] Called with:', { fileId, fileName, speciesName });
              setSelectedFileForRaw({ id: fileId, name: fileName, highlightSpecies: speciesName });
              setShowRawViewer(true);
              console.log('[OPEN RAW EDITOR] State updated, showRawViewer should be true');
            }}
            pinLabel={pinLabel}
            startDate={startDate}
            endDate={endDate}
            fileCategories={fileCategories}
          />
        </div>
      ) : (
        // Chart View (existing chart code)
        <div className="flex" style={{ gap: `${appliedStyleRule?.properties.plotToParametersGap ?? 12}px` }}>
          {/* Main Chart - Takes up most space */}
          <div className="flex-1 space-y-3">
      {/* Color Key - for nmax and FPOD chart view */}
      {(isSubcamNmaxFile || fileType === 'FPOD') && viewMode === 'chart' && visibleParameters.length > 0 && (
        <div className="flex items-center gap-4 px-3 py-2 bg-white border rounded-md flex-wrap">
          {visibleParameters.map(param => {
            const state = parameterStates[param];
            if (!state) return null;
            const colorValue = getColorValue(state.color, state.opacity ?? 1.0);
            // For FPOD, strip unit suffix like "(DPM)" or "(Clicks)" for cleaner display
            let displayName = getLITUDisplayName(param) || param;
            if (fileType === 'FPOD') {
              displayName = displayName.replace(/\s*\((DPM|Clicks)\)\s*$/, '');
            }
            return (
              <div key={param} className="flex items-center gap-1.5">
                <div className="w-4 h-1 rounded-full" style={{ backgroundColor: colorValue }} />
                <span className="text-xs text-gray-700">{displayName}</span>
              </div>
            );
          })}
        </div>
      )}
      {visibleParameters.length > 0 && (
        <div
          className={cn(
            "w-full p-2",
            // Use white background for FPOD with nighttime shading, otherwise use card background
            showDateTimeAxis ? "bg-white" : "bg-card",
            !compactView && "border rounded-md"
          )}
          style={{
            height: `${dynamicChartHeight + (
// Add extra height for single-axis info banner (not for nmax or FPOD)
              (!compactView && axisMode === 'single' && !isSubcamNmaxFile && fileType !== 'FPOD') ? 40 : 0
            )}px`
          }}
        >

{/* Single Axis Mode Info Banner - hidden for nmax and FPOD (FPOD shows hint in parent header) */}
          {axisMode === 'single' && !compactView && !isSubcamNmaxFile && fileType !== 'FPOD' && (
            <div className="bg-muted/50 border rounded px-3 py-1.5 mb-2 flex items-center gap-2">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Single-Axis Mode:</span> Mouse-over graph area for actual values
              </p>
            </div>
          )}
          {/* Single Axis Mode */}
          {axisMode === 'single' && (
<div style={{
              width: '100%',
              height: (visibleParameters.length > 1 && !compactView && !isSubcamNmaxFile && fileType !== 'FPOD') ? 'calc(100% - 40px)' : '100%',
              backgroundColor: showDateTimeAxis ? '#ffffff' : undefined
            }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={finalDisplayData}
                margin={{
                  top: 5,
                  right: 12,
                  left: 0,
                  bottom: appliedStyleRule?.properties.chartBottomMargin ?? 10
                }}
                style={{ backgroundColor: showDateTimeAxis ? '#ffffff' : undefined }}
              >
                <CartesianGrid
                  strokeDasharray="2 2"
                  stroke="hsl(var(--border))"
                  vertical={false}
                />

                {/* Nighttime shading for 24hr FPOD files */}
                {nighttimePeriods.map((period, index) => {
                  // Validate that period times exist in the data
                  const startExists = finalDisplayData.some(d => d.time === period.start);
                  const endExists = finalDisplayData.some(d => d.time === period.end);
                  if (!startExists || !endExists) {
                    console.warn('[NIGHTTIME] Skipping period - times not found in data:', { period, startExists, endExists });
                    return null;
                  }
                  return (
                    <ReferenceArea
                      key={`night-${index}`}
                      x1={period.start}
                      x2={period.end}
                      fill="#1e293b"
                      fillOpacity={0.15}
                      strokeOpacity={0}
                      ifOverflow="hidden"
                    />
                  );
                })}

                <XAxis
                  dataKey={showDaysFromStart ? "dayNumber" : "time"}
                  tick={{ fontSize: '0.65rem', fill: 'hsl(var(--muted-foreground))', angle: -45, textAnchor: 'end', dy: 8 }}
                  stroke="hsl(var(--border))"
                  tickFormatter={(value) =>
                    showDaysFromStart
                      ? `Day ${Math.round(value)}`
                      : showDateTimeAxis
                      ? formatDateTimeTick(value, coordinates, true)
                      : appliedStyleRule?.properties.xAxisRange
                      ? format24HourTick(value)
                      : formatDateTick(value, dataSource, showYearInXAxis)
                  }
                  height={appliedStyleRule?.properties.xAxisTitle
                    ? 45 + (appliedStyleRule.properties.xAxisTitlePosition || 20)
                    : showDateTimeAxis ? 60 : 45
                  }
                  label={appliedStyleRule?.properties.xAxisTitle ? {
                    value: appliedStyleRule.properties.xAxisTitle,
                    position: 'bottom',
                    offset: (appliedStyleRule.properties.xAxisTitleMargin ?? -5),
                    style: { textAnchor: 'middle', fontSize: `${appliedStyleRule.properties.xAxisTitleFontSize || 10}px`, fill: 'hsl(var(--muted-foreground))' }
                  } : undefined}
                />

                {/* Primary Y-Axis (Left) - shown with labels for FPOD, hidden for others in single-axis mode, fully hidden for nmax */}
                <YAxis
                  tick={fileType === 'FPOD' ? { fontSize: '0.6rem', fill: 'hsl(var(--muted-foreground))' } : false}
                  stroke={isSubcamNmaxFile ? 'transparent' : 'hsl(var(--border))'}
                  width={isSubcamNmaxFile ? 1 : fileType === 'FPOD' ? 50 : 10}
                  domain={yAxisDomain}
                  allowDataOverflow={true}
                  hide={isSubcamNmaxFile}
                  tickFormatter={fileType === 'FPOD' ? (value) => formatYAxisTick(value, dataRange, dataMax) : undefined}
                  label={fileType === 'FPOD' ? {
                    value: fpodUnitMode === 'DPM' ? 'DPM' : 'Clicks',
                    angle: -90,
                    position: 'insideLeft',
                    offset: 10,
                    style: { textAnchor: 'middle', fontSize: '0.65rem', fill: 'hsl(var(--muted-foreground))', fontWeight: 500 }
                  } : undefined}
                />

                {/* Frame lines - top and right edges */}
                <ReferenceLine {...(axisMode === 'single' && appliedStyleRule?.properties.secondaryYAxis?.enabled ? { yAxisId: "left" } : {})} y={yAxisDomain[1]} stroke="hsl(var(--border))" strokeWidth={1} strokeOpacity={0.3} />
                {finalDisplayData.length > 0 && (
                  <ReferenceLine {...(axisMode === 'single' && appliedStyleRule?.properties.secondaryYAxis?.enabled ? { yAxisId: "left" } : {})} x={showDaysFromStart ? finalDisplayData[finalDisplayData.length - 1].dayNumber : finalDisplayData[finalDisplayData.length - 1].time} stroke="hsl(var(--border))" strokeWidth={1} strokeOpacity={0.3} />
                )}

                <RechartsTooltip
                  content={<CustomChartTooltip coordinates={coordinates} />}
                  isAnimationActive={false}
                />

                {/*
                  Z-INDEX ORDERING: In Recharts, components render in JSX order.
                  - Render Area components FIRST (they will be in the background)
                  - Render Line components AFTER areas (they will be on top and clickable)
                  - Lines have increased strokeWidth (2px) and activeDot for better clickability
                  - Now includes MA parameters (SINGLE AXIS MODE)
                */}
                {(() => {
                  const maLines = allDisplayParameters.filter(p => p.endsWith('_ma'));
                  if (maLines.length > 0) {
                    console.log('[MA DEBUG] [SINGLE AXIS] Rendering MA lines:', maLines);
                  }
                  return allDisplayParameters.map((parameter) => {
                    const state = parameterStates[parameter];
                    if (!state) {
                      console.warn('[MA DEBUG] [SINGLE AXIS] No state found for parameter:', parameter);
                      return null;
                    }

                    const isMA = parameter.endsWith('_ma');
                    const colorValue = getColorValue(state.color, state.opacity ?? 1.0);

                    if (isMA) {
                      console.log('[MA DEBUG] [SINGLE AXIS] Rendering MA line:', {
                        parameter,
                        color: colorValue,
                        state
                      });
                    }

                    return (
                      <Line
                        key={parameter}
                        {...(axisMode === 'single' && appliedStyleRule?.properties.secondaryYAxis?.enabled ? { yAxisId: "left" } : {})}
                        type="monotone"
                        dataKey={parameter}
                        stroke={colorValue}
                        strokeWidth={state.lineWidth ?? 2}
                        strokeDasharray={state.lineStyle === 'dashed' ? '5 5' : undefined}
                        dot={false}
                        connectNulls={false}
                        name={getLITUDisplayName(parameter) || parameter}
                        isAnimationActive={false}
                        activeDot={{ r: isMA ? 4 : 6, strokeWidth: 2 }}
                        onClick={() => toggleParameterVisibility(parameter)}
                        style={{ cursor: 'pointer' }}
                      />
                    );
                  });
                })()}
              </LineChart>
            </ResponsiveContainer>
            </div>
          )}

          {/* Multi Axis Mode */}
          {axisMode === 'multi' && (
            <div style={{ width: '100%', height: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={finalDisplayData}
                margin={{
                  top: 5,
                  right: Math.ceil(visibleParameters.length / 2) * 10,
                  left: 10,
                  bottom: (appliedStyleRule?.properties.chartBottomMargin ?? 10)
                }}
              >
                <CartesianGrid strokeDasharray="2 2" stroke="hsl(var(--border))" vertical={false} />

                <XAxis
                  dataKey={showDaysFromStart ? "dayNumber" : "time"}
                  tick={{ fontSize: '0.65rem', fill: 'hsl(var(--muted-foreground))', angle: -45, textAnchor: 'end', dy: 8 }}
                  stroke="hsl(var(--border))"
                  tickFormatter={(value) =>
                    showDaysFromStart
                      ? `Day ${Math.round(value)}`
                      : showDateTimeAxis
                      ? formatDateTimeTick(value, coordinates, true)
                      : appliedStyleRule?.properties.xAxisRange
                      ? format24HourTick(value)
                      : formatDateTick(value, dataSource, showYearInXAxis)
                  }
                  height={appliedStyleRule?.properties.xAxisTitle
                    ? 45 + (appliedStyleRule.properties.xAxisTitlePosition || 20)
                    : showDateTimeAxis ? 60 : 45
                  }
                  label={appliedStyleRule?.properties.xAxisTitle ? {
                    value: appliedStyleRule.properties.xAxisTitle,
                    position: 'bottom',
                    offset: (appliedStyleRule.properties.xAxisTitleMargin ?? -5),
                    style: { textAnchor: 'middle', fontSize: `${appliedStyleRule.properties.xAxisTitleFontSize || 10}px`, fill: 'hsl(var(--muted-foreground))' }
                  } : undefined}
                />

                {/* One YAxis per visible parameter */}
                {visibleParameters.map((parameter, index) => {
                  const orientation = index % 2 === 0 ? 'left' : 'right';
                  const yAxisId = `axis-${parameter}`;
                  const domain = parameterDomains[parameter] || [0, 100];
                  const paramRange = Math.abs(domain[1] - domain[0]);
                  const paramMax = Math.max(Math.abs(domain[0]), Math.abs(domain[1]));
                  const paramColor = getColorValue(parameterStates[parameter].color);
                  // Add gap between axes: increase width for better spacing
                  const axisWidth = (index === 2) ? 65 : 55;
                  // Use GrowProbe common name if available, LITU name for nmax, otherwise formatted parameter name
                  const gpCommonName = fileType === 'GP' ? getGrowProbeCommonName(parameter) : null;
                  const lituName = getLITUDisplayName(parameter);
                  const labelText = lituName || gpCommonName || formatParameterWithSource(parameter, false);

                  // Calculate base offset and apply custom offsets from style rules
                  let labelOffset = getMultiAxisLabelOffset(domain, paramRange, paramMax);

                  // Apply custom Y-axis title offsets for _nmax files in multi-axis mode
                  if (appliedStyleRule?.properties.leftYAxisTitleOffset !== undefined ||
                      appliedStyleRule?.properties.rightYAxisTitleOffset !== undefined) {
                    const customOffset = orientation === 'left'
                      ? (appliedStyleRule.properties.leftYAxisTitleOffset ?? 0)
                      : (appliedStyleRule.properties.rightYAxisTitleOffset ?? 0);
                    labelOffset += customOffset;
                  }

                  const labelStyle = {
                    textAnchor: 'middle',
                    fontSize: '0.55rem',
                    fill: paramColor,
                    fontWeight: 500
                  };

                  // Prepare label config (check for multi-line)
                  let labelConfig: any = {
                    value: labelText,
                    angle: -90,
                    position: orientation === 'left' ? 'insideLeft' : 'insideRight',
                    offset: labelOffset,
                    style: labelStyle
                  };

                  // Check if multi-line is enabled
                  if (appliedStyleRule?.properties.yAxisMultiLine) {
                    const threshold = appliedStyleRule.properties.yAxisMultiLineWordThreshold || 3;
                    const lines = splitYAxisTitle(labelText, threshold);

                    // If split into multiple lines, use custom component
                    if (lines.length > 1) {
                      labelConfig = {
                        content: <MultiLineYAxisLabel value={lines} angle={-90} offset={labelOffset} style={labelStyle} />,
                        position: orientation === 'left' ? 'insideLeft' : 'insideRight'
                      };
                    }
                  }

                  return (
                    <YAxis
                      key={yAxisId}
                      yAxisId={yAxisId}
                      orientation={orientation}
                      tick={{ fontSize: '0.55rem', fill: paramColor }}
                      stroke={paramColor}
                      width={axisWidth}
                      tickFormatter={(value) => formatYAxisTick(value, paramRange, paramMax)}
                      label={labelConfig}
                      domain={domain}
                      allowDataOverflow={true}
                    />
                  );
                })}

                {/* Frame lines - top edges for each Y-axis */}
                {visibleParameters.map((parameter) => {
                  const domain = parameterDomains[parameter] || [0, 100];
                  const yAxisId = `axis-${parameter}`;
                  return (
                    <ReferenceLine
                      key={`ref-${yAxisId}`}
                      y={domain[1]}
                      yAxisId={yAxisId}
                      stroke="hsl(var(--border))"
                      strokeWidth={1}
                      strokeOpacity={0.3}
                    />
                  );
                })}

                {/* Frame lines - right edge (using first axis) */}
                {finalDisplayData.length > 0 && visibleParameters.length > 0 && (
                  <ReferenceLine
                    x={showDaysFromStart ? finalDisplayData[finalDisplayData.length - 1].dayNumber : finalDisplayData[finalDisplayData.length - 1].time}
                    yAxisId={`axis-${visibleParameters[0]}`}
                    stroke="hsl(var(--border))"
                    strokeWidth={1}
                    strokeOpacity={0.3}
                  />
                )}

                <RechartsTooltip
                  content={<CustomChartTooltip coordinates={coordinates} parameterDomains={parameterDomains} />}
                  isAnimationActive={false}
                />

                {/*
                  Z-INDEX ORDERING: In Recharts, components render in JSX order.
                  - Render Area components FIRST (they will be in the background)
                  - Render Line components AFTER areas (they will be on top and clickable)
                  - Lines have increased strokeWidth (2px) and activeDot for better clickability
                  - Now includes MA parameters which share Y-axis with their base parameter
                */}
                {(() => {
                  const maLines = allDisplayParameters.filter(p => p.endsWith('_ma'));
                  if (maLines.length > 0) {
                    console.log('[MA DEBUG] [MULTI AXIS] Rendering MA lines:', maLines);
                  }
                  return allDisplayParameters.map((parameter) => {
                    const state = parameterStates[parameter];
                    if (!state) {
                      console.warn('[MA DEBUG] [MULTI AXIS] No state found for parameter:', parameter);
                      return null;
                    }

                    // For MA parameters, use the base parameter's Y-axis
                    const isMA = parameter.endsWith('_ma');
                    const baseParam = isMA ? parameter.replace('_ma', '') : parameter;
                    const yAxisId = `axis-${baseParam}`;
                    const colorValue = getColorValue(state.color, state.opacity ?? 1.0);

                    if (isMA) {
                      console.log('[MA DEBUG] [MULTI AXIS] Rendering MA line:', {
                        parameter,
                        baseParam,
                        yAxisId,
                        color: colorValue,
                        state
                      });
                    }

                    return (
                      <Line
                        key={parameter}
                        type="monotone"
                        dataKey={parameter}
                        yAxisId={yAxisId}
                        stroke={colorValue}
                        strokeWidth={state.lineWidth ?? 2}
                        strokeDasharray={state.lineStyle === 'dashed' ? '5 5' : undefined}
                        dot={false}
                        connectNulls={false}
                        name={getLITUDisplayName(parameter) || parameter}
                        isAnimationActive={false}
                        activeDot={{ r: isMA ? 4 : 6, strokeWidth: 2 }} // Smaller dots for MA
                        onClick={() => toggleParameterVisibility(parameter)}
                        style={{ cursor: 'pointer' }}
                      />
                    );
                  });
                })()}
              </LineChart>
            </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Time Range Brush - only show in separate mode OR if last plot in common mode; hidden for 24hr avg plots */}
      {data.length > 10 && !hideBrush && (timeAxisMode === 'separate' || isLastPlot) && (
        <div className="relative h-16 w-full border rounded-md bg-card p-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 2, right: 15, left: 15, bottom: 0 }}>
              <XAxis
                dataKey="time"
                tickFormatter={(value) => formatDateTick(value, dataSource, showYearInXAxis)}
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: '0.6rem' }}
                height={10}
                interval="preserveStartEnd"
              />
              <Brush
                dataKey="time"
                height={16}
                stroke="hsl(var(--primary))"
                fill="transparent"
                tickFormatter={() => ""}
                travellerWidth={10}
                startIndex={activeBrushStart}
                endIndex={activeBrushEnd}
                onChange={handleBrushChange}
                y={12}
              />
            </LineChart>
          </ResponsiveContainer>

          {/* Pan Handle Overlay */}
          <BrushPanHandle
            dataLength={data.length}
            startIndex={activeBrushStart}
            endIndex={activeBrushEnd}
            onChange={handleBrushChange}
            containerMargin={15}
          />
        </div>
      )}

      {/* Observations info note - below chart, only for nmax chart view */}
      {isSubcamNmaxFile && viewMode === 'chart' && (
        <div className="bg-muted/40 border rounded-md px-3 py-2 flex items-center gap-2">
          <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
          </svg>
          <p className="text-xs text-muted-foreground">
            Data is being displayed as Observations, this does not include any species identification information. Please consult Methodology for more details.
          </p>
        </div>
      )}

          </div>

{/* Parameter Controls - On the right side (hidden for nmax chart view and FPOD files) */}
          {!(isSubcamNmaxFile && viewMode === 'chart') && fileType !== 'FPOD' && (
          <div className={cn(
            "transition-all duration-300 ease-in-out flex-shrink-0 flex flex-col",
            isParameterPanelExpanded ? "w-72 space-y-2" : "w-8 overflow-hidden"
          )}>
            {/* Collapsed state - just show expand button */}
            {!isParameterPanelExpanded && !compactView && (
              <Button
                variant="outline"
                size="sm"
                className="h-full min-h-[200px] w-8 p-0 flex flex-col items-center justify-center gap-1 hover:bg-accent/50 border-l-0 rounded-l-none"
                onClick={() => setIsParameterPanelExpanded(true)}
                title="Expand parameters panel"
              >
                <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground writing-mode-vertical" style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
                  Parameters
                </span>
              </Button>
            )}
            {/* Header with collapse button and label - shown when expanded, hidden in compact view */}
            {isParameterPanelExpanded && !compactView && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 hover:bg-accent/50"
                  onClick={() => setIsParameterPanelExpanded(false)}
                  title="Collapse panel"
                >
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                </Button>

                <p className="text-xs font-medium">
                  Parameters ({visibleParameters.length} visible)
                  {axisMode === 'multi' && visibleParameters.length > 0 && (
                    <span className="text-muted-foreground font-normal ml-1">- Multi-axis</span>
                  )}
                </p>
              </div>
            )}

            {/* Parameter Filters - shown when panel is expanded and filters are available */}
            {isParameterPanelExpanded && !compactView && (
              <ParameterFilterPanel
                parameters={numericParameters}
                sourceFilter={sourceFilter}
                dateFilter={dateFilter}
                unitFilter={unitFilter}
                stationFilter={stationFilter}
                onSourceFilterChange={setSourceFilter}
                onDateFilterChange={setDateFilter}
                onUnitFilterChange={setUnitFilter}
                onStationFilterChange={setStationFilter}
                onClearFilters={() => {
                  setSourceFilter([]);
                  setDateFilter([]);
                  setUnitFilter([]);
                  setStationFilter([]);
                }}
              />
            )}

            {isParameterPanelExpanded && (
            <div className="space-y-1 flex-1 overflow-y-auto">
              {(() => {
                // Apply filters to parameters - now supports multiple selections
                // Use ALL numeric parameters + MA parameters, regardless of visibility
                // Visibility only controls plot rendering, not parameter list display
                let filteredParameters = [...numericParameters, ...movingAverageParameters];

                // Hide sensor parameters (accelerometer, magnetic field) unless enabled
                if (!showSensorParams && fileType === 'GP') {
                  filteredParameters = filteredParameters.filter(param =>
                    !isHiddenSensorParam(param)
                  );
                }

                // console.log('[PARAM LIST RENDER] Starting with ALL parameters (numeric + MA):', filteredParameters.length, filteredParameters);
                // console.log('[PARAM LIST RENDER] visibleParameters:', visibleParameters.length, visibleParameters);
                // console.log('[PARAM LIST RENDER] compactView:', compactView);
                // console.log('[PARAM LIST RENDER] sourceFilter:', sourceFilter);
                // console.log('[PARAM LIST RENDER] dateFilter:', dateFilter);
                // console.log('[PARAM LIST RENDER] unitFilter:', unitFilter);
                // console.log('[PARAM LIST RENDER] stationFilter:', stationFilter);

                // Apply source filter (Porpoise, Dolphin, Sonar)
                if (sourceFilter.length > 0) {
                  filteredParameters = filteredParameters.filter(param =>
                    sourceFilter.some(source => param.toLowerCase().includes(source.toLowerCase()))
                  );
                  // console.log('[PARAM LIST RENDER] After source filter:', filteredParameters.length);
                }

                // Apply date filter (e.g., [2406_2407])
                if (dateFilter.length > 0) {
                  filteredParameters = filteredParameters.filter(param =>
                    dateFilter.some(date => param.includes(`[${date}]`))
                  );
                  // console.log('[PARAM LIST RENDER] After date filter:', filteredParameters.length);
                }

                // Apply unit filter (DPM, Clicks)
                if (unitFilter.length > 0) {
                  filteredParameters = filteredParameters.filter(param =>
                    unitFilter.some(unit => param.includes(`(${unit})`))
                  );
                  // console.log('[PARAM LIST RENDER] After unit filter:', filteredParameters.length);
                }

                // Apply station filter (e.g., [C_S], [C_W], [F_L])
                if (stationFilter.length > 0) {
                  filteredParameters = filteredParameters.filter(param =>
                    stationFilter.some(station => param.includes(`[${station}]`))
                  );
                  // console.log('[PARAM LIST RENDER] After station filter:', filteredParameters.length);
                }

                // In compact view, filter to show only visible parameters and sort alphabetically
                const parametersToShow = compactView
                  ? filteredParameters
                      .filter(param => parameterStates[param]?.visible)
                      .sort((a, b) => a.localeCompare(b))
                  : filteredParameters;

                // console.log('[PARAM LIST RENDER] After compact view filter, parametersToShow:', parametersToShow.length, parametersToShow);
                // console.log('[PARAM LIST RENDER] parameterStates visibility:', Object.keys(parameterStates).map(k => ({ name: k, visible: parameterStates[k]?.visible })));

                return parametersToShow.map((parameter, index) => {
                const state = parameterStates[parameter];
                if (!state) return null;

                // Check if this is an MA parameter
                const isMA = parameter.endsWith('_ma');
                const baseParam = isMA ? parameter.replace('_ma', '') : parameter;
                const baseState = isMA ? parameterStates[baseParam] : null;

                // Get display name for MA parameters
                let displayName = parameter;
                if (isMA && baseState?.movingAverage) {
                  const windowDays = baseState.movingAverage.windowDays || 7;
                  displayName = `${baseParam} MA (${windowDays}d)`;
                }

                // Get axis position for this parameter in multi-axis mode
                const visibleIndex = visibleParameters.indexOf(parameter);
                const axisPosition = visibleIndex >= 0 ? (visibleIndex % 2 === 0 ? 'L' : 'R') : null;

                const colorValue = getColorValue(state.color);

                return (
                  <div key={parameter} className={cn(
                    "flex items-center justify-between rounded bg-card/50",
                    compactView ? "p-0.5" : "p-1.5 border",
                    isMA && !compactView && "ml-4" // Indent MA parameters
                  )}>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {/* Checkbox - hidden in compact view */}
                      {!compactView && (
                        <Checkbox
                          id={`param-${parameter}`}
                          checked={state.visible}
                          onCheckedChange={() => toggleParameterVisibility(parameter)}
                          className="h-3 w-3"
                        />
                      )}

                      {/* Solo button - small circular button, hidden in compact view */}
                      {!compactView && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-4 w-4 p-0 rounded-full hover:bg-accent",
                            state.isSolo && "bg-primary/20 hover:bg-primary/30"
                          )}
                          onClick={() => toggleSolo(parameter)}
                          title={state.isSolo ? "Exit solo mode" : "Show only this parameter"}
                        >
                          <Circle className={cn(
                            "h-2.5 w-2.5",
                            state.isSolo ? "fill-primary text-primary" : "text-muted-foreground"
                          )} />
                        </Button>
                      )}

                      {/* Colored circle in compact view - shown to the left of parameter name */}
                      {compactView && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <div
                              className="w-3 h-3 rounded-full border cursor-pointer hover:ring-2 hover:ring-offset-1 transition-all flex-shrink-0"
                              style={{
                                backgroundColor: getColorValue(state.color, state.opacity ?? 1.0),
                                '--tw-ring-color': colorValue
                              } as React.CSSProperties}
                              title="Change color and transparency"
                              onClick={(e) => e.stopPropagation()}
                            />
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-3" align="end" onClick={(e) => e.stopPropagation()}>
                            <div className="space-y-3">
                              <p className="text-xs font-medium">Color & Style</p>

                              {/* Quick color palette */}
                              <div className="space-y-2">
                                <Label className="text-xs">Quick Colors</Label>
                                <div className="grid grid-cols-8 gap-1.5">
                                  {DEFAULT_COLOR_PALETTE.map((color) => (
                                    <button
                                      key={color}
                                      className="w-6 h-6 rounded border-2 hover:scale-110 transition-transform"
                                      style={{ backgroundColor: color, borderColor: state.color === color ? 'hsl(var(--foreground))' : 'hsl(var(--border))' }}
                                      onClick={() => updateParameterColor(parameter, color)}
                                      title={color}
                                    />
                                  ))}
                                </div>
                              </div>

                              <div className="relative">
                                <HexColorPicker
                                  color={state.color.startsWith('#') ? state.color : cssVarToHex(state.color)}
                                  onChange={(hex) => updateParameterColor(parameter, hex)}
                                  style={{ width: '200px', height: '150px' }}
                                />
                              </div>

                              {/* Line Style */}
                              <div className="space-y-2">
                                <Label className="text-xs">Line Style</Label>
                                <div className="flex gap-2">
                                  <Button
                                    variant={state.lineStyle === 'solid' || !state.lineStyle ? 'default' : 'outline'}
                                    size="sm"
                                    className="h-8 text-xs flex-1"
                                    onClick={() => updateParameterLineStyle(parameter, 'solid')}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <div className="w-6 h-0.5 bg-current" />
                                      <span>Solid</span>
                                    </div>
                                  </Button>
                                  <Button
                                    variant={state.lineStyle === 'dashed' ? 'default' : 'outline'}
                                    size="sm"
                                    className="h-8 text-xs flex-1"
                                    onClick={() => updateParameterLineStyle(parameter, 'dashed')}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <div className="w-6 h-0.5 bg-current" style={{ backgroundImage: 'repeating-linear-gradient(90deg, currentColor 0, currentColor 2px, transparent 2px, transparent 4px)' }} />
                                      <span>Dashed</span>
                                    </div>
                                  </Button>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label className="text-xs">Opacity</Label>
                                  <span className="text-xs text-muted-foreground">
                                    {Math.round((state.opacity ?? 1.0) * 100)}%
                                  </span>
                                </div>
                                <Input
                                  type="range"
                                  min="0"
                                  max="100"
                                  step="5"
                                  value={Math.round((state.opacity ?? 1.0) * 100)}
                                  onChange={(e) => updateParameterOpacity(parameter, parseInt(e.target.value) / 100)}
                                  className="h-2 cursor-pointer"
                                />
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 text-xs flex-1"
                                    onClick={() => updateParameterOpacity(parameter, 0.25)}
                                  >
                                    25%
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 text-xs flex-1"
                                    onClick={() => updateParameterOpacity(parameter, 0.5)}
                                  >
                                    50%
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 text-xs flex-1"
                                    onClick={() => updateParameterOpacity(parameter, 0.75)}
                                  >
                                    75%
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 text-xs flex-1"
                                    onClick={() => updateParameterOpacity(parameter, 1.0)}
                                  >
                                    100%
                                  </Button>
                                </div>
                              </div>

                              {/* Line Width */}
                              <div className="space-y-2">
                                <Label className="text-xs">Line Width</Label>
                                <div className="grid grid-cols-4 gap-1.5">
                                  <Button
                                    variant={(state.lineWidth ?? 2) === 0.5 ? 'default' : 'outline'}
                                    size="sm"
                                    className="h-8 text-xs px-1"
                                    onClick={() => updateParameterLineWidth(parameter, 0.5)}
                                  >
                                    <div className="flex flex-col items-center gap-0.5">
                                      <div className="w-full h-[1px] bg-current" />
                                      <span className="text-[0.6rem]">0.5</span>
                                    </div>
                                  </Button>
                                  <Button
                                    variant={(state.lineWidth ?? 2) === 1 ? 'default' : 'outline'}
                                    size="sm"
                                    className="h-8 text-xs px-1"
                                    onClick={() => updateParameterLineWidth(parameter, 1)}
                                  >
                                    <div className="flex flex-col items-center gap-0.5">
                                      <div className="w-full h-[1.5px] bg-current" />
                                      <span className="text-[0.6rem]">1</span>
                                    </div>
                                  </Button>
                                  <Button
                                    variant={(state.lineWidth ?? 2) === 1.5 ? 'default' : 'outline'}
                                    size="sm"
                                    className="h-8 text-xs px-1"
                                    onClick={() => updateParameterLineWidth(parameter, 1.5)}
                                  >
                                    <div className="flex flex-col items-center gap-0.5">
                                      <div className="w-full h-[2px] bg-current" />
                                      <span className="text-[0.6rem]">1.5</span>
                                    </div>
                                  </Button>
                                  <Button
                                    variant={(state.lineWidth ?? 2) === 2 ? 'default' : 'outline'}
                                    size="sm"
                                    className="h-8 text-xs px-1"
                                    onClick={() => updateParameterLineWidth(parameter, 2)}
                                  >
                                    <div className="flex flex-col items-center gap-0.5">
                                      <div className="w-full h-[2.5px] bg-current" />
                                      <span className="text-[0.6rem]">2</span>
                                    </div>
                                  </Button>
                                  <Button
                                    variant={(state.lineWidth ?? 2) === 2.5 ? 'default' : 'outline'}
                                    size="sm"
                                    className="h-8 text-xs px-1"
                                    onClick={() => updateParameterLineWidth(parameter, 2.5)}
                                  >
                                    <div className="flex flex-col items-center gap-0.5">
                                      <div className="w-full h-[3px] bg-current" />
                                      <span className="text-[0.6rem]">2.5</span>
                                    </div>
                                  </Button>
                                  <Button
                                    variant={(state.lineWidth ?? 2) === 3 ? 'default' : 'outline'}
                                    size="sm"
                                    className="h-8 text-xs px-1"
                                    onClick={() => updateParameterLineWidth(parameter, 3)}
                                  >
                                    <div className="flex flex-col items-center gap-0.5">
                                      <div className="w-full h-[3.5px] bg-current" />
                                      <span className="text-[0.6rem]">3</span>
                                    </div>
                                  </Button>
                                  <Button
                                    variant={(state.lineWidth ?? 2) === 3.5 ? 'default' : 'outline'}
                                    size="sm"
                                    className="h-8 text-xs px-1"
                                    onClick={() => updateParameterLineWidth(parameter, 3.5)}
                                  >
                                    <div className="flex flex-col items-center gap-0.5">
                                      <div className="w-full h-1 bg-current" />
                                      <span className="text-[0.6rem]">3.5</span>
                                    </div>
                                  </Button>
                                  <Button
                                    variant={(state.lineWidth ?? 2) === 4 ? 'default' : 'outline'}
                                    size="sm"
                                    className="h-8 text-xs px-1"
                                    onClick={() => updateParameterLineWidth(parameter, 4)}
                                  >
                                    <div className="flex flex-col items-center gap-0.5">
                                      <div className="w-full h-[5px] bg-current" />
                                      <span className="text-[0.6rem]">4</span>
                                    </div>
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}

                      {/* Parameter label with click to toggle */}
                      <div
                        className="flex items-center gap-1 flex-1 min-w-0 cursor-pointer"
                        onClick={() => toggleParameterVisibility(parameter)}
                        title="Click to toggle visibility"
                      >
                        {/* Parameter name with tooltip for GrowProbe common names */}
                        {(() => {
                          const gpCommonName = fileType === 'GP' ? getGrowProbeCommonName(parameter) : null;
                          const labelContent = isMA
                            ? (compactView ? formatParameterName(displayName) : displayName)
                            : (compactView ? formatParameterName(parameter) : getParameterLabelWithUnit(parameter));

                          if (gpCommonName) {
                            return (
                              <TooltipProvider delayDuration={300}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Label
                                      htmlFor={`param-${parameter}`}
                                      className={cn(
                                        "text-[11px] font-normal cursor-pointer",
                                        !compactView && !isParameterPanelExpanded && "truncate",
                                        isMA && "italic text-muted-foreground"
                                      )}
                                    >
                                      {labelContent}
                                    </Label>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">
                                    {gpCommonName}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            );
                          }
                          return (
                            <Label
                              htmlFor={`param-${parameter}`}
                              className={cn(
                                "text-[11px] font-normal cursor-pointer",
                                !compactView && !isParameterPanelExpanded && "truncate",
                                isMA && "italic text-muted-foreground"
                              )}
                            >
                              {labelContent}
                            </Label>
                          );
                        })()}

                        {/* Filter indicator */}
                        {state.timeFilter?.enabled && (
                          <Filter
                            className="h-2.5 w-2.5 text-primary opacity-70"
                            title={`Time filter: ${state.timeFilter.excludeStart}-${state.timeFilter.excludeEnd}`}
                          />
                        )}
                        {/* MA indicator */}
                        {state.movingAverage?.enabled && (
                          <BarChart3
                            className="h-2.5 w-2.5 text-primary opacity-70"
                            title={`${state.movingAverage.windowDays}d MA ${state.movingAverage.showLine ? '(visible)' : '(hidden)'}`}
                          />
                        )}
                        {/* Y-axis range indicator */}
                        {state.yAxisRange && (state.yAxisRange.min !== undefined || state.yAxisRange.max !== undefined) && (
                          <Settings
                            className="h-2.5 w-2.5 text-primary opacity-70"
                            title={`Custom Y-axis: ${state.yAxisRange.min ?? 'auto'} to ${state.yAxisRange.max ?? 'auto'}`}
                          />
                        )}
                      </div>
                    </div>

                    {/* Right side controls */}
                    <div className="flex items-center gap-1.5">
                      {/* Show axis indicator in multi-axis mode - hidden in compact view */}
                      {!compactView && axisMode === 'multi' && state.visible && axisPosition && (
                        <span
                          className="text-[0.6rem] font-semibold px-1 rounded"
                          style={{ color: colorValue, backgroundColor: `${colorValue}1a` }}
                        >
                          {axisPosition}
                        </span>
                      )}

                      {/* Colored circle with color picker - hidden in compact view (shown next to parameter name instead) */}
                      {!compactView && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <div
                            className="w-3 h-3 rounded-full border cursor-pointer hover:ring-2 hover:ring-offset-1 transition-all"
                            style={{
                              backgroundColor: getColorValue(state.color, state.opacity ?? 1.0),
                              '--tw-ring-color': colorValue
                            } as React.CSSProperties}
                            title="Change color and transparency"
                          />
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-3" align="end" onClick={(e) => e.stopPropagation()}>
                          <div className="space-y-3">
                            <p className="text-xs font-medium">Color & Style</p>

                            {/* Quick color palette */}
                            <div className="space-y-2">
                              <Label className="text-xs">Quick Colors</Label>
                              <div className="grid grid-cols-8 gap-1.5">
                                {DEFAULT_COLOR_PALETTE.map((color) => (
                                  <button
                                    key={color}
                                    className="w-6 h-6 rounded border-2 hover:scale-110 transition-transform"
                                    style={{ backgroundColor: color, borderColor: state.color === color ? 'hsl(var(--foreground))' : 'hsl(var(--border))' }}
                                    onClick={() => updateParameterColor(parameter, color)}
                                    title={color}
                                  />
                                ))}
                              </div>
                            </div>

                            <div className="relative">
                              <HexColorPicker
                                color={state.color.startsWith('#') ? state.color : cssVarToHex(state.color)}
                                onChange={(hex) => updateParameterColor(parameter, hex)}
                                style={{ width: '200px', height: '150px' }}
                              />
                            </div>

                            {/* Line Style */}
                            <div className="space-y-2">
                              <Label className="text-xs">Line Style</Label>
                              <div className="flex gap-2">
                                <Button
                                  variant={state.lineStyle === 'solid' || !state.lineStyle ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-8 text-xs flex-1"
                                  onClick={() => updateParameterLineStyle(parameter, 'solid')}
                                >
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-6 h-0.5 bg-current" />
                                    <span>Solid</span>
                                  </div>
                                </Button>
                                <Button
                                  variant={state.lineStyle === 'dashed' ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-8 text-xs flex-1"
                                  onClick={() => updateParameterLineStyle(parameter, 'dashed')}
                                >
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-6 h-0.5 bg-current" style={{ backgroundImage: 'repeating-linear-gradient(90deg, currentColor 0, currentColor 2px, transparent 2px, transparent 4px)' }} />
                                    <span>Dashed</span>
                                  </div>
                                </Button>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label className="text-xs">Opacity</Label>
                                <span className="text-xs text-muted-foreground">
                                  {Math.round((state.opacity ?? 1.0) * 100)}%
                                </span>
                              </div>
                              <Input
                                type="range"
                                min="0"
                                max="100"
                                step="5"
                                value={Math.round((state.opacity ?? 1.0) * 100)}
                                onChange={(e) => updateParameterOpacity(parameter, parseInt(e.target.value) / 100)}
                                className="h-2 cursor-pointer"
                              />
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-xs flex-1"
                                  onClick={() => updateParameterOpacity(parameter, 0.25)}
                                >
                                  25%
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-xs flex-1"
                                  onClick={() => updateParameterOpacity(parameter, 0.5)}
                                >
                                  50%
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-xs flex-1"
                                  onClick={() => updateParameterOpacity(parameter, 0.75)}
                                >
                                  75%
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-xs flex-1"
                                  onClick={() => updateParameterOpacity(parameter, 1.0)}
                                >
                                  100%
                                </Button>
                              </div>
                            </div>

                            {/* Line Width */}
                            <div className="space-y-2">
                              <Label className="text-xs">Line Width</Label>
                              <div className="grid grid-cols-4 gap-1.5">
                                <Button
                                  variant={(state.lineWidth ?? 2) === 0.5 ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-8 text-xs px-1"
                                  onClick={() => updateParameterLineWidth(parameter, 0.5)}
                                >
                                  <div className="flex flex-col items-center gap-0.5">
                                    <div className="w-full h-[1px] bg-current" />
                                    <span className="text-[0.6rem]">0.5</span>
                                  </div>
                                </Button>
                                <Button
                                  variant={(state.lineWidth ?? 2) === 1 ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-8 text-xs px-1"
                                  onClick={() => updateParameterLineWidth(parameter, 1)}
                                >
                                  <div className="flex flex-col items-center gap-0.5">
                                    <div className="w-full h-[1.5px] bg-current" />
                                    <span className="text-[0.6rem]">1</span>
                                  </div>
                                </Button>
                                <Button
                                  variant={(state.lineWidth ?? 2) === 1.5 ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-8 text-xs px-1"
                                  onClick={() => updateParameterLineWidth(parameter, 1.5)}
                                >
                                  <div className="flex flex-col items-center gap-0.5">
                                    <div className="w-full h-[2px] bg-current" />
                                    <span className="text-[0.6rem]">1.5</span>
                                  </div>
                                </Button>
                                <Button
                                  variant={(state.lineWidth ?? 2) === 2 ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-8 text-xs px-1"
                                  onClick={() => updateParameterLineWidth(parameter, 2)}
                                >
                                  <div className="flex flex-col items-center gap-0.5">
                                    <div className="w-full h-[2.5px] bg-current" />
                                    <span className="text-[0.6rem]">2</span>
                                  </div>
                                </Button>
                                <Button
                                  variant={(state.lineWidth ?? 2) === 2.5 ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-8 text-xs px-1"
                                  onClick={() => updateParameterLineWidth(parameter, 2.5)}
                                >
                                  <div className="flex flex-col items-center gap-0.5">
                                    <div className="w-full h-[3px] bg-current" />
                                    <span className="text-[0.6rem]">2.5</span>
                                  </div>
                                </Button>
                                <Button
                                  variant={(state.lineWidth ?? 2) === 3 ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-8 text-xs px-1"
                                  onClick={() => updateParameterLineWidth(parameter, 3)}
                                >
                                  <div className="flex flex-col items-center gap-0.5">
                                    <div className="w-full h-[3.5px] bg-current" />
                                    <span className="text-[0.6rem]">3</span>
                                  </div>
                                </Button>
                                <Button
                                  variant={(state.lineWidth ?? 2) === 3.5 ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-8 text-xs px-1"
                                  onClick={() => updateParameterLineWidth(parameter, 3.5)}
                                >
                                  <div className="flex flex-col items-center gap-0.5">
                                    <div className="w-full h-1 bg-current" />
                                    <span className="text-[0.6rem]">3.5</span>
                                  </div>
                                </Button>
                                <Button
                                  variant={(state.lineWidth ?? 2) === 4 ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-8 text-xs px-1"
                                  onClick={() => updateParameterLineWidth(parameter, 4)}
                                >
                                  <div className="flex flex-col items-center gap-0.5">
                                    <div className="w-full h-[5px] bg-current" />
                                    <span className="text-[0.6rem]">4</span>
                                  </div>
                                </Button>
                              </div>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                      )}

                      {/* Settings icon - contains filters and MA - only show for base parameters, not MA */}
                      {!isMA && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                              "h-5 w-5 p-0 hover:bg-accent",
                              (state.timeFilter?.enabled || state.movingAverage?.enabled || (state.yAxisRange?.min !== undefined && state.yAxisRange?.max !== undefined)) && "text-primary"
                            )}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Settings className="h-3 w-3" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 p-3" align="end" onClick={(e) => e.stopPropagation()}>
                          <div className="space-y-4">
                            <p className="text-xs font-semibold border-b pb-2">Settings - {parameter}</p>

                            {/* Time Filter Section - Compact */}
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <Checkbox
                                  id={`filter-${parameter}`}
                                  checked={state.timeFilter?.enabled || false}
                                  onCheckedChange={(checked) =>
                                    updateTimeFilter(
                                      parameter,
                                      checked as boolean,
                                      state.timeFilter?.excludeStart,
                                      state.timeFilter?.excludeEnd
                                    )
                                  }
                                  className="h-3 w-3 shrink-0"
                                />
                                <Label htmlFor={`filter-${parameter}`} className="text-xs cursor-pointer shrink-0">
                                  Filter
                                </Label>
                                {state.timeFilter?.enabled && (
                                  <>
                                    <span className="text-xs text-muted-foreground shrink-0">Hide:</span>
                                    <Input
                                      type="time"
                                      value={state.timeFilter?.excludeStart || '08:00'}
                                      onChange={(e) =>
                                        updateTimeFilter(
                                          parameter,
                                          true,
                                          e.target.value,
                                          state.timeFilter?.excludeEnd
                                        )
                                      }
                                      className="h-6 text-xs w-20"
                                    />
                                    <span className="text-xs text-muted-foreground shrink-0">to</span>
                                    <Input
                                      type="time"
                                      value={state.timeFilter?.excludeEnd || '18:00'}
                                      onChange={(e) =>
                                        updateTimeFilter(
                                          parameter,
                                          true,
                                          state.timeFilter?.excludeStart,
                                          e.target.value
                                        )
                                      }
                                      className="h-6 text-xs w-20"
                                    />
                                  </>
                                )}
                              </div>
                              {state.timeFilter?.enabled && (
                                <p className="text-[0.65rem] text-muted-foreground italic pl-5">
                                  Applied to each day in the time series
                                </p>
                              )}
                            </div>

                            {/* Moving Average Section - Compact */}
                            <div className="border-t pt-3">
                              <div className="flex items-center gap-2 flex-wrap">
                                <BarChart3 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <Checkbox
                                  id={`ma-${parameter}`}
                                  checked={state.movingAverage?.enabled || false}
                                  onCheckedChange={(checked) =>
                                    updateMovingAverage(
                                      parameter,
                                      checked as boolean,
                                      state.movingAverage?.windowDays,
                                      state.movingAverage?.showLine
                                    )
                                  }
                                  className="h-3 w-3 shrink-0"
                                />
                                <Label htmlFor={`ma-${parameter}`} className="text-xs cursor-pointer shrink-0">
                                  Moving Avg
                                </Label>
                                {state.movingAverage?.enabled && (
                                  <>
                                    <span className="text-xs text-muted-foreground shrink-0">Window:</span>
                                    <Input
                                      type="number"
                                      min="1"
                                      max="365"
                                      value={state.movingAverage?.windowDays || 7}
                                      onChange={(e) =>
                                        updateMovingAverage(
                                          parameter,
                                          true,
                                          parseInt(e.target.value) || 7,
                                          state.movingAverage?.showLine
                                        )
                                      }
                                      className="h-6 text-xs w-16"
                                    />
                                    <span className="text-xs text-muted-foreground shrink-0">days</span>
                                    <Checkbox
                                      id={`ma-show-${parameter}`}
                                      checked={state.movingAverage?.showLine !== false}
                                      onCheckedChange={(checked) =>
                                        updateMovingAverage(
                                          parameter,
                                          true,
                                          state.movingAverage?.windowDays,
                                          checked as boolean
                                        )
                                      }
                                      className="h-3 w-3 shrink-0"
                                    />
                                    <Label htmlFor={`ma-show-${parameter}`} className="text-xs cursor-pointer shrink-0">
                                      Show line
                                    </Label>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Y-Axis Range Section */}
                            <div className="space-y-2 border-t pt-3">
                              <div className="flex items-center gap-2">
                                <Ruler className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-xs font-medium">Y-Axis Range</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  id={`yaxis-${parameter}`}
                                  checked={(state.yAxisRange?.min !== undefined && state.yAxisRange?.max !== undefined)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      // Enable with current domain as defaults
                                      const currentDomain = parameterDomains[parameter] || [0, 100];
                                      // Initialize pending values
                                      setPendingYAxisRanges(prev => ({
                                        ...prev,
                                        [parameter]: { min: String(currentDomain[0]), max: String(currentDomain[1]) }
                                      }));
                                      updateYAxisRange(parameter, currentDomain[0], currentDomain[1]);
                                    } else {
                                      // Disable by clearing range
                                      setPendingYAxisRanges(prev => {
                                        const updated = { ...prev };
                                        delete updated[parameter];
                                        return updated;
                                      });
                                      updateYAxisRange(parameter, undefined, undefined);
                                    }
                                  }}
                                  className="h-3 w-3"
                                />
                                <Label htmlFor={`yaxis-${parameter}`} className="text-xs cursor-pointer">
                                  Custom Y-axis range
                                </Label>
                              </div>
                              {(state.yAxisRange?.min !== undefined && state.yAxisRange?.max !== undefined) && (
                                <div className="pl-5 space-y-2">
                                  <div className="flex items-center gap-2">
                                    <Label className="text-xs w-12">Min:</Label>
                                    <Input
                                      type="number"
                                      step="any"
                                      value={pendingYAxisRanges[parameter]?.min ?? state.yAxisRange?.min ?? ''}
                                      onChange={(e) => {
                                        setPendingYAxisRanges(prev => ({
                                          ...prev,
                                          [parameter]: {
                                            min: e.target.value,
                                            max: prev[parameter]?.max ?? String(state.yAxisRange?.max ?? '')
                                          }
                                        }));
                                      }}
                                      className="h-7 text-xs"
                                      placeholder="Min value"
                                    />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Label className="text-xs w-12">Max:</Label>
                                    <Input
                                      type="number"
                                      step="any"
                                      value={pendingYAxisRanges[parameter]?.max ?? state.yAxisRange?.max ?? ''}
                                      onChange={(e) => {
                                        setPendingYAxisRanges(prev => ({
                                          ...prev,
                                          [parameter]: {
                                            min: prev[parameter]?.min ?? String(state.yAxisRange?.min ?? ''),
                                            max: e.target.value
                                          }
                                        }));
                                      }}
                                      className="h-7 text-xs"
                                      placeholder="Max value"
                                    />
                                  </div>
                                  {pendingYAxisRanges[parameter] && (
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        const pending = pendingYAxisRanges[parameter];
                                        const newMin = parseFloat(pending.min);
                                        const newMax = parseFloat(pending.max);
                                        if (!isNaN(newMin) && !isNaN(newMax)) {
                                          updateYAxisRange(parameter, newMin, newMax);
                                          // Clear pending state after applying
                                          setPendingYAxisRanges(prev => {
                                            const updated = { ...prev };
                                            delete updated[parameter];
                                            return updated;
                                          });
                                        }
                                      }}
                                      className="h-7 text-xs w-full"
                                    >
                                      Apply
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Include Zero Values Section - Only show for subtracted plots */}
                            {isSubtractedPlot && (
                              <div className="space-y-2 border-t pt-3">
                                <div className="flex items-center gap-2">
                                  <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                                  <span className="text-xs font-medium">Data Filtering</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Checkbox
                                    id="include-zero-values"
                                    checked={includeZeroValues}
                                    onCheckedChange={(checked) => {
                                      if (onIncludeZeroValuesChange) {
                                        onIncludeZeroValuesChange(checked as boolean);
                                      }
                                    }}
                                    className="h-3 w-3"
                                  />
                                  <Label htmlFor="include-zero-values" className="text-xs cursor-pointer">
                                    Include zero values
                                  </Label>
                                </div>
                                <p className="text-[0.65rem] text-muted-foreground pl-5">
                                  When unchecked, shows zero for data points where only one of the two source plots has data (the other is zero). This preserves the timeline.
                                </p>
                              </div>
                            )}

                            {/* Custom Parameter Name Section - available for all plots */}
                            <div className="space-y-1.5 border-t pt-3">
                              <Label htmlFor={`custom-name-${parameter}`} className="text-xs font-medium">
                                Custom Display Name
                              </Label>
                              <div className="flex gap-1.5">
                                <Input
                                  id={`custom-name-${parameter}`}
                                  type="text"
                                  placeholder={getParameterLabelWithUnit(parameter)}
                                  value={customParameterNames[parameter] || ''}
                                  onChange={(e) => {
                                    setCustomParameterNames(prev => ({
                                      ...prev,
                                      [parameter]: e.target.value
                                    }));
                                  }}
                                  className="h-7 text-xs"
                                  onClick={(e) => e.stopPropagation()}
                                />
                                {customParameterNames[parameter] && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCustomParameterNames(prev => {
                                        const updated = { ...prev };
                                        delete updated[parameter];
                                        return updated;
                                      });
                                    }}
                                    title="Reset to default"
                                  >
                                    Reset
                                  </Button>
                                )}
                              </div>
                              <p className="text-[0.65rem] text-muted-foreground">
                                Leave empty to use auto-formatted name
                              </p>
                            </div>

                            {/* Display Options Section - only show in compact view */}
                            {compactView && (
                              <div className="space-y-2 border-t pt-3">
                                <div className="flex items-center gap-2">
                                  <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                                  <span className="text-xs font-medium">Display Options</span>
                                </div>
                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-2">
                                    <Checkbox
                                      id="hide-units"
                                      checked={hideUnits}
                                      onCheckedChange={(checked) => setHideUnits(checked as boolean)}
                                      className="h-3 w-3"
                                    />
                                    <Label htmlFor="hide-units" className="text-xs cursor-pointer">
                                      Hide units (DPM, Clicks, etc.)
                                    </Label>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Checkbox
                                      id="hide-dates"
                                      checked={hideDates}
                                      onCheckedChange={(checked) => setHideDates(checked as boolean)}
                                      className="h-3 w-3"
                                    />
                                    <Label htmlFor="hide-dates" className="text-xs cursor-pointer">
                                      Hide dates [2406_2407]
                                    </Label>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Checkbox
                                      id="hide-stations"
                                      checked={hideStations}
                                      onCheckedChange={(checked) => setHideStations(checked as boolean)}
                                      className="h-3 w-3"
                                    />
                                    <Label htmlFor="hide-stations" className="text-xs cursor-pointer">
                                      Hide stations [C_S, F_L, etc.]
                                    </Label>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Checkbox
                                      id="hide-parameter-name"
                                      checked={hideParameterName}
                                      onCheckedChange={(checked) => setHideParameterName(checked as boolean)}
                                      className="h-3 w-3"
                                    />
                                    <Label htmlFor="hide-parameter-name" className="text-xs cursor-pointer">
                                      Hide parameter name (Dolphin, etc.)
                                    </Label>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                      )}

                      {/* Settings cog for MA parameters in compact view - right-aligned */}
                      {isMA && compactView && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-4 w-4 p-0 hover:bg-accent flex-shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Settings className="h-2.5 w-2.5 text-muted-foreground" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-3" align="end" onClick={(e) => e.stopPropagation()}>
                            <div className="space-y-2">
                              <p className="text-xs font-medium">Display Settings</p>

                              {/* Display Options for MA parameters */}
                              <div className="space-y-1.5 border-t pt-2">
                                <div className="flex items-center gap-2">
                                  <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                                  <span className="text-xs font-medium">Display Options</span>
                                </div>
                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-2">
                                    <Checkbox
                                      id={`ma-hide-units-${parameter}`}
                                      checked={hideUnits}
                                      onCheckedChange={(checked) => setHideUnits(checked as boolean)}
                                      className="h-3 w-3"
                                    />
                                    <Label htmlFor={`ma-hide-units-${parameter}`} className="text-xs cursor-pointer">
                                      Hide units (DPM, Clicks, etc.)
                                    </Label>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Checkbox
                                      id={`ma-hide-dates-${parameter}`}
                                      checked={hideDates}
                                      onCheckedChange={(checked) => setHideDates(checked as boolean)}
                                      className="h-3 w-3"
                                    />
                                    <Label htmlFor={`ma-hide-dates-${parameter}`} className="text-xs cursor-pointer">
                                      Hide dates [2406_2407]
                                    </Label>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Checkbox
                                      id={`ma-hide-stations-${parameter}`}
                                      checked={hideStations}
                                      onCheckedChange={(checked) => setHideStations(checked as boolean)}
                                      className="h-3 w-3"
                                    />
                                    <Label htmlFor={`ma-hide-stations-${parameter}`} className="text-xs cursor-pointer">
                                      Hide stations [C_S, F_L, etc.]
                                    </Label>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Checkbox
                                      id={`ma-hide-parameter-name-${parameter}`}
                                      checked={hideParameterName}
                                      onCheckedChange={(checked) => setHideParameterName(checked as boolean)}
                                      className="h-3 w-3"
                                    />
                                    <Label htmlFor={`ma-hide-parameter-name-${parameter}`} className="text-xs cursor-pointer">
                                      Hide parameter name (Dolphin, etc.)
                                    </Label>
                                  </div>

                                  {/* Custom parameter name input for MA */}
                                  <div className="space-y-1.5 pt-2 border-t">
                                    <Label htmlFor={`ma-custom-name-${parameter}`} className="text-xs font-medium">
                                      Custom Display Name
                                    </Label>
                                    <div className="flex gap-1.5">
                                      <Input
                                        id={`ma-custom-name-${parameter}`}
                                        type="text"
                                        placeholder={formatParameterName(displayName)}
                                        value={customParameterNames[displayName] || ''}
                                        onChange={(e) => {
                                          setCustomParameterNames(prev => ({
                                            ...prev,
                                            [displayName]: e.target.value
                                          }));
                                        }}
                                        className="h-7 text-xs"
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                      {customParameterNames[displayName] && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 px-2 text-xs"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setCustomParameterNames(prev => {
                                              const updated = { ...prev };
                                              delete updated[displayName];
                                              return updated;
                                            });
                                          }}
                                          title="Reset to default"
                                        >
                                          Reset
                                        </Button>
                                      )}
                                    </div>
                                    <p className="text-[0.65rem] text-muted-foreground">
                                      Leave empty to use auto-formatted name
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                    </div>
                  </div>
                );
              })})()}
            </div>
            )}
          </div>
          )}
        </div>
      )}

      {/* Date Format Preview Dialog */}
      <Dialog open={showDateFormatDialog} onOpenChange={setShowDateFormatDialog}>
        <DialogContent className="max-w-2xl z-[9999]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Confirm Date Format Change
            </DialogTitle>
            <DialogDescription>
              You are about to change the date format to <strong>{pendingDateFormat}</strong>.
              This will reparse the file and swap the month and day values. Please review the changes below:
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="text-sm font-medium">Preview (first 5 timestamps):</div>
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-12">#</TableHead>
                    <TableHead className="text-xs">Current</TableHead>
                    <TableHead className="text-xs">→</TableHead>
                    <TableHead className="text-xs">After Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingDateFormat && generatePreviewTimestamps(pendingDateFormat).map((preview, idx) => (
                    <TableRow key={idx} className={preview.changed ? 'bg-amber-50' : ''}>
                      <TableCell className="text-xs">{idx + 1}</TableCell>
                      <TableCell className="text-xs font-mono">{preview.current}</TableCell>
                      <TableCell className="text-xs text-center">
                        {preview.changed ? '→' : '='}
                      </TableCell>
                      <TableCell className="text-xs font-mono font-semibold">
                        {preview.preview}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="text-xs text-muted-foreground">
              <strong>Note:</strong> Changed timestamps are highlighted in amber. The file will be reparsed with the new format.
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <div className="flex gap-2 flex-1">
              <Button
                variant="secondary"
                onClick={handleSavePreviewAsCsv}
                className="flex-1"
              >
                Save as CSV
              </Button>
              {pinId && (
                <Button
                  variant="secondary"
                  onClick={handleSavePreviewToDatabase}
                  className="flex-1"
                >
                  <Database className="h-4 w-4 mr-2" />
                  Save to Database
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleCancelDateFormat}>
                Cancel
              </Button>
              <Button onClick={handleConfirmDateFormat}>
                Apply Change
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Raw CSV Viewer Dialog */}
      <Dialog open={showRawCSV} onOpenChange={setShowRawCSV}>
        <DialogContent className="max-w-4xl max-h-[80vh] z-[9999]">
          <DialogHeader>
            <DialogTitle>Original CSV File</DialogTitle>
            <DialogDescription>
              This is the raw CSV file as stored. Use this to verify the date format and data structure.
            </DialogDescription>
          </DialogHeader>

          <div className="h-[60vh] overflow-auto border rounded-md bg-muted/20 p-3">
            <pre className="text-xs font-mono whitespace-pre">
              {rawCSVContent}
            </pre>
          </div>

          <DialogFooter className="flex gap-2">
            <Button variant="secondary" onClick={handleDetectFormat}>
              Detect Time Format
            </Button>
            <Button onClick={() => setShowRawCSV(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Time Format Detection Dialog */}
      <Dialog open={showFormatDetection} onOpenChange={setShowFormatDetection}>
        <DialogContent className="max-w-md z-[10000]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Time Format Detection
            </DialogTitle>
            <DialogDescription>
              The time format has been detected. You can change it to a different format if needed.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Detected Format:</Label>
              <div className="p-3 bg-primary/10 border border-primary/20 rounded-md">
                <p className="text-sm font-semibold text-primary">{detectedFormat}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="format-select" className="text-sm font-medium">
                Change To:
              </Label>
              <Select value={selectedFormat} onValueChange={setSelectedFormat}>
                <SelectTrigger id="format-select" className="w-full">
                  <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent className="z-[10001]" position="popper" sideOffset={4}>
                  <SelectItem value="DD/MM/YYYY HH:mm">DD/MM/YYYY HH:mm</SelectItem>
                  <SelectItem value="MM/DD/YYYY HH:mm">MM/DD/YYYY HH:mm</SelectItem>
                  <SelectItem value="YYYY-MM-DD HH:mm">YYYY-MM-DD HH:mm</SelectItem>
                  <SelectItem value="YYYY/MM/DD HH:mm">YYYY/MM/DD HH:mm</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {selectedFormat !== detectedFormat && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  <strong>Note:</strong> This will convert all time values in the CSV from <strong>{detectedFormat}</strong> to <strong>{selectedFormat}</strong>.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFormatDetection(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmFormatChange}
              disabled={selectedFormat === detectedFormat}
            >
              {selectedFormat === detectedFormat ? 'No Change' : 'Confirm & Preview'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modified CSV Preview Dialog */}
      <Dialog open={showModifiedCSV} onOpenChange={setShowModifiedCSV}>
        <DialogContent className="max-w-4xl max-h-[80vh] z-[10000]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Modified CSV File
              <span className="text-xs font-normal px-2 py-1 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-100 rounded">
                MODIFIED
              </span>
            </DialogTitle>
            <DialogDescription>
              Preview of the modified CSV with converted time format. Review the changes before saving.
            </DialogDescription>
          </DialogHeader>

          <div className="h-[60vh] overflow-auto border rounded-md bg-amber-50/30 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 p-3">
            <pre className="text-xs font-mono whitespace-pre">
              {modifiedCSVContent}
            </pre>
          </div>

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setShowModifiedCSV(false)}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={handleDownloadModifiedCSV} data-testid="export-csv-button">
              Download CSV
            </Button>
            {pinId && (
              <Button onClick={handleSaveModifiedCSV} className="bg-primary">
                <Database className="h-4 w-4 mr-2" />
                Save to Database (MOD_)
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Y-Axis Range Dialog */}
      <Dialog open={showYAxisRangeDialog} onOpenChange={setShowYAxisRangeDialog}>
        <DialogContent className="max-w-md z-[9999]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              Set Y-Axis Range
            </DialogTitle>
            <DialogDescription>
              Customize the Y-axis range for <strong>{yAxisRangeParameter}</strong>.
              Leave blank for automatic scaling.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="yaxis-min" className="text-sm font-medium">
                Minimum Value
              </Label>
              <Input
                id="yaxis-min"
                type="number"
                step="any"
                placeholder="Auto"
                value={yAxisRangeMin}
                onChange={(e) => setYAxisRangeMin(e.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank for automatic minimum
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="yaxis-max" className="text-sm font-medium">
                Maximum Value
              </Label>
              <Input
                id="yaxis-max"
                type="number"
                step="any"
                placeholder="Auto"
                value={yAxisRangeMax}
                onChange={(e) => setYAxisRangeMax(e.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank for automatic maximum
              </p>
            </div>

            {yAxisRangeParameter && parameterStates[yAxisRangeParameter]?.yAxisRange && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-md">
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  <strong>Current settings:</strong><br />
                  Min: {parameterStates[yAxisRangeParameter].yAxisRange?.min ?? 'Auto'}<br />
                  Max: {parameterStates[yAxisRangeParameter].yAxisRange?.max ?? 'Auto'}
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (yAxisRangeParameter) {
                  updateYAxisRange(yAxisRangeParameter, undefined, undefined);
                }
                setShowYAxisRangeDialog(false);
              }}
            >
              Reset to Auto
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowYAxisRangeDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (yAxisRangeParameter) {
                  const min = yAxisRangeMin ? parseFloat(yAxisRangeMin) : undefined;
                  const max = yAxisRangeMax ? parseFloat(yAxisRangeMax) : undefined;
                  updateYAxisRange(yAxisRangeParameter, min, max);
                }
                setShowYAxisRangeDialog(false);
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Raw CSV Viewer for editing unrecognized species */}
      {selectedFileForRaw && (
        <RawCsvViewer
          fileId={selectedFileForRaw.id}
          fileName={selectedFileForRaw.name}
          isOpen={showRawViewer}
          onClose={() => {
            setShowRawViewer(false);
            setSelectedFileForRaw(null);
          }}
        />
      )}

    </div>
  );
}

