'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronDown, FileCode, BarChart3, Calendar } from 'lucide-react';
import { DataTimeline } from '@/components/pin-data/DataTimeline';
import type { PinFile } from '@/lib/supabase/types';
import {
  categorizeFile,
  getCategoriesForTile,
  tileHasCategories
} from '@/lib/file-categorization-config';

export interface SourceTileProps {
  source: string;
  label: string;
  files: any[];
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
  pinColorMap: Map<string, string>;
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
  pinColorMap
}: SourceTileProps) {
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
        className="flex-1 overflow-y-auto overflow-x-auto cursor-grab scrollbar-hide"
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
