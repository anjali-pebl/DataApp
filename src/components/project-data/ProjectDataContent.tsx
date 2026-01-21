'use client';

import React from 'react';
import { Database } from 'lucide-react';
import { SourceTile } from './SourceTile';
import { DataTimelineSkeleton } from '@/components/loading/PageSkeletons';
import type { PinFile } from '@/lib/supabase/types';
import { TILE_NAMES } from '@/lib/file-categorization-config';

export interface ProjectDataContentProps {
  isLoading: boolean;
  filteredFiles: any[];
  allFiles: any[];
  getFileDateRange: (file: PinFile) => Promise<{ start: Date; end: Date } | null>;
  onFileClick: (file: PinFile & { pinLabel: string }) => void;
  onRenameFile: (file: any, newName: string) => Promise<boolean>;
  onDeleteFile: (file: any) => Promise<void>;
  onDatesUpdated: () => Promise<void>;
  onSelectMultipleFiles: (files: any[]) => Promise<void>;
  projectId: string;
  onMergedFileClick: (mergedFile: any) => Promise<void>;
  onAddFilesToMergedFile: (mergedFile: any) => Promise<void>;
  multiFileMergeMode: 'union' | 'intersection';
  setMultiFileMergeMode: (mode: 'union' | 'intersection') => void;
  groupFilesBySource: (files: any[]) => Record<string, any[]>;
  globalPinColorMap: Map<string, string>;
}

export function ProjectDataContent({
  isLoading,
  filteredFiles,
  allFiles,
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
  groupFilesBySource,
  globalPinColorMap
}: ProjectDataContentProps) {
  // Show skeleton while loading
  if (isLoading) {
    return <DataTimelineSkeleton />;
  }

  // Show empty state if no files at all
  if (allFiles.length === 0) {
    return (
      <div className="text-center py-8">
        <Database className="h-12 w-12 mx-auto mb-4 opacity-30" />
        <p className="text-muted-foreground">No data files in this project</p>
      </div>
    );
  }

  // Group files by source
  const filesBySource = groupFilesBySource(filteredFiles);
  const tilesWithFiles = TILE_NAMES.filter(tileName => filesBySource[tileName]?.length > 0);

  // Show empty state if no files match filters
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
            onFileClick={onFileClick}
            onRenameFile={onRenameFile}
            onDeleteFile={onDeleteFile}
            onDatesUpdated={onDatesUpdated}
            onSelectMultipleFiles={onSelectMultipleFiles}
            projectId={projectId}
            onMergedFileClick={onMergedFileClick}
            onAddFilesToMergedFile={onAddFilesToMergedFile}
            multiFileMergeMode={multiFileMergeMode}
            setMultiFileMergeMode={setMultiFileMergeMode}
            pinColorMap={globalPinColorMap}
          />
        );
      })}
    </div>
  );
}
