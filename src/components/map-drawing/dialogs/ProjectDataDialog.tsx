'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from "@/hooks/use-toast";
import {
  Database,
  Loader2,
  Upload,
  MapPin,
  ChevronDown,
  X,
  Cloud,
  BarChart3,
  FileCode,
  Calendar,
  AlertCircle,
  Table
} from 'lucide-react';
import { DataTimeline } from '@/components/pin-data/DataTimeline';
import { DataTimelineSkeleton } from '@/components/loading/PageSkeletons';
import type { Pin, Line as LineType, Area, Project, PinFile, MergedFile } from '@/lib/supabase/types';
import { fileStorageService } from '@/lib/supabase/file-storage-service';
import {
  categorizeFile,
  getCategoriesForTile,
  tileHasCategories,
  TILE_NAMES
} from '@/lib/file-categorization-config';

export interface ProjectDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentProjectContext: string;
  activeProjectId: string;
  dynamicProjects: Record<string, Project>;
  pins: Pin[];
  lines: LineType[];
  areas: Area[];
  pinFileMetadata: Record<string, PinFile[]>;
  areaFileMetadata: Record<string, PinFile[]>;
  mergedFiles: MergedFile[];
  selectedPins: string[];
  selectedTypes: string[];
  selectedSuffixes: string[];
  selectedDateRanges: string[];
  selectedFileSources: ('upload' | 'merged')[];
  isUploadingFiles: boolean;
  isLoadingMergedFiles: boolean;
  isPageLoading: boolean;
  isInitialLoad: boolean;
  multiFileMergeMode: 'union' | 'intersection';
  setCurrentProjectContext: (id: string) => void;
  setShowUploadPinSelector: (show: boolean) => void;
  setSelectedUploadPinId: (id: string) => void;
  setPendingUploadFiles: (files: File[]) => void;
  setSelectedPins: (pins: string[]) => void;
  setSelectedTypes: (types: string[]) => void;
  setSelectedSuffixes: (suffixes: string[]) => void;
  setSelectedDateRanges: (ranges: string[]) => void;
  setSelectedFileSources: (sources: ('upload' | 'merged')[]) => void;
  setPinFileMetadata: React.Dispatch<React.SetStateAction<Record<string, PinFile[]>>>;
  setAreaFileMetadata: React.Dispatch<React.SetStateAction<Record<string, PinFile[]>>>;
  setMultiFileMergeMode: (mode: 'union' | 'intersection') => void;
  setMultiFileConfirmData: (data: any) => void;
  setShowMultiFileConfirmDialog: (show: boolean) => void;
  handleInitiateFileUpload: () => void;
  getProjectFiles: (projectId?: string) => Array<PinFile & { pinLabel: string }>;
  groupFilesByType: (files: PinFile[]) => Record<string, Array<PinFile & { pinLabel: string }>>;
  extractDateRange: (fileName: string) => string | null;
  getFileDateRange: (file: PinFile) => Promise<{ start: Date; end: Date } | null>;
  reloadProjectFiles: () => Promise<void>;
  openMarineDeviceModal: (
    fileType: any,
    files: File[],
    metadata?: {
      pinLabel?: string;
      startDate?: Date;
      endDate?: Date;
      fileCategories?: string[];
    }
  ) => void;
}

