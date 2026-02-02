'use client';

import React, { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { format, startOfMonth, endOfMonth, eachMonthOfInterval, differenceInDays, parseISO, isValid, getYear } from 'date-fns';
import { Info, Calendar, BarChart3, Trash2, Check, X, PlayCircle, ArrowUpDown, ArrowUp, ArrowDown, MoreVertical, FileText, Pencil, Clock, Loader2, Layers, Combine, Upload, AlertCircle, Plus, CheckCircle2, Table } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { type PinFile } from '@/lib/supabase/file-storage-service';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { getMergedFilesByProjectAction } from '@/app/api/merged-files/actions';
import type { MergedFile } from '@/lib/supabase/merged-files-service';
import { categorizeFile } from '@/lib/file-categorization-config';
import { createPairedTimelineEntries, type PairedTimelineEntry } from '@/lib/fpod-file-pairing';

// Lazy load MergeFilesDialog - only loads when user clicks merge button
const MergeFilesDialog = dynamic(
  () => import('./MergeFilesDialog').then(mod => ({ default: mod.MergeFilesDialog })),
  { ssr: false, loading: () => <div className="animate-pulse">Loading merge dialog...</div> }
);

// Lazy load RawCsvViewer - only loads when user clicks "Open Raw"
const RawCsvViewer = dynamic(
  () => import('@/components/data-explorer/RawCsvViewer').then(mod => ({ default: mod.RawCsvViewer })),
  { ssr: false, loading: () => <div className="animate-pulse p-4">Loading CSV viewer...</div> }
);

interface DataTimelineProps {
  files: (PinFile & { pinLabel: string })[];
  getFileDateRange: (file: PinFile) => Promise<{
    totalDays: number | null;
    startDate: string | null;
    endDate: string | null;
    uniqueDates?: string[];
    isCrop?: boolean;
    error?: string;
  }>;
  onFileClick: (file: PinFile & { pinLabel: string }) => void;
  onDeleteFile?: (file: PinFile & { pinLabel: string }) => void;
  onRenameFile?: (file: PinFile & { pinLabel: string }, newName: string) => Promise<boolean>;
  onDatesUpdated?: () => void;
  onSelectMultipleFiles?: (files: (PinFile & { pinLabel: string })[]) => void;
  onOpenStackedPlots?: (files: (PinFile & { pinLabel: string })[]) => void;
  projectId?: string;
  onMergedFileClick?: (mergedFile: MergedFile) => void;
  onAddFilesToMergedFile?: (mergedFile: MergedFile) => void;
  multiFileMergeMode?: boolean;
  onMultiFileMergeModeChange?: (mode: boolean) => void;
  viewMode?: 'table' | 'timeline';
  pinColorMap?: Map<string, string>; // Optional external color map for consistent colors across tiles
  tileName?: string; // Name of the tile (e.g., 'FPOD') - used for file pairing
  onPairedFileClick?: (stdFile: PinFile & { pinLabel: string }, avgFile: PinFile & { pinLabel: string }) => void;
}

interface FileWithDateRange {
  file: PinFile & { pinLabel: string };
  dateRange: {
    totalDays: number | null;
    startDate: string | null;
    endDate: string | null;
    uniqueDates?: string[];
    isCrop?: boolean;
    error?: string;
    loading: boolean;
  };
}

interface MergedGroup {
  groupKey: string; // Project_DataType_Station
  project: string;
  dataType: string;
  station: string;
  files: FileWithDateRange[];
  startDate: string | null;
  endDate: string | null;
  totalDays: number | null;
  color: string;
}

// Colorblind-friendly palette (Paul Tol scheme)
const COLORS = [
  '#4477AA', // Blue
  '#EE6677', // Red/pink
  '#228833', // Green
  '#CCBB44', // Olive yellow
  '#66CCEE', // Cyan
  '#AA3377', // Purple
  '#CC6644', // Burnt orange
  '#BBBBBB', // Grey
  '#336688', // Steel blue
  '#885533', // Brown
];

// Shimmer loading component
const Shimmer = ({ className }: { className?: string }) => (
  <div className={`animate-shimmer bg-gradient-to-r from-muted/50 via-muted/80 to-muted/50 bg-[length:200%_100%] rounded ${className}`} />
);

// Skeleton row component for smooth loading
const SkeletonTableRow = ({ index }: { index: number }) => (
  <div
    className="grid grid-cols-12 gap-2 py-1.5 text-xs opacity-0 animate-[fadeIn_0.3s_ease-in-out_forwards]"
    style={{ animationDelay: `${index * 50}ms` }}
  >
    {/* Pin indicator skeleton */}
    <div className="col-span-1 flex items-center">
      <Shimmer className="w-3 h-3" />
    </div>

    {/* File name skeleton */}
    <div className="col-span-4 flex items-center">
      <Shimmer className="h-4 w-full max-w-[200px]" />
    </div>

    {/* Date/Duration section skeleton */}
    <div className="col-span-5 grid grid-cols-3 gap-1 bg-muted/5 px-2 py-1 rounded-sm">
      <div className="flex items-center justify-center">
        <Shimmer className="h-3 w-16" />
      </div>
      <div className="flex items-center justify-center">
        <Shimmer className="h-3 w-16" />
      </div>
      <div className="flex items-center justify-center">
        <Shimmer className="h-4 w-12" />
      </div>
    </div>

    {/* Info button skeleton */}
    <div className="col-span-2 flex items-center justify-end">
      <Shimmer className="h-4 w-4" />
    </div>
  </div>
);

// Helper function to safely format dates with validation
const safeFormatDate = (dateValue: string | Date | null | undefined, formatString: string): string => {
  if (!dateValue) return 'Unknown';

  try {
    const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
    if (!isValid(date)) return 'Unknown';
    return format(date, formatString);
  } catch (error) {
    console.error('[DataTimeline] Invalid date format:', dateValue, error);
    return 'Unknown';
  }
};

// Helper function to parse various date formats to proper Date
const parseCustomDate = (dateString: string): Date | null => {
  if (!dateString) return null;

  // Handle DD/MM/YYYY format (from CSV files)
  const slashParts = dateString.split('/');
  if (slashParts.length === 3) {
    const [day, month, year] = slashParts;
    const standardFormat = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const parsed = parseISO(standardFormat);
    return isValid(parsed) ? parsed : null;
  }

  // Handle ISO format yyyy-mm-dd (standard ISO date format)
  const dashParts = dateString.split('-');
  if (dashParts.length === 3) {
    const [year, month, day] = dashParts;
    const standardFormat = `${year}-${month}-${day}`;
    const parsed = parseISO(standardFormat);
    return isValid(parsed) ? parsed : null;
  }

  // Try standard parsing as fallback
  const standardParsed = parseISO(dateString);
  return isValid(standardParsed) ? standardParsed : null;
};

// Helper function to calculate correct duration from corrected dates
const getCorrectDuration = (startDateString: string | null, endDateString: string | null): number | null => {
  if (!startDateString || !endDateString) return null;

  const startDate = parseCustomDate(startDateString);
  const endDate = parseCustomDate(endDateString);

  if (!startDate || !endDate) return null;

  return differenceInDays(endDate, startDate) + 1;
};

// Helper function to format date as YY-MM-DD
const formatCompactDate = (dateString: string | null): string => {
  if (!dateString) return '-';

  const date = parseCustomDate(dateString);
  if (!date) return dateString; // Return original if can't parse

  // Format as YY-MM-DD
  return format(date, 'yy-MM-dd');
};

// Helper function to check if file is a merged file
const isMergedFile = (file: PinFile & { pinLabel: string }): boolean => {
  return (file as any).fileSource === 'merged' ||
         file.pinId === 'merged' || // Check for special merged pinId
         file.fileName.includes('_merge_') ||
         file.fileName.includes('merge_std');
};

// Parse file name to extract Project_DataType_Station grouping key
// Example: "Control_FPOD_S_2024-01-15.csv" -> { project: "Control", dataType: "FPOD", station: "S" }
const parseFileGrouping = (fileName: string): { project: string; dataType: string; station: string; groupKey: string } | null => {
  const parts = fileName.split('_');
  if (parts.length < 3) return null;

  const project = parts[0];
  const dataType = parts[1];
  const station = parts[2];
  const groupKey = `${project}_${dataType}_${station}`;

  return { project, dataType, station, groupKey };
};

export function DataTimeline({ files, getFileDateRange, onFileClick, onDeleteFile, onRenameFile, onDatesUpdated, onSelectMultipleFiles, onOpenStackedPlots, projectId, onMergedFileClick, onAddFilesToMergedFile, multiFileMergeMode = false, onMultiFileMergeModeChange, viewMode: externalViewMode, pinColorMap: externalPinColorMap, tileName, onPairedFileClick }: DataTimelineProps) {
  const { toast } = useToast();
  const [filesWithDates, setFilesWithDates] = useState<FileWithDateRange[]>([]);
  const [internalViewMode, setInternalViewMode] = useState<'table' | 'timeline'>('timeline');

  // Use external viewMode if provided, otherwise use internal state
  const viewMode = externalViewMode ?? internalViewMode;
  const setViewMode = externalViewMode ? () => {} : setInternalViewMode;
  const [hasAnalyzed, setHasAnalyzed] = useState(true); // Always true since dates are from database
  const [deleteConfirmFile, setDeleteConfirmFile] = useState<{ id: string; name: string } | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | null>('asc'); // Start with alphabetical (asc)
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');
  const [fetchingTimesFor, setFetchingTimesFor] = useState<string | null>(null);
  const [openMenuFileId, setOpenMenuFileId] = useState<string | null>(null);
  const [isBulkFetching, setIsBulkFetching] = useState(false);
  const [showMergedView, setShowMergedView] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeGroupKey, setMergeGroupKey] = useState<string | null>(null);
  const [mergeFiles, setMergeFiles] = useState<FileWithDateRange[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());

  // Stack plot mode state
  const [stackPlotMode, setStackPlotMode] = useState(false);
  const [selectedForStack, setSelectedForStack] = useState<Set<string>>(new Set());

  // Raw CSV viewer state
  const [showRawViewer, setShowRawViewer] = useState(false);
  const [selectedFileForRaw, setSelectedFileForRaw] = useState<{ id: string; name: string } | null>(null);

  // FPOD file pairing map: fileId -> PairedTimelineEntry
  const [pairingMap, setPairingMap] = useState<Map<string, PairedTimelineEntry>>(new Map());

  // All files without pairing (for table view)
  const [allFilesWithDates, setAllFilesWithDates] = useState<FileWithDateRange[]>([]);

  // Toggle file selection for multi-file mode
  const toggleFileSelection = (fileId: string) => {
    setSelectedFileIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  };

  // Toggle file selection for stack plot mode
  const toggleStackSelection = (fileId: string) => {
    setSelectedForStack(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  };

  // Handle opening multiple files
  const handleOpenMultiFile = () => {
    if (!onSelectMultipleFiles || selectedFileIds.size < 2) {
      toast({
        variant: "destructive",
        title: "Selection Required",
        description: "Please select at least 2 files to merge"
      });
      return;
    }

    const selectedFiles = filesWithDates
      .filter(f => selectedFileIds.has(f.file.id))
      .map(f => f.file);

    onSelectMultipleFiles(selectedFiles);

    // Don't reset immediately - will reset after successful merge
  };

  // Handle opening stacked plots
  const handleOpenStackedPlots = async () => {
    if (selectedForStack.size < 2) {
      toast({
        variant: "destructive",
        title: "Selection Required",
        description: "Please select at least 2 files to open as stacked plots"
      });
      return;
    }

    const selectedFiles = filesWithDates
      .filter(f => selectedForStack.has(f.file.id))
      .map(f => f.file)
      .sort((a, b) => a.fileName.localeCompare(b.fileName)); // Sort alphabetically

    // Use the dedicated stacked plots callback if available
    if (onOpenStackedPlots) {
      onOpenStackedPlots(selectedFiles);
      // Reset selections and exit stack mode
      setSelectedForStack(new Set());
      setStackPlotMode(false);
      return;
    }

    // Fallback to sequential opening if callback not provided
    toast({
      title: "Opening Stacked Plots",
      description: `Loading ${selectedFiles.length} files sequentially...`
    });

    // Open each file sequentially with a small delay between each
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      await onFileClick(file);

      // Small delay to ensure plots render properly before opening next one
      if (i < selectedFiles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    toast({
      title: "Stacked Plots Opened",
      description: `Successfully opened ${selectedFiles.length} files in stacked plots`
    });

    // Reset selections and exit stack mode
    setSelectedForStack(new Set());
    setStackPlotMode(false);
  };

  // Reset merge mode when files change (after successful merge)
  useEffect(() => {
    // If we're in merge mode with selections, but the file list changes (new merge created),
    // reset the merge mode
    if (multiFileMergeMode && selectedFileIds.size > 0) {
      const allSelectedFilesStillExist = Array.from(selectedFileIds).every(id =>
        filesWithDates.some(f => f.file.id === id)
      );

      // If files changed significantly (merge was created), reset
      if (!allSelectedFilesStillExist || filesWithDates.length === 0) {
        setSelectedFileIds(new Set());
        onMultiFileMergeModeChange?.(false);
      }
    }
  }, [files.length]); // Watch for changes in file count

  // Delete file handler - just call parent's onDeleteFile
  const handleDeleteFile = async (file: PinFile & { pinLabel: string }) => {
    if (onDeleteFile) {
      onDeleteFile(file);
    }
  };

  // Rename file handler
  const handleRenameFile = async (file: PinFile & { pinLabel: string }) => {
    if (!onRenameFile || !renameValue.trim()) {
      setRenamingFileId(null);
      return;
    }

    const success = await onRenameFile(file, renameValue.trim());
    if (success) {
      // Update local state to reflect the name change
      setFilesWithDates(prev =>
        prev.map(f =>
          f.file.id === file.id
            ? { ...f, file: { ...f.file, fileName: renameValue.trim() } }
            : f
        )
      );
    }
    setRenamingFileId(null);
    setRenameValue('');
  };

  // Start renaming a file
  const startRename = (file: PinFile & { pinLabel: string }) => {
    setRenamingFileId(file.id);
    setRenameValue(file.fileName);
  };

  // Handle file click - routes to paired handler if file is part of an FPOD pair
  const handleFileOpen = (file: PinFile & { pinLabel: string }) => {
    const pairing = pairingMap.get(file.id);
    console.log('[FPOD-PAIRING] handleFileOpen:', {
      fileName: file.fileName,
      fileId: file.id,
      hasPairing: !!pairing,
      isPaired: pairing?.isPaired,
      pairedFileName: pairing?.pairedFile?.fileName,
      hasCallback: !!onPairedFileClick,
      pairingMapSize: pairingMap.size,
    });
    if (pairing?.isPaired && pairing.pairedFile && onPairedFileClick) {
      console.log('[FPOD-PAIRING] Routing to paired click handler');
      onPairedFileClick(pairing.displayFile, pairing.pairedFile);
    } else {
      console.log('[FPOD-PAIRING] Routing to normal file click');
      onFileClick(file);
    }
  };

  // Get display name for a file, appending paired indicator if applicable
  const getPairedDisplayName = (file: PinFile & { pinLabel: string }): string | null => {
    const pairing = pairingMap.get(file.id);
    if (pairing?.isPaired) {
      return '(Std + Avg)';
    }
    return null;
  };

  // Bulk fetch missing dates
  const handleFetchMissingDates = async () => {
    const filesWithoutDates = filesWithDates.filter(
      ({ dateRange, file }) =>
        (!dateRange.startDate || !dateRange.endDate) && !isMergedFile(file)
    );

    if (filesWithoutDates.length === 0) {
      toast({
        title: "All dates present",
        description: "All files already have start and end dates (merged files skipped)"
      });
      return;
    }

    setIsBulkFetching(true);

    try {
      toast({
        title: "Fetching missing dates...",
        description: `Analyzing ${filesWithoutDates.length} file(s)`
      });

      let successCount = 0;
      let errorCount = 0;

      // Process files sequentially to avoid overwhelming the system
      for (const fileWithDate of filesWithoutDates) {
        const file = fileWithDate.file;
        setFetchingTimesFor(file.id);

        try {
          // Get date range from CSV
          const result = await getFileDateRange(file);

          if (result.error || !result.startDate || !result.endDate) {
            errorCount++;
            continue;
          }

          // Convert dates from DD/MM/YYYY to YYYY-MM-DD format for database
          const convertToDbFormat = (dateStr: string): string => {
            const parts = dateStr.split('/');
            if (parts.length === 3) {
              const [day, month, year] = parts;
              return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }
            return dateStr;
          };

          const startDateDb = convertToDbFormat(result.startDate);
          const endDateDb = convertToDbFormat(result.endDate);

          console.log(`[DataTimeline] Updating ${file.fileName}:`, { fileId: file.id, startDateDb, endDateDb });

          // Update database with dates
          const { updateFileDatesAction } = await import('@/app/data-explorer/actions');
          const updateResult = await updateFileDatesAction(
            file.id,
            startDateDb,
            endDateDb,
            result.isCrop,
            result.uniqueDates
          );

          console.log(`[DataTimeline] Update result for ${file.fileName}:`, updateResult);

          if (!updateResult.success) {
            console.error(`[DataTimeline] Failed to update ${file.fileName}:`, updateResult.error);

            // Show a specific toast for pin-related errors
            if (updateResult.error?.includes('Pin not found')) {
              toast({
                variant: "destructive",
                title: "Skipped orphaned file",
                description: `${file.fileName} has no associated pin`
              });
            }

            errorCount++;
            continue;
          }

          console.log(`[DataTimeline] Successfully updated ${file.fileName} with dates`);

          // Update local state
          setFilesWithDates(prev =>
            prev.map(f =>
              f.file.id === file.id
                ? {
                    ...f,
                    file: {
                      ...f.file,
                      startDate: new Date(startDateDb),
                      endDate: new Date(endDateDb)
                    },
                    dateRange: {
                      startDate: startDateDb,
                      endDate: endDateDb,
                      totalDays: result.totalDays,
                      uniqueDates: result.uniqueDates,
                      isCrop: result.isCrop,
                      loading: false
                    }
                  }
                : f
            )
          );

          successCount++;
        } catch (error) {
          console.error(`Error fetching dates for ${file.fileName}:`, error);
          errorCount++;
        }
      }

      setFetchingTimesFor(null);

      // Show result
      if (successCount > 0) {
        toast({
          title: "Dates fetched successfully",
          description: `Updated ${successCount} file(s)${errorCount > 0 ? `, ${errorCount} failed` : ''}`
        });

        // Notify parent to reload files
        if (onDatesUpdated) {
          onDatesUpdated();
        }
      } else {
        toast({
          variant: "destructive",
          title: "Failed to fetch dates",
          description: `Could not fetch dates for any files`
        });
      }
    } catch (error) {
      console.error('Error in bulk fetch:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : 'Failed to fetch dates'
      });
    } finally {
      setIsBulkFetching(false);
      setFetchingTimesFor(null);
    }
  };

  // Check if any files are missing dates (exclude merged files)
  const hasMissingDates = useMemo(() => {
    return filesWithDates.some(({ dateRange, file }) =>
      (!dateRange.startDate || !dateRange.endDate) && !isMergedFile(file)
    );
  }, [filesWithDates]);

  // Count files missing dates (exclude merged files)
  const missingDatesCount = useMemo(() => {
    return filesWithDates.filter(({ dateRange, file }) =>
      (!dateRange.startDate || !dateRange.endDate) && !isMergedFile(file)
    ).length;
  }, [filesWithDates]);

  // Toggle sort order handler
  const toggleSortOrder = () => {
    setSortOrder(current => {
      if (current === 'asc') return 'desc';
      if (current === 'desc') return null;
      return 'asc';
    });
  };

  // Apply sorting to filesWithDates
  const sortedFilesWithDates = useMemo(() => {
    if (!sortOrder) return filesWithDates;

    return [...filesWithDates].sort((a, b) => {
      const nameA = a.file.fileName;
      const nameB = b.file.fileName;

      if (sortOrder === 'asc') {
        return nameA.localeCompare(nameB);
      } else {
        return nameB.localeCompare(nameA);
      }
    });
  }, [filesWithDates, sortOrder]);

  // Apply sorting to allFilesWithDates (for table view - shows all files without pairing)
  const sortedAllFilesWithDates = useMemo(() => {
    if (!sortOrder) return allFilesWithDates;

    return [...allFilesWithDates].sort((a, b) => {
      const nameA = a.file.fileName;
      const nameB = b.file.fileName;

      if (sortOrder === 'asc') {
        return nameA.localeCompare(nameB);
      } else {
        return nameB.localeCompare(nameA);
      }
    });
  }, [allFilesWithDates, sortOrder]);

  // Helper function to extract prefix from pin label
  const getPinPrefix = (pinLabel: string): string => {
    // Extract the location identifier by removing data type suffixes
    // Examples:
    // "Farm 1 - FPOD" -> "Farm 1"
    // "Farm 1 FPOD" -> "Farm 1"
    // "Control A - SubCam" -> "Control A"
    // "Control A SubCam" -> "Control A"
    // "All Locations" -> "All Locations" (special case)

    // Special case: "All Locations" should be its own group
    if (pinLabel === 'All Locations') {
      return 'All Locations';
    }

    // First, try splitting by " - " (common separator)
    const dashSplit = pinLabel.split(' - ');
    if (dashSplit.length > 1) {
      return dashSplit[0].trim();
    }

    // If no " - ", try to remove known data type suffixes from the end
    const knownSuffixes = [
      'FPOD', 'SubCam', 'GP', 'GrowProbe',
      'EDNA', 'EDNAW', 'EDNAS',
      'WQ', 'CHEM', 'CHEMSW', 'CHEMWQ', 'CROP',
      'Hapl', 'Taxo', 'Cred', 'Meta'
    ];

    let result = pinLabel.trim();

    // Try to remove suffixes (case-insensitive, with space, underscore, or dash separator)
    for (const suffix of knownSuffixes) {
      const patterns = [
        ` ${suffix}`,    // "Farm 1 FPOD"
        `_${suffix}`,    // "Farm1_FPOD"
        `-${suffix}`,    // "Farm1-FPOD"
      ];

      for (const pattern of patterns) {
        if (result.toLowerCase().endsWith(pattern.toLowerCase())) {
          result = result.slice(0, -pattern.length).trim();
          break;
        }
      }
    }

    // If nothing was removed, return the original label
    return result || pinLabel;
  };

  // Create pin-based color mapping grouped by prefix
  // Use external color map if provided (for consistency across tiles), otherwise compute locally
  const pinColorMap = useMemo(() => {
    // If external color map is provided, use it
    if (externalPinColorMap) {
      return externalPinColorMap;
    }

    // Otherwise, compute color map based on pin prefixes
    // First, group pins by their prefix
    const prefixGroups = new Map<string, string[]>();
    files.forEach(f => {
      const prefix = getPinPrefix(f.pinLabel);
      if (!prefixGroups.has(prefix)) {
        prefixGroups.set(prefix, []);
      }
      prefixGroups.get(prefix)!.push(f.pinLabel);
    });

    // Assign colors to prefixes
    const prefixColorMap = new Map<string, string>();
    Array.from(prefixGroups.keys()).sort().forEach((prefix, index) => {
      prefixColorMap.set(prefix, COLORS[index % COLORS.length]);
    });

    // Map each pin label to its prefix color
    const colorMap = new Map<string, string>();
    files.forEach(f => {
      const prefix = getPinPrefix(f.pinLabel);
      const color = prefixColorMap.get(prefix) || COLORS[0];
      colorMap.set(f.pinLabel, color);
    });

    return colorMap;
  }, [files, externalPinColorMap]);

  // Create merged groups based on Project_DataType_Station
  const mergedGroups = useMemo(() => {
    const groups = new Map<string, MergedGroup>();

    sortedFilesWithDates.forEach((fileWithDate) => {
      const grouping = parseFileGrouping(fileWithDate.file.fileName);
      if (!grouping) return; // Skip files that don't match the naming pattern

      const { groupKey, project, dataType, station } = grouping;

      if (!groups.has(groupKey)) {
        // Initialize new group
        groups.set(groupKey, {
          groupKey,
          project,
          dataType,
          station,
          files: [],
          startDate: null,
          endDate: null,
          totalDays: null,
          color: pinColorMap.get(fileWithDate.file.pinLabel) || COLORS[0]
        });
      }

      const group = groups.get(groupKey)!;
      group.files.push(fileWithDate);

      // Update merged date range
      if (fileWithDate.dateRange.startDate && fileWithDate.dateRange.endDate) {
        const fileStart = parseCustomDate(fileWithDate.dateRange.startDate);
        const fileEnd = parseCustomDate(fileWithDate.dateRange.endDate);

        if (fileStart && fileEnd) {
          const groupStart = group.startDate ? parseCustomDate(group.startDate) : null;
          const groupEnd = group.endDate ? parseCustomDate(group.endDate) : null;

          // Update earliest start date
          if (!groupStart || fileStart < groupStart) {
            group.startDate = fileWithDate.dateRange.startDate;
          }

          // Update latest end date
          if (!groupEnd || fileEnd > groupEnd) {
            group.endDate = fileWithDate.dateRange.endDate;
          }

          // Recalculate total days
          if (group.startDate && group.endDate) {
            group.totalDays = getCorrectDuration(group.startDate, group.endDate);
          }
        }
      }
    });

    // Sort groups alphabetically by groupKey
    return Array.from(groups.values()).sort((a, b) => a.groupKey.localeCompare(b.groupKey));
  }, [sortedFilesWithDates, pinColorMap]);

  // Initialize files with dates from database
  useEffect(() => {
    if (files.length === 0) {
      setFilesWithDates([]);
      setPairingMap(new Map());
      return;
    }

    // Apply FPOD pairing when tileName is 'FPOD' and not in stack plot selection mode
    const shouldPair = tileName === 'FPOD' && !stackPlotMode && selectedFileIds.size === 0;
    let filesToDisplay = files;
    const newPairingMap = new Map<string, PairedTimelineEntry>();

    console.log('[FPOD-PAIRING] Init effect running:', {
      tileName,
      shouldPair,
      stackPlotMode,
      selectedFileIdsSize: selectedFileIds.size,
      fileCount: files.length,
      fileNames: files.map(f => f.fileName),
    });

    if (shouldPair) {
      const pairedEntries = createPairedTimelineEntries(files);
      console.log('[FPOD-PAIRING] Paired entries:', pairedEntries.map(e => ({
        display: e.displayFile.fileName,
        paired: e.pairedFile?.fileName || null,
        isPaired: e.isPaired,
      })));
      // Build a display list using only the displayFile from each entry
      filesToDisplay = pairedEntries.map(entry => entry.displayFile);
      // Build pairing map keyed by displayFile id
      for (const entry of pairedEntries) {
        newPairingMap.set(entry.displayFile.id, entry);
      }
      console.log('[FPOD-PAIRING] Display files after pairing:', filesToDisplay.map(f => f.fileName));
      console.log('[FPOD-PAIRING] Pairing map size:', newPairingMap.size);
    }

    setPairingMap(newPairingMap);

    // Sort files alphabetically by fileName
    const sortedFiles = [...filesToDisplay].sort((a, b) =>
      a.fileName.localeCompare(b.fileName)
    );

    // Helper to create FileWithDateRange from a file
    const createFileWithDateRange = (file: PinFile & { pinLabel: string }): FileWithDateRange => {
      let startDate: string | null = null;
      let endDate: string | null = null;
      let totalDays: number | null = null;

      // Get dates from file if available (from database)
      if (file.startDate && file.endDate) {
        const start = new Date(file.startDate);
        const end = new Date(file.endDate);

        // Format dates as YYYY-MM-DD
        startDate = format(start, 'yyyy-MM-dd');
        endDate = format(end, 'yyyy-MM-dd');

        // Calculate duration
        totalDays = differenceInDays(end, start) + 1;
      }

      return {
        file,
        dateRange: {
          totalDays,
          startDate,
          endDate,
          uniqueDates: file.uniqueDates,
          isCrop: file.isDiscrete,
          loading: false
        }
      };
    };

    // Initialize files with date range data from database (for timeline - may be paired)
    const initialFiles = sortedFiles.map(createFileWithDateRange);
    setFilesWithDates(initialFiles);

    // Also store ALL files without pairing (for table view)
    const allSortedFiles = [...files].sort((a, b) => a.fileName.localeCompare(b.fileName));
    const allInitialFiles = allSortedFiles.map(createFileWithDateRange);
    setAllFilesWithDates(allInitialFiles);

    setHasAnalyzed(true); // Mark as analyzed since dates are from database
  }, [files, tileName, stackPlotMode, selectedFileIds.size]);

  // Calculate timeline bounds and headers
  const timelineData = useMemo(() => {
    // Use merged groups or individual files based on toggle
    const dataSource = showMergedView ? mergedGroups : sortedFilesWithDates;

    if (dataSource.length === 0) {
      return { months: [], years: [], minDate: null, maxDate: null, totalDays: 0 };
    }

    // Extract dates based on data source type
    let allStartDates: Date[] = [];
    let allEndDates: Date[] = [];

    if (showMergedView) {
      // Use merged group dates
      mergedGroups.forEach((group) => {
        if (group.startDate && group.endDate) {
          const start = parseCustomDate(group.startDate);
          const end = parseCustomDate(group.endDate);
          if (start) allStartDates.push(start);
          if (end) allEndDates.push(end);
        }
      });
    } else {
      // Use individual file dates
      sortedFilesWithDates
        .filter(({ dateRange }) => !dateRange.loading && !dateRange.error && dateRange.startDate && dateRange.endDate)
        .forEach(({ dateRange }) => {
          const start = parseCustomDate(dateRange.startDate!);
          const end = parseCustomDate(dateRange.endDate!);
          if (start) allStartDates.push(start);
          if (end) allEndDates.push(end);
        });
    }

    if (allStartDates.length === 0 || allEndDates.length === 0) {
      return { months: [], years: [], minDate: null, maxDate: null, totalDays: 0 };
    }

    let minDate = new Date(Math.min(...allStartDates.map(d => d.getTime())));
    let maxDate = new Date(Math.max(...allEndDates.map(d => d.getTime())));

    // If all data falls within a short range (e.g., same month), expand to show full month(s)
    // This ensures bars don't span 100% width when all data has the same date
    const actualRange = differenceInDays(maxDate, minDate) + 1;
    if (actualRange < 14) {
      // Expand timeline to show the full month(s) the data falls in
      minDate = startOfMonth(minDate);
      maxDate = endOfMonth(maxDate);
    }

    // Generate ALL months between minDate and maxDate for proper alignment
    // This ensures month headers align with the timeline bars
    const months = eachMonthOfInterval({
      start: startOfMonth(minDate),
      end: endOfMonth(maxDate)
    });

    // Generate year headers based on actual data months
    const years: Array<{year: number, startMonth: number, monthCount: number}> = [];
    if (months.length > 0) {
      let currentYear = getYear(months[0]);
      let startMonth = 0;
      let monthCount = 0;

      months.forEach((month, index) => {
        const monthYear = getYear(month);
        if (monthYear === currentYear) {
          monthCount++;
        } else {
          years.push({ year: currentYear, startMonth, monthCount });
          currentYear = monthYear;
          startMonth = index;
          monthCount = 1;
        }
      });
      // Add the last year
      if (monthCount > 0) {
        years.push({ year: currentYear, startMonth, monthCount });
      }
    }

    const totalDays = differenceInDays(maxDate, minDate) + 1;

    return { months, years, minDate, maxDate, totalDays };
  }, [sortedFilesWithDates, mergedGroups, showMergedView]);

  // Calculate bar positions and widths for individual files
  const calculateBarMetrics = (file: FileWithDateRange) => {
    if (!timelineData.minDate || !timelineData.totalDays ||
        !file.dateRange.startDate || !file.dateRange.endDate) {
      return { left: 0, width: 0 };
    }

    const startDate = parseCustomDate(file.dateRange.startDate);
    const endDate = parseCustomDate(file.dateRange.endDate);

    if (!startDate || !endDate) {
      console.warn(`Invalid dates for ${file.file.fileName}:`, {
        startDate: file.dateRange.startDate,
        endDate: file.dateRange.endDate
      });
      return { left: 0, width: 0 };
    }

    const daysFromStart = differenceInDays(startDate, timelineData.minDate);
    const barDuration = differenceInDays(endDate, startDate) + 1;

    const left = Math.max(0, (daysFromStart / timelineData.totalDays) * 100);
    const width = Math.max(0.1, (barDuration / timelineData.totalDays) * 100);

    return { left, width };
  };

  // Calculate discrete bar metrics for CROP files (one bar per sampling day)
  const calculateDiscreteBars = (file: FileWithDateRange): Array<{left: number; width: number; date: string}> => {
    if (!timelineData.minDate || !timelineData.totalDays || !file.dateRange.uniqueDates) {
      return [];
    }

    return file.dateRange.uniqueDates.map(dateStr => {
      const samplingDate = parseCustomDate(dateStr);
      if (!samplingDate) return null;

      const daysFromStart = differenceInDays(samplingDate, timelineData.minDate);
      const barDuration = 1; // Each bar is 1 day

      const left = Math.max(0, (daysFromStart / timelineData.totalDays) * 100);
      const width = Math.max(0.3, (barDuration / timelineData.totalDays) * 100); // Minimum 0.3% width for visibility

      return { left, width, date: dateStr };
    }).filter(bar => bar !== null) as Array<{left: number; width: number; date: string}>;
  };

  // Calculate bar positions and widths for merged groups
  const calculateMergedBarMetrics = (group: MergedGroup) => {
    if (!timelineData.minDate || !timelineData.totalDays ||
        !group.startDate || !group.endDate) {
      return { left: 0, width: 0 };
    }

    const startDate = parseCustomDate(group.startDate);
    const endDate = parseCustomDate(group.endDate);

    if (!startDate || !endDate) {
      return { left: 0, width: 0 };
    }

    const daysFromStart = differenceInDays(startDate, timelineData.minDate);
    const barDuration = differenceInDays(endDate, startDate) + 1;

    const left = Math.max(0, (daysFromStart / timelineData.totalDays) * 100);
    const width = Math.max(0.1, (barDuration / timelineData.totalDays) * 100);

    return { left, width };
  };

  // Helper function to format date range for timeline display names
  const formatDateRangeForDisplay = (startDate: string | null, endDate: string | null): string => {
    if (!startDate || !endDate) return '';

    const start = parseCustomDate(startDate);
    const end = parseCustomDate(endDate);

    if (!start || !end) return '';

    const startMonth = format(start, 'MMM');
    const endMonth = format(end, 'MMM');
    const startYear = format(start, 'yyyy');
    const endYear = format(end, 'yyyy');

    // Same month and year
    if (startMonth === endMonth && startYear === endYear) {
      return `${startMonth} ${startYear}`;
    }

    // Different months, same year
    if (startYear === endYear) {
      return `${startMonth}-${endMonth} ${startYear}`;
    }

    // Different years
    return `${startMonth} ${startYear} - ${endMonth} ${endYear}`;
  };

  // Helper function to get categories for a file
  const getFileCategories = (fileName: string): string => {
    const matches = categorizeFile(fileName);

    if (matches.length === 0) return '';

    // Extract categories and filter out undefined ones
    const categories = matches
      .map(match => match.category)
      .filter((cat): cat is string => cat !== undefined);

    if (categories.length === 0) return '';

    // Join multiple categories with comma
    return categories.join(', ');
  };

  // Helper function to determine file category (which tile it belongs to)
  const getFileCategory = (fileName: string): string => {
    const fileNameLower = fileName.toLowerCase();
    const parts = fileName.split('_');
    const position0 = parts[0]?.toLowerCase() || '';
    const position1 = parts[1]?.toLowerCase() || '';

    if (position0.includes('crop') || position1.includes('crop')) {
      return 'CROP';
    } else if (position0.includes('chemsw') || position1.includes('chemsw')) {
      return 'CHEMSW';
    } else if (position0.includes('chemwq') || position1.includes('chemwq')) {
      return 'CHEMWQ';
    } else if (position0.includes('chem') || position1.includes('chem') || fileNameLower.includes('_chem')) {
      return 'CHEM';
    } else if (position0.includes('wq') || position1.includes('wq') || fileNameLower.includes('_wq')) {
      return 'WQ';
    } else if (position0.includes('edna') || position1.includes('edna') || fileNameLower.includes('_edna')) {
      return 'EDNA';
    } else if (position0.includes('fpod') || position1.includes('fpod')) {
      return 'FPOD';
    } else if (position0.includes('subcam') || position1.includes('subcam')) {
      return 'SUBCAM';
    } else if (position0.includes('gp') || position1.includes('gp')) {
      return 'GP';
    }

    return 'OTHER';
  };


  // Helper function to check if we need to show suffix
  const shouldShowSuffix = (
    file: PinFile & { pinLabel: string },
    dateRange: { startDate: string | null; endDate: string | null },
    allFiles: FileWithDateRange[]
  ): boolean => {
    // Count files with same pin label (location)
    const sameLocationFiles = allFiles.filter(f => {
      if (f.file.id === file.id) return false; // Exclude self
      if (f.file.pinLabel !== file.pinLabel) return false; // Different location
      if (isMergedFile(f.file)) return false; // Ignore merged files

      return true; // Same location
    });

    return sameLocationFiles.length > 0; // If there are other files with same location, show suffix
  };

  // Helper function to extract location from FPOD merged files
  const extractLocationFromMergedFile = (fileName: string): string | null => {
    // Check if this is an FPOD file
    const fileNameLower = fileName.toLowerCase();
    if (!fileNameLower.includes('fpod')) {
      return null;
    }

    // Extract station from FPOD filenames
    // Pattern: Project_FPOD_Station_Parts_Date.csv
    // Examples: Control_FPOD_C_S_2024.csv → "C_S"
    //           Farm_FPOD_F_AS_2024.csv → "F_AS"
    //           Project_FPOD_merge_2024.csv → null
    const parts = fileName.split('_');
    const fpodIndex = parts.findIndex(p => p.toLowerCase() === 'fpod');

    if (fpodIndex >= 0 && fpodIndex < parts.length - 1) {
      const stationParts: string[] = [];

      // Collect parts after FPOD until we hit a date, merge, or end
      for (let i = fpodIndex + 1; i < parts.length; i++) {
        const part = parts[i];

        // Stop if we hit a year (starts with 4 digits)
        if (part.match(/^\d{4}/)) break;

        // Stop if we hit 'merge' keyword (not a location)
        if (part.toLowerCase().includes('merge')) break;

        // Stop if part contains file extension
        if (part.includes('.')) break;

        // Stop if part is empty
        if (!part || part.trim() === '') break;

        // Add this part to station
        stationParts.push(part);

        // Stop after collecting 3 parts max (reasonable limit)
        if (stationParts.length >= 3) break;
      }

      if (stationParts.length > 0) {
        const station = stationParts.join('_');
        // Validate that it's a reasonable station code
        if (station.length <= 20) {
          return station;
        }
      }
    }

    return null;
  };

  // Main display name generator for timeline view
  const getTimelineDisplayName = (
    file: PinFile & { pinLabel: string },
    dateRange: { startDate: string | null; endDate: string | null },
    allFiles: FileWithDateRange[],
    skipCategories: boolean = false
  ): string => {
    const dateRangeStr = formatDateRangeForDisplay(dateRange.startDate, dateRange.endDate);

    // Merged files
    if (isMergedFile(file)) {
      const categories = skipCategories ? '' : getFileCategories(file.fileName);

      // Use the actual pin label if available and not generic
      let locationLabel = file.pinLabel;

      // If pinLabel is generic or missing, try to extract from filename
      // But preserve "All Locations" label if it's set
      if (locationLabel === 'All Locations') {
        // Keep "All Locations" as-is
      } else if (!locationLabel || locationLabel === 'Unknown Pin' || locationLabel === 'Merged Files' || locationLabel === 'Merged') {
        const extractedLocation = extractLocationFromMergedFile(file.fileName);
        locationLabel = extractedLocation || 'Unassigned';
      }

      return categories
        ? `${locationLabel} • ${dateRangeStr} (${categories})`
        : `${locationLabel} • ${dateRangeStr}`;
    }

    // Unassigned files (no valid pin ID or area ID)
    const hasValidId = file.pinId || file.areaId;
    const hasValidLabel = file.pinLabel && file.pinLabel !== 'Unknown' && file.pinLabel !== '';

    if (!hasValidId || !hasValidLabel) {
      // Check if this is an "All Locations" file (files with "all" in name)
      if (file.pinLabel === 'All Locations') {
        const categories = skipCategories ? '' : getFileCategories(file.fileName);
        return categories
          ? `All Locations • ${dateRangeStr} (${categories})`
          : `All Locations • ${dateRangeStr}`;
      }

      const categories = skipCategories ? '' : getFileCategories(file.fileName);
      return categories
        ? `Unassigned • ${dateRangeStr} (${categories})`
        : `Unassigned • ${dateRangeStr}`;
    }

    // Pin-linked files
    // Always show categories for:
    // - Water/Crop files
    // - "All Locations" files (since they aggregate data from multiple locations)
    // - Files with multiple files at same location
    // But skip if this is a paired file (paired indicator shown separately)
    if (skipCategories) {
      return `${file.pinLabel} • ${dateRangeStr}`;
    }

    const fileNameLower = file.fileName.toLowerCase();
    const isWaterOrCrop = fileNameLower.includes('chem') ||
                          fileNameLower.includes('_wq') ||
                          fileNameLower.includes('crop');
    const isAllLocations = file.pinLabel === 'All Locations';
    const categories = (isWaterOrCrop || isAllLocations || shouldShowSuffix(file, dateRange, allFiles))
      ? getFileCategories(file.fileName)
      : null;
    return categories
      ? `${file.pinLabel} • ${dateRangeStr} (${categories})`
      : `${file.pinLabel} • ${dateRangeStr}`;
  };

  if (filesWithDates.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        No data files to display
      </div>
    );
  }

  return (
    <div className="space-y-0">
      <div className="flex items-center justify-between p-2.5">
        <div className="flex items-center gap-2">
          {/* Select All / Deselect All Toggle Button - Show when in merge mode or stack plot mode */}
          {(multiFileMergeMode || stackPlotMode) && (() => {
            const allFileIds = sortedFilesWithDates.map(f => f.file.id);
            const currentSelection = stackPlotMode ? selectedForStack : selectedFileIds;
            const allSelected = allFileIds.length > 0 && allFileIds.every(id => currentSelection.has(id));

            return (
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2"
                onClick={() => {
                  if (allSelected) {
                    // Deselect all files
                    if (stackPlotMode) {
                      setSelectedForStack(new Set());
                    } else if (multiFileMergeMode) {
                      setSelectedFileIds(new Set());
                    }
                  } else {
                    // Select all files in current view
                    const allFileIdsSet = new Set(allFileIds);
                    if (stackPlotMode) {
                      setSelectedForStack(allFileIdsSet);
                    } else if (multiFileMergeMode) {
                      setSelectedFileIds(allFileIdsSet);
                    }
                  }
                }}
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                <span className="text-xs">
                  {allSelected ? 'Deselect All' : `Select All (${sortedFilesWithDates.length})`}
                </span>
              </Button>
            );
          })()}

          {/* Stack Plots - Open Stacked Plots Button (when 2+ selected) */}
          {stackPlotMode && selectedForStack.size >= 2 ? (
            <Button
              variant="default"
              size="sm"
              className="h-6 px-2 bg-blue-600 hover:bg-blue-700"
              onClick={handleOpenStackedPlots}
            >
              <PlayCircle className="h-3 w-3 mr-1" />
              <span className="text-xs">Open Stacked Plots ({selectedForStack.size})</span>
            </Button>
          ) : (
            // "📊 Stack Plots" button to toggle stack plot mode
            <Button
              variant={stackPlotMode ? 'default' : 'outline'}
              size="sm"
              className="h-6 px-2"
              onClick={() => {
                const newMode = !stackPlotMode;
                setStackPlotMode(newMode);
                if (!newMode) {
                  setSelectedForStack(new Set());
                }
                // Turn off merge mode when entering stack mode
                if (newMode && multiFileMergeMode) {
                  onMultiFileMergeModeChange?.(false);
                  setSelectedFileIds(new Set());
                }
              }}
            >
              <Layers className="h-3 w-3 mr-1" />
              <span className="text-xs">Stack Plots</span>
            </Button>
          )}

          {/* Merge Button / Merge Selected Files Button */}
          {multiFileMergeMode && selectedFileIds.size >= 2 ? (
            // Green "Merge Selected Files" button when files are selected
            <Button
              variant="default"
              size="sm"
              className="h-6 px-2 bg-green-600 hover:bg-green-700"
              onClick={handleOpenMultiFile}
            >
              <Combine className="h-3 w-3 mr-1" />
              <span className="text-xs">Merge Selected Files ({selectedFileIds.size})</span>
            </Button>
          ) : (
            // "+ Merge" button when no files or less than 2 files selected
            onSelectMultipleFiles && (
              <Button
                variant={multiFileMergeMode ? 'default' : 'outline'}
                size="sm"
                className="h-6 px-2"
                onClick={() => {
                  const newMode = !multiFileMergeMode;
                  onMultiFileMergeModeChange?.(newMode);
                  if (!newMode) {
                    setSelectedFileIds(new Set());
                  }
                  // Turn off stack mode when entering merge mode
                  if (newMode && stackPlotMode) {
                    setStackPlotMode(false);
                    setSelectedForStack(new Set());
                  }
                }}
              >
                <Plus className="h-3 w-3 mr-1" />
                <span className="text-xs">Merge</span>
              </Button>
            )
          )}

          {/* Fetch Missing Dates Button - Show when there are missing dates */}
          {hasMissingDates && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2"
              onClick={handleFetchMissingDates}
              disabled={isBulkFetching}
            >
              {isBulkFetching ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  <span className="text-xs">Fetching...</span>
                </>
              ) : (
                <>
                  <Clock className="h-3 w-3 mr-1" />
                  <span className="text-xs">Fetch Dates ({missingDatesCount})</span>
                </>
              )}
            </Button>
          )}

          {/* Merged View Toggle - Show in timeline mode */}
          {viewMode === 'timeline' && (
            <div className="flex items-center gap-2 bg-muted/30 rounded px-2 py-1">
              <Layers className="h-3 w-3 text-muted-foreground" />
              <Label htmlFor="merge-toggle" className="text-xs cursor-pointer">
                Group Locations
              </Label>
              <Switch
                id="merge-toggle"
                checked={showMergedView}
                onCheckedChange={setShowMergedView}
                className="h-4 data-[state=checked]:bg-primary"
              />
            </div>
          )}

          {/* View Mode Toggle - Only shown when not controlled externally */}
          {!externalViewMode && (
            <div className="flex items-center gap-1 bg-muted/50 rounded p-1">
              <Button
                variant={viewMode === 'table' ? 'default' : 'ghost'}
                size="sm"
                className="h-6 px-2"
                onClick={() => setViewMode('table')}
              >
                <Calendar className="h-3 w-3 mr-1" />
                <span className="text-xs">Table</span>
              </Button>
              <Button
                variant={viewMode === 'timeline' ? 'default' : 'ghost'}
                size="sm"
                className="h-6 px-2"
                onClick={() => setViewMode('timeline')}
              >
                <BarChart3 className="h-3 w-3 mr-1" />
                <span className="text-xs">Timeline</span>
              </Button>
            </div>
          )}
        </div>
      </div>

        {/* TABLE VIEW: Detailed Start/End Dates - Shows ALL files without pairing */}
        {viewMode === 'table' && (
        <div className="space-y-1">
          {sortedAllFilesWithDates.length > 0 && (
            <div className="bg-white rounded p-3 transition-all duration-300 border">
              <table className="w-full table-fixed border-collapse">
                <thead>
                  <tr className="border-b border-border/30 text-xs font-medium text-muted-foreground">
                    {(multiFileMergeMode || stackPlotMode) && <th className="text-left pb-2 pr-2 w-8"></th>}
                    <th className="text-left pb-2 pr-2">Pin</th>
                    <th className="text-left pb-2 pr-2">File Name</th>
                    <th className="text-center pb-2 px-2 bg-muted/10 rounded-tl-sm">Start Date</th>
                    <th className="text-center pb-2 px-2 bg-muted/10">End Date</th>
                    <th className="text-center pb-2 px-2 bg-muted/10 rounded-tr-sm">Duration</th>
                  </tr>
                </thead>
                <tbody>
                {sortedAllFilesWithDates.map((fileWithDate, index) => {
                    const { file, dateRange } = fileWithDate;
                    const color = pinColorMap.get(file.pinLabel) || COLORS[0];
                    
                    return (
                      <tr
                        key={`table-${file.id}-${index}`}
                        className="h-[22px] text-xs hover:bg-muted/30 transition-colors opacity-0 animate-[fadeIn_0.4s_ease-in-out_forwards]"
                        style={{ animationDelay: `${index * 30}ms` }}
                      >
                        {/* Checkbox for multi-file selection (merge or stack plot mode) */}
                        {(multiFileMergeMode || stackPlotMode) && (
                          <td className="pr-2 align-middle">
                            <Checkbox
                              checked={stackPlotMode ? selectedForStack.has(file.id) : selectedFileIds.has(file.id)}
                              onCheckedChange={() => stackPlotMode ? toggleStackSelection(file.id) : toggleFileSelection(file.id)}
                              className="flex-shrink-0"
                            />
                          </td>
                        )}

                        {/* Pin indicator / Merge icon */}
                        <td className="pr-2 align-middle">
                          {isMergedFile(file) ? (
                            <Combine
                              className="w-3 h-3 text-green-600"
                              title="Merged File"
                            />
                          ) : (
                            <div
                              className="w-3 h-3 rounded-sm transition-transform hover:scale-110"
                              style={{ backgroundColor: color }}
                              title={file.pinLabel}
                            />
                          )}
                        </td>

                        {/* File name - Clickable with menu */}
                        <td className="pr-2 align-middle">
                          {renamingFileId === file.id ? (
                            // Show rename input field when renaming
                            <div className="flex items-center gap-1">
                              <Input
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    handleRenameFile(fileWithDate.file);
                                  } else if (e.key === 'Escape') {
                                    setRenamingFileId(null);
                                  }
                                }}
                                className="h-7 text-xs font-mono"
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 shrink-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRenameFile(fileWithDate.file);
                                }}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 shrink-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenamingFileId(null);
                                }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            // Show file name with menu when not renaming
                            <Popover open={openMenuFileId === file.id} onOpenChange={(open) => setOpenMenuFileId(open ? file.id : null)}>
                              <PopoverTrigger asChild>
                                <button
                                  className="font-mono truncate text-left hover:text-primary hover:underline transition-colors cursor-pointer w-full text-left"
                                  title={`Click for actions on ${file.fileName}`}
                                >
                                  {file.fileName.replace(/^FPOD_/, '')}
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="min-w-[400px] p-0" align="start">
                              <div className="flex flex-col">
                                {/* Open option - always opens single file in table view */}
                                <button
                                  onClick={() => {
                                    setOpenMenuFileId(null);
                                    onFileClick(fileWithDate.file);
                                  }}
                                  className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted transition-colors text-left"
                                >
                                  <FileText className="h-4 w-4" />
                                  <div>
                                    <div className="font-medium">Open</div>
                                    <div className="text-xs text-muted-foreground">View data plots</div>
                                  </div>
                                </button>

                                {/* Open Raw option */}
                                <button
                                  onClick={() => {
                                    setOpenMenuFileId(null);
                                    setSelectedFileForRaw({ id: file.id, name: file.fileName });
                                    setShowRawViewer(true);
                                  }}
                                  className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted transition-colors text-left"
                                >
                                  <Table className="h-4 w-4" />
                                  <div>
                                    <div className="font-medium">Open Raw</div>
                                    <div className="text-xs text-muted-foreground">View raw CSV data</div>
                                  </div>
                                </button>

                                <Separator />

                                {/* Info option */}
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted transition-colors text-left">
                                      <Info className="h-4 w-4" />
                                      <div>
                                        <div className="font-medium">Info</div>
                                        <div className="text-xs text-muted-foreground">File details</div>
                                      </div>
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-72" side="right">
                                    <div className="space-y-3">
                                      <div className="flex items-center gap-2">
                                        {isMergedFile(file) ? (
                                          <Combine className="w-3 h-3 text-green-600" />
                                        ) : (
                                          <div
                                            className="w-3 h-3 rounded-sm"
                                            style={{ backgroundColor: color }}
                                          />
                                        )}
                                        <span className="text-sm font-medium">
                                          {isMergedFile(file) ? 'Merged File' : file.pinLabel}
                                        </span>
                                      </div>
                                      <div className="space-y-2 text-xs">
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">File:</span>
                                          <span className="font-mono">{file.fileName}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">Size:</span>
                                          <span>{file.fileSize ? `${(file.fileSize / 1024).toFixed(1)} KB` : 'Unknown'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">
                                            {isMergedFile(file) ? 'Created:' : 'Uploaded:'}
                                          </span>
                                          <span>{safeFormatDate(file.uploadedAt, 'MMM d, yyyy')}</span>
                                        </div>
                                        {isMergedFile(file) ? (
                                          // Merged file info
                                          <>
                                            {(file as any).sourceFilesMetadata && (
                                              <div className="pt-2">
                                                <span className="text-muted-foreground block mb-1">Source Files:</span>
                                                <div className="space-y-1">
                                                  {Object.values((file as any).sourceFilesMetadata as Record<string, any>).map((sourceMeta: any, idx: number) => (
                                                    <div key={idx} className="text-[11px] font-mono bg-muted/30 px-2 py-1 rounded">
                                                      {sourceMeta.fileName}
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>
                                            )}
                                            <Separator className="my-2" />
                                            <div className="flex justify-between">
                                              <span className="text-muted-foreground">Merge Mode:</span>
                                              <span className="font-medium">
                                                {(file as any).mergeMode === 'stack-parameters' ? 'Stack Parameters' : 'Sequential'}
                                              </span>
                                            </div>
                                            {(() => {
                                              const correctedDays = getCorrectDuration(dateRange.startDate, dateRange.endDate);
                                              return correctedDays !== null && (
                                                <div className="flex justify-between">
                                                  <span className="text-muted-foreground">Duration:</span>
                                                  <span>{correctedDays} days</span>
                                                </div>
                                              );
                                            })()}
                                            {(file as any).mergeRules && (file as any).mergeRules.length > 0 && (
                                              <div className="pt-1">
                                                <span className="text-muted-foreground block mb-1">Applied Rules:</span>
                                                <div className="pl-2 space-y-0.5">
                                                  {(file as any).mergeRules.map((rule: any, idx: number) => (
                                                    <div key={idx} className="text-[10px] text-muted-foreground">
                                                      • {rule.name || rule.type}
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>
                                            )}
                                          </>
                                        ) : (
                                          // Regular file info - show period and duration
                                          (() => {
                                            const correctedDays = getCorrectDuration(dateRange.startDate, dateRange.endDate);
                                            return correctedDays !== null && (
                                              <>
                                                <div className="flex justify-between">
                                                  <span className="text-muted-foreground">Period:</span>
                                                  <span>{dateRange.startDate} to {dateRange.endDate}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                  <span className="text-muted-foreground">Duration:</span>
                                                  <span>{correctedDays} days</span>
                                                </div>
                                              </>
                                            );
                                          })()
                                        )}
                                      </div>
                                    </div>
                                  </PopoverContent>
                                </Popover>

                                {/* Rename option */}
                                {onRenameFile && (
                                  <button
                                    onClick={() => {
                                      setOpenMenuFileId(null);
                                      startRename(fileWithDate.file);
                                    }}
                                    className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted transition-colors text-left"
                                  >
                                    <Pencil className="h-4 w-4" />
                                    <div>
                                      <div className="font-medium">Rename</div>
                                      <div className="text-xs text-muted-foreground">Change file name</div>
                                    </div>
                                  </button>
                                )}

                                <Separator />

                                {/* Delete option */}
                                {onDeleteFile && (
                                  deleteConfirmFile?.id === file.id ? (
                                    <div className="flex items-center gap-2 px-3 py-2.5 text-sm">
                                      <span className="text-xs flex-1">Delete?</span>
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        className="h-7 px-3"
                                        onClick={async () => {
                                          setDeleteConfirmFile(null);
                                          setOpenMenuFileId(null);
                                          await handleDeleteFile(fileWithDate.file);
                                        }}
                                      >
                                        Yes
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-3"
                                        onClick={() => setDeleteConfirmFile(null)}
                                      >
                                        No
                                      </Button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => setDeleteConfirmFile({ id: file.id, name: file.fileName })}
                                      className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted transition-colors text-left text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                      <div>
                                        <div className="font-medium">Delete</div>
                                        <div className="text-xs text-muted-foreground">Remove file permanently</div>
                                      </div>
                                    </button>
                                  )
                                )}
                              </div>
                            </PopoverContent>
                          </Popover>
                          )}
                        </td>

                        {/* Start Date */}
                        <td className="px-2 text-center bg-muted/5 align-middle">
                          {dateRange.loading ? (
                            <div className="relative inline-block">
                              <Shimmer className="h-3 w-12" />
                            </div>
                          ) : dateRange.error ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            <span className="font-mono text-[11px]">{formatCompactDate(dateRange.startDate)}</span>
                          )}
                        </td>

                        {/* End Date */}
                        <td className="px-2 text-center bg-muted/5 align-middle">
                          {dateRange.loading ? (
                            <div className="relative inline-block">
                              <Shimmer className="h-3 w-12" />
                            </div>
                          ) : dateRange.error ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            <span className="font-mono text-[11px]">{formatCompactDate(dateRange.endDate)}</span>
                          )}
                        </td>

                        {/* Duration */}
                        <td className="px-2 text-center bg-muted/5 align-middle">
                          {dateRange.loading ? (
                            <div className="relative inline-block">
                              <Shimmer className="h-4 w-12 rounded" />
                            </div>
                          ) : (() => {
                            const correctedDays = getCorrectDuration(dateRange.startDate, dateRange.endDate);
                            return correctedDays !== null ? (
                              <span className="bg-primary/10 px-1.5 py-0.5 rounded text-xs font-medium">
                                {correctedDays} days
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  })
                }
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}

        {/* TIMELINE VIEW: Table-Based Layout */}
        {viewMode === 'timeline' && timelineData.months.length > 0 && (
        <div className="relative bg-white rounded p-3 border">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr>
                {/* LEFT HEADER (35%): Data Files with Sort */}
                <th className="w-[35%] align-top">
                  <div className="h-7 flex items-center mb-2" style={{ borderBottom: '1.5px solid rgba(0,0,0,0.12)' }}>
                    <button
                      onClick={toggleSortOrder}
                      className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors cursor-pointer group"
                      title="Click to sort files alphabetically"
                    >
                      <span>Data Files</span>
                      {sortOrder === 'asc' && <ArrowUp className="h-3 w-3 group-hover:text-primary" />}
                      {sortOrder === 'desc' && <ArrowDown className="h-3 w-3 group-hover:text-primary" />}
                      {!sortOrder && <ArrowUpDown className="h-3 w-3 opacity-50 group-hover:opacity-100 group-hover:text-primary" />}
                    </button>
                  </div>
                </th>

                {/* RIGHT HEADER (65%): Timeline */}
                <th className="w-[65%] align-top">
                  <div className="relative mb-3">
                    <div className="h-7 flex items-center justify-center mb-2" style={{ borderBottom: '1.5px solid rgba(0,0,0,0.12)' }}>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">
                        Timeline ({format(timelineData.minDate!, 'MMM yyyy')} - {format(timelineData.maxDate!, 'MMM yyyy')})
                      </h4>
                    </div>

                    {/* Two-row header: Years and Months */}
                    <div className="relative overflow-hidden">
                      {/* Year row - uses flex layout for responsiveness */}
                      <div className="relative h-5" style={{ borderBottom: '1.5px solid rgba(0,0,0,0.12)' }}>
                        <div className="flex h-full w-full">
                          {timelineData.years.map((yearData, index) => {
                            // Calculate width based on number of months this year spans
                            const yearMonths = timelineData.months.slice(yearData.startMonth, yearData.startMonth + yearData.monthCount);
                            const yearDays = yearMonths.reduce((total, month) => {
                              return total + differenceInDays(endOfMonth(month), startOfMonth(month)) + 1;
                            }, 0);
                            const widthPercent = (yearDays / timelineData.totalDays) * 100;

                            return (
                              <div
                                key={index}
                                className="text-xs font-semibold text-foreground/90 flex items-center justify-center flex-shrink-0 overflow-hidden"
                                style={{
                                  width: `${widthPercent}%`,
                                  minWidth: '30px',
                                  borderRight: timelineData.years.length > 1 ? '1.5px solid rgba(0,0,0,0.15)' : 'none'
                                }}
                              >
                                <span className="truncate">{yearData.year}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Month row - uses flex layout for responsiveness */}
                      <div className="relative h-5 bg-muted/10 overflow-hidden">
                        <div className="flex h-full w-full">
                          {timelineData.months.map((month, index) => {
                            const monthStart = startOfMonth(month);
                            const monthEnd = endOfMonth(month);
                            const monthDuration = differenceInDays(monthEnd, monthStart) + 1;
                            const widthPercent = (monthDuration / timelineData.totalDays) * 100;

                            return (
                              <div
                                key={index}
                                className="flex items-center justify-center text-xs flex-shrink-0 overflow-hidden"
                                style={{
                                  width: `${widthPercent}%`,
                                  minWidth: timelineData.months.length <= 6 ? '20px' : '12px',
                                  borderRight: timelineData.months.length > 1 ? '1.5px solid rgba(0,0,0,0.12)' : 'none'
                                }}
                                title={format(month, 'MMMM yyyy')}
                              >
                                <span className="text-muted-foreground font-medium text-[10px] truncate">
                                  {format(month, 'MM')}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {/* MERGED VIEW: Show grouped timelines with individual file bars */}
              {showMergedView && mergedGroups.map((group, index) => {
                return (
                  <tr key={`merged-${group.groupKey}-${index}`} className="h-[22px]">
                    {/* LEFT CELL: Group Info */}
                    <td className="w-[35%] pr-4 align-middle">
                      <div className="flex items-center gap-2 min-w-0">
                        {/* Pin color indicator */}
                        <div
                          className="w-2 h-2 rounded-sm flex-shrink-0"
                          style={{ backgroundColor: group.color }}
                          title={`Group: ${group.groupKey}`}
                        />

                        {/* Group name with popover menu */}
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              className="text-xs font-mono flex-1 min-w-0 truncate text-left hover:text-primary hover:underline transition-colors cursor-pointer font-semibold"
                              title={group.groupKey}
                            >
                              {group.groupKey}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-80" align="start">
                            <div className="space-y-3">
                              <div className="flex items-center gap-2 pb-2 border-b">
                                <div
                                  className="w-3 h-3 rounded-sm"
                                  style={{ backgroundColor: group.color }}
                                />
                                <span className="text-sm font-semibold">{group.groupKey}</span>
                              </div>
                              <div className="space-y-2 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Files:</span>
                                  <span className="font-medium">{group.files.length}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Period:</span>
                                  <span>{group.startDate} to {group.endDate}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Total Coverage:</span>
                                  <span className="font-medium">{group.totalDays} days</span>
                                </div>
                              </div>
                              <Separator />
                              <div className="space-y-1">
                                <div className="text-xs font-medium text-muted-foreground uppercase">Included Files:</div>
                                <div className="max-h-48 overflow-y-auto space-y-1">
                                  {group.files.map((fileWithDate, idx) => (
                                    <div
                                      key={`group-file-${fileWithDate.file.id}-${idx}`}
                                      className="text-xs font-mono bg-muted/30 px-2 py-1 rounded"
                                    >
                                      <div className="truncate">{fileWithDate.file.fileName}</div>
                                      <div className="text-[10px] text-muted-foreground">
                                        {fileWithDate.dateRange.startDate} - {fileWithDate.dateRange.endDate}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <Separator />
                              <button
                                onClick={() => {
                                  setMergeDialogOpen(true);
                                  setMergeGroupKey(group.groupKey);
                                  setMergeFiles(group.files);
                                }}
                                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors font-medium text-primary"
                              >
                                <Combine className="h-4 w-4" />
                                <span>Merge Files</span>
                              </button>
                            </div>
                          </PopoverContent>
                        </Popover>

                        {/* File count badge */}
                        <span className="text-xs text-muted-foreground bg-muted px-1 rounded">
                          {group.files.length}
                        </span>
                      </div>
                    </td>

                    {/* RIGHT CELL: Multiple Timeline Bars (one per file) */}
                    <td className="w-[65%] align-middle relative">
                      {/* Month gridlines */}
                      <div className="absolute inset-0 pointer-events-none">
                        {timelineData.months.map((month, monthIdx) => {
                          const monthStart = startOfMonth(month);
                          const monthEnd = endOfMonth(month);
                          const monthDuration = differenceInDays(monthEnd, monthStart) + 1;
                          const daysFromTimelineStart = differenceInDays(monthStart, timelineData.minDate!);
                          const left = (daysFromTimelineStart / timelineData.totalDays) * 100;

                          return (
                            <div
                              key={monthIdx}
                              className="absolute h-full border-l border-border/10"
                              style={{ left: `${left}%` }}
                            />
                          );
                        })}
                      </div>
                      <div className="relative h-4 w-full bg-muted/30 rounded">
                        {/* Render a bar for each file in the group */}
                        {group.files.map((fileWithDate, fileIdx) => {
                          const barMetrics = calculateBarMetrics(fileWithDate);
                          const { dateRange } = fileWithDate;

                          if (barMetrics.width === 0 || !dateRange.startDate || !dateRange.endDate) {
                            return null;
                          }

                          const fileDuration = getCorrectDuration(dateRange.startDate, dateRange.endDate);

                          return (
                            <div
                              key={`merged-bar-${fileWithDate.file.id}-${fileIdx}`}
                              className="absolute h-full rounded flex items-center text-white font-medium shadow-sm transition-all hover:shadow-md hover:z-10"
                              style={{
                                left: `${barMetrics.left}%`,
                                width: `${barMetrics.width}%`,
                                backgroundColor: group.color,
                                minWidth: '2px'
                              }}
                              title={`${fileWithDate.file.fileName}: ${dateRange.startDate} - ${dateRange.endDate} (${fileDuration || 0} days)`}
                            >
                              {barMetrics.width > 8 && fileDuration && (
                                <div className="flex items-center justify-center w-full">
                                  <span className="text-xs font-medium">
                                    {fileDuration}d
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Show "No data" if no files have valid dates */}
                        {group.files.every(f => !f.dateRange.startDate || !f.dateRange.endDate) && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-xs text-muted-foreground">No data</span>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* INDIVIDUAL VIEW: Show individual files */}
              {!showMergedView && sortedFilesWithDates.map((fileWithDate, index) => {
                const { file, dateRange } = fileWithDate;
                const color = pinColorMap.get(file.pinLabel) || COLORS[0];

                const barMetrics = calculateBarMetrics(fileWithDate);

                return (
                  <tr key={`timeline-${file.id}-${index}`} className="h-[22px]">
                    {/* LEFT CELL: File Info */}
                    <td className="w-[35%] pr-4 align-middle">
                      <div className="flex items-center gap-2 min-w-0">
                        {/* Checkbox for stack plot mode */}
                        {(multiFileMergeMode || stackPlotMode) && (
                          <Checkbox
                            checked={stackPlotMode ? selectedForStack.has(file.id) : selectedFileIds.has(file.id)}
                            onCheckedChange={() => stackPlotMode ? toggleStackSelection(file.id) : toggleFileSelection(file.id)}
                            className="flex-shrink-0 w-3 h-3"
                          />
                        )}

                        {/* Pin color indicator / Merge icon */}
                        {isMergedFile(file) ? (
                          <Combine
                            className="w-3 h-3 text-green-600 flex-shrink-0"
                            title="Merged File"
                          />
                        ) : (
                          <div
                            className="w-2 h-2 rounded-sm flex-shrink-0"
                            style={{ backgroundColor: color }}
                            title={`Pin: ${file.pinLabel}`}
                          />
                        )}

                        {/* File name with popover menu */}
                        {renamingFileId === fileWithDate.file.id ? (
                          // Show rename input field when renaming
                          <div className="flex items-center gap-1 flex-1">
                            <Input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleRenameFile(fileWithDate.file);
                                } else if (e.key === 'Escape') {
                                  setRenamingFileId(null);
                                }
                              }}
                              className="h-6 text-xs font-mono"
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRenameFile(fileWithDate.file);
                              }}
                            >
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenamingFileId(null);
                              }}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          // Show file name with menu when not renaming
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                className="text-xs font-mono flex-1 min-w-0 truncate text-left hover:text-primary hover:underline transition-colors cursor-pointer"
                                title={getTimelineDisplayName(file, dateRange, sortedFilesWithDates, !!pairingMap.get(file.id)?.isPaired)}
                              >
                                {getTimelineDisplayName(file, dateRange, sortedFilesWithDates, !!pairingMap.get(file.id)?.isPaired)}
                                {getPairedDisplayName(file) && (
                                  <span className="ml-1">
                                    {getPairedDisplayName(file)}
                                  </span>
                                )}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="min-w-[400px] p-0" align="start">
                            <div className="flex flex-col">
                              {/* Open option */}
                              <button
                                onClick={() => handleFileOpen(fileWithDate.file)}
                                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
                                data-testid="open-chart-button"
                              >
                                <FileText className="h-4 w-4" />
                                <span>Open</span>
                              </button>

                              {/* Rename option */}
                              {onRenameFile && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startRename(fileWithDate.file);
                                  }}
                                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
                                >
                                  <Pencil className="h-4 w-4" />
                                  <span>Rename</span>
                                </button>
                              )}

                              {/* Info option */}
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-left">
                                    <Info className="h-4 w-4" />
                                    <span>Info</span>
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-72" side="right">
                                  <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                      <div
                                        className="w-3 h-3 rounded-sm"
                                        style={{ backgroundColor: color }}
                                      />
                                      <span className="text-sm font-medium">{fileWithDate.file.pinLabel}</span>
                                    </div>
                                    <div className="space-y-2 text-xs">
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">File:</span>
                                        <span className="font-mono">{fileWithDate.file.fileName}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Size:</span>
                                        <span>{fileWithDate.file.fileSize ? `${(fileWithDate.file.fileSize / 1024).toFixed(1)} KB` : 'Unknown'}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Uploaded:</span>
                                        <span>{safeFormatDate(fileWithDate.file.uploadedAt, 'MMM d, yyyy')}</span>
                                      </div>
                                      {dateRange.startDate && dateRange.endDate && (
                                        <>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Period:</span>
                                            <span>{dateRange.startDate} to {dateRange.endDate}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Duration:</span>
                                            <span>{dateRange.totalDays} days</span>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </PopoverContent>
                              </Popover>

                              <Separator />

                              {/* Delete option */}
                              {onDeleteFile && (
                                deleteConfirmFile?.id === fileWithDate.file.id ? (
                                  <div className="flex items-center gap-2 px-3 py-2 text-sm border-t">
                                    <span className="text-xs">Delete?</span>
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      className="h-6 px-2"
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        setDeleteConfirmFile(null);
                                        await handleDeleteFile(fileWithDate.file);
                                      }}
                                    >
                                      Yes
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 px-2"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDeleteConfirmFile(null);
                                      }}
                                    >
                                      No
                                    </Button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDeleteConfirmFile({ id: fileWithDate.file.id, name: fileWithDate.file.fileName });
                                    }}
                                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors text-left text-destructive border-t"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    <span>Delete</span>
                                  </button>
                                )
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                        )}

                        {/* Duration badge */}
                        {(() => {
                          const correctedDays = getCorrectDuration(dateRange.startDate, dateRange.endDate);
                          return correctedDays && (
                            <span className="text-xs text-muted-foreground bg-muted px-1 rounded">
                              {correctedDays}d
                            </span>
                          );
                        })()}
                      </div>
                    </td>

                    {/* RIGHT CELL: Timeline Bar */}
                    <td className="w-[65%] align-middle relative">
                      {/* Month gridlines */}
                      <div className="absolute inset-0 pointer-events-none">
                        {timelineData.months.map((month, monthIdx) => {
                          const monthStart = startOfMonth(month);
                          const monthEnd = endOfMonth(month);
                          const monthDuration = differenceInDays(monthEnd, monthStart) + 1;
                          const daysFromTimelineStart = differenceInDays(monthStart, timelineData.minDate!);
                          const left = (daysFromTimelineStart / timelineData.totalDays) * 100;

                          return (
                            <div
                              key={monthIdx}
                              className="absolute h-full border-l border-border/10"
                              style={{ left: `${left}%` }}
                            />
                          );
                        })}
                      </div>
                      <div className="relative h-4 w-full bg-muted/30 rounded">
                        {dateRange.loading ? (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Shimmer className="h-2 w-8" />
                          </div>
                        ) : dateRange.error ? (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-xs text-muted-foreground">-</span>
                          </div>
                        ) : dateRange.isCrop && dateRange.uniqueDates && dateRange.uniqueDates.length > 0 ? (
                          // Discrete bars for CROP files (one bar per sampling day)
                          <>
                            {calculateDiscreteBars(fileWithDate).map((bar, idx) => (
                              <div
                                key={`discrete-bar-${file.id}-${idx}`}
                                className="absolute h-full rounded shadow-sm transition-all hover:shadow-md hover:z-10"
                                style={{
                                  left: `${bar.left}%`,
                                  width: `${bar.width}%`,
                                  backgroundColor: color,
                                  minWidth: '2px'
                                }}
                                title={`${fileWithDate.file.pinLabel}: ${bar.date} (sampling day ${idx + 1}/${dateRange.uniqueDates.length})`}
                              />
                            ))}
                          </>
                        ) : barMetrics.width > 0 ? (
                          // Continuous bar for regular files (GP, FPOD, Subcam, etc.)
                          <div
                            className="absolute h-full rounded flex items-center text-white font-medium shadow-sm transition-all hover:shadow-md"
                            style={{
                              left: `${barMetrics.left}%`,
                              width: `${barMetrics.width}%`,
                              backgroundColor: color,
                              minWidth: '2px'
                            }}
                            title={`${fileWithDate.file.pinLabel}: ${dateRange.startDate} - ${dateRange.endDate} (${getCorrectDuration(dateRange.startDate, dateRange.endDate) || 0} days)`}
                          >
                            {barMetrics.width > 12 && (() => {
                              const correctedDays = getCorrectDuration(dateRange.startDate, dateRange.endDate);
                              return correctedDays && (
                                <div className="flex items-center justify-center w-full">
                                  <span className="text-xs font-medium">
                                    {correctedDays}d
                                  </span>
                                </div>
                              );
                            })()}
                          </div>
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-xs text-muted-foreground">No data</span>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <MergeFilesDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        groupKey={mergeGroupKey}
        files={mergeFiles}
        onSuccess={() => {
          // Reload files after successful merge
          if (onDatesUpdated) onDatesUpdated();
        }}
      />

      {/* Raw CSV Viewer Dialog */}
      {selectedFileForRaw && (
        <RawCsvViewer
          fileId={selectedFileForRaw.id}
          fileName={selectedFileForRaw.name}
          isOpen={showRawViewer}
          onClose={() => setShowRawViewer(false)}
        />
      )}
    </div>
  );
}