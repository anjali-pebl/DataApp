'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronDown, FileCode, BarChart3, Calendar, Image, FileText, Download, Trash2 } from 'lucide-react';
import { DataTimeline } from '@/components/pin-data/DataTimeline';
import type { PinFile } from '@/lib/supabase/types';
import {
  categorizeFile,
  getCategoriesForTile,
  tileHasCategories,
  isPhotoFile,
  isPdfFile
} from '@/lib/file-categorization-config';
import { fileStorageService } from '@/lib/supabase/file-storage-service';

export interface SourceTileProps {
  source: string;
  label: string;
  files: any[];
  getFileDateRange: (file: PinFile) => Promise<{
    totalDays: number | null;
    startDate: string | null;
    endDate: string | null;
    uniqueDates?: string[];
    isCrop?: boolean;
    error?: string;
  }>;
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
  pinColorMap: Map<string, string>;
  onPairedFileClick?: (stdFile: PinFile & { pinLabel: string }, avgFile: PinFile & { pinLabel: string }) => void;
}

export function SourceTile({
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
  pinColorMap,
  onPairedFileClick
}: SourceTileProps) {
  const [selectedCategories, setSelectedCategories] = React.useState<string[]>([]);
  const [viewMode, setViewMode] = React.useState<'table' | 'timeline'>('timeline');
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [startY, setStartY] = React.useState(0);
  const [scrollTop, setScrollTop] = React.useState(0);
  // Per-tile merge mode enabled state (default off)
  const [isMergeEnabled, setIsMergeEnabled] = React.useState(false);

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
      <div className="bg-teal-700 border-b border-teal-800 px-4 py-3 flex-shrink-0 rounded-t-lg">
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

            {/* View Mode Toggle (not useful for Media tile) */}
            {label !== 'Media' && (
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
            )}

            <span className="text-xs text-white bg-teal-800 px-2 py-1 rounded">
              {filteredFiles.length} {filteredFiles.length === 1 ? 'file' : 'files'}
            </span>
          </div>
        </div>
      </div>

      {/* Tile Content */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto overflow-x-auto cursor-grab scrollbar-hide"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {label === 'Media' ? (
          <MediaFileList files={filteredFiles} onDeleteFile={onDeleteFile} pinColorMap={pinColorMap} />
        ) : (
          <DataTimeline
            key={`${projectId}-${label}`}
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
            multiFileMergeMode={isMergeEnabled}
            onMultiFileMergeModeChange={setIsMergeEnabled}
            viewMode={viewMode}
            pinColorMap={pinColorMap}
            tileName={label}
            onPairedFileClick={onPairedFileClick}
          />
        )}
      </div>
    </div>
  );
}

/** Simple file list for media files (photos & PDFs) */
function MediaFileList({ files, onDeleteFile, pinColorMap }: { files: any[]; onDeleteFile: (file: any) => Promise<void>; pinColorMap: Map<string, string> }) {
  const [deleteConfirmId, setDeleteConfirmId] = React.useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = React.useState<{ url: string; fileName: string } | null>(null);

  const photos = files.filter(f => isPhotoFile(f.fileName));
  const documents = files.filter(f => isPdfFile(f.fileName));

  const handleFileClick = (file: any) => {
    const publicUrl = fileStorageService.getPublicUrl(file.filePath);
    if (!publicUrl) return;

    if (isPhotoFile(file.fileName)) {
      setPhotoPreview({ url: publicUrl, fileName: file.fileName });
    } else if (isPdfFile(file.fileName)) {
      window.open(publicUrl, '_blank');
    }
  };

  const handleDownload = async (file: any) => {
    const publicUrl = fileStorageService.getPublicUrl(file.filePath);
    if (!publicUrl) return;
    try {
      const response = await fetch(publicUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  const renderFile = (file: any) => {
    const pinColor = pinColorMap.get(file.pinLabel) || '#94a3b8';
    return (
    <div key={file.id} className="flex items-center h-[22px] text-xs hover:bg-muted/30">
      {/* Pin indicator + label — matches DataTimeline table rows */}
      <div className="flex items-center gap-1.5 px-4 whitespace-nowrap">
        <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: pinColor }} />
        <span className="text-xs text-muted-foreground">{file.pinLabel}</span>
      </div>
      {/* File name */}
      <button onClick={() => handleFileClick(file)} className="flex items-center gap-1.5 flex-1 min-w-0 text-left px-4">
        {isPhotoFile(file.fileName) ? (
          <Image className="h-3 w-3 flex-shrink-0 text-blue-500" />
        ) : (
          <FileText className="h-3 w-3 flex-shrink-0 text-red-500" />
        )}
        <span className="font-mono truncate hover:text-primary hover:underline cursor-pointer">{file.fileName}</span>
      </button>
      {/* Actions — always visible */}
      <div className="flex items-center gap-1 px-2">
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => handleDownload(file)} title="Download">
          <Download className="h-3 w-3 text-muted-foreground" />
        </Button>
        {deleteConfirmId === file.id ? (
          <div className="flex items-center gap-1">
            <span className="text-xs">Delete?</span>
            <Button size="sm" variant="destructive" className="h-5 text-[10px] px-1" onClick={async () => { setDeleteConfirmId(null); await onDeleteFile(file); }}>Yes</Button>
            <Button size="sm" variant="outline" className="h-5 text-[10px] px-1" onClick={() => setDeleteConfirmId(null)}>No</Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setDeleteConfirmId(file.id)} title="Delete">
            <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
          </Button>
        )}
      </div>
    </div>
  );
  };

  return (
    <div className="py-1 space-y-2">
      {photos.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 px-4 py-1">
            <Image className="h-3 w-3 text-blue-500" />
            <span className="text-xs font-medium text-muted-foreground">Photos ({photos.length})</span>
          </div>
          {photos.map(renderFile)}
        </div>
      )}
      {documents.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 px-4 py-1">
            <FileText className="h-3 w-3 text-red-500" />
            <span className="text-xs font-medium text-muted-foreground">Documents ({documents.length})</span>
          </div>
          {documents.map(renderFile)}
        </div>
      )}

      {/* Photo preview modal */}
      {photoPreview && (
        <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center" onClick={() => setPhotoPreview(null)}>
          <div className="relative max-w-3xl max-h-[90vh] p-4" onClick={e => e.stopPropagation()}>
            <button onClick={() => setPhotoPreview(null)} className="absolute top-2 right-2 bg-black/50 text-white rounded-full p-1 hover:bg-black/70 z-10">
              <span className="sr-only">Close</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <p className="text-white text-sm mb-2 text-center">{photoPreview.fileName}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoPreview.url} alt={photoPreview.fileName} className="max-w-full max-h-[75vh] object-contain rounded" />
          </div>
        </div>
      )}
    </div>
  );
}