// Source Tile Component with per-tile category filtering
function SourceTile({
  source,
  label,
  files,
  getFileDateRange,
  onFileClick,
  onRenameFile,
  onDeleteFile,
  onDatesUpdated,
  onSelectMultipleFiles,
  projectId,
  onMergedFileClick,
  onAddFilesToMergedFile,
  multiFileMergeMode,
  setMultiFileMergeMode,
  pinColorMap
}: {
  source: string;
  label: string;
  files: any[];
  getFileDateRange: (file: PinFile) => Promise<{ start: Date; end: Date } | null>;
  onFileClick: any;
  onRenameFile: any;
  onDeleteFile: any;
  onDatesUpdated: any;
  onSelectMultipleFiles: any;
  projectId: string;
  onMergedFileClick: any;
  onAddFilesToMergedFile: any;
  multiFileMergeMode: 'union' | 'intersection';
  setMultiFileMergeMode: (mode: 'union' | 'intersection') => void;
  pinColorMap: Map<string, string>;
}) {
  const [selectedCategories, setSelectedCategories] = React.useState<string[]>([]);
  const [viewMode, setViewMode] = React.useState<'table' | 'timeline'>('timeline');
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [startY, setStartY] = React.useState(0);
  const [scrollTop, setScrollTop] = React.useState(0);

  // Get all categories for a file in this specific tile
  const getFileCategories = (fileName: string): string[] => {
    const matches = categorizeFile(fileName);
    const categoriesForThisTile = matches
      .filter(match => match.tile === label)
      .map(match => match.category)
      .filter((cat): cat is string => cat !== undefined);
    return categoriesForThisTile;
  };

  // Get unique categories for this tile from the configuration
  const availableCategories = getCategoriesForTile(label);
  const hasCategories = tileHasCategories(label);

  // Filter files by selected categories
  // If 1 category: OR logic (show if file has that category)
  // If 2+ categories: AND logic (show only if file has ALL selected categories)
  const filteredFiles = !hasCategories || selectedCategories.length === 0
    ? files
    : files.filter(file => {
        const fileCategories = getFileCategories(file.fileName);

        if (selectedCategories.length === 1) {
          // Single category: show if file has this category
          return fileCategories.some(cat => selectedCategories.includes(cat));
        } else {
          // Multiple categories: show only if file has ALL selected categories
          return selectedCategories.every(cat => fileCategories.includes(cat));
        }
      });

  // Drag to scroll handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!contentRef.current) return;
    setIsDragging(true);
    setStartY(e.pageY - contentRef.current.offsetTop);
    setScrollTop(contentRef.current.scrollTop);
    contentRef.current.style.cursor = 'grabbing';
    contentRef.current.style.userSelect = 'none';
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !contentRef.current) return;
    e.preventDefault();
    const y = e.pageY - contentRef.current.offsetTop;
    const walk = (y - startY) * 2; // Scroll speed multiplier
    contentRef.current.scrollTop = scrollTop - walk;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    if (contentRef.current) {
      contentRef.current.style.cursor = 'grab';
      contentRef.current.style.userSelect = 'auto';
    }
  };

  const handleMouseLeave = () => {
    if (isDragging) {
      setIsDragging(false);
      if (contentRef.current) {
        contentRef.current.style.cursor = 'grab';
        contentRef.current.style.userSelect = 'auto';
      }
    }
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden flex flex-col max-h-[500px]">
      {/* Tile Header */}
      <div className="bg-teal-700 border-b border-teal-800 px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-white">{label}</h3>
          <div className="flex items-center gap-2">
            {/* Category Filter Dropdown */}
            {hasCategories && availableCategories.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button className={`flex items-center gap-1 px-2 py-1 rounded hover:bg-teal-700 transition-colors text-xs ${selectedCategories.length > 0 ? 'bg-amber-500 text-white' : 'bg-teal-800 text-white'}`}>
                    <FileCode className="h-3 w-3" />
                    <span className="font-semibold">{selectedCategories.length > 0 ? selectedCategories.length : availableCategories.length}</span>
                    <span>Categories</span>
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2" align="end">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold mb-2 flex items-center justify-between">
                      <span>Filter by Category</span>
                      {selectedCategories.length > 0 && (
                        <button
                          onClick={() => setSelectedCategories([])}
                          className="text-primary hover:text-primary/80 text-[10px]"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    {availableCategories.map(category => (
                      <label key={category} className="flex items-center gap-2 text-xs hover:bg-muted p-1 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedCategories.includes(category)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedCategories([...selectedCategories, category]);
                            } else {
                              setSelectedCategories(selectedCategories.filter(c => c !== category));
                            }
                          }}
                          className="h-3 w-3"
                        />
                        <span className="font-medium">{category}</span>
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 bg-teal-800/50 rounded p-1">
              <Button
                variant={viewMode === 'table' ? 'default' : 'ghost'}
                size="sm"
                className={`h-6 px-2 ${viewMode !== 'table' ? 'text-white hover:bg-teal-600 hover:text-white' : ''}`}
                onClick={() => setViewMode('table')}
              >
                <Calendar className="h-3 w-3 mr-1" />
                <span className="text-xs">Table</span>
              </Button>
              <Button
                variant={viewMode === 'timeline' ? 'default' : 'ghost'}
                size="sm"
                className={`h-6 px-2 ${viewMode !== 'timeline' ? 'text-white hover:bg-teal-600 hover:text-white' : ''}`}
                onClick={() => setViewMode('timeline')}
              >
                <BarChart3 className="h-3 w-3 mr-1" />
                <span className="text-xs">Timeline</span>
              </Button>
            </div>

            <span className="text-xs text-white bg-teal-800 px-2 py-1 rounded">
              {filteredFiles.length} {filteredFiles.length === 1 ? 'file' : 'files'}
            </span>
          </div>
        </div>
      </div>

      {/* Tile Content */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto overflow-x-hidden cursor-grab scrollbar-hide"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <DataTimeline
          files={filteredFiles}
          getFileDateRange={getFileDateRange}
          onFileClick={onFileClick}
          onRenameFile={onRenameFile}
          onDeleteFile={onDeleteFile}
          onDatesUpdated={onDatesUpdated}
          onSelectMultipleFiles={onSelectMultipleFiles}
          projectId={projectId}
          onMergedFileClick={onMergedFileClick}
          onAddFilesToMergedFile={onAddFilesToMergedFile}
          multiFileMergeMode={multiFileMergeMode}
          onMultiFileMergeModeChange={setMultiFileMergeMode}
          viewMode={viewMode}
          pinColorMap={pinColorMap}
        />
      </div>
    </div>
  );
}

export function ProjectDataDialog({
  open,
  onOpenChange,
  currentProjectContext,
  activeProjectId,
  dynamicProjects,
  pins,
  lines,
  areas,
  pinFileMetadata,
  areaFileMetadata,
  mergedFiles,
  selectedPins,
  selectedTypes,
  selectedSuffixes,
  selectedDateRanges,
  selectedFileSources,
  isUploadingFiles,
  isLoadingMergedFiles,
  isPageLoading,
  isInitialLoad,
  multiFileMergeMode,
  setCurrentProjectContext,
  setShowUploadPinSelector,
  setSelectedUploadPinId,
  setPendingUploadFiles,
  setSelectedPins,
  setSelectedTypes,
  setSelectedSuffixes,
  setSelectedDateRanges,
  setSelectedFileSources,
  setPinFileMetadata,
  setAreaFileMetadata,
  setMultiFileMergeMode,
  setMultiFileConfirmData,
  setShowMultiFileConfirmDialog,
  handleInitiateFileUpload,
  getProjectFiles,
  groupFilesByType,
  extractDateRange,
  getFileDateRange,
  reloadProjectFiles,
  openMarineDeviceModal,
}: ProjectDataDialogProps) {
  const { toast } = useToast();

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setCurrentProjectContext('');
      setShowUploadPinSelector(false);
      setSelectedUploadPinId('');
      setPendingUploadFiles([]);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="!fixed !inset-0 !left-0 !top-0 !translate-x-0 !translate-y-0 w-screen h-screen max-w-none max-h-none !m-0 !p-6 !rounded-none !border-0 overflow-hidden z-[9999] flex flex-col">
        <DialogHeader className="flex-shrink-0 pb-1.5 pr-8">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="flex items-center gap-1.5 text-sm">
              <Database className="h-3.5 w-3.5" />
              <span>Project Data Files</span>
              <span className="text-muted-foreground font-normal">·</span>
              <span className="text-muted-foreground font-normal text-xs">
                {dynamicProjects[currentProjectContext || activeProjectId]?.name}
              </span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              Manage and upload data files for the current project
            </DialogDescription>
            {/* Action Buttons - Inline with header */}
            <div className="flex items-center gap-2">
              {/* Upload Button */}
              <Button
                variant="default"
                size="sm"
                className="flex items-center gap-1.5 h-7 px-2.5"
                disabled={isUploadingFiles}
                onClick={handleInitiateFileUpload}
                data-testid="upload-file-button"
              >
                {isUploadingFiles ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="text-xs">Uploading...</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-3 w-3" />
                    <span className="text-xs">Upload</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {(() => {
            let projectFiles = getProjectFiles(currentProjectContext || activeProjectId);

            const groupedFiles = groupFilesByType(projectFiles);

            // Add fileSource property to uploaded files
            const uploadedFiles = Object.values(groupedFiles).flat().map(file => ({
              ...file,
              fileSource: 'upload' as const
            }));

            // Combine uploaded and merged files for timeline display
            const allFiles = [...uploadedFiles, ...mergedFiles];
            const hasFiles = allFiles.length > 0;

            if (!hasFiles) {
              return (
                <div className="text-center py-8">
                  <Database className="h-12 w-12 mx-auto mb-4 opacity-30" />
                  <p className="text-muted-foreground">No data files in this project</p>
                </div>
              );
            }

            // Compute global color map for consistent colors across all tiles
            // This is computed once for ALL files and passed to each tile
            const COLORS = [
              '#3b82f6', // blue
              '#ef4444', // red
              '#22c55e', // green
              '#f59e0b', // amber
              '#8b5cf6', // violet
              '#ec4899', // pink
              '#06b6d4', // cyan
              '#84cc16', // lime
              '#f97316', // orange
              '#6366f1', // indigo
            ];

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

            // Group pins by their prefix
            const prefixGroups = new Map<string, string[]>();
            allFiles.forEach(f => {
              const prefix = getPinPrefix(f.pinLabel);
              if (!prefixGroups.has(prefix)) {
                prefixGroups.set(prefix, []);
              }
              prefixGroups.get(prefix)!.push(f.pinLabel);
            });

            // Assign colors to prefixes (sorted for consistency)
            const prefixColorMap = new Map<string, string>();
            Array.from(prefixGroups.keys()).sort().forEach((prefix, index) => {
              prefixColorMap.set(prefix, COLORS[index % COLORS.length]);
            });

            // Map each pin label to its prefix color
            const globalPinColorMap = new Map<string, string>();
            allFiles.forEach(f => {
              const prefix = getPinPrefix(f.pinLabel);
              const color = prefixColorMap.get(prefix) || COLORS[0];
              globalPinColorMap.set(f.pinLabel, color);
            });

            // Handler for clicking file names in timeline
            const handleTimelineFileClick = async (file: PinFile & { pinLabel: string }) => {
              try {
                // Determine file type from filename
                let fileType: 'GP' | 'FPOD' | 'Subcam' | 'CROP' | 'CHEM' | 'CHEMSW' | 'CHEMWQ' | 'WQ' | 'EDNA' = 'GP';

                const parts = file.fileName.split('_');
                const position0 = parts[0]?.toLowerCase() || '';
                const position1 = parts[1]?.toLowerCase() || '';
                const fileNameLower = file.fileName.toLowerCase();

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

                // Extract metadata for header display
                const pinLabel = file.pinLabel || 'Unassigned';
                const dateRange = await getFileDateRange(file);

                // Convert string dates to Date objects, with validation
                // Handle both DD/MM/YYYY and ISO date formats
                let startDate: Date | undefined = undefined;
                let endDate: Date | undefined = undefined;

                if (dateRange?.startDate) {
                  // Check if it's DD/MM/YYYY format (contains /)
                  if (dateRange.startDate.includes('/')) {
                    const [day, month, year] = dateRange.startDate.split('/');
                    const parsedStart = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                    if (!isNaN(parsedStart.getTime())) {
                      startDate = parsedStart;
                    }
                  } else {
                    const parsedStart = new Date(dateRange.startDate);
                    if (!isNaN(parsedStart.getTime())) {
                      startDate = parsedStart;
                    }
                  }
                }

                if (dateRange?.endDate) {
                  // Check if it's DD/MM/YYYY format (contains /)
                  if (dateRange.endDate.includes('/')) {
                    const [day, month, year] = dateRange.endDate.split('/');
                    const parsedEnd = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                    if (!isNaN(parsedEnd.getTime())) {
                      endDate = parsedEnd;
                    }
                  } else {
                    const parsedEnd = new Date(dateRange.endDate);
                    if (!isNaN(parsedEnd.getTime())) {
                      endDate = parsedEnd;
                    }
                  }
                }

                // Extract ALL categories from filename using categorization
                const categories = categorizeFile(file.fileName);
                const fileCategories = categories
                  .map(c => c.category)
                  .filter((c): c is string => c !== undefined); // Remove undefined categories

                console.log('📋 [PROJECT DATA DIALOG] File metadata:', {
                  fileName: file.fileName,
                  pinLabel,
                  startDate,
                  endDate,
                  fileCategories,
                  rawDateRange: dateRange
                });

                // Download file content
                const fileContent = await fileStorageService.downloadFile(file.filePath);
                if (fileContent) {
                  // Convert blob to File object
                  const actualFile = new File([fileContent], file.fileName, {
                    type: file.fileType || 'text/csv'
                  });

                  // Open modal with the downloaded file and metadata
                  openMarineDeviceModal(fileType, [actualFile], {
                    pinLabel,
                    startDate,
                    endDate,
                    fileCategories
                  });
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
                  title: "Error",
                  description: "Failed to open file."
                });
              }
            };

            // Group files by source category using the new categorization config
            // A file can appear in multiple tiles if it matches multiple patterns
            const groupFilesBySource = (files: any[]) => {
              const grouped: Record<string, any[]> = {};

              // Initialize groups for all tile names
              TILE_NAMES.forEach(tileName => {
                grouped[tileName] = [];
              });

              files.forEach(file => {
                const matches = categorizeFile(file.fileName);
                matches.forEach(match => {
                  if (grouped[match.tile]) {
                    // Only add the file if it's not already in this tile's group
                    if (!grouped[match.tile].find(f => f.id === file.id)) {
                      grouped[match.tile].push(file);
                    }
                  }
                });
              });

              return grouped;
            };

            // Helper function to check if file matches type filter
            const matchesType = (file: any, type: string): boolean => {
              const fileName = file.fileName.toLowerCase();
              if (type === 'SubCam') return fileName.includes('subcam');
              if (type === 'GP') return fileName.includes('gp');
              if (type === 'FPOD') return fileName.includes('fpod');
              return false;
            };

            // Helper function to extract suffix from filename
            const extractSuffix = (fileName: string): string => {
              const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
              const parts = nameWithoutExt.split('_');
              return parts.length > 0 ? parts[parts.length - 1] : '';
            };

            // Apply filters to get filtered files (suffix filter removed - now per-tile)
            const filteredFiles = allFiles.filter(file => {
              const pinMatch = selectedPins.length === 0 || selectedPins.includes(file.pinLabel);
              const typeMatch = selectedTypes.length === 0 || selectedTypes.some(type => matchesType(file, type));

              // Date range filter
              const dateRangeMatch = selectedDateRanges.length === 0 || selectedDateRanges.some(range => {
                const fileRange = extractDateRange(file.fileName);
                return fileRange === range;
              });

              // File source filter (upload vs merged)
              const fileSourceMatch = selectedFileSources.length === 0 || selectedFileSources.includes(file.fileSource);

              return pinMatch && typeMatch && dateRangeMatch && fileSourceMatch;
            });

            // Calculate unique values for cascading filters
            // For pins: show pins available after applying type and dateRange filters
            const filesForPinOptions = allFiles.filter(file => {
              const typeMatch = selectedTypes.length === 0 || selectedTypes.some(type => matchesType(file, type));
              const dateRangeMatch = selectedDateRanges.length === 0 || selectedDateRanges.some(range => {
                const fileRange = extractDateRange(file.fileName);
                return fileRange === range;
              });
              return typeMatch && dateRangeMatch;
            });
            const uniquePins = Array.from(new Set(filesForPinOptions.map(file => file.pinLabel))).sort();

            // For types: show types available after applying pin and dateRange filters
            const filesForTypeOptions = allFiles.filter(file => {
              const pinMatch = selectedPins.length === 0 || selectedPins.includes(file.pinLabel);
              const dateRangeMatch = selectedDateRanges.length === 0 || selectedDateRanges.some(range => {
                const fileRange = extractDateRange(file.fileName);
                return fileRange === range;
              });
              return pinMatch && dateRangeMatch;
            });
            // Build type list from filesForTypeOptions
            const typeMap = new Map<string, any[]>();
            filesForTypeOptions.forEach(file => {
              const fileName = file.fileName.toLowerCase();
              if (fileName.includes('subcam')) {
                if (!typeMap.has('SubCam')) typeMap.set('SubCam', []);
                typeMap.get('SubCam')!.push(file);
              }
              if (fileName.includes('gp')) {
                if (!typeMap.has('GP')) typeMap.set('GP', []);
                typeMap.get('GP')!.push(file);
              }
              if (fileName.includes('fpod')) {
                if (!typeMap.has('FPOD')) typeMap.set('FPOD', []);
                typeMap.get('FPOD')!.push(file);
              }
            });
            const uniqueTypes = Array.from(typeMap.keys()).sort();

            // For date ranges: show date ranges available after applying pin and type filters
            const filesForDateRangeOptions = allFiles.filter(file => {
              const pinMatch = selectedPins.length === 0 || selectedPins.includes(file.pinLabel);
              const typeMatch = selectedTypes.length === 0 || selectedTypes.some(type => matchesType(file, type));
              return pinMatch && typeMatch;
            });
            const uniqueDateRanges = Array.from(new Set(filesForDateRangeOptions.map(file => {
              return extractDateRange(file.fileName);
            }).filter(range => range !== null))).sort() as string[];

            // Calculate project summary statistics
            const projectStats = {
              totalFiles: allFiles.length,
              filteredFiles: filteredFiles.length,
              fileTypes: Object.entries(groupedFiles).map(([type, files]) => ({
                type: type,
                count: files.length
              })).filter(({ count }) => count > 0),
              totalSize: allFiles.reduce((sum, file) => sum + (file.fileSize || 0), 0),
              uniquePins: uniquePins.length
            };

            const hasActiveFilters = selectedPins.length > 0 || selectedTypes.length > 0 || selectedDateRanges.length > 0 || selectedFileSources.length < 2;

            return (
              <div className="space-y-2">
                {/* Compact Project Summary with Filters */}
                <div className="bg-muted/10 rounded p-1.5 border border-border/20">
                  <div className="flex items-center gap-3 flex-wrap text-[11px]">
                    {/* Total Files */}
                    <div className="flex items-center gap-1">
                      <Database className="h-3 w-3 text-blue-500" />
                      <span className="font-semibold">
                        {hasActiveFilters ? `${projectStats.filteredFiles}/${projectStats.totalFiles}` : projectStats.totalFiles}
                      </span>
                      <span className="text-muted-foreground">Files</span>
                      {hasActiveFilters && (
                        <button
                          onClick={() => {
                            setSelectedPins([]);
                            setSelectedTypes([]);
                            setSelectedDateRanges([]);
                            setSelectedFileSources(['upload', 'merged']);
                          }}
                          className="ml-1 text-primary hover:text-primary/80"
                          title="Clear all filters"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    {/* Unique Pins - Filterable */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className={`flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted transition-colors ${selectedPins.length > 0 ? 'bg-green-500/20 border border-green-500/50' : ''}`}>
                          <MapPin className="h-3 w-3 text-green-500" />
                          <span className="font-semibold">{selectedPins.length > 0 ? selectedPins.length : projectStats.uniquePins}</span>
                          <span className="text-muted-foreground">Pins</span>
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-2" align="start">
                        <div className="space-y-1">
                          <div className="text-xs font-semibold mb-2 flex items-center justify-between">
                            <span>Filter by Pin</span>
                            {selectedPins.length > 0 && (
                              <button
                                onClick={() => setSelectedPins([])}
                                className="text-primary hover:text-primary/80 text-[10px]"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                          {uniquePins.map(pin => (
                            <label key={pin} className="flex items-center gap-2 text-xs hover:bg-muted p-1 rounded cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedPins.includes(pin)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedPins([...selectedPins, pin]);
                                  } else {
                                    setSelectedPins(selectedPins.filter(p => p !== pin));
                                  }
                                }}
                                className="h-3 w-3"
                              />
                              <span>{pin}</span>
                            </label>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>

                    {/* Total Size */}
                    <div className="flex items-center gap-1">
                      <Upload className="h-3 w-3 text-orange-500" />
                      <span className="font-semibold">{(projectStats.totalSize / (1024 * 1024)).toFixed(1)}</span>
                      <span className="text-muted-foreground">MB</span>
                    </div>

                    {/* File Source Filter - Uploaded vs Merged */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className={`flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted transition-colors ${selectedFileSources.length < 2 ? 'bg-indigo-500/20 border border-indigo-500/50' : ''}`}>
                          <Cloud className="h-3 w-3 text-indigo-500" />
                          <span className="font-semibold">{selectedFileSources.length === 2 ? 'All' : selectedFileSources.length === 1 ? '1' : '0'}</span>
                          <span className="text-muted-foreground">Source</span>
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-2" align="start">
                        <div className="space-y-1">
                          <div className="text-xs font-semibold mb-2 flex items-center justify-between">
                            <span>Filter by Source</span>
                            {selectedFileSources.length < 2 && (
                              <button
                                onClick={() => setSelectedFileSources(['upload', 'merged'])}
                                className="text-primary hover:text-primary/80 text-[10px]"
                              >
                                Show All
                              </button>
                            )}
                          </div>
                          <label className="flex items-center gap-2 text-xs hover:bg-muted p-1 rounded cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedFileSources.includes('upload')}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedFileSources([...selectedFileSources, 'upload']);
                                } else {
                                  setSelectedFileSources(selectedFileSources.filter(s => s !== 'upload'));
                                }
                              }}
                              className="h-3 w-3"
                            />
                            <Upload className="h-3 w-3 text-blue-500" />
                            <span>Upload Files</span>
                          </label>
                          <label className="flex items-center gap-2 text-xs hover:bg-muted p-1 rounded cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selectedFileSources.includes('merged')}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedFileSources([...selectedFileSources, 'merged']);
                                } else {
                                  setSelectedFileSources(selectedFileSources.filter(s => s !== 'merged'));
                                }
                              }}
                              className="h-3 w-3"
                            />
                            <FileCode className="h-3 w-3 text-green-500" />
                            <span>Merged Files</span>
                          </label>
                        </div>
                      </PopoverContent>
                    </Popover>

                    {/* File Types - Filterable */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className={`flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted transition-colors ${selectedTypes.length > 0 ? 'bg-purple-500/20 border border-purple-500/50' : ''}`}>
                          <BarChart3 className="h-3 w-3 text-purple-500" />
                          <span className="font-semibold">{selectedTypes.length > 0 ? selectedTypes.length : projectStats.fileTypes.length}</span>
                          <span className="text-muted-foreground">Types</span>
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-2" align="start">
                        <div className="space-y-1">
                          <div className="text-xs font-semibold mb-2 flex items-center justify-between">
                            <span>Filter by Type</span>
                            {selectedTypes.length > 0 && (
                              <button
                                onClick={() => setSelectedTypes([])}
                                className="text-primary hover:text-primary/80 text-[10px]"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                          {uniqueTypes.map(type => (
                            <label key={type} className="flex items-center gap-2 text-xs hover:bg-muted p-1 rounded cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedTypes.includes(type)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedTypes([...selectedTypes, type]);
                                  } else {
                                    setSelectedTypes(selectedTypes.filter(t => t !== type));
                                  }
                                }}
                                className="h-3 w-3"
                              />
                              <span>{type}</span>
                            </label>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>

                    {/* Date Ranges - Filterable */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className={`flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted transition-colors ${selectedDateRanges.length > 0 ? 'bg-cyan-500/20 border border-cyan-500/50' : ''}`}>
                          <Calendar className="h-3 w-3 text-cyan-500" />
                          <span className="font-semibold">{selectedDateRanges.length > 0 ? selectedDateRanges.length : uniqueDateRanges.length}</span>
                          <span className="text-muted-foreground">Date Ranges</span>
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56 p-2" align="start">
                        <div className="space-y-1">
                          <div className="text-xs font-semibold mb-2 flex items-center justify-between">
                            <span>Filter by Date Range</span>
                            {selectedDateRanges.length > 0 && (
                              <button
                                onClick={() => setSelectedDateRanges([])}
                                className="text-primary hover:text-primary/80 text-[10px]"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                          {uniqueDateRanges.map(range => (
                            <label key={range} className="flex items-center gap-2 text-xs hover:bg-muted p-1 rounded cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedDateRanges.includes(range)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedDateRanges([...selectedDateRanges, range]);
                                  } else {
                                    setSelectedDateRanges(selectedDateRanges.filter(r => r !== range));
                                  }
                                }}
                                className="h-3 w-3"
                              />
                              <span className="font-mono">{range}</span>
                            </label>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>

                    {/* File Type Distribution - Inline */}
                    {projectStats.fileTypes.length > 0 && (
                      <div className="flex items-center gap-1.5 ml-auto">
                        {projectStats.fileTypes.map(({ type, count }, index) => (
                          <div key={type} className="bg-muted/80 px-1.5 py-0.5 rounded text-[10px] font-medium">
                            {type}: {count}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Show skeleton while loading initial data */}
                {isLoadingMergedFiles || (isPageLoading && isInitialLoad) ? (
                  <DataTimelineSkeleton />
                ) : (
                  <>
                    {/* Group files by source */}
                    {(() => {
                      const filesBySource = groupFilesBySource(filteredFiles);
                      const tilesWithFiles = TILE_NAMES.filter(tileName => filesBySource[tileName]?.length > 0);

                      if (tilesWithFiles.length === 0) {
                        return (
                          <div className="text-center py-8">
                            <Database className="h-12 w-12 mx-auto mb-4 opacity-30" />
                            <p className="text-muted-foreground">No files match the current filters</p>
                          </div>
                        );
                      }

                      return (
                        <div className="grid grid-cols-1 gap-4">
                          {tilesWithFiles.map(tileName => {
                            const files = filesBySource[tileName];
                            return (
                              <SourceTile
                                key={tileName}
                                source={tileName}
                                label={tileName}
                                files={files}
                                getFileDateRange={getFileDateRange}
                                onFileClick={handleTimelineFileClick}
                                onRenameFile={async (file, newName) => {
                      console.log('Timeline rename request for file:', file.id, 'New name:', newName);

                      try {
                        const success = await fileStorageService.renameFile(file.id, newName);
                        console.log('Rename result from service:', success);

                        if (success) {
                          console.log('Rename successful, updating UI...');
                          // Find which pin this file belongs to and update that pin's metadata
                          const pinId = Object.keys(pinFileMetadata).find(pinId =>
                            pinFileMetadata[pinId]?.some(f => f.id === file.id)
                          );

                          if (pinId) {
                            console.log('Found file in pin metadata, updating pinId:', pinId);
                            // Update the state immediately to reflect the new name
                            setPinFileMetadata(prev => ({
                              ...prev,
                              [pinId]: prev[pinId]?.map(f =>
                                f.id === file.id ? { ...f, fileName: newName } : f
                              ) || []
                            }));
                          }

                          // Also check if this file belongs to an area
                          const areaId = Object.keys(areaFileMetadata).find(areaId =>
                            areaFileMetadata[areaId]?.some(f => f.id === file.id)
                          );

                          if (areaId) {
                            console.log('Found file in area metadata, updating areaId:', areaId);
                            // Update the area file metadata
                            setAreaFileMetadata(prev => ({
                              ...prev,
                              [areaId]: prev[areaId]?.map(f =>
                                f.id === file.id ? { ...f, fileName: newName } : f
                              ) || []
                            }));
                          }

                          toast({
                            title: "File Renamed",
                            description: `File renamed to ${newName}`
                          });

                          return true;
                        } else {
                          toast({
                            variant: "destructive",
                            title: "Rename Failed",
                            description: "Failed to rename the file. Please try again."
                          });
                          return false;
                        }
                      } catch (error) {
                        console.error('Rename file error:', error);
                        toast({
                          variant: "destructive",
                          title: "Error",
                          description: "An error occurred while renaming the file."
                        });
                        return false;
                      }
                                    }}
                                    onDeleteFile={async (file) => {
                      console.log('Timeline delete request for file:', file.id, file.fileName);

                      try {
                        // Check if this is a merged file
                        const isMergedFile = (file as any).fileSource === 'merged';

                        if (isMergedFile) {
                          console.log('Deleting merged file with ID:', file.id);
                          const { deleteMergedFileAction } = await import('@/app/api/merged-files/actions');
                          const result = await deleteMergedFileAction(file.id);

                          if (result.success) {
                            console.log('Merged file deleted successfully');

                            // Reload all project files to ensure timeline updates immediately
                            console.log('🔄 Triggering full project files reload after merged file delete...');
                            await reloadProjectFiles();

                            toast({
                              title: "Merged File Deleted",
                              description: `${file.fileName} has been deleted.`
                            });
                          } else {
                            toast({
                              variant: "destructive",
                              title: "Delete Failed",
                              description: result.error || "Failed to delete the merged file."
                            });
                          }
                        } else {
                          // Regular uploaded file
                          console.log('Calling deleteFileSimple with ID:', file.id);
                          const success = await fileStorageService.deleteFileSimple(file.id);
                          console.log('Delete result from service:', success);

                          if (success) {
                            console.log('Delete successful, reloading files...');

                            // Reload all project files to ensure timeline updates immediately
                            console.log('🔄 Triggering full project files reload after delete...');
                            await reloadProjectFiles();

                            toast({
                              title: "File Deleted",
                              description: `${file.fileName} has been deleted.`
                            });
                          } else {
                            toast({
                              variant: "destructive",
                              title: "Delete Failed",
                              description: "Failed to delete the file. Please try again."
                            });
                          }
                        }
                      } catch (error) {
                        console.error('Delete file error:', error);
                        toast({
                          variant: "destructive",
                          title: "Delete Error",
                          description: "An error occurred while deleting the file."
                        });
                      }
                                    }}
                                    onDatesUpdated={async () => {
                      console.log('📅 Dates updated, reloading files...');

                      // Reload files for all pins to get updated dates
                      const fileMetadata: Record<string, PinFile[]> = {};

                      for (const pin of pins) {
                        try {
                          const files = await fileStorageService.getPinFiles(pin.id);
                          if (files.length > 0) {
                            fileMetadata[pin.id] = files;
                          }
                        } catch (error) {
                          console.error(`Error reloading files for pin ${pin.id}:`, error);
                        }
                      }

                      console.log('✅ Files reloaded with updated dates');
                      setPinFileMetadata(fileMetadata);
                                    }}
                                    onSelectMultipleFiles={async (selectedFiles) => {
                      try {
                        console.log('🔄 Multi-file selection:', selectedFiles.map(f => f.fileName));

                        // Determine file type from first file
                        const firstFile = selectedFiles[0];
                        let fileType: 'GP' | 'FPOD' | 'Subcam' | 'CROP' | 'CHEM' | 'CHEMSW' | 'CHEMWQ' | 'WQ' = 'GP';

                        const parts = firstFile.fileName.split('_');
                        const position0 = parts[0]?.toLowerCase() || '';
                        const position1 = parts[1]?.toLowerCase() || '';
                        const fileNameLower = firstFile.fileName.toLowerCase();

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
                        } else if (position0.includes('fpod') || position1.includes('fpod')) {
                          fileType = 'FPOD';
                        } else if (position0.includes('subcam') || position1.includes('subcam')) {
                          fileType = 'Subcam';
                        } else if (position0.includes('gp') || position1.includes('gp')) {
                          fileType = 'GP';
                        }

                        // Download all files
                        const downloadedFiles: File[] = [];
                        for (const file of selectedFiles) {
                          const fileContent = await fileStorageService.downloadFile(file.filePath);
                          if (fileContent) {
                            const actualFile = new File([fileContent], file.fileName, {
                              type: file.fileType || 'text/csv'
                            });
                            downloadedFiles.push(actualFile);
                          } else {
                            toast({
                              variant: "destructive",
                              title: "Download Failed",
                              description: `Failed to download ${file.fileName}`
                            });
                            return;
                          }
                        }

                        // Import multiFileValidator
                        const { parseFile, validateFilesCompatibility } = await import('@/lib/multiFileValidator');

                        // Parse all files with file IDs
                        const parsedFiles = await Promise.all(
                          downloadedFiles.map(async (file, idx) => {
                            const parsed = await parseFile(file);
                            return {
                              ...parsed,
                              fileId: selectedFiles[idx].id // Add file ID for tracking
                            };
                          })
                        );

                        // Validate compatibility
                        const validation = validateFilesCompatibility(parsedFiles);

                        // Store data and show confirmation dialog
                        setMultiFileConfirmData({
                          parsedFiles,
                          validation,
                          downloadedFiles,
                          fileType,
                          selectedFiles // Add selectedFiles with pin metadata
                        });
                        setShowMultiFileConfirmDialog(true);
                      } catch (error) {
                        console.error('Multi-file selection error:', error);
                        toast({
                          variant: "destructive",
                          title: "Error",
                          description: error instanceof Error ? error.message : 'Failed to process multiple files'
                        });
                      }
                                    }}
                                    projectId={activeProjectId}
                                    onMergedFileClick={async (mergedFile) => {
                      try {
                        console.log('🔄 Opening merged file:', mergedFile.fileName);

                        // Download the merged file
                        const { downloadMergedFileAction } = await import('@/app/api/merged-files/actions');
                        const result = await downloadMergedFileAction(mergedFile.filePath);

                        if (!result.success || !result.data) {
                          throw new Error(result.error || 'Failed to download merged file');
                        }

                        // Convert the CSV text back to a File object
                        const file = new File([result.data], mergedFile.fileName, { type: 'text/csv' });

                        // Determine file type
                        let fileType: 'GP' | 'FPOD' | 'Subcam' | 'CROP' | 'CHEM' | 'CHEMSW' | 'CHEMWQ' | 'WQ' = 'GP';
                        const parts = mergedFile.fileName.split('_');
                        const position0 = parts[0]?.toLowerCase() || '';
                        const position1 = parts[1]?.toLowerCase() || '';
                        const fileNameLower = mergedFile.fileName.toLowerCase();

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
                        } else if (position0.includes('fpod') || position1.includes('fpod')) {
                          fileType = 'FPOD';
                        } else if (position0.includes('subcam') || position1.includes('subcam')) {
                          fileType = 'Subcam';
                        } else if (position0.includes('gp') || position1.includes('gp')) {
                          fileType = 'GP';
                        }

                        // Open in modal
                        openMarineDeviceModal(fileType, [file]);
                      } catch (error) {
                        console.error('Error opening merged file:', error);
                        toast({
                          variant: "destructive",
                          title: "Error",
                          description: error instanceof Error ? error.message : 'Failed to open merged file'
                        });
                      }
                                    }}
                                    onAddFilesToMergedFile={async (mergedFile) => {
                      toast({
                        title: "Add Files Feature",
                        description: "This feature is coming soon! You'll be able to add more files to this merge."
                      });
                      // TODO: Implement add files to merged file dialog
                                    }}
                                multiFileMergeMode={multiFileMergeMode}
                                setMultiFileMergeMode={setMultiFileMergeMode}
                                pinColorMap={globalPinColorMap}
                              />
                            );
                          })}
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            );
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
