"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BarChart3, TableIcon, Settings, ChevronLeft, ChevronRight, BookOpen } from "lucide-react";
import { MethodologyModal } from "@/components/methodology";

// Common names for chemical parameters (used for tooltips)
const PARAMETER_COMMON_NAMES: Record<string, string> = {
  // Carbon and Nitrogen
  'C (% m/m)': 'Carbon (percent by mass)',
  'N (%)': 'Nitrogen (percent)',
  'C/N ratio': 'Carbon to Nitrogen Ratio',
  // Heavy metals and trace elements (mg/kg = milligrams per kilogram)
  'As (mg/kg)': 'Arsenic (milligrams per kilogram)',
  'Cd (mg/kg)': 'Cadmium (milligrams per kilogram)',
  'Hg (mg/kg)': 'Mercury (milligrams per kilogram)',
  'Pb (mg/kg)': 'Lead (milligrams per kilogram)',
  'Cr (mg/kg)': 'Chromium (milligrams per kilogram)',
  'Ni (mg/kg)': 'Nickel (milligrams per kilogram)',
  'V (mg/kg)': 'Vanadium (milligrams per kilogram)',
  'Sn (mg/kg)': 'Tin (milligrams per kilogram)',
  'Sb (mg/kg)': 'Antimony (milligrams per kilogram)',
  'Zn (mg/kg)': 'Zinc (milligrams per kilogram)',
  'Cu (mg/kg)': 'Copper (milligrams per kilogram)',
  'Fe (mg/kg)': 'Iron (milligrams per kilogram)',
  'Mn (mg/kg)': 'Manganese (milligrams per kilogram)',
  'Co (mg/kg)': 'Cobalt (milligrams per kilogram)',
  'Se (mg/kg)': 'Selenium (milligrams per kilogram)',
  'Mo (mg/kg)': 'Molybdenum (milligrams per kilogram)',
  'B (mg/kg)': 'Boron (milligrams per kilogram)',
  'Mg (mg/kg)': 'Magnesium (milligrams per kilogram)',
  'Ca (mg/kg)': 'Calcium (milligrams per kilogram)',
  'K (mg/kg)': 'Potassium (milligrams per kilogram)',
  // Macronutrients (percent or mg/100g)
  'Na (%)': 'Sodium (percent)',
  'P (mg/100g)': 'Phosphorus (milligrams per 100 grams)',
  'Na_alt (mg/100g)': 'Sodium - alternate measure (milligrams per 100 grams)',
  // Nutritional composition (g/100g = grams per 100 grams)
  'Protein (g/100g)': 'Protein (grams per 100 grams)',
  'Fat (g/100g)': 'Fat (grams per 100 grams)',
  'Carbs (g/100g)': 'Carbohydrates (grams per 100 grams)',
  'Fiber (g/100g)': 'Dietary Fiber (grams per 100 grams)',
  'Sugars (g/100g)': 'Sugars (grams per 100 grams)',
  'Ash (g/100g)': 'Ash/Mineral Content (grams per 100 grams)',
  'Moisture (g/100g)': 'Moisture/Water Content (grams per 100 grams)',
  'Saturates (g/100g)': 'Saturated Fats (grams per 100 grams)',
  'Monounsaturates (g/100g)': 'Monounsaturated Fats (grams per 100 grams)',
  'Polyunsaturates (g/100g)': 'Polyunsaturated Fats (grams per 100 grams)',
  // Energy values
  'Energy (kcal/100g)': 'Energy (kilocalories per 100 grams)',
  'Energy (kJ/100g)': 'Energy (kilojoules per 100 grams)',
  // Water quality parameters - with units
  'pH': 'pH (acidity/alkalinity scale 0-14)',
  'Salinity (ppt)': 'Salinity (parts per thousand)',
  'Sal (ppt)': 'Salinity (parts per thousand)',
  'DO (mg/L)': 'Dissolved Oxygen (milligrams per liter)',
  'Temp (°C)': 'Temperature (degrees Celsius)',
  // Water chemistry - Nutrients with units
  'PO4 (mg/L)': 'Phosphate (milligrams per liter)',
  'NO3 (mg/L)': 'Nitrate (milligrams per liter)',
  'NO2 (mg/L)': 'Nitrite (milligrams per liter)',
  'NH4 (mg/L)': 'Ammonium (milligrams per liter)',
  'SiO4 (mg/L)': 'Silicate (milligrams per liter)',
  // Water quality parameters - simple names (no units in column header)
  'Temp': 'Temperature (water temperature)',
  'Temperature': 'Temperature (water temperature)',
  'Salinity': 'Salinity (dissolved salt concentration)',
  'DO': 'Dissolved Oxygen (oxygen available for aquatic life)',
  'Turbidity': 'Turbidity (water clarity/cloudiness)',
  'Conductivity': 'Electrical Conductivity (ability to conduct electricity)',
  'TDS': 'Total Dissolved Solids (dissolved minerals and salts)',
  'Ammonia': 'Ammonia (nitrogen compound, toxic at high levels)',
  'Nitrate': 'Nitrate (plant nutrient, excess causes algae growth)',
  'Nitrite': 'Nitrite (intermediate nitrogen form, toxic to fish)',
  'Phosphate': 'Phosphate (plant nutrient, excess causes algae growth)',
  'Silicate': 'Silicate (diatom nutrient)',
  'Chlorophyll': 'Chlorophyll (algae/phytoplankton indicator)',
  'Chlorophyll-a': 'Chlorophyll-a (primary photosynthetic pigment)',
  'ORP': 'Oxidation-Reduction Potential (water quality indicator)',
  // Crop measurements
  'length (cm)': 'Length (centimeters)',
  'width (cm)': 'Width (centimeters)',
  'Fouling': 'Fouling (surface coverage by organisms)',
  'Fouling (% area)': 'Fouling (percent of surface area covered)',
  'fouling': 'Fouling (surface coverage by organisms)',
  'Yield': 'Yield (kilograms of biomass per meter of rope)',
  'yield': 'Yield (kilograms of biomass per meter of rope)',
  'Yield (kg/m)': 'Yield (kilograms of biomass per meter of rope)',
  'yield (kg/m)': 'Yield (kilograms of biomass per meter of rope)',
  'Yield (kg)': 'Yield (kilograms of biomass per meter of rope)',
  'yield (kg)': 'Yield (kilograms of biomass per meter of rope)',
  'Fertility': 'Fertility (percent of area with sorus)',
  'fertility': 'Fertility (percent of area with sorus)',
  'Fertility (%)': 'Fertility (percent of area with sorus)',
  'fertility (%)': 'Fertility (percent of area with sorus)',
  'Fertility (% area)': 'Fertility (percent of area with sorus)',
  'fertility (% area)': 'Fertility (percent of area with sorus)',
  'Fertility (% blade sorus)': 'Fertility (percent of area with sorus)',
};
import type { ParsedDataPoint } from './csvParser';
import { groupBySampleAndDate, type SpotSampleGroup } from '@/lib/statistical-utils';
import { ColumnChartWithErrorBars } from './ColumnChartWithErrorBars';
import { WhiskerPlot } from './WhiskerPlot';
import { StackedCredibilityChart } from './StackedCredibilityChart';
import { StackedTaxonomyChart } from './StackedTaxonomyChart';
import { format, parseISO } from 'date-fns';
import { DEFAULT_STYLE_RULES, STYLE_RULES_VERSION, type StyleRule, type StyleProperties, StylingRulesDialog } from './StylingRulesDialog';
import { extractProjectPrefix, abbreviateStationLabel } from '@/lib/edna-utils';
import { isCredFile, processCredibilityFile } from '@/lib/edna-cred-processor';
import { isTaxonomyFile, processTaxonomyFile } from '@/lib/edna-taxonomy-processor';
import { isEdnaMetaFile, processEdnaMetaFile } from '@/lib/edna-meta-processor';

interface PinChartDisplaySpotSampleProps {
  data: ParsedDataPoint[];
  timeColumn: string | null;
  detectedSampleIdColumn: string | null;
  headers: string[];
  fileName?: string;
  diagnosticLogs?: string[];
  // Metadata for header display
  pinLabel?: string;
  startDate?: Date;
  endDate?: Date;
  fileCategories?: string[];
  // Methodology modal props
  projectId?: string;
  tileName?: 'SubCam' | 'GrowProbe' | 'FPOD' | 'Water and Crop Samples' | 'eDNA';
}

// Default color palette for sample IDs
const DEFAULT_COLOR_PALETTE = [
  '#3b82f6', // Blue
  '#ef4444', // Red
  '#10b981', // Green
  '#f59e0b', // Amber
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#f97316', // Orange
  '#14b8a6', // Teal
  '#f43f5e', // Rose
];

/**
 * Spot-Sample Plotting Component
 * Handles discrete sampling data (CROP, CHEM, WQ, EDNA files)
 * Displays column charts with error bars or whisker plots
 */
