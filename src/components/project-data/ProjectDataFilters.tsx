'use client';

import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Database,
  MapPin,
  ChevronDown,
  X,
  Cloud,
  BarChart3,
  Calendar,
  Upload,
  FileCode
} from 'lucide-react';

export interface ProjectDataFiltersProps {
  projectStats: {
    totalFiles: number;
    filteredFiles: number;
    fileTypes: Array<{ type: string; count: number }>;
    totalSize: number;
    uniquePins: number;
  };
  hasActiveFilters: boolean;
  // Pin filter
  uniquePins: string[];
  selectedPins: string[];
  setSelectedPins: (pins: string[]) => void;
  // Type filter
  uniqueTypes: string[];
  selectedTypes: string[];
  setSelectedTypes: (types: string[]) => void;
  // Date range filter
  uniqueDateRanges: string[];
  selectedDateRanges: string[];
  setSelectedDateRanges: (ranges: string[]) => void;
  // File source filter
  selectedFileSources: ('upload' | 'merged')[];
  setSelectedFileSources: (sources: ('upload' | 'merged')[]) => void;
  // Clear all
  onClearAllFilters: () => void;
}

export function ProjectDataFilters({
  projectStats,
  hasActiveFilters,
  uniquePins,
  selectedPins,
  setSelectedPins,
  uniqueTypes,
  selectedTypes,
  setSelectedTypes,
  uniqueDateRanges,
  selectedDateRanges,
  setSelectedDateRanges,
  selectedFileSources,
  setSelectedFileSources,
  onClearAllFilters
}: ProjectDataFiltersProps) {
  return (
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
              onClick={onClearAllFilters}
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
            {projectStats.fileTypes.map(({ type, count }) => (
              <div key={type} className="bg-muted/80 px-1.5 py-0.5 rounded text-[10px] font-medium">
                {type}: {count}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
