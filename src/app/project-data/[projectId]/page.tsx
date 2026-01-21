'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useToast } from '@/hooks/use-toast';
import { fileStorageService } from '@/lib/supabase/file-storage-service';
import { categorizeFile, TILE_NAMES } from '@/lib/file-categorization-config';
import type { PinFile, MergedFile } from '@/lib/supabase/types';

import { ProjectDataHeader } from '@/components/project-data/ProjectDataHeader';
import { ProjectDataFilters } from '@/components/project-data/ProjectDataFilters';
import { ProjectDataContent } from '@/components/project-data/ProjectDataContent';
import { useProjectData } from '@/components/project-data/useProjectData';

// Lazy load the MarineDeviceModal
const MarineDeviceModal = dynamic(
  () => import('@/components/map-drawing/dialogs/MarineDeviceModal').then(mod => ({ default: mod.MarineDeviceModal })),
  { ssr: false, loading: () => null }
);

// File Upload Dialog
const FileUploadDialog = dynamic(
  () => import('@/components/map-drawing/dialogs/FileUploadDialog').then(mod => ({ default: mod.FileUploadDialog })),
  { ssr: false, loading: () => null }
);

// Multi-file confirmation dialog
const MultiFileConfirmDialog = dynamic(
  () => import('@/components/pin-data/MultiFileConfirmDialog').then(mod => ({ default: mod.MultiFileConfirmDialog })),
  { ssr: false, loading: () => null }
);

interface ProjectDataPageProps {
  params: Promise<{ projectId: string }>;
}

// Helper: Color palette for pins
const COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

// Helper: Get pin prefix for consistent coloring
const getPinPrefix = (pinLabel: string): string => {
  if (pinLabel === 'All Locations') return 'All Locations';

  const dashSplit = pinLabel.split(' - ');
  if (dashSplit.length > 1) return dashSplit[0].trim();

  const knownSuffixes = [
    'FPOD', 'SubCam', 'GP', 'GrowProbe', 'EDNA', 'EDNAW', 'EDNAS',
    'WQ', 'CHEM', 'CHEMSW', 'CHEMWQ', 'CROP', 'Hapl', 'Taxo', 'Cred', 'Meta'
  ];

  let result = pinLabel.trim();
  for (const suffix of knownSuffixes) {
    const patterns = [` ${suffix}`, `_${suffix}`, `-${suffix}`];
    for (const pattern of patterns) {
      if (result.toLowerCase().endsWith(pattern.toLowerCase())) {
        result = result.slice(0, -pattern.length).trim();
        break;
      }
    }
  }

  return result || pinLabel;
};