export function PinChartDisplaySpotSample({
  data,
  timeColumn,
  detectedSampleIdColumn,
  headers,
  fileName,
  diagnosticLogs,
  pinLabel,
  startDate,
  endDate,
  fileCategories,
  projectId,
  tileName
}: PinChartDisplaySpotSampleProps) {

  // IMMEDIATE DIAGNOSTIC LOGGING - runs before any processing
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  SPOT-SAMPLE COMPONENT ENTRY                                  ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('[SPOT-SAMPLE-ENTRY] fileName:', fileName);
  console.log('[SPOT-SAMPLE-ENTRY] data exists:', !!data);
  console.log('[SPOT-SAMPLE-ENTRY] data length:', data?.length);
  console.log('[SPOT-SAMPLE-ENTRY] data sample:', data?.slice(0, 2));
  console.log('[SPOT-SAMPLE-ENTRY] First row full structure:', data?.[0]);
  console.log('[SPOT-SAMPLE-ENTRY] First row Date value:', data?.[0]?.['Date'], 'Type:', typeof data?.[0]?.['Date']);
  console.log('[SPOT-SAMPLE-ENTRY] First row Sample value:', data?.[0]?.['Sample'], 'Type:', typeof data?.[0]?.['Sample']);
  console.log('[SPOT-SAMPLE-ENTRY] First row C (% m/m) value:', data?.[0]?.['C (% m/m)'], 'Type:', typeof data?.[0]?.['C (% m/m)']);
  console.log('[SPOT-SAMPLE-ENTRY] timeColumn:', timeColumn);
  console.log('[SPOT-SAMPLE-ENTRY] detectedSampleIdColumn:', detectedSampleIdColumn);
  console.log('[SPOT-SAMPLE-ENTRY] headers exists:', !!headers);
  console.log('[SPOT-SAMPLE-ENTRY] headers:', headers);
  console.log('═══════════════════════════════════════════════════════════════');

  // State
  const [showTable, setShowTable] = useState(false);

  // Default to whisker chart for _indiv files, column chart for others
  const defaultChartType = fileName?.toLowerCase().endsWith('_indiv.csv') ? 'whisker' : 'column';
  const [chartType, setChartType] = useState<'column' | 'whisker'>(defaultChartType);

  const [selectedSampleIdColumn, setSelectedSampleIdColumn] = useState<string | null>(
    detectedSampleIdColumn
  );
  const [showStylingDialog, setShowStylingDialog] = useState(false);
  const [showMethodologyModal, setShowMethodologyModal] = useState(false);

  // Column chart color mode: 'unique' = different color per sample, 'single' = same color for all
  // Initialize with defaults, will be updated by useEffect when spotSampleStyles is available
  const [columnColorMode, setColumnColorMode] = useState<'unique' | 'single'>('unique');
  const [singleColumnColor, setSingleColumnColor] = useState('#3b82f6');

  // Parameter visibility state - default to showing first 2 parameters
  const [visibleParameters, setVisibleParameters] = useState<Set<string>>(() => new Set());

  // Parameter-specific Y-axis ranges (for CHEMWQ files)
  // Initialize with empty object, will be updated by useEffect when spotSampleStyles is available
  const [parameterYAxisRanges, setParameterYAxisRanges] = useState<Record<string, { min?: number; max?: number }>>({});
  const [yAxisDialogOpen, setYAxisDialogOpen] = useState<string | null>(null); // Track which parameter dialog is open
  const [tempYAxisMin, setTempYAxisMin] = useState<string>('');
  const [tempYAxisMax, setTempYAxisMax] = useState<string>('');

  // Data filtering state (for _indiv files)
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [selectedStations, setSelectedStations] = useState<string[]>([]);
  const [selectedSampleIds, setSelectedSampleIds] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<'dates' | 'stations'>('dates');

  // Data aggregation state (for _indiv files)
  const [aggregationMode, setAggregationMode] = useState<'detailed' | 'by-date'>('detailed');

  // Collapsed state for the Parameters sidebar
  const [isParametersSidebarCollapsed, setIsParametersSidebarCollapsed] = useState(false);

  // Load style rules from localStorage (with versioning)
  const [styleRules, setStyleRules] = useState<StyleRule[]>(() => {
    if (typeof window === 'undefined') return DEFAULT_STYLE_RULES;

    try {
      const storedRules = localStorage.getItem('styleRules');
      const storedVersion = localStorage.getItem('styleRulesVersion');

      if (storedRules && storedVersion === String(STYLE_RULES_VERSION)) {
        return JSON.parse(storedRules);
      } else {
        // Version mismatch or no stored version - use defaults
        localStorage.setItem('styleRules', JSON.stringify(DEFAULT_STYLE_RULES));
        localStorage.setItem('styleRulesVersion', String(STYLE_RULES_VERSION));
        return DEFAULT_STYLE_RULES;
      }
    } catch (error) {
      console.error('[SPOT-SAMPLE] Failed to load style rules from localStorage:', error);
      return DEFAULT_STYLE_RULES;
    }
  });

  // Find matching style rule based on fileName
  const matchingStyleRule = useMemo(() => {
    if (!fileName) return null;

    // Find first enabled rule that matches the filename suffix
    const rule = styleRules.find(rule =>
      rule.enabled && fileName.toLowerCase().endsWith(rule.suffix.toLowerCase())
    );

    if (rule) {
      console.log('[SPOT-SAMPLE] Found matching style rule:', rule.styleName, 'for file:', fileName);
      console.log('[SPOT-SAMPLE] Spot sample styles:', rule.properties.spotSample);
    } else {
      console.log('[SPOT-SAMPLE] No matching style rule found for file:', fileName);
    }

    return rule;
  }, [fileName, styleRules]);

  // Get matching suffix for style updates
  const matchingSuffix = matchingStyleRule?.suffix;

  // Extract spot sample styles from matching rule (needs to be after matchingStyleRule)
  const spotSampleStyles = React.useMemo(() => {
    return matchingStyleRule?.properties.spotSample;
  }, [matchingStyleRule]);

  // Update color settings when style rules change
  React.useEffect(() => {
    if (spotSampleStyles?.columnColorMode) {
      setColumnColorMode(spotSampleStyles.columnColorMode);
    }
    if (spotSampleStyles?.singleColumnColor) {
      setSingleColumnColor(spotSampleStyles.singleColumnColor);
    }
    if (spotSampleStyles?.parameterYAxisRanges) {
      setParameterYAxisRanges(spotSampleStyles.parameterYAxisRanges);
    }
  }, [spotSampleStyles]);

  // Detect and process _Cred files
  const isCredibilityFile = useMemo(() => {
    const result = fileName ? isCredFile(fileName) : false;
    console.log('[SPOT-SAMPLE] 🔍 Credibility file detection:', {
      fileName,
      isCredFile: result
    });
    return result;
  }, [fileName]);

  const credibilityData = useMemo(() => {
    if (!isCredibilityFile) {
      console.log('[SPOT-SAMPLE] ⏭️  Not a credibility file, skipping _Cred processing');
      return null;
    }

    console.log('[SPOT-SAMPLE] 📊 Processing _Cred file:', fileName);
    console.log('[SPOT-SAMPLE]   - Data rows:', data.length);
    console.log('[SPOT-SAMPLE]   - Headers:', headers);
    console.log('[SPOT-SAMPLE]   - Sample first row:', data[0]);

    const { aggregated, skippedCount } = processCredibilityFile(data, headers);

    console.log('[SPOT-SAMPLE] ✅ _Cred processing complete:', {
      aggregated,
      skippedCount,
      totalUniqueSpecies: aggregated.totalUniqueSpecies
    });

    if (skippedCount > 0) {
      console.warn(`[SPOT-SAMPLE] ⚠️  Skipped ${skippedCount} invalid rows in _Cred file`);
    }

    return aggregated;
  }, [isCredibilityFile, data, headers, fileName]);

  // Detect and process _taxo files
  const isTaxonomyFileDetected = useMemo(() => {
    const result = fileName ? isTaxonomyFile(fileName) : false;
    console.log('[SPOT-SAMPLE] 🔍 Taxonomy file detection:', {
      fileName,
      isTaxonomyFile: result
    });
    return result;
  }, [fileName]);

  const taxonomyData = useMemo(() => {
    if (!isTaxonomyFileDetected) {
      console.log('[SPOT-SAMPLE] ⏭️  Not a taxonomy file, skipping _taxo processing');
      return null;
    }

    console.log('[SPOT-SAMPLE] 📊 Processing _taxo file:', fileName);
    console.log('[SPOT-SAMPLE]   - Data rows:', data.length);
    console.log('[SPOT-SAMPLE]   - Headers:', headers);
    console.log('[SPOT-SAMPLE]   - Sample first row:', data[0]);

    const { aggregated, skippedCount } = processTaxonomyFile(data, headers);

    console.log('[SPOT-SAMPLE] ✅ _taxo processing complete:', {
      aggregated,
      skippedCount,
      totalSamples: aggregated.samples.length,
      totalPhyla: aggregated.allPhyla.length
    });

    if (skippedCount > 0) {
      console.warn(`[SPOT-SAMPLE] ⚠️  Skipped ${skippedCount} invalid rows in _taxo file`);
    }

    return aggregated;
  }, [isTaxonomyFileDetected, data, headers, fileName]);

  // Styling dialog handlers
  const handleStyleRuleToggle = (suffix: string, enabled: boolean) => {
    const updatedRules = styleRules.map(rule =>
      rule.suffix === suffix ? { ...rule, enabled } : rule
    );
    setStyleRules(updatedRules);
    localStorage.setItem('styleRules', JSON.stringify(updatedRules));
    console.log('[SPOT-SAMPLE] Style rule toggled:', suffix, enabled);
  };

  const handleStyleRuleUpdate = (suffix: string, properties: Partial<StyleProperties>) => {
    const updatedRules = styleRules.map(rule => {
      if (rule.suffix !== suffix) return rule;

      // Deep merge spotSample properties if they exist
      const updatedProperties = { ...rule.properties };
      if (properties.spotSample && rule.properties.spotSample) {
        updatedProperties.spotSample = {
          ...rule.properties.spotSample,
          ...properties.spotSample
        };
      } else if (properties.spotSample) {
        updatedProperties.spotSample = properties.spotSample;
      }

      // Merge other top-level properties
      Object.keys(properties).forEach(key => {
        if (key !== 'spotSample') {
          updatedProperties[key as keyof StyleProperties] = properties[key as keyof StyleProperties] as any;
        }
      });

      return { ...rule, properties: updatedProperties };
    });

    setStyleRules(updatedRules);
    localStorage.setItem('styleRules', JSON.stringify(updatedRules));
    console.log('[SPOT-SAMPLE] Style rule updated:', suffix, properties);
  };

  // Color mode change handler - updates state and persists to style rules
  const handleColumnColorModeChange = (mode: 'unique' | 'single') => {
    setColumnColorMode(mode);

    // Find matching style rule and update it
    if (matchingSuffix) {
      handleStyleRuleUpdate(matchingSuffix, {
        spotSample: { columnColorMode: mode }
      });
    }
    console.log('[SPOT-SAMPLE] Column color mode changed:', mode);
  };

  // Single column color change handler - updates state and persists to style rules
  const handleSingleColumnColorChange = (color: string) => {
    setSingleColumnColor(color);

    // Find matching style rule and update it
    if (matchingSuffix) {
      handleStyleRuleUpdate(matchingSuffix, {
        spotSample: { singleColumnColor: color }
      });
    }
    console.log('[SPOT-SAMPLE] Single column color changed:', color);
  };

  // Parameter Y-axis range change handler - updates state and persists to style rules
  const handleParameterYAxisRangeChange = (parameter: string, min?: number, max?: number) => {
    const updatedRanges = {
      ...parameterYAxisRanges,
      [parameter]: { min, max }
    };
    setParameterYAxisRanges(updatedRanges);

    // Find matching style rule and update it
    if (matchingSuffix) {
      handleStyleRuleUpdate(matchingSuffix, {
        spotSample: { parameterYAxisRanges: updatedRanges }
      });
    }
    console.log('[SPOT-SAMPLE] Parameter Y-axis range changed:', parameter, { min, max });
  };

  // Sample color change handler - updates custom sample colors in style rules
  const handleSampleColorChange = (sampleId: string, color: string) => {
    // Get current custom colors from style rules
    const currentCustomColors = spotSampleStyles?.sampleColors || {};
    const updatedColors = {
      ...currentCustomColors,
      [sampleId]: color
    };

    // Find matching style rule and update it
    if (matchingSuffix) {
      handleStyleRuleUpdate(matchingSuffix, {
        spotSample: { sampleColors: updatedColors }
      });
    }
    console.log('[SPOT-SAMPLE] Sample color changed:', sampleId, color);
  };

  // Get actual sample ID column (user selection or detected)
  const sampleIdColumn = selectedSampleIdColumn || detectedSampleIdColumn;

  // Detect Station ID column for _indiv files
  // The "station ID" column contains the full station identifier (e.g., "1-NE-3", "2-SW-1")
  // This is what we want to display in x-axis labels
  const stationIdColumn = useMemo(() => {
    console.log('[SPOT-SAMPLE] Searching for Station ID column in headers:', headers);

    // Look for "station ID" column (case insensitive, flexible matching)
    const stationCol = headers.find(h => {
      const normalized = h.toLowerCase().replace(/[\s_-]/g, '');
      return normalized === 'stationid';
    });

    if (stationCol) {
      console.log('[SPOT-SAMPLE] ✅ Detected Station ID column:', stationCol);
    } else {
      console.log('[SPOT-SAMPLE] ❌ No Station ID column found');
    }
    return stationCol || null;
  }, [headers]);

  // Get parameter columns (exclude time and sample ID columns)
  const parameterColumns = useMemo(() => {
    const filtered = headers.filter(h =>
      h !== timeColumn &&
      h !== sampleIdColumn &&
      h !== stationIdColumn &&
      h.toLowerCase() !== 'time' &&
      h.toLowerCase() !== 'sample' &&
      h.toLowerCase() !== 'sample id' &&
      h.toLowerCase() !== 'subset' &&
      h.toLowerCase() !== 'replicate' &&
      h.toLowerCase().replace(/[\s_-]/g, '') !== 'stationid' &&
      h.toLowerCase().replace(/[\s_-]/g, '') !== 'subsetid' &&
      h.toLowerCase().replace(/[\s_-]/g, '') !== 'bladeid' &&
      h.toLowerCase().replace(/[\s_-]/g, '') !== 'imageid' &&
      // Exclude haplotype taxonomy columns (text fields, not numeric data)
      h.toLowerCase() !== 'kingdom' &&
      h.toLowerCase() !== 'phylum' &&
      h.toLowerCase() !== 'class' &&
      h.toLowerCase() !== 'order' &&
      h.toLowerCase() !== 'family' &&
      h.toLowerCase() !== 'genus' &&
      h.toLowerCase() !== 'species' &&
      h.toLowerCase() !== 'redlist_status' &&
      h.toLowerCase() !== 'score' &&
      h.toLowerCase() !== 'nns'
    );

    // console.log('[SPOT-SAMPLE] ═══════════════════════════════════════');
    // console.log('[SPOT-SAMPLE] Header Analysis:');
    // console.log('[SPOT-SAMPLE] All headers:', headers);
    // console.log('[SPOT-SAMPLE] Time column:', timeColumn);
    // console.log('[SPOT-SAMPLE] Sample ID column:', sampleIdColumn);
    // console.log('[SPOT-SAMPLE] Station ID column:', stationIdColumn);
    // console.log('[SPOT-SAMPLE] Filtered parameter columns:', filtered);

    // Sort parameters according to parameterOrder if defined
    let sortedParams = filtered;
    if (spotSampleStyles?.parameterOrder && spotSampleStyles.parameterOrder.length > 0) {
      console.log('[SPOT-SAMPLE] Applying parameter order:', spotSampleStyles.parameterOrder);

      // For files with parameterOrder defined, ONLY show parameters in the order list
      // This filters out metadata columns like "station ID", "subset ID", "image ID"
      const orderMap = new Map(
        spotSampleStyles.parameterOrder.map((param, index) => [param.toLowerCase(), index])
      );

      // Only keep parameters that are in the parameterOrder list
      const orderedParams = filtered
        .filter(param => orderMap.has(param.toLowerCase()))
        .sort((a, b) => {
          const indexA = orderMap.get(a.toLowerCase()) ?? 999;
          const indexB = orderMap.get(b.toLowerCase()) ?? 999;
          return indexA - indexB;
        });

      // If no parameters match the order, fall back to all filtered parameters
      if (orderedParams.length > 0) {
        sortedParams = orderedParams;
        console.log('[SPOT-SAMPLE] Filtered to only ordered parameters:', sortedParams);
      } else {
        console.log('[SPOT-SAMPLE] ⚠️  No parameters matched the order list, using all filtered parameters');
        console.log('[SPOT-SAMPLE] All filtered parameters:', filtered);
      }
    }

    console.log('[SPOT-SAMPLE] ═══════════════════════════════════════');

    return sortedParams;
  }, [headers, timeColumn, sampleIdColumn, stationIdColumn, spotSampleStyles]);

  // Initialize visible parameters when parameterColumns change
  // Default count depends on file prefix
  React.useEffect(() => {
    if (parameterColumns.length > 0 && visibleParameters.size === 0) {
      // Determine default parameter count based on file prefix
      let defaultCount = 2; // Default for most files

      const fileNameUpper = fileName.toUpperCase();
      if (fileNameUpper.includes('CHEM-SW') || fileNameUpper.includes('CHEMSW')) {
        defaultCount = 7; // CHEM-SW files show first 7 parameters
        console.log('[SPOT-SAMPLE] CHEM-SW file detected, showing first 7 parameters');
      } else if (fileNameUpper.includes('CHEM-WQ') || fileNameUpper.includes('CHEMWQ')) {
        defaultCount = 4; // CHEM-WQ files show first 4 parameters
        console.log('[SPOT-SAMPLE] CHEM-WQ file detected, showing first 4 parameters');
      } else if (fileNameUpper.includes('_INDIV')) {
        defaultCount = 4; // _indiv files show first 4 parameters (length, width, fouling, yield)
        console.log('[SPOT-SAMPLE] _indiv file detected, showing first 4 parameters');
      }

      const defaultVisible = new Set(parameterColumns.slice(0, defaultCount));
      setVisibleParameters(defaultVisible);
      console.log('[SPOT-SAMPLE] Initialized visible parameters:', Array.from(defaultVisible));
    }
  }, [parameterColumns, visibleParameters.size, fileName]);

  // Group data by date + sample ID
  const groupedData = useMemo(() => {
    // Allow empty strings as valid column names (for unnamed columns)
    if (!timeColumn || sampleIdColumn === null || sampleIdColumn === undefined) {
      console.log('[SPOT-SAMPLE] ❌ Missing required columns:', { timeColumn, sampleIdColumn });
      return [];
    }

    // console.log('[SPOT-SAMPLE] ═══════════════════════════════════════');
    // console.log('[SPOT-SAMPLE] Starting data grouping...');
    // console.log('[SPOT-SAMPLE] Total data rows:', data.length);
    // console.log('[SPOT-SAMPLE] Sample first 3 rows:', data.slice(0, 3));
    // console.log('[SPOT-SAMPLE] Time column:', timeColumn);
    // console.log('[SPOT-SAMPLE] Sample ID column:', sampleIdColumn);
    // console.log('[SPOT-SAMPLE] Station ID column:', stationIdColumn || 'none');
    // console.log('[SPOT-SAMPLE] Parameters to process:', parameterColumns);
    // console.log('[SPOT-SAMPLE] ═══════════════════════════════════════');

    // Detect if this is an eDNA Meta file
    const isMetaFile = fileName ? isEdnaMetaFile(fileName) : false;
    console.log('[SPOT-SAMPLE] Is eDNA Meta file:', isMetaFile);

    let result: SpotSampleGroup[];

    if (isMetaFile) {
      // Use specialized eDNA Meta processor (handles wide format with one row per sample)
      console.log('[SPOT-SAMPLE] Using specialized eDNA Meta processor');
      result = processEdnaMetaFile(data, sampleIdColumn, fileName || '');
    } else {
      // Use standard grouping for long format data (multiple rows per sample)
      // Only pass stationIdColumn as blade ID if it's different from sample ID column
      // This prevents duplicate labels like "Control-S Control-S" in CHEMWQ files
      const bladeIdColumn = (stationIdColumn && stationIdColumn !== sampleIdColumn) ? stationIdColumn : undefined;
      console.log('[SPOT-SAMPLE] Blade ID column (for grouping):', bladeIdColumn || 'none (same as sample ID)');
      console.log('[SPOT-SAMPLE] Using standard groupBySampleAndDate');

      result = groupBySampleAndDate(data, timeColumn, sampleIdColumn, parameterColumns, bladeIdColumn, false);
    }

    // console.log('[SPOT-SAMPLE] ═══════════════════════════════════════');
    // console.log('[SPOT-SAMPLE] Grouping complete!');
    // console.log('[SPOT-SAMPLE] Result groups:', result.length);
    // console.log('[SPOT-SAMPLE] Sample first 3 groups:', result.slice(0, 3));
    // console.log('[SPOT-SAMPLE] ═══════════════════════════════════════');

    return result;
  }, [data, timeColumn, sampleIdColumn, parameterColumns, stationIdColumn, fileName]);

  // Post-process for eDNA files: abbreviate station labels
  // NOTE: Skip this for Meta files as processEdnaMetaFile() already handles abbreviation
  const processedGroupedData = useMemo(() => {
    const isMetaFile = fileName ? isEdnaMetaFile(fileName) : false;

    // Skip post-processing for Meta files (already handled by processEdnaMetaFile)
    if (!fileName || isMetaFile) {
      return groupedData;
    }

    console.log('[SPOT-SAMPLE] ═══════════════════════════════════════');
    console.log('[SPOT-SAMPLE] eDNA file detected (non-Meta), abbreviating station labels');

    const projectPrefix = extractProjectPrefix(fileName);
    console.log('[SPOT-SAMPLE] Project prefix:', projectPrefix);

    const abbreviated = groupedData.map(group => {
      const originalLabel = group.xAxisLabel;

      // Extract the station part from the x-axis label
      // Format is typically: "DD/MM/YY [Station_Name]" or just "Station_Name"
      const match = originalLabel.match(/\[(.*?)\]/) || originalLabel.match(/^(.*)$/);
      const stationPart = match ? match[1] : originalLabel;

      const abbreviatedStation = abbreviateStationLabel(stationPart, projectPrefix);

      // Reconstruct the label with abbreviated station
      let newLabel: string;
      if (originalLabel.includes('[')) {
        // Has date prefix, keep it
        const dateMatch = originalLabel.match(/^(.*?)\s*\[/);
        const datePart = dateMatch ? dateMatch[1] : '';
        newLabel = datePart ? `${datePart} [${abbreviatedStation}]` : abbreviatedStation;
      } else {
        // No date prefix, just use abbreviated station
        newLabel = abbreviatedStation;
      }

      console.log('[SPOT-SAMPLE] Label transform:', originalLabel, '→', newLabel);

      return {
        ...group,
        xAxisLabel: newLabel
      };
    });

    console.log('[SPOT-SAMPLE] Abbreviation complete');
    console.log('[SPOT-SAMPLE] ═══════════════════════════════════════');

    return abbreviated;
  }, [groupedData, fileName]);

  // Extract unique dates, stations, and sample IDs for filtering (for _indiv files)
  const availableDates = useMemo(() => {
    const dates = [...new Set(processedGroupedData.map(d => d.date))];
    return dates.sort(); // Sort chronologically
  }, [processedGroupedData]);

  const availableStations = useMemo(() => {
    const stations = [...new Set(processedGroupedData.map(d => d.sampleId))];
    return stations.sort(); // Sort alphabetically
  }, [processedGroupedData]);

  const availableSampleIdsForFilter = useMemo(() => {
    const sampleIds = [...new Set(
      processedGroupedData
        .filter(d => d.bladeId) // Only include if bladeId exists
        .map(d => d.bladeId!)
    )];
    return sampleIds.sort(); // Sort alphabetically
  }, [processedGroupedData]);

  // Apply filtering to grouped data (for _indiv files)
  const filteredGroupedData = useMemo(() => {
    let filtered = processedGroupedData;

    // Apply date filter
    if (selectedDates.length > 0) {
      filtered = filtered.filter(d => selectedDates.includes(d.date));
    }

    // Apply station filter
    if (selectedStations.length > 0) {
      filtered = filtered.filter(d => selectedStations.includes(d.sampleId));
    }

    // Apply sample ID filter
    if (selectedSampleIds.length > 0) {
      filtered = filtered.filter(d => d.bladeId && selectedSampleIds.includes(d.bladeId));
    }

    console.log('[SPOT-SAMPLE] Filtering applied:', {
      original: processedGroupedData.length,
      filtered: filtered.length,
      selectedDates,
      selectedStations,
      selectedSampleIds
    });

    return filtered;
  }, [processedGroupedData, selectedDates, selectedStations, selectedSampleIds]);

  // Apply aggregation mode (for _indiv files)
  const finalGroupedData = useMemo(() => {
    if (aggregationMode === 'detailed') {
      return filteredGroupedData;
    }

    // Aggregate by date - combine all samples for each date+parameter
    const aggregated: SpotSampleGroup[] = [];
    const dateParamMap = new Map<string, number[]>();

    // Collect all values by date+parameter
    filteredGroupedData.forEach(group => {
      const key = `${group.date}|${group.parameter}`;
      const existing = dateParamMap.get(key) || [];
      dateParamMap.set(key, [...existing, ...group.values]);
    });

    // Create aggregated groups
    dateParamMap.forEach((values, key) => {
      const [date, parameter] = key.split('|');

      // Calculate statistics for aggregated data
      const sorted = values.slice().sort((a, b) => a - b);
      const count = values.length;
      const mean = values.reduce((sum, v) => sum + v, 0) / count;
      const min = sorted[0];
      const max = sorted[count - 1];
      const Q1 = sorted[Math.floor(count * 0.25)];
      const median = count % 2 === 0
        ? (sorted[Math.floor(count / 2) - 1] + sorted[Math.floor(count / 2)]) / 2
        : sorted[Math.floor(count / 2)];
      const Q3 = sorted[Math.floor(count * 0.75)];

      // Calculate standard deviation and standard error
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / count;
      const sd = Math.sqrt(variance);
      const se = sd / Math.sqrt(count);

      // Format date for display
      const dateObj = new Date(date);
      const formattedDate = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${String(dateObj.getFullYear()).slice(-2)}`;

      aggregated.push({
        date,
        sampleId: 'All Samples', // Indicate this is aggregated
        xAxisLabel: formattedDate, // Just show the date
        parameter,
        values,
        count,
        stats: {
          mean,
          sd,
          se,
          min,
          Q1,
          median,
          Q3,
          max
        }
      });
    });

    console.log('[SPOT-SAMPLE] Aggregation applied:', {
      mode: aggregationMode,
      original: filteredGroupedData.length,
      aggregated: aggregated.length
    });

    return aggregated;
  }, [filteredGroupedData, aggregationMode]);

  // Assign colors to unique sample IDs
  // Use custom colors from style rules if available, otherwise use default palette
  const sampleIdColors = useMemo(() => {
    const uniqueSampleIds = [...new Set(finalGroupedData.map(d => d.sampleId))];
    const colors: Record<string, string> = {};
    const customColors = spotSampleStyles?.sampleColors || {};

    uniqueSampleIds.forEach((id, index) => {
      // Use custom color if defined, otherwise fall back to default palette
      colors[id] = customColors[id] || DEFAULT_COLOR_PALETTE[index % DEFAULT_COLOR_PALETTE.length];
    });

    console.log('[SPOT-SAMPLE] Assigned colors:', colors);
    console.log('[SPOT-SAMPLE] Custom colors from style rules:', customColors);
    return colors;
  }, [finalGroupedData, spotSampleStyles]);

  // Get available sample ID column options (only ID-type columns, not parameter columns)
  const sampleIdColumnOptions = useMemo(() => {
    const isIndivFile = fileName?.toLowerCase().endsWith('_indiv.csv');

    // For _indiv files, only show meaningful grouping columns (Farm ID and station ID)
    if (isIndivFile) {
      const indivGroupingPatterns = ['farm', 'farmid', 'station', 'stationid'];
      const isIndivGroupingColumn = (header: string): boolean => {
        const normalized = header.toLowerCase().replace(/[\s_-]/g, '');
        return indivGroupingPatterns.some(pattern =>
          normalized === pattern || normalized.startsWith(pattern)
        );
      };
      const idColumns = headers.filter(h => h !== timeColumn && isIndivGroupingColumn(h));
      return idColumns;
    }

    // For other files, use general ID-type column detection
    const isIdColumn = (header: string): boolean => {
      const normalized = header.toLowerCase().replace(/[\s_-]/g, '');

      // Common ID column patterns
      const idPatterns = [
        'sample', 'sampleid',
        'station', 'stationid',
        'site', 'siteid',
        'farm', 'farmid',
        'location', 'locationid',
        'subset', 'subsetid',
        'blade', 'bladeid',
        'replicate', 'replicateid',
        'plot', 'plotid',
        'treatment', 'treatmentid',
        'group', 'groupid',
        'id' // Generic ID column
      ];

      return idPatterns.some(pattern =>
        normalized === pattern ||
        normalized.startsWith(pattern) ||
        normalized.endsWith('id')
      );
    };

    const idColumns = headers.filter(h => h !== timeColumn && isIdColumn(h));
    return idColumns;
  }, [headers, timeColumn, fileName]);

  // Get list of unique sample IDs for color customization
  const availableSampleIds = useMemo(() => {
    return [...new Set(finalGroupedData.map(d => d.sampleId))];
  }, [finalGroupedData]);

  // Calculate dynamic chart width for horizontal scrolling
  const uniqueDataPoints = useMemo(() => {
    return [...new Set(finalGroupedData.map(d => d.xAxisLabel))].length;
  }, [finalGroupedData]);

  // Fit chart to page width when "subset ID" is selected (fewer groups, no scrolling needed)
  const isSubsetIdSelected = sampleIdColumn?.toLowerCase().replace(/[\s_-]/g, '') === 'subsetid';
  const needsScrolling = !isSubsetIdSelected && uniqueDataPoints > 20;
  const chartWidth = needsScrolling ? uniqueDataPoints * 60 : undefined;

  // Early validation with detailed error messages
  if (!data || data.length === 0) {
    console.error('[SPOT-SAMPLE] ❌ ERROR: No data provided or empty data array');
    return (
      <div className="p-4 border border-destructive rounded-lg bg-destructive/10">
        <p className="text-sm font-semibold text-destructive mb-1">
          No Data Available
        </p>
        <p className="text-xs text-muted-foreground">
          The data array is empty or undefined. This might be a CSV parsing issue.
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Check console logs for CSV parser errors.
        </p>
      </div>
    );
  }

  if (!headers || headers.length === 0) {
    console.error('[SPOT-SAMPLE] ❌ ERROR: No headers provided');
    return (
      <div className="p-4 border border-destructive rounded-lg bg-destructive/10">
        <p className="text-sm font-semibold text-destructive mb-1">
          Missing CSV Headers
        </p>
        <p className="text-xs text-muted-foreground">
          Could not read column headers from the CSV file.
        </p>
      </div>
    );
  }

  // Special handling for _Cred files - bypass normal spot-sample requirements
  if (isCredibilityFile && credibilityData) {
    console.log('[SPOT-SAMPLE] 🎨 Rendering _Cred chart:', fileName);
    console.log('[SPOT-SAMPLE]   - Credibility data:', credibilityData);
    console.log('[SPOT-SAMPLE]   - Spot sample styles:', spotSampleStyles);
    console.log('[SPOT-SAMPLE]   - Custom title:', spotSampleStyles?.chartTitle);
    console.log('[SPOT-SAMPLE]   - Custom Y-axis:', spotSampleStyles?.yAxisLabel);
    console.log('[SPOT-SAMPLE]   - GBIF colors:', {
      trueColor: spotSampleStyles?.gbifTrueColor,
      falseColor: spotSampleStyles?.gbifFalseColor
    });

    return (
      <div className="space-y-3">
        {/* File header - location, time period, categories, and filename */}
        {(pinLabel || startDate || endDate || (fileCategories && fileCategories.length > 0) || fileName) && (
          <div className="flex flex-col gap-0.5 mb-2">
            {/* Main header: Location • Time Period (Categories) */}
            {(pinLabel || startDate || endDate || (fileCategories && fileCategories.length > 0)) && (
              <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                {/* Location */}
                {pinLabel && <span>{pinLabel}</span>}

                {/* Time Period */}
                {(startDate || endDate) && (
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
              </div>
            )}

            {/* Raw filename in smaller font */}
            {fileName && (
              <div className="text-xs text-muted-foreground font-mono">
                {fileName}
              </div>
            )}
          </div>
        )}

        {/* Control Bar */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Chart/Table Toggle */}
          <div className="flex items-center gap-1 border rounded-lg p-1">
            <Button
              variant={!showTable ? "default" : "ghost"}
              size="sm"
              onClick={() => setShowTable(false)}
              className="h-8"
            >
              <BarChart3 className="h-4 w-4 mr-1" />
              Chart
            </Button>
            <Button
              variant={showTable ? "default" : "ghost"}
              size="sm"
              onClick={() => setShowTable(true)}
              className="h-8"
            >
              <TableIcon className="h-4 w-4 mr-1" />
              Table
            </Button>
          </div>

          {/* Styling Button */}
          <StylingRulesDialog
            open={showStylingDialog}
            onOpenChange={setShowStylingDialog}
            styleRules={styleRules}
            onStyleRuleToggle={handleStyleRuleToggle}
            onStyleRuleUpdate={handleStyleRuleUpdate}
            currentFileName={fileName}
            currentChartType="credibility"
            columnColorMode={columnColorMode}
            onColumnColorModeChange={setColumnColorMode}
            singleColumnColor={singleColumnColor}
            onSingleColumnColorChange={setSingleColumnColor}
            availableSampleIds={availableSampleIds}
            sampleIdColors={sampleIdColors}
            onSampleColorChange={handleSampleColorChange}
          >
            <Button
              variant="outline"
              size="sm"
              className="h-8 ml-auto"
              title="Configure chart styling"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </StylingRulesDialog>

          {/* Info Badge */}
          <div className="text-xs text-muted-foreground">
            {credibilityData.totalUniqueSpecies} unique species detected
          </div>
        </div>

        {/* Chart or Table View */}
        {showTable ? (
          <div className="border rounded-lg overflow-hidden">
            <div className="max-h-[600px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 bg-background">Credibility Level</TableHead>
                    <TableHead className="sticky top-0 bg-background">GBIF Status</TableHead>
                    <TableHead className="sticky top-0 bg-background text-right">Species Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Low</TableCell>
                    <TableCell>GBIF Verified</TableCell>
                    <TableCell className="text-right">{credibilityData.low_gbif_true}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Low</TableCell>
                    <TableCell>GBIF Unverified</TableCell>
                    <TableCell className="text-right">{credibilityData.low_gbif_false}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Moderate</TableCell>
                    <TableCell>GBIF Verified</TableCell>
                    <TableCell className="text-right">{credibilityData.moderate_gbif_true}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Moderate</TableCell>
                    <TableCell>GBIF Unverified</TableCell>
                    <TableCell className="text-right">{credibilityData.moderate_gbif_false}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">High</TableCell>
                    <TableCell>GBIF Verified</TableCell>
                    <TableCell className="text-right">{credibilityData.high_gbif_true}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">High</TableCell>
                    <TableCell>GBIF Unverified</TableCell>
                    <TableCell className="text-right">{credibilityData.high_gbif_false}</TableCell>
                  </TableRow>
                  <TableRow className="font-semibold bg-muted">
                    <TableCell colSpan={2}>Total Unique Species</TableCell>
                    <TableCell className="text-right">{credibilityData.totalUniqueSpecies}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <div className="border rounded-lg p-4">
            <StackedCredibilityChart
              data={credibilityData}
              fileName={fileName || 'credibility_data.csv'}
              customTitle={spotSampleStyles?.chartTitle as string | undefined}
              customYAxisLabel={spotSampleStyles?.yAxisLabel as string | undefined}
              gbifTrueColor={spotSampleStyles?.gbifTrueColor as string | undefined}
              gbifFalseColor={spotSampleStyles?.gbifFalseColor as string | undefined}
              height={spotSampleStyles?.chartHeight || 400}
            />
          </div>
        )}
      </div>
    );
  }

  // Special handling for _taxo files - bypass normal spot-sample requirements
  if (isTaxonomyFileDetected && taxonomyData) {
    console.log('[SPOT-SAMPLE] 🎨 Rendering _taxo chart:', fileName);
    console.log('[SPOT-SAMPLE]   - Taxonomy data:', taxonomyData);
    console.log('[SPOT-SAMPLE]   - Total samples:', taxonomyData.samples.length);
    console.log('[SPOT-SAMPLE]   - Total phyla:', taxonomyData.allPhyla.length);
    console.log('[SPOT-SAMPLE]   - Spot sample styles:', spotSampleStyles);

    return (
      <div className="space-y-3">
        {/* File header - location, time period, categories, and filename */}
        {(pinLabel || startDate || endDate || (fileCategories && fileCategories.length > 0) || fileName) && (
          <div className="flex flex-col gap-0.5 mb-2">
            {/* Main header: Location • Time Period (Categories) */}
            {(pinLabel || startDate || endDate || (fileCategories && fileCategories.length > 0)) && (
              <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                {/* Location */}
                {pinLabel && <span>{pinLabel}</span>}

                {/* Time Period */}
                {(startDate || endDate) && (
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
              </div>
            )}

            {/* Raw filename in smaller font */}
            {fileName && (
              <div className="text-xs text-muted-foreground font-mono">
                {fileName}
              </div>
            )}
          </div>
        )}

        {/* Control Bar */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Chart/Table Toggle */}
          <div className="flex items-center gap-1 border rounded-lg p-1">
            <Button
              variant={!showTable ? "default" : "ghost"}
              size="sm"
              onClick={() => setShowTable(false)}
              className="h-8"
            >
              <BarChart3 className="h-4 w-4 mr-1" />
              Chart
            </Button>
            <Button
              variant={showTable ? "default" : "ghost"}
              size="sm"
              onClick={() => setShowTable(true)}
              className="h-8"
            >
              <TableIcon className="h-4 w-4 mr-1" />
              Table
            </Button>
          </div>

          {/* Styling Button */}
          <StylingRulesDialog
            open={showStylingDialog}
            onOpenChange={setShowStylingDialog}
            styleRules={styleRules}
            onStyleRuleToggle={handleStyleRuleToggle}
            onStyleRuleUpdate={handleStyleRuleUpdate}
            currentFileName={fileName}
            currentChartType="taxonomy"
            columnColorMode={columnColorMode}
            onColumnColorModeChange={setColumnColorMode}
            singleColumnColor={singleColumnColor}
            onSingleColumnColorChange={setSingleColumnColor}
            availableSampleIds={availableSampleIds}
            sampleIdColors={sampleIdColors}
            onSampleColorChange={handleSampleColorChange}
          >
            <Button
              variant="outline"
              size="sm"
              className="h-8 ml-auto"
              title="Configure chart styling"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </StylingRulesDialog>

          {/* Info Badge */}
          <div className="text-xs text-muted-foreground">
            {taxonomyData.allPhyla.length} phyla across {taxonomyData.samples.length} samples
          </div>
        </div>

        {/* Chart or Table View */}
        {showTable ? (
          <div className="border rounded-lg overflow-hidden">
            <div className="max-h-[600px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 bg-background">Phylum</TableHead>
                    {taxonomyData.samples.map(sample => (
                      <TableHead key={sample} className="sticky top-0 bg-background text-right">
                        {sample}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {taxonomyData.allPhyla.map(phylum => (
                    <TableRow key={phylum}>
                      <TableCell className="font-medium">{phylum}</TableCell>
                      {taxonomyData.samples.map(sample => {
                        const count = taxonomyData.phylumCounts[phylum][sample];
                        const percentage = taxonomyData.phylumPercentages[phylum][sample];
                        return (
                          <TableCell key={sample} className="text-right">
                            {count} ({percentage.toFixed(1)}%)
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold bg-muted">
                    <TableCell>Total Taxa</TableCell>
                    {taxonomyData.samples.map(sample => (
                      <TableCell key={sample} className="text-right">
                        {taxonomyData.totalTaxaPerSample[sample]}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <div className="border rounded-lg p-4 overflow-visible">
            <StackedTaxonomyChart
              data={taxonomyData}
              fileName={fileName || 'taxonomy_data.csv'}
              customTitle={spotSampleStyles?.chartTitle as string | undefined}
              customYAxisLabel={spotSampleStyles?.yAxisLabel as string | undefined}
              height={spotSampleStyles?.chartHeight || 600}
              spotSampleStyles={spotSampleStyles}
            />
          </div>
        )}
      </div>
    );
  }

  if (!timeColumn) {
    console.error('[SPOT-SAMPLE] ❌ ERROR: No time column detected');
    return (
      <div className="p-4 border border-destructive rounded-lg bg-destructive/10">
        <p className="text-sm font-semibold text-destructive mb-1">
          Missing Time Column
        </p>
        <p className="text-xs text-muted-foreground">
          Could not detect a time/date column in the CSV.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Available headers: {headers.join(', ')}
        </p>
      </div>
    );
  }

  // Allow empty strings as valid column names (for unnamed columns)
  if (sampleIdColumn === null || sampleIdColumn === undefined) {
    console.error('[SPOT-SAMPLE] ❌ ERROR: No sample ID column detected');
    return (
      <div className="p-4 border border-destructive rounded-lg bg-destructive/10">
        <p className="text-sm font-semibold text-destructive mb-1">
          Missing Sample ID Column
        </p>
        <p className="text-xs text-muted-foreground">
          Could not detect a "Sample ID" or "Sample" column in the CSV.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Available headers: {headers.join(', ')}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Use the dropdown below to manually select the sample ID column.
        </p>
      </div>
    );
  }

  if (finalGroupedData.length === 0) {
    console.error('[SPOT-SAMPLE] ❌ ERROR: No grouped data created (or all data filtered out)');
    console.error('[SPOT-SAMPLE] This means the grouping function returned 0 groups');
    console.error('[SPOT-SAMPLE] Check the [STATISTICAL-UTILS] logs above for skip reasons');

    return (
      <div className="p-4 border border-destructive rounded-lg bg-destructive/10">
        <p className="text-sm font-semibold text-destructive mb-2">
          No Valid Data Points Found
        </p>
        <p className="text-xs text-muted-foreground mb-2">
          The CSV was loaded but no valid numeric data could be grouped.
        </p>
        <details className="mt-2">
          <summary className="text-xs font-semibold cursor-pointer">Possible Causes</summary>
          <ul className="text-xs text-muted-foreground mt-2 space-y-1 ml-4 list-disc">
            <li>Parameter values are stored as text instead of numbers</li>
            <li>All date values are missing or invalid</li>
            <li>All sample ID values are missing or empty</li>
            <li>All numeric columns contain null/empty values</li>
          </ul>
        </details>

        {diagnosticLogs && diagnosticLogs.length > 0 && (
          <details className="mt-3 open">
            <summary className="text-xs font-semibold cursor-pointer text-blue-600 mb-2">
              📋 Parser Diagnostic Logs ({diagnosticLogs.length} messages)
            </summary>
            <div className="mt-2 p-3 bg-muted rounded text-xs font-mono max-h-64 overflow-y-auto">
              {diagnosticLogs.map((log, index) => (
                <div key={index} className="py-0.5 border-b border-muted-foreground/10 last:border-0">
                  {log}
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="mt-3 p-2 bg-muted rounded text-xs font-mono">
          <div>Data rows: {data.length}</div>
          <div>Headers: {headers.length}</div>
          <div>Time column: {timeColumn}</div>
          <div>Sample ID column: {sampleIdColumn}</div>
          <div>Parameters: {parameterColumns.length}</div>
        </div>

        {!diagnosticLogs && (
          <p className="text-xs text-muted-foreground mt-3 font-semibold">
            📊 Check console logs for detailed diagnostics
          </p>
        )}
      </div>
    );
  }

  // Handler for toggling parameter visibility
  const toggleParameterVisibility = (param: string) => {
    setVisibleParameters(prev => {
      const newSet = new Set(prev);
      if (newSet.has(param)) {
        newSet.delete(param);
      } else {
        newSet.add(param);
      }
      console.log('[SPOT-SAMPLE] Toggled parameter:', param, '- Now visible:', newSet.has(param));
      return newSet;
    });
  };

  // Filter parameters to only show visible ones
  const visibleParametersList = parameterColumns.filter(p => visibleParameters.has(p));

  return (
    <div className="flex gap-3">
      {/* Main chart area */}
      <div className="flex-1 space-y-3">
        {/* File header - location, time period, categories, filename, and Methodology button */}
        <div className="flex items-stretch gap-4 mb-2">
          {/* Left side: Header info and filename stacked */}
          <div className="flex flex-col gap-0.5 flex-1">
            {/* Main header: Location • Time Period (Categories) */}
            {(pinLabel || startDate || endDate || (fileCategories && fileCategories.length > 0)) && (
              <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                {/* Location */}
                {pinLabel && <span>{pinLabel}</span>}

                {/* Time Period */}
                {(startDate || endDate) && (
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
              </div>
            )}

            {/* Raw filename in smaller font */}
            {fileName && (
              <div className="text-xs text-muted-foreground font-mono">
                {fileName}
              </div>
            )}
          </div>

          {/* Right side: Methodology button spanning full height */}
          <Button
            className="px-6 text-sm rounded-lg text-white font-medium bg-teal-700 hover:bg-teal-800 shrink-0 self-stretch"
            onClick={() => setShowMethodologyModal(true)}
            disabled={!projectId || !tileName}
          >
            <BookOpen className="h-4 w-4 mr-2" />
            METHODOLOGY
          </Button>
        </div>

        {/* Control Bar */}
        <div className="flex items-center gap-3 flex-wrap">
        {/* Chart/Table Toggle */}
        <div className="flex items-center gap-1 border rounded-lg p-1">
          <Button
            variant={!showTable ? "default" : "ghost"}
            size="sm"
            onClick={() => setShowTable(false)}
            className="h-8"
          >
            <BarChart3 className="h-4 w-4 mr-1" />
            Chart
          </Button>
          <Button
            variant={showTable ? "default" : "ghost"}
            size="sm"
            onClick={() => setShowTable(true)}
            className="h-8"
          >
            <TableIcon className="h-4 w-4 mr-1" />
            Table
          </Button>
        </div>

        {/* Aggregation Mode Toggle - only show for _indiv files */}
        {fileName?.toLowerCase().endsWith('_indiv.csv') && (
          <div className="flex items-center gap-1 border rounded-lg p-1">
            <Button
              variant={aggregationMode === 'detailed' ? "default" : "ghost"}
              size="sm"
              onClick={() => setAggregationMode('detailed')}
              className="h-8"
              title="Show all individual data points"
            >
              Detailed
            </Button>
            <Button
              variant={aggregationMode === 'by-date' ? "default" : "ghost"}
              size="sm"
              onClick={() => setAggregationMode('by-date')}
              className="h-8"
              title="Aggregate all samples by date"
            >
              By Date
            </Button>
          </div>
        )}

        {/* Spacer to push right-side controls to the right */}
        <div className="flex-1" />

        {/* Chart Type Selector (only show when chart is active) */}
        {!showTable && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-muted-foreground">Show As:</span>
            <Select
              value={chartType}
              onValueChange={(val) => {
                console.log('[CHART-TYPE] Changing from', chartType, 'to', val);
                setChartType(val as 'column' | 'whisker');
              }}
            >
              <SelectTrigger className="w-[160px] h-8">
                <SelectValue placeholder="Select chart type" />
              </SelectTrigger>
              <SelectContent className="z-[9999]">
                <SelectItem value="column">
                  Column Chart
                </SelectItem>
                <SelectItem value="whisker">
                  Whisker Plot
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Sample ID Column Selector - hidden for Chem files or if only one option */}
        {(() => {
          const upper = fileName?.toUpperCase() || '';
          const isChemFile = upper.includes('CHEMSW') || upper.includes('CHEM-SW') ||
                 upper.includes('CHEMWQ') || upper.includes('CHEM-WQ') ||
                 upper.endsWith('_CHEM.CSV');
          const hasOnlyOneOption = sampleIdColumnOptions.length <= 1;
          if (isChemFile || hasOnlyOneOption) return null;

          return (
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-muted-foreground">Show By:</span>
              <Select
                value={selectedSampleIdColumn || detectedSampleIdColumn || ''}
                onValueChange={(val) => setSelectedSampleIdColumn(val)}
              >
                <SelectTrigger className="w-[180px] h-8">
                  <SelectValue>
                    {selectedSampleIdColumn
                      ? selectedSampleIdColumn
                      : detectedSampleIdColumn === ''
                        ? 'Auto (Column 2)'
                        : `Auto (${detectedSampleIdColumn})`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="z-[9999]">
                  {sampleIdColumnOptions.map((col, idx) => (
                    <SelectItem key={`col-${idx}`} value={col || '__empty__'}>
                      {col === '' ? 'Column 2 (Unnamed)' : col}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })()}

        {/* Combined Filter Control - only show for _indiv files */}
        {fileName?.toLowerCase().endsWith('_indiv.csv') && (
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8">
                  Filter {(selectedDates.length > 0 || selectedSampleIds.length > 0) && `(${selectedDates.length + selectedSampleIds.length})`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72">
                <div className="space-y-3">
                  {/* Filter Type Toggle */}
                  <div className="flex items-center gap-1 border rounded-lg p-1">
                    <Button
                      variant={filterType === 'dates' ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setFilterType('dates')}
                      className="h-6 text-xs flex-1"
                    >
                      Dates {selectedDates.length > 0 && `(${selectedDates.length})`}
                    </Button>
                    <Button
                      variant={filterType === 'stations' ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setFilterType('stations')}
                      className="h-6 text-xs flex-1"
                    >
                      Stations {selectedSampleIds.length > 0 && `(${selectedSampleIds.length})`}
                    </Button>
                  </div>

                  {/* Date Filter Content */}
                  {filterType === 'dates' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold">Filter by Date</Label>
                        {selectedDates.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() => setSelectedDates([])}
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {availableDates.map(date => {
                          const dateObj = new Date(date);
                          const formattedDate = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()}`;
                          return (
                            <div key={date} className="flex items-center space-x-2">
                              <Checkbox
                                id={`date-${date}`}
                                checked={selectedDates.includes(date)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedDates([...selectedDates, date]);
                                  } else {
                                    setSelectedDates(selectedDates.filter(d => d !== date));
                                  }
                                }}
                              />
                              <label
                                htmlFor={`date-${date}`}
                                className="text-xs cursor-pointer"
                              >
                                {formattedDate}
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Stations Filter Content */}
                  {filterType === 'stations' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold">Filter by Station</Label>
                        {selectedSampleIds.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() => setSelectedSampleIds([])}
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {availableSampleIdsForFilter.map(sampleId => (
                          <div key={sampleId} className="flex items-center space-x-2">
                            <Checkbox
                              id={`sampleid-${sampleId}`}
                              checked={selectedSampleIds.includes(sampleId)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedSampleIds([...selectedSampleIds, sampleId]);
                                } else {
                                  setSelectedSampleIds(selectedSampleIds.filter(id => id !== sampleId));
                                }
                              }}
                            />
                            <label
                              htmlFor={`sampleid-${sampleId}`}
                              className="text-xs cursor-pointer"
                            >
                              {sampleId}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>

          </>
        )}

        {/* Styling Button */}
        <StylingRulesDialog
          open={showStylingDialog}
          onOpenChange={setShowStylingDialog}
          styleRules={styleRules}
          onStyleRuleToggle={handleStyleRuleToggle}
          onStyleRuleUpdate={handleStyleRuleUpdate}
          currentFileName={fileName}
          currentChartType={chartType}
          columnColorMode={columnColorMode}
          onColumnColorModeChange={handleColumnColorModeChange}
          singleColumnColor={singleColumnColor}
          onSingleColumnColorChange={handleSingleColumnColorChange}
          availableSampleIds={availableSampleIds}
          sampleIdColors={sampleIdColors}
          onSampleColorChange={handleSampleColorChange}
        >
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            title="Configure chart styling"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </StylingRulesDialog>

        {/* Info Badge */}
        <div className="text-xs text-muted-foreground">
          {finalGroupedData.length} data point{finalGroupedData.length !== 1 ? 's' : ''} • {' '}
          {Object.keys(sampleIdColors).length} sample{Object.keys(sampleIdColors).length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Chart or Table View */}
      {showTable ? (
        <div className="border rounded-lg overflow-hidden">
          <div className="max-h-[600px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky top-0 bg-background">Date</TableHead>
                  <TableHead className="sticky top-0 bg-background">Sample ID</TableHead>
                  <TableHead className="sticky top-0 bg-background">Parameter</TableHead>
                  <TableHead className="sticky top-0 bg-background text-right">Count</TableHead>
                  <TableHead className="sticky top-0 bg-background text-right">Mean</TableHead>
                  <TableHead className="sticky top-0 bg-background text-right">SD</TableHead>
                  <TableHead className="sticky top-0 bg-background text-right">Min</TableHead>
                  <TableHead className="sticky top-0 bg-background text-right">Max</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {finalGroupedData.map((group, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">
                      {format(parseISO(group.date), 'dd/MM/yyyy')}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: sampleIdColors[group.sampleId] }}
                        />
                        {group.sampleId}
                      </div>
                    </TableCell>
                    <TableCell>{group.parameter}</TableCell>
                    <TableCell className="text-right">{group.count}</TableCell>
                    <TableCell className="text-right">{group.stats.mean.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      {group.count > 1 ? `±${group.stats.sd.toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell className="text-right">{group.stats.min.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{group.stats.max.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <div className={needsScrolling ? "overflow-x-auto border rounded-lg" : "border rounded-lg"}>
          <div className="space-y-3 p-2">
            {/* Legend - at top of charts */}
            <div className="flex items-center gap-4 flex-wrap px-2 pb-2 border-b">
              <span className="text-xs font-semibold text-muted-foreground">Sample IDs:</span>
              {Object.entries(sampleIdColors).map(([sampleId, color]) => (
                <div key={sampleId} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs">{sampleId}</span>
                </div>
              ))}
            </div>
            {/* Render a chart for each parameter */}
            {(() => {
              console.log('[SPOT-SAMPLE] 📊 RENDERING CHARTS');
              console.log('[SPOT-SAMPLE] Chart type:', chartType);
              console.log('[SPOT-SAMPLE] All parameter columns:', parameterColumns);
              console.log('[SPOT-SAMPLE] Visible parameters:', Array.from(visibleParameters));
              console.log('[SPOT-SAMPLE] Grouped data length:', finalGroupedData.length);
              console.log('[SPOT-SAMPLE] Chart width:', chartWidth);
              return null;
            })()}
            {visibleParametersList.map(param => {
              // Log data being passed to chart component
              const paramData = finalGroupedData.filter(d => d.parameter === param);
              console.log(`[SPOT-SAMPLE-CHART] 🎨 Rendering ${param} chart:`, {
                parameterName: param,
                dataPointsCount: paramData.length,
                sampleFirstThree: paramData.slice(0, 3).map(d => ({
                  xLabel: d.xAxisLabel,
                  mean: d.stats.mean,
                  sd: d.stats.sd,
                  rawValues: d.values,
                  valuesCount: d.count
                }))
              });

              const chartTitle = PARAMETER_COMMON_NAMES[param] || param;
              return (
                <div key={param} className="space-y-2">
                  <div className="flex items-center gap-2 pl-4">
                    <h3 className="text-sm font-semibold">{chartTitle}</h3>
                    {/* Parameter-specific Y-axis controls */}
                    <Popover
                      open={yAxisDialogOpen === param}
                      onOpenChange={(open) => {
                        setYAxisDialogOpen(open ? param : null);
                        // Initialize temp values when opening
                        if (open) {
                          const currentRange = parameterYAxisRanges[param];
                          setTempYAxisMin(currentRange?.min?.toString() || '');
                          setTempYAxisMax(currentRange?.max?.toString() || '');
                        }
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          title={`Set Y-axis range for ${param}`}
                        >
                          <Settings className="h-3 w-3" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-4">
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <Label className="text-xs font-semibold">Y-Axis Range for {param}</Label>
                            <p className="text-xs text-muted-foreground">
                              Set custom min/max values for this parameter's Y-axis. Leave empty for auto-scale.
                            </p>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs">Minimum</Label>
                            <Input
                              type="number"
                              placeholder="Auto"
                              value={tempYAxisMin}
                              onChange={(e) => setTempYAxisMin(e.target.value)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs">Maximum</Label>
                            <Input
                              type="number"
                              placeholder="Auto"
                              value={tempYAxisMax}
                              onChange={(e) => setTempYAxisMax(e.target.value)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 h-8 text-xs"
                              onClick={() => {
                                // Clear the range
                                handleParameterYAxisRangeChange(param, undefined, undefined);
                                setTempYAxisMin('');
                                setTempYAxisMax('');
                                setYAxisDialogOpen(null);
                              }}
                            >
                              Clear
                            </Button>
                            <Button
                              size="sm"
                              className="flex-1 h-8 text-xs"
                              onClick={() => {
                                // Apply the range
                                const min = tempYAxisMin ? parseFloat(tempYAxisMin) : undefined;
                                const max = tempYAxisMax ? parseFloat(tempYAxisMax) : undefined;
                                handleParameterYAxisRangeChange(param, min, max);
                                setYAxisDialogOpen(null);
                              }}
                            >
                              Apply
                            </Button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div style={{ width: chartWidth || '100%' }}>
                    {chartType === 'column' ? (
                      <ColumnChartWithErrorBars
                        data={finalGroupedData}
                        parameter={param}
                        sampleIdColors={sampleIdColors}
                        width={chartWidth || '100%'}
                        height={350}
                        spotSampleStyles={spotSampleStyles}
                        columnColorMode={columnColorMode}
                        singleColumnColor={singleColumnColor}
                        yAxisRange={parameterYAxisRanges[param]}
                        showDateSeparators={aggregationMode === 'detailed'}
                      />
                    ) : (
                    <WhiskerPlot
                      data={finalGroupedData}
                      parameter={param}
                      sampleIdColors={sampleIdColors}
                      width={chartWidth || '100%'}
                      height={350}
                      spotSampleStyles={spotSampleStyles}
                      yAxisRange={parameterYAxisRanges[param]}
                      showDateSeparators={aggregationMode === 'detailed'}
                    />
                  )}
                </div>
              </div>
            );
            })}
          </div>
        </div>
      )}
      </div>

      {/* Parameter Selector Panel - Collapsible */}
      <div className={`shrink-0 transition-all duration-300 ${isParametersSidebarCollapsed ? 'w-8' : 'w-48'}`}>
        <div className="sticky top-4">
          {isParametersSidebarCollapsed ? (
            /* Collapsed State - Narrow strip with expand button */
            <div className="border rounded-lg bg-background h-[400px] flex flex-col items-center py-3">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 mb-3"
                onClick={() => setIsParametersSidebarCollapsed(false)}
                title="Expand Parameters panel"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div
                className="writing-mode-vertical text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground"
                style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                onClick={() => setIsParametersSidebarCollapsed(false)}
              >
                Parameters ({visibleParameters.size}/{parameterColumns.length})
              </div>
            </div>
          ) : (
            /* Expanded State - Full panel */
            <div className="border rounded-lg p-3 bg-background">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">Parameters</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => setIsParametersSidebarCollapsed(true)}
                    title="Collapse Parameters panel"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-2">
                  <TooltipProvider delayDuration={300}>
                    {parameterColumns.map(param => {
                      const commonName = PARAMETER_COMMON_NAMES[param];
                      return (
                        <div key={param} className="flex items-center space-x-2">
                          <Checkbox
                            id={`param-${param}`}
                            checked={visibleParameters.has(param)}
                            onCheckedChange={() => toggleParameterVisibility(param)}
                          />
                          {commonName ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Label
                                  htmlFor={`param-${param}`}
                                  className="text-xs cursor-pointer flex-1 leading-tight"
                                >
                                  {param}
                                </Label>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-[200px]">
                                <p className="text-xs">{commonName}</p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Label
                              htmlFor={`param-${param}`}
                              className="text-xs cursor-pointer flex-1 leading-tight"
                            >
                              {param}
                            </Label>
                          )}
                        </div>
                      );
                    })}
                  </TooltipProvider>
                </div>
                <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                  {visibleParameters.size} of {parameterColumns.length} visible
                </div>
              </div>
          )}
        </div>
      </div>

      {/* Methodology Modal */}
      {projectId && tileName && (
        <MethodologyModal
          open={showMethodologyModal}
          onOpenChange={setShowMethodologyModal}
          projectId={projectId}
          tileName={tileName}
        />
      )}
    </div>
  );
}
