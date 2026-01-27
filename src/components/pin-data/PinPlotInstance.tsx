"use client";
// Force reload - fixed FileIcon import
import React, { useState, useEffect, useId, useMemo, useCallback, memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X, Settings2, BarChart, Loader2, AlertCircle, CheckCircle2, Info, ChevronDown, ChevronUp, FileIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { parseMultipleCSVFiles, parseHaplotypeCsv, type ParseResult, type ParsedDataPoint, type HaplotypeParseResult } from "./csvParser";
import PinChartDisplay from "@/components/charts/LazyPinChartDisplay";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";

interface MergedFileMetadata {
  mergeMode: 'sequential' | 'stack-parameters';
  sourceFiles: string[];
  sourceFilesMetadata?: Record<string, any>;
  startDate?: Date | null;
  endDate?: Date | null;
  createdAt?: Date;
}

interface PinPlotInstanceProps {
  instanceId: string;
  initialPlotTitle: string;
  onRemovePlot?: (id: string) => void; // Optional - undefined means can't remove
  fileType: 'GP' | 'FPOD' | 'Subcam';
  files: File[];
  // Pre-parsed data for merged plots (bypasses CSV parsing)
  preParsedData?: ParseResult;
  // Merged file metadata (for displaying file info)
  mergedFileMetadata?: MergedFileMetadata;
  // File metadata for header display
  pinLabel?: string; // Location name
  startDate?: Date; // Start date of data
  endDate?: Date; // End date of data
  fileCategories?: string[]; // Categories (e.g., ["Sediment", "Haplotypes"])
  // Time synchronization props
  timeAxisMode?: 'separate' | 'common';
  globalTimeRange?: { min: Date | null; max: Date | null };
  globalBrushRange?: { startIndex: number; endIndex: number | undefined };
  onDataParsed?: (plotId: string, parseResult: ParseResult) => void;
  onBrushChange?: (brushData: { startIndex?: number; endIndex?: number }) => void;
  isLastPlot?: boolean;
  // Visibility tracking for merge feature
  onVisibilityChange?: (
    visibleParams: string[],
    paramColors: Record<string, string>,
    paramSettings?: Record<string, any>,
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
  initialParameterSettings?: Record<string, any>;
  initialAxisMode?: 'single' | 'multi';
  initialCustomYAxisLabel?: string;
  initialCompactView?: boolean;
  initialCustomParameterNames?: Record<string, string>;
  // Pin ID for saving corrected files to database
  pinId?: string;
  // Subtracted plot settings (for computed/subtracted plots)
  isSubtractedPlot?: boolean;
  includeZeroValues?: boolean;
  onIncludeZeroValuesChange?: (include: boolean) => void;
  // Methodology modal props
  projectId?: string;
  tileName?: 'SubCam' | 'GrowProbe' | 'FPOD' | 'Water and Crop Samples' | 'eDNA';
}


function PinPlotInstanceComponent({
  instanceId,
  initialPlotTitle,
  onRemovePlot,
  fileType,
  files,
  preParsedData,
  mergedFileMetadata,
  pinLabel,
  startDate,
  endDate,
  fileCategories,
  timeAxisMode,
  globalTimeRange,
  globalBrushRange,
  onDataParsed,
  onBrushChange,
  isLastPlot,
  onVisibilityChange,
  initialVisibleParameters,
  initialParameterColors,
  initialParameterSettings,
  initialAxisMode,
  initialCustomYAxisLabel,
  initialCompactView,
  initialCustomParameterNames,
  pinId,
  isSubtractedPlot = false,
  includeZeroValues = false,
  onIncludeZeroValuesChange,
  projectId,
  tileName
}: PinPlotInstanceProps) {
  const { toast } = useToast();
  const componentId = useId();

  console.log('🎯 [PinPlotInstance] Received metadata:', {
    pinLabel,
    startDate,
    endDate,
    fileCategories,
    fileType
  });

  // State
  const [plotTitle, setPlotTitle] = useState(initialPlotTitle);
  const [isLoading, setIsLoading] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [haplotypeData, setHaplotypeData] = useState<HaplotypeParseResult | null>(null);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showMergeInfo, setShowMergeInfo] = useState(false);
  const [dateFormat, setDateFormat] = useState<'DD/MM/YYYY' | 'MM/DD/YYYY' | undefined>(undefined);

  // Memoize file processing to prevent duplicate parsing
  const processCSVFiles = useCallback(async (csvFiles: File[], formatOverride?: 'DD/MM/YYYY' | 'MM/DD/YYYY') => {
    // console.log('[PLOT INSTANCE] processCSVFiles called with formatOverride:', formatOverride);
    setIsProcessingFiles(true);
    setParseResult(null);
    setHaplotypeData(null);

    try {
      // Check file type for special handling
      const fileName = csvFiles[0]?.name.toLowerCase() || '';
      const isHaplFile = csvFiles.length > 0 && fileName.includes('hapl');
      const isNmaxFile = csvFiles.length > 0 && (fileName.includes('_nmax') || fileName.includes('_nmx'));

      if (isHaplFile) {
        // _hapl files: Parse ONLY as haplotype data (heatmap only)
        const haplotypeResult = await parseHaplotypeCsv(csvFiles[0]);
        setHaplotypeData(haplotypeResult);

        // Create a minimal ParseResult for compatibility
        const dummyParseResult: ParseResult = {
          data: [],
          headers: [],
          errors: haplotypeResult.errors,
          summary: {
            totalRows: haplotypeResult.summary.totalSpecies,
            validRows: haplotypeResult.summary.totalSpecies,
            columns: haplotypeResult.summary.totalSites,
            timeColumn: null
          }
        };
        setParseResult(dummyParseResult);

        if (haplotypeResult.errors.length > 0) {
          toast({
            variant: haplotypeResult.species.length > 0 ? "default" : "destructive",
            title: haplotypeResult.species.length > 0 ? "Haplotype Data Processed with Warnings" : "Processing Error",
            description: `${haplotypeResult.errors.length} issue${haplotypeResult.errors.length > 1 ? 's' : ''} found. ${haplotypeResult.summary.totalSpecies} species loaded.`
          });
        } else {
          toast({
            title: "Haplotype Data Processed Successfully",
            description: `Loaded ${haplotypeResult.summary.totalSpecies} species across ${haplotypeResult.summary.totalSites} sites`
          });
        }
      } else if (isNmaxFile) {
        // _nmax files: Parse as BOTH normal CSV (for time series) AND haplotype data (for heatmap toggle)
        // Parse as normal CSV first
        const result = await parseMultipleCSVFiles(csvFiles, fileType, formatOverride);
        setParseResult(result);

        // Also parse as haplotype data for heatmap toggle option
        const haplotypeResult = await parseHaplotypeCsv(csvFiles[0]);
        setHaplotypeData(haplotypeResult);

        // Notify parent of parsed data
        if (onDataParsed) {
          onDataParsed(instanceId, result);
        }

        if (result.errors.length > 0) {
          toast({
            variant: result.data.length > 0 ? "default" : "destructive",
            title: result.data.length > 0 ? "Data Processed with Warnings" : "Processing Error",
            description: `${result.errors.length} issue${result.errors.length > 1 ? 's' : ''} found. ${result.data.length} valid data points loaded.`
          });
        } else {
          toast({
            title: "NMAX Data Processed Successfully",
            description: `Loaded ${result.data.length} data points. Heatmap view available.`
          });
        }
      } else {
        // Normal CSV parsing
        const result = await parseMultipleCSVFiles(csvFiles, fileType, formatOverride);
        // console.log('[PLOT INSTANCE] CSV parsed. First 3 timestamps:', result.data.slice(0, 3).map(d => d.time));
        setParseResult(result);

        // Notify parent of parsed data for synchronization
        if (onDataParsed) {
          onDataParsed(instanceId, result);
        }

        if (result.errors.length > 0) {
          toast({
            variant: result.data.length > 0 ? "default" : "destructive",
            title: result.data.length > 0 ? "Data Processed with Warnings" : "Processing Error",
            description: `${result.errors.length} issue${result.errors.length > 1 ? 's' : ''} found. ${result.data.length} valid data points loaded.`
          });
        } else {
          toast({
            title: "Data Processed Successfully",
            description: `Loaded ${result.data.length} data points from ${csvFiles.length} file${csvFiles.length > 1 ? 's' : ''}`
          });
        }
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process CSV files';
      setParseResult({
        data: [],
        headers: [],
        errors: [errorMessage],
        summary: { totalRows: 0, validRows: 0, columns: 0, timeColumn: null }
      });
      toast({
        variant: "destructive",
        title: "Processing Error",
        description: errorMessage
      });
    } finally {
      setIsProcessingFiles(false);
    }
  }, [fileType, toast, onDataParsed, instanceId]);

  // Handle pre-parsed data (for merged plots) or process CSV files
  // Use a ref to track if we've already processed these files
  const processedFilesRef = React.useRef<string>('');

  useEffect(() => {
    if (preParsedData) {
      // Use pre-parsed data directly (merged plot scenario)
      setParseResult(preParsedData);
      if (onDataParsed) {
        onDataParsed(instanceId, preParsedData);
      }
      setIsProcessingFiles(false);
    } else if (files.length > 0) {
      // Create a unique key for the current files
      const filesKey = files.map(f => `${f.name}-${f.size}-${f.lastModified}`).join('|') + `|${dateFormat}`;

      // Only process if files changed
      if (processedFilesRef.current !== filesKey) {
        processedFilesRef.current = filesKey;
        processCSVFiles(files, dateFormat);
      }
    }
  }, [files, preParsedData, instanceId, onDataParsed, dateFormat, processCSVFiles]);

  return (
    <Card className="shadow-sm relative">
      {/* Remove button - only show if onRemovePlot is provided */}
      {onRemovePlot && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 h-6 w-6 z-10"
          onClick={() => onRemovePlot(instanceId)}
        >
          <X className="h-4 w-4" />
        </Button>
      )}

      {/* File Info button for merged files */}
      {mergedFileMetadata && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-10 h-6 w-6 z-10"
          onClick={() => setShowMergeInfo(true)}
          title="View merge info"
        >
          <FileIcon className="h-4 w-4 text-primary" />
        </Button>
      )}

      <CardContent className="p-3">
        {isProcessingFiles ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Processing {fileType} files...</p>
            </div>
          </div>
        ) : parseResult ? (
          <div className="min-h-[285px]">
            <PinChartDisplay
              data={parseResult.data}
              fileType={fileType}
              timeColumn={parseResult.summary.timeColumn}
              showYAxisLabels={true}
              fileName={files.length > 0 ? files[0].name : undefined}
              dataSource="csv"
              pinLabel={pinLabel}
              startDate={startDate}
              endDate={endDate}
              fileCategories={fileCategories}
              timeAxisMode={timeAxisMode}
              globalTimeRange={globalTimeRange}
              globalBrushRange={globalBrushRange}
              onBrushChange={onBrushChange}
              isLastPlot={isLastPlot}
              onVisibilityChange={onVisibilityChange}
              // Initial state for restoring saved views
              initialVisibleParameters={initialVisibleParameters}
              initialParameterColors={initialParameterColors}
              initialParameterSettings={initialParameterSettings}
              initialAxisMode={initialAxisMode}
              initialCustomYAxisLabel={initialCustomYAxisLabel}
              initialCompactView={initialCompactView}
              initialCustomParameterNames={initialCustomParameterNames}
              // Set defaults for merged plots (detected by preParsedData)
              defaultAxisMode='multi'
              defaultParametersExpanded={preParsedData ? true : false}
              // Date format toggle (only for non-merged plots)
              currentDateFormat={dateFormat}
              onDateFormatChange={!preParsedData ? setDateFormat : undefined}
              // Raw files for viewing original CSV
              rawFiles={files.length > 0 ? files : undefined}
              // Pin ID for saving corrected files to database
              pinId={pinId}
              // Spot-sample data props (for CROP, CHEM, WQ, EDNA files)
              detectedSampleIdColumn={parseResult.detectedSampleIdColumn}
              headers={parseResult.headers}
              // Haplotype data (for EDNA hapl files)
              haplotypeData={haplotypeData || undefined}
              // Subtracted plot settings
              isSubtractedPlot={isSubtractedPlot}
              includeZeroValues={includeZeroValues}
              onIncludeZeroValuesChange={onIncludeZeroValuesChange}
              // Methodology modal props
              projectId={projectId}
              tileName={tileName}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-32 text-center">
            <div>
              <p className="text-xs text-muted-foreground">No data processed yet</p>
              <p className="text-xs text-muted-foreground opacity-70">Upload CSV files to begin</p>
            </div>
          </div>
        )}
      </CardContent>

      {/* Merge Info Dialog */}
      {mergedFileMetadata && (
        <Dialog open={showMergeInfo} onOpenChange={setShowMergeInfo}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Merged File Information</DialogTitle>
              <DialogDescription>
                Details about the source files used to create this merge
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Merge Mode */}
              <div>
                <h4 className="text-sm font-semibold mb-1">Merge Mode</h4>
                <p className="text-sm text-muted-foreground">
                  {mergedFileMetadata.mergeMode === 'sequential' ?
                    'Sequential (files combined one after another)' :
                    'Stack Parameters (parameters stacked side-by-side)'}
                </p>
              </div>

              {/* Date Range */}
              {(mergedFileMetadata.startDate || mergedFileMetadata.endDate) && (
                <div>
                  <h4 className="text-sm font-semibold mb-1">Date Range</h4>
                  <p className="text-sm text-muted-foreground">
                    {mergedFileMetadata.startDate && format(mergedFileMetadata.startDate, 'PPP')}
                    {mergedFileMetadata.startDate && mergedFileMetadata.endDate && ' → '}
                    {mergedFileMetadata.endDate && format(mergedFileMetadata.endDate, 'PPP')}
                  </p>
                </div>
              )}

              {/* Source Files */}
              <div>
                <h4 className="text-sm font-semibold mb-2">Source Files ({mergedFileMetadata.sourceFiles.length})</h4>
                <div className="border rounded-md max-h-64 overflow-y-auto">
                  <ul className="divide-y">
                    {mergedFileMetadata.sourceFiles.map((fileName, index) => (
                      <li key={index} className="p-2 text-sm hover:bg-accent/50">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">#{index + 1}</span>
                          <span>{fileName}</span>
                        </div>
                        {mergedFileMetadata.sourceFilesMetadata?.[fileName] && (
                          <div className="text-xs text-muted-foreground ml-8 mt-1">
                            {/* Display any additional metadata if available */}
                            {mergedFileMetadata.sourceFilesMetadata[fileName].rows &&
                              `${mergedFileMetadata.sourceFilesMetadata[fileName].rows} rows`}
                            {mergedFileMetadata.sourceFilesMetadata[fileName].columns &&
                              ` • ${mergedFileMetadata.sourceFilesMetadata[fileName].columns} columns`}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Created At */}
              {mergedFileMetadata.createdAt && (
                <div>
                  <h4 className="text-sm font-semibold mb-1">Created</h4>
                  <p className="text-sm text-muted-foreground">
                    {format(mergedFileMetadata.createdAt, 'PPP p')}
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end mt-4">
              <Button variant="outline" onClick={() => setShowMergeInfo(false)}>
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

// Custom comparison function for React.memo to prevent unnecessary re-renders
const arePropsEqual = (prevProps: PinPlotInstanceProps, nextProps: PinPlotInstanceProps): boolean => {
  // Always re-render if these critical props change
  if (
    prevProps.instanceId !== nextProps.instanceId ||
    prevProps.files !== nextProps.files ||
    prevProps.preParsedData !== nextProps.preParsedData ||
    prevProps.fileType !== nextProps.fileType ||
    prevProps.timeAxisMode !== nextProps.timeAxisMode
  ) {
    return false;
  }

  // Compare initial state props for restoration
  if (
    prevProps.initialVisibleParameters !== nextProps.initialVisibleParameters ||
    prevProps.initialParameterColors !== nextProps.initialParameterColors ||
    prevProps.initialParameterSettings !== nextProps.initialParameterSettings ||
    prevProps.initialAxisMode !== nextProps.initialAxisMode ||
    prevProps.initialCompactView !== nextProps.initialCompactView
  ) {
    return false;
  }

  // Compare time synchronization props (only if in common mode)
  if (nextProps.timeAxisMode === 'common') {
    if (
      prevProps.globalTimeRange?.min !== nextProps.globalTimeRange?.min ||
      prevProps.globalTimeRange?.max !== nextProps.globalTimeRange?.max ||
      prevProps.globalBrushRange?.startIndex !== nextProps.globalBrushRange?.startIndex ||
      prevProps.globalBrushRange?.endIndex !== nextProps.globalBrushRange?.endIndex
    ) {
      return false;
    }
  }

  // Subtracted plot settings
  if (
    prevProps.isSubtractedPlot !== nextProps.isSubtractedPlot ||
    prevProps.includeZeroValues !== nextProps.includeZeroValues
  ) {
    return false;
  }

  // Props are equal, skip re-render
  return true;
};

// Export memoized component for better performance in stacked plots
export const PinPlotInstance = memo(PinPlotInstanceComponent, arePropsEqual);