export default function ProjectDataPage({ params }: ProjectDataPageProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [projectId, setProjectId] = useState<string>('');

  // Resolve params promise
  useEffect(() => {
    params.then(p => setProjectId(p.projectId));
  }, [params]);

  // Project data hook
  const {
    project,
    pins,
    areas,
    pinFileMetadata,
    areaFileMetadata,
    mergedFiles,
    isLoading,
    isLoadingMergedFiles,
    reload,
    getProjectFiles,
    groupFilesByType,
    extractDateRange
  } = useProjectData(projectId);

  // Filter state
  const [selectedPins, setSelectedPins] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedDateRanges, setSelectedDateRanges] = useState<string[]>([]);
  const [selectedFileSources, setSelectedFileSources] = useState<('upload' | 'merged')[]>(['upload', 'merged']);

  // File upload state
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [showUploadPinSelector, setShowUploadPinSelector] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);

  // Multi-file merge state
  const [multiFileMergeMode, setMultiFileMergeMode] = useState<'union' | 'intersection'>('union');
  const [showMultiFileConfirmDialog, setShowMultiFileConfirmDialog] = useState(false);
  const [multiFileConfirmData, setMultiFileConfirmData] = useState<any>(null);

  // Marine Device Modal state
  const [showMarineDeviceModal, setShowMarineDeviceModal] = useState(false);
  const [selectedFileType, setSelectedFileType] = useState<'GP' | 'FPOD' | 'Subcam' | 'CROP' | 'CHEM' | 'CHEMSW' | 'CHEMWQ' | 'WQ' | 'EDNA' | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedFileMetadata, setSelectedFileMetadata] = useState<{
    pinLabel?: string;
    startDate?: Date;
    endDate?: Date;
    fileCategories?: string[];
  } | null>(null);

  // Compute all files with fileSource property
  const allFiles = useMemo(() => {
    const projectFiles = getProjectFiles();
    const uploadedFiles = projectFiles.map(file => ({
      ...file,
      fileSource: 'upload' as const
    }));
    return [...uploadedFiles, ...mergedFiles];
  }, [getProjectFiles, mergedFiles]);

  // Compute global pin color map
  const globalPinColorMap = useMemo(() => {
    const prefixGroups = new Map<string, string[]>();
    allFiles.forEach(f => {
      const prefix = getPinPrefix(f.pinLabel);
      if (!prefixGroups.has(prefix)) {
        prefixGroups.set(prefix, []);
      }
      prefixGroups.get(prefix)!.push(f.pinLabel);
    });

    const prefixColorMap = new Map<string, string>();
    Array.from(prefixGroups.keys()).sort().forEach((prefix, index) => {
      prefixColorMap.set(prefix, COLORS[index % COLORS.length]);
    });

    const colorMap = new Map<string, string>();
    allFiles.forEach(f => {
      const prefix = getPinPrefix(f.pinLabel);
      const color = prefixColorMap.get(prefix) || COLORS[0];
      colorMap.set(f.pinLabel, color);
    });

    return colorMap;
  }, [allFiles]);

  // Helper function to check if file matches type filter
  const matchesType = useCallback((file: any, type: string): boolean => {
    const fileName = file.fileName.toLowerCase();
    if (type === 'SubCam') return fileName.includes('subcam');
    if (type === 'GP') return fileName.includes('gp');
    if (type === 'FPOD') return fileName.includes('fpod');
    return false;
  }, []);

  // Apply filters
  const filteredFiles = useMemo(() => {
    return allFiles.filter(file => {
      const pinMatch = selectedPins.length === 0 || selectedPins.includes(file.pinLabel);
      const typeMatch = selectedTypes.length === 0 || selectedTypes.some(type => matchesType(file, type));
      const dateRangeMatch = selectedDateRanges.length === 0 || selectedDateRanges.some(range => {
        const fileRange = extractDateRange(file.fileName);
        return fileRange === range;
      });
      const fileSourceMatch = selectedFileSources.length === 0 || selectedFileSources.includes(file.fileSource);
      return pinMatch && typeMatch && dateRangeMatch && fileSourceMatch;
    });
  }, [allFiles, selectedPins, selectedTypes, selectedDateRanges, selectedFileSources, matchesType, extractDateRange]);

  // Compute unique filter options based on cascading filters
  const { uniquePins, uniqueTypes, uniqueDateRanges, projectStats } = useMemo(() => {
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

    // Project stats
    const groupedFiles = groupFilesByType(getProjectFiles());
    const projectStats = {
      totalFiles: allFiles.length,
      filteredFiles: filteredFiles.length,
      fileTypes: Object.entries(groupedFiles).map(([type, files]) => ({
        type,
        count: files.length
      })).filter(({ count }) => count > 0),
      totalSize: allFiles.reduce((sum, file) => sum + (file.fileSize || 0), 0),
      uniquePins: uniquePins.length
    };

    return { uniquePins, uniqueTypes, uniqueDateRanges, projectStats };
  }, [allFiles, filteredFiles, selectedPins, selectedTypes, selectedDateRanges, matchesType, extractDateRange, groupFilesByType, getProjectFiles]);

  const hasActiveFilters = selectedPins.length > 0 || selectedTypes.length > 0 || selectedDateRanges.length > 0 || selectedFileSources.length < 2;

  // Group files by source category
  const groupFilesBySource = useCallback((files: any[]) => {
    const grouped: Record<string, any[]> = {};
    TILE_NAMES.forEach(tileName => {
      grouped[tileName] = [];
    });

    files.forEach(file => {
      const matches = categorizeFile(file.fileName);
      matches.forEach(match => {
        if (grouped[match.tile]) {
          if (!grouped[match.tile].find(f => f.id === file.id)) {
            grouped[match.tile].push(file);
          }
        }
      });
    });

    return grouped;
  }, []);

  // Get file date range
  const getFileDateRange = useCallback(async (file: PinFile): Promise<{ start: Date; end: Date } | null> => {
    // Check if file has stored date range
    if (file.startDate && file.endDate) {
      return {
        start: new Date(file.startDate),
        end: new Date(file.endDate)
      };
    }
    return null;
  }, []);

  // Handle file upload initiation
  const handleInitiateFileUpload = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.csv,.xlsx,.xls';
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      if (files.length > 0) {
        setPendingUploadFiles(files);
        setShowUploadPinSelector(true);
      }
    };
    input.click();
  }, []);

  // Handle file upload
  const handleFileUpload = useCallback(async (targetId: string, targetType: 'pin' | 'area') => {
    if (pendingUploadFiles.length === 0 || !projectId) return;

    setIsUploadingFiles(true);
    try {
      for (const file of pendingUploadFiles) {
        await fileStorageService.uploadFile({
          file,
          pinId: targetType === 'pin' ? targetId : undefined,
          areaId: targetType === 'area' ? targetId : undefined,
          projectId
        });
      }

      toast({
        title: 'Upload Complete',
        description: `Successfully uploaded ${pendingUploadFiles.length} file(s)`
      });

      setPendingUploadFiles([]);
      setShowUploadPinSelector(false);
      await reload();
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        variant: 'destructive',
        title: 'Upload Failed',
        description: error instanceof Error ? error.message : 'Failed to upload files'
      });
    } finally {
      setIsUploadingFiles(false);
    }
  }, [pendingUploadFiles, projectId, reload, toast]);

  // Handle file click (open in modal)
  const handleFileClick = useCallback(async (file: PinFile & { pinLabel: string }) => {
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

      // Extract metadata
      const pinLabel = file.pinLabel || 'Unassigned';
      const dateRange = await getFileDateRange(file);

      let startDate: Date | undefined;
      let endDate: Date | undefined;

      if (dateRange) {
        startDate = dateRange.start;
        endDate = dateRange.end;
      }

      // Extract categories
      const categories = categorizeFile(file.fileName);
      const fileCategories = categories
        .map(c => c.category)
        .filter((c): c is string => c !== undefined);

      // Download file content
      const fileContent = await fileStorageService.downloadFile(file.filePath);
      if (fileContent) {
        const actualFile = new File([fileContent], file.fileName, {
          type: file.fileType || 'text/csv'
        });

        setSelectedFileType(fileType);
        setSelectedFiles([actualFile]);
        setSelectedFileMetadata({
          pinLabel,
          startDate,
          endDate,
          fileCategories
        });
        setShowMarineDeviceModal(true);
      } else {
        toast({
          variant: 'destructive',
          title: 'Download Failed',
          description: 'Could not download file from storage.'
        });
      }
    } catch (error) {
      console.error('Error downloading file:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to open file.'
      });
    }
  }, [getFileDateRange, toast]);

  // Handle merged file click
  const handleMergedFileClick = useCallback(async (mergedFile: MergedFile) => {
    try {
      const { downloadMergedFileAction } = await import('@/app/api/merged-files/actions');
      const result = await downloadMergedFileAction(mergedFile.filePath);

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to download merged file');
      }

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

      setSelectedFileType(fileType);
      setSelectedFiles([file]);
      setSelectedFileMetadata(null);
      setShowMarineDeviceModal(true);
    } catch (error) {
      console.error('Error opening merged file:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to open merged file'
      });
    }
  }, [toast]);

  // Handle file rename
  const handleRenameFile = useCallback(async (file: any, newName: string): Promise<boolean> => {
    try {
      const success = await fileStorageService.renameFile(file.id, newName);
      if (success) {
        toast({
          title: 'File Renamed',
          description: `File renamed to ${newName}`
        });
        await reload();
        return true;
      } else {
        toast({
          variant: 'destructive',
          title: 'Rename Failed',
          description: 'Failed to rename the file.'
        });
        return false;
      }
    } catch (error) {
      console.error('Rename error:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'An error occurred while renaming the file.'
      });
      return false;
    }
  }, [reload, toast]);

  // Handle file delete
  const handleDeleteFile = useCallback(async (file: any): Promise<void> => {
    try {
      const isMergedFile = file.fileSource === 'merged';

      if (isMergedFile) {
        const { deleteMergedFileAction } = await import('@/app/api/merged-files/actions');
        const result = await deleteMergedFileAction(file.id);

        if (result.success) {
          toast({
            title: 'Merged File Deleted',
            description: `${file.fileName} has been deleted.`
          });
          await reload();
        } else {
          toast({
            variant: 'destructive',
            title: 'Delete Failed',
            description: result.error || 'Failed to delete the merged file.'
          });
        }
      } else {
        const success = await fileStorageService.deleteFileSimple(file.id);
        if (success) {
          toast({
            title: 'File Deleted',
            description: `${file.fileName} has been deleted.`
          });
          await reload();
        } else {
          toast({
            variant: 'destructive',
            title: 'Delete Failed',
            description: 'Failed to delete the file.'
          });
        }
      }
    } catch (error) {
      console.error('Delete error:', error);
      toast({
        variant: 'destructive',
        title: 'Delete Error',
        description: 'An error occurred while deleting the file.'
      });
    }
  }, [reload, toast]);

  // Handle dates updated
  const handleDatesUpdated = useCallback(async (): Promise<void> => {
    await reload();
  }, [reload]);

  // Handle multi-file selection
  const handleSelectMultipleFiles = useCallback(async (selectedFiles: any[]): Promise<void> => {
    try {
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
            variant: 'destructive',
            title: 'Download Failed',
            description: `Failed to download ${file.fileName}`
          });
          return;
        }
      }

      // Import multi-file validator
      const { parseFile, validateFilesCompatibility } = await import('@/lib/multiFileValidator');

      // Parse all files
      const parsedFiles = await Promise.all(
        downloadedFiles.map(async (file, idx) => {
          const parsed = await parseFile(file);
          return {
            ...parsed,
            fileId: selectedFiles[idx].id
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
        selectedFiles
      });
      setShowMultiFileConfirmDialog(true);
    } catch (error) {
      console.error('Multi-file selection error:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to process multiple files'
      });
    }
  }, [toast]);

  // Handle add files to merged file
  const handleAddFilesToMergedFile = useCallback(async (mergedFile: any): Promise<void> => {
    toast({
      title: 'Add Files Feature',
      description: 'This feature is coming soon! You\'ll be able to add more files to this merge.'
    });
  }, [toast]);

  // Clear all filters
  const handleClearAllFilters = useCallback(() => {
    setSelectedPins([]);
    setSelectedTypes([]);
    setSelectedDateRanges([]);
    setSelectedFileSources(['upload', 'merged']);
  }, []);

  // Don't render until we have the projectId
  if (!projectId) {
    return null;
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <ProjectDataHeader
        projectName={project?.name || ''}
        isUploadingFiles={isUploadingFiles}
        onUpload={handleInitiateFileUpload}
      />

      <div className="px-6 py-3">
        <ProjectDataFilters
          projectStats={projectStats}
          hasActiveFilters={hasActiveFilters}
          uniquePins={uniquePins}
          selectedPins={selectedPins}
          setSelectedPins={setSelectedPins}
          uniqueTypes={uniqueTypes}
          selectedTypes={selectedTypes}
          setSelectedTypes={setSelectedTypes}
          uniqueDateRanges={uniqueDateRanges}
          selectedDateRanges={selectedDateRanges}
          setSelectedDateRanges={setSelectedDateRanges}
          selectedFileSources={selectedFileSources}
          setSelectedFileSources={setSelectedFileSources}
          onClearAllFilters={handleClearAllFilters}
        />
      </div>

      <main className="flex-1 overflow-y-auto p-6">
        <ProjectDataContent
          isLoading={isLoading || isLoadingMergedFiles}
          filteredFiles={filteredFiles}
          allFiles={allFiles}
          getFileDateRange={getFileDateRange}
          onFileClick={handleFileClick}
          onRenameFile={handleRenameFile}
          onDeleteFile={handleDeleteFile}
          onDatesUpdated={handleDatesUpdated}
          onSelectMultipleFiles={handleSelectMultipleFiles}
          projectId={projectId}
          onMergedFileClick={handleMergedFileClick}
          onAddFilesToMergedFile={handleAddFilesToMergedFile}
          multiFileMergeMode={multiFileMergeMode}
          setMultiFileMergeMode={setMultiFileMergeMode}
          groupFilesBySource={groupFilesBySource}
          globalPinColorMap={globalPinColorMap}
        />
      </main>

      {/* Marine Device Modal */}
      {showMarineDeviceModal && selectedFileType && (
        <MarineDeviceModal
          open={showMarineDeviceModal}
          onOpenChange={setShowMarineDeviceModal}
          selectedFileType={selectedFileType}
          selectedFiles={selectedFiles}
          selectedFileMetadata={selectedFileMetadata || undefined}
          isLoadingFromSavedPlot={false}
          onRequestFileSelection={() => {
            toast({
              title: 'File Selection',
              description: 'Please select a file from the Project Data page.'
            });
          }}
          availableFilesForPlots={getProjectFiles()}
          onDownloadFile={async (fileId: string) => {
            const file = getProjectFiles().find(f => f.id === fileId);
            if (file) {
              const content = await fileStorageService.downloadFile(file.filePath);
              if (content) {
                const url = URL.createObjectURL(content);
                const a = document.createElement('a');
                a.href = url;
                a.download = file.fileName;
                a.click();
                URL.revokeObjectURL(url);
              }
            }
          }}
          objectGpsCoords={undefined}
          objectName={selectedFileMetadata?.pinLabel || 'Unknown Location'}
          multiFileMergeMode={multiFileMergeMode === 'union'}
          allProjectFilesForTimeline={getProjectFiles()}
          getFileDateRange={(fileId: string) => {
            const file = getProjectFiles().find(f => f.id === fileId);
            if (file?.startDate && file?.endDate) {
              return {
                start: new Date(file.startDate),
                end: new Date(file.endDate)
              };
            }
            return null;
          }}
          projectId={projectId}
          onRefreshFiles={reload}
          availableProjects={[{ id: projectId, name: project?.name || '' }]}
          onClose={() => {
            setSelectedFileType(null);
            setSelectedFiles([]);
            setSelectedFileMetadata(null);
          }}
        />
      )}

      {/* File Upload Dialog */}
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
        currentProjectId={projectId}
        isUploadingFiles={isUploadingFiles}
        onUpload={(targetId, targetType) => handleFileUpload(targetId, targetType)}
        onCancel={() => {
          setShowUploadPinSelector(false);
          setPendingUploadFiles([]);
        }}
      />

      {/* Multi-file Confirm Dialog */}
      {showMultiFileConfirmDialog && multiFileConfirmData && (
        <MultiFileConfirmDialog
          open={showMultiFileConfirmDialog}
          onOpenChange={setShowMultiFileConfirmDialog}
          parsedFiles={multiFileConfirmData.parsedFiles}
          validation={multiFileConfirmData.validation}
          mergeMode={multiFileMergeMode}
          onMergeModeChange={setMultiFileMergeMode}
          onConfirm={() => {
            // Open in modal
            setSelectedFileType(multiFileConfirmData.fileType);
            setSelectedFiles(multiFileConfirmData.downloadedFiles);
            setSelectedFileMetadata(null);
            setShowMultiFileConfirmDialog(false);
            setShowMarineDeviceModal(true);
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
