
"use client";

import React, { useMemo, useRef, useEffect, useState } from 'react';
import { parseISO, startOfDay, format, isValid, eachDayOfInterval } from 'date-fns';
import { scaleLinear, scaleBand } from 'd3-scale';
import { cn } from "@/lib/utils";
import { reorganizeTaxonomicData } from '@/lib/taxonomic-reorganizer';
import { ResponsiveContainer, LineChart, Line, XAxis, Brush } from 'recharts';
import type { FlattenedTaxon } from '@/lib/taxonomic-tree-builder';


interface DataPoint {
  time: string | number;
  [key:string]: string | number | undefined | null;
}

interface HeatmapDisplayProps {
  data: DataPoint[];
  series: string[];
  speciesIndentMap?: Map<string, number>; // Taxonomic indentation levels from tree view
  speciesRankMap?: Map<string, string>; // Taxonomic ranks from tree view
  filteredFlattenedTree?: FlattenedTaxon[]; // Flattened tree with parent-child relationships
  parentChildRelationships?: Map<string, { color: string; role: 'parent' | 'child' }>; // Parent-child relationship indicators
  containerHeight: number;
  brushStartIndex?: number;
  brushEndIndex?: number;
  onBrushChange?: (newIndex: { startIndex?: number; endIndex?: number }) => void;
  timeFormat?: 'short' | 'full';
  customColor?: string; // Custom color for heatmap (hex format)
  customMaxValue?: number; // Custom max value for color scale saturation
  cellWidth?: number; // Width of each cell/column (default: 10)
  rowHeight?: number; // Height of each row (default: 35)
  onShowInTree?: (speciesName: string) => void;
}

interface ProcessedCell {
  date: string; // YYYY-MM-DD
  series: string;
  value: number;
  count: number;
}

interface OverviewDataPoint {
    time: string;
    value: number;
}

const HeatmapDisplayComponent = ({
    data,
    series,
    speciesIndentMap,
    speciesRankMap,
    filteredFlattenedTree,
    parentChildRelationships,
    containerHeight,
    brushStartIndex,
    brushEndIndex,
    onBrushChange,
    timeFormat = 'short',
    customColor,
    customMaxValue,
    cellWidth = 10,
    rowHeight = 35,
    onShowInTree
}: HeatmapDisplayProps) => {
  // Debug: Check if filteredFlattenedTree is being passed
  console.log('[HEATMAP DISPLAY] filteredFlattenedTree prop:', filteredFlattenedTree ? `${filteredFlattenedTree.length} items` : 'undefined/null');

  const containerRef = useRef<HTMLDivElement>(null);
  const [svgDimensions, setSvgDimensions] = useState({ width: 0, height: 0 });
  const [selectedCell, setSelectedCell] = useState<{
    day: string;
    species: string;
    value: number;
    count: number;
    x: number;
    y: number;
  } | null>(null);

  // Click handler for heatmap cells via event delegation
  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const target = e.target as SVGElement;
    const cellData = target.getAttribute('data-cell');
    if (!cellData) return;
    try {
      const parsed = JSON.parse(cellData);
      setSelectedCell({ ...parsed, x: e.clientX, y: e.clientY });
    } catch { /* ignore */ }
  };

  // Close popup when clicking outside
  useEffect(() => {
    if (!selectedCell) return;
    const handleClick = (e: MouseEvent) => {
      const popup = document.getElementById('heatmap-cell-popup');
      if (popup && !popup.contains(e.target as Node)) {
        setSelectedCell(null);
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [selectedCell]);

  const BRUSH_CHART_HEIGHT = 60;
  const heatmapHeight = onBrushChange ? containerHeight - BRUSH_CHART_HEIGHT : containerHeight;

  // Extract taxonomic rank from species name (e.g., "Brachyura (ord.)" → "ord")
  // Prefer speciesRankMap from tree view when available
  const getTaxonomicRank = (speciesName: string): string | null => {
    // If we have tree view rank data, use that
    if (speciesRankMap && speciesRankMap.has(speciesName)) {
      return speciesRankMap.get(speciesName)!;
    }
    // Fallback to extracting from species name string
    // Match abbreviated ranks with dot: (phyl.), (ord.), etc.
    const matchAbbrev = speciesName.match(/\((phyl|infraclass|class|ord|fam|gen|sp)\.\)/);
    if (matchAbbrev) return matchAbbrev[1];
    // Match full rank names without dot: (kingdom), (phylum), etc.
    const matchFull = speciesName.match(/\((kingdom|phylum|order|family|genus|species)\)/);
    return matchFull ? matchFull[1] : null;
  };

  // Get single-letter abbreviation for taxonomic rank
  const getRankAbbreviation = (rank: string | null): string => {
    const abbrevMap: Record<string, string> = {
      'kingdom': 'K',    // Kingdom
      'phylum': 'P',     // Phylum (full name)
      'phyl': 'P',       // Phylum (abbreviated)
      'infraclass': 'I', // Infraclass
      'class': 'C',      // Class
      'order': 'O',      // Order (full name)
      'ord': 'O',        // Order (abbreviated)
      'family': 'F',     // Family (full name)
      'fam': 'F',        // Family (abbreviated)
      'genus': 'G',      // Genus (full name)
      'gen': 'G',        // Genus (abbreviated)
      'species': 'S',    // Species (full name)
      'sp': 'S'          // Species (abbreviated)
    };
    return rank ? (abbrevMap[rank] ?? '?') : '?';
  };

// Get color for taxonomic rank (colorblind-friendly Paul Tol palette)
  const getRankColor = (rank: string | null): string => {
    const rankColors: Record<string, string> = {
      'kingdom': '#882255',    // Kingdom - wine
      'phylum': '#AA3377',     // Phylum - purple (full name)
      'phyl': '#AA3377',       // Phylum - purple (abbreviated)
      'infraclass': '#CC6677', // Infraclass - rose
      'class': '#EE6677',      // Class - red/pink
      'order': '#CCBB44',      // Order - olive yellow (full name)
      'ord': '#CCBB44',        // Order - olive yellow (abbreviated)
      'family': '#228833',     // Family - green (full name)
      'fam': '#228833',        // Family - green (abbreviated)
      'genus': '#66CCEE',      // Genus - cyan (full name)
      'gen': '#66CCEE',        // Genus - cyan (abbreviated)
      'species': '#4477AA',    // Species - blue (full name)
      'sp': '#4477AA'          // Species - blue (abbreviated)
    };
    return rank ? (rankColors[rank] ?? '#BBBBBB') : '#BBBBBB';
  };

  // Remove rank suffix from name (e.g., "Gadus morhua (sp.)" → "Gadus morhua", "Animalia (kingdom)" → "Animalia")
  const stripRankSuffix = (name: string): string => {
    return name
      .replace(/\s*\((phyl|infraclass|class|ord|fam|gen|sp)\.\)\s*$/, '')
      .replace(/\s*\((kingdom|phylum|order|family|genus|species)\)\s*$/, '');
  };

  // Map rank to indent level (hierarchical ordering)
  // Prefer speciesIndentMap from tree view when available, fallback to rank-based calculation
  const getRankIndentLevel = (rank: string | null): number => {
    const rankLevels: Record<string, number> = {
      'phyl': 0,       // Phylum - no indentation (highest level)
      'infraclass': 1, // Infraclass - 1 level indent
      'class': 2,      // Class - 2 level indent
      'ord': 3,        // Order - 3 level indent
      'fam': 4,        // Family - 4 levels indent
      'gen': 5,        // Genus - 5 levels indent
      'sp': 6          // Species - 6 levels indent
    };
    return rank ? (rankLevels[rank] ?? 0) : 0;
  };

  // Get indentation level for a species, using tree view data when available
  const getIndentLevel = (speciesName: string): number => {
    // If we have tree view indentation data, use that
    if (speciesIndentMap && speciesIndentMap.has(speciesName)) {
      return speciesIndentMap.get(speciesName)!;
    }
    // Fallback to rank-based calculation
    const rank = getTaxonomicRank(speciesName);
    return getRankIndentLevel(rank);
  };

  // Use series directly - it's already in correct taxonomic order from the tree builder
  // No need to rebuild hierarchy here, as it would create incorrect parent-child relationships
  const hierarchicalSeries = series;

  // Use FIXED max indent level for consistent positioning (species level = 6)
  // This ensures indentation is always based on taxonomic rank, not on what species are visible
  const maxIndentLevel = 6; // Species rank has the highest indent level

  // Indent pixels per level
  const INDENT_PX_PER_LEVEL = 20;

  // Calculate maximum label width needed based on actually displayed taxa names
  const maxLabelWidth = useMemo(() => {
    // Estimate ~6.5 pixels per character for text-xs font
    const CHAR_WIDTH = 6.5;
    const BASE_PADDING = 20; // Base padding for the label area

    // Calculate the effective width needed for each visible taxon (name + its indentation)
    let maxEffectiveWidth = 0;
    series.forEach(name => {
      const cleanName = name.replace(/\s*\((phyl|infraclass|class|ord|fam|gen|sp)\.\)\s*$/, '').replace(/\s*\((kingdom|phylum|order|family|genus|species)\)\s*$/, '');
      const indentLevel = getIndentLevel(name);
      // Width = text width + indent offset from right edge (maxIndent - thisIndent) * px
      const effectiveWidth = (cleanName.length * CHAR_WIDTH) +
                            (maxIndentLevel - indentLevel) * INDENT_PX_PER_LEVEL +
                            16 + // Colored square (12px) + gap (4px)
                            BASE_PADDING;
      maxEffectiveWidth = Math.max(maxEffectiveWidth, effectiveWidth);
    });

    // Ensure minimum width of 150px
    return Math.max(150, Math.ceil(maxEffectiveWidth));
  }, [series, speciesIndentMap]);

  // Dynamic left margin to accommodate all labels without truncation
  const leftMargin = maxLabelWidth;
  const margin = { top: 50, right: 20, bottom: 100, left: leftMargin };

  useEffect(() => {
    const resizeObserver = new ResizeObserver(entries => {
      if (!entries || entries.length === 0) {
        return;
      }
      const { width } = entries[0].contentRect;
      setSvgDimensions({ width, height: heatmapHeight });
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      if (containerRef.current) {
        resizeObserver.unobserve(containerRef.current);
      }
    };
  }, [heatmapHeight]);

  const { processedData } = useMemo(() => {
    if (!data || data.length === 0 || brushStartIndex === undefined || brushEndIndex === undefined) { 
        return { 
            processedData: { cells: [], uniqueDays: [], series: [], minValue: 0, maxValue: 0, dateInterval: null },
        };
    }

    const start = Math.max(0, brushStartIndex);
    const end = Math.min(data.length - 1, brushEndIndex);
    const visibleData = data.slice(start, end + 1);

    const dailyData = new Map<string, { sum: number; count: number }>();
    const allValues: number[] = [];
    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    visibleData.forEach(point => {
      const date = parseISO(point.time as string);
      if (!isValid(date)) return;

      if (!minDate || date < minDate) minDate = date;
      if (!maxDate || date > maxDate) maxDate = date;

      const dayKey = format(startOfDay(date), 'yyyy-MM-dd');
      
      series.forEach(s => {
        const value = point[s];
        if (value !== null && value !== undefined && typeof value === 'number' && !isNaN(value)) {
          const cellKey = `${dayKey}__${s}`;
          const existing = dailyData.get(cellKey) || { sum: 0, count: 0 };
          existing.sum += value;
          existing.count++;
          dailyData.set(cellKey, existing);
        }
      });
    });

    const dateInterval = minDate && maxDate ? eachDayOfInterval({ start: minDate, end: maxDate }) : [];
    if (dateInterval.length > 150) {
        const limitedEndDate = dateInterval[149];
        if(limitedEndDate) maxDate = limitedEndDate;
    }
    const finalInterval = minDate && maxDate ? eachDayOfInterval({ start: minDate, end: maxDate }) : [];

    const cells: ProcessedCell[] = [];
    dailyData.forEach((stats, key) => {
      const [dateStr, seriesName] = key.split('__');
      if (stats.count > 0 && finalInterval.some(d => format(d, 'yyyy-MM-dd') === dateStr)) {
        const avg = stats.sum / stats.count;
        cells.push({ date: dateStr, series: seriesName, value: avg, count: stats.count });
        allValues.push(avg);
      }
    });

    const uniqueDays = finalInterval.map(d => format(d, 'yyyy-MM-dd')).sort();
    const minValue = Math.min(0, ...allValues);
    const maxValue = Math.max(...allValues);

    const processedResult = { cells, uniqueDays, series: hierarchicalSeries, minValue, maxValue, dateInterval: finalInterval };
    return { processedData: processedResult };

  }, [data, series, hierarchicalSeries, brushStartIndex, brushEndIndex]);

  const colorScale = useMemo(() => {
    // Convert hex to rgba for gradient
    const hexToRgba = (hex: string, alpha: number) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    const lightColor = customColor
      ? hexToRgba(customColor, 0.1)
      : "hsla(var(--primary) / 0.1)";
    const darkColor = customColor
      ? hexToRgba(customColor, 1.0)
      : "hsla(var(--primary) / 1.0)";

    // Use custom max value if provided, otherwise default to 10
    const effectiveMaxValue = customMaxValue !== undefined && customMaxValue > 0
      ? customMaxValue
      : 10; // Default max value for conditional formatting

    return scaleLinear<string>()
      .domain([Math.max(0.001, processedData.minValue), effectiveMaxValue])
      .range([lightColor, darkColor])
      .clamp(true);
  }, [processedData.minValue, processedData.maxValue, customColor, customMaxValue]);
  
  // FIX: Calculate tick values BEFORE early return to maintain hook order
  const tickValues = useMemo(() => {
    const days = processedData.uniqueDays;
    if (days.length <= 10) return days;
    const tickInterval = Math.ceil(days.length / 10);
    return days.filter((_, i) => i % tickInterval === 0);
  }, [processedData.uniqueDays]);

  if (!data || data.length === 0 || series.length === 0 || processedData.uniqueDays.length === 0) {
    return (
      <div style={{ height: `${containerHeight}px` }} className="flex items-center justify-center text-muted-foreground text-sm p-2 border rounded-md bg-white">
        No data available for heatmap view. Check selected range.
      </div>
    );
  }

  const { cells, uniqueDays, series: visibleSeries } = processedData;
  const cellMap = new Map<string, ProcessedCell>(cells.map(c => [`${c.date}__${c.series}`, c]));

  const { width, height } = svgDimensions;

  // Calculate plot dimensions - fill container width dynamically, use fixed row height
  const minPlotWidth = uniqueDays.length * cellWidth;
  const availablePlotWidth = Math.max(minPlotWidth, width - margin.left - margin.right);
  const plotWidth = availablePlotWidth;
  const plotHeight = visibleSeries.length * rowHeight;

  const xScale = scaleBand<string>().domain(uniqueDays).range([0, plotWidth]).padding(0.05);
  const yScale = scaleBand<string>().domain(visibleSeries).range([0, plotHeight]).padding(0.05);
  
  const formatDateTickBrush = (timeValue: string | number): string => {
    try {
      const dateObj = parseISO(String(timeValue));
      if (!isValid(dateObj)) return String(timeValue);
      return format(dateObj, 'dd MMM'); 
    } catch (e) {
      return String(timeValue);
    }
  };

  // Pre-compute taxon info map for performance (avoid repeated finds in render loop)
  const taxonInfoMap = useMemo(() => {
    if (!filteredFlattenedTree) return new Map();
    const map = new Map<string, typeof filteredFlattenedTree[0]>();
    filteredFlattenedTree.forEach(taxon => {
      const name = taxon.node.originalName || taxon.name;
      map.set(name, taxon);
    });
    return map;
  }, [filteredFlattenedTree]);

  // Get unique ranks present in the data
  const ranksPresent = useMemo(() => {
    const ranks = new Set(series.map(s => getTaxonomicRank(s)).filter(r => r !== null));
    return Array.from(ranks).sort((a, b) => {
      const order: Record<string, number> = { 'kingdom': 0, 'phylum': 1, 'phyl': 1, 'class': 2, 'infraclass': 2, 'order': 3, 'ord': 3, 'family': 4, 'fam': 4, 'genus': 5, 'gen': 5, 'species': 6, 'sp': 6 };
      return (order[a] ?? 999) - (order[b] ?? 999);
    });
  }, [series]);

  const rankLabels: Record<string, string> = {
    'kingdom': 'Kingdom',
    'phylum': 'Phylum', 'phyl': 'Phylum',
    'class': 'Class', 'infraclass': 'Infraclass',
    'order': 'Order', 'ord': 'Order',
    'family': 'Family', 'fam': 'Family',
    'genus': 'Genus', 'gen': 'Genus',
    'species': 'Species', 'sp': 'Species'
  };

  return (
    <div className="w-full h-full">
        <div
          ref={containerRef}
          style={{ height: `${heatmapHeight}px` }}
          className="relative w-full h-full border rounded-md p-2 bg-white overflow-x-auto overflow-y-visible"
        >
          {/* Taxonomic Rank Legend - Top Right */}
          <div className="absolute top-[6px] right-2 px-3 py-2 bg-white/95 backdrop-blur-sm rounded-md shadow-sm z-10">
            <div className="flex items-center gap-3 text-xs">
              <span className="font-semibold text-gray-700">Taxonomic Ranks:</span>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: '#882255' }}></div>
                <span className="text-gray-600">Kingdom</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: '#AA3377' }}></div>
                <span className="text-gray-600">Phylum</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: '#CC6677' }}></div>
                <span className="text-gray-600">Infraclass</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: '#EE6677' }}></div>
                <span className="text-gray-600">Class</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: '#CCBB44' }}></div>
                <span className="text-gray-600">Order</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: '#228833' }}></div>
                <span className="text-gray-600">Family</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: '#66CCEE' }}></div>
                <span className="text-gray-600">Genus</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: '#4477AA' }}></div>
                <span className="text-gray-600">Species</span>
              </div>
              <div className="flex items-center gap-2 ml-2 pl-2 border-l border-gray-300">
                <svg width="14" height="14" viewBox="-7 -7 14 14" className="inline-block">
                  <path d="M -2.4,0 L 0,2.4 L 2.4,0 Z" fill="#4477AA" opacity="0.9" />
                </svg>
                <svg width="14" height="14" viewBox="-7 -7 14 14" className="inline-block">
                  <path d="M -2.4,0 L 0,-2.4 L 2.4,0 Z" fill="#4477AA" opacity="0.9" />
                </svg>
                <span className="text-gray-600">Parent-Child</span>
              </div>
            </div>
          </div>
            <svg onClick={handleSvgClick} width={Math.max(width, plotWidth + margin.left + margin.right)} height={plotHeight + margin.top + margin.bottom}>
              {plotWidth > 0 && plotHeight > 0 && (
              <g transform={`translate(${margin.left},${margin.top})`}>
                {/* Y-axis */}
                <g className="y-axis">
                  {/* Taxa names with rank badges */}
                  {yScale.domain().map(seriesName => {
                    const rank = getTaxonomicRank(seriesName);
                    const indentLevel = getIndentLevel(seriesName);
                    const rankColor = getRankColor(rank);
                    const rankAbbrev = getRankAbbreviation(rank);
                    const cleanName = stripRankSuffix(seriesName);

                    // Check if this is a parent node (not a leaf in the tree)
                    const taxonInfo = taxonInfoMap.get(seriesName);
                    const isParentNode = taxonInfo && !taxonInfo.node.isLeaf;

                    // Position badges and text based on indentation level
                    // More indented items (higher level) should be closer to plot area (closer to x=0)
                    // Calculate position from the right side of the margin (close to plot area)
                    const squareSize = 12;
                    const badgeGap = 4; // Gap between badge and text
                    const textRightPadding = squareSize + badgeGap + 4; // Space for badge + gap + extra padding

                    // Badge position: to the RIGHT of text (between text and heatmap), shifted 5px left
                    const xOffsetOriginal = -(textRightPadding + (maxIndentLevel - indentLevel) * INDENT_PX_PER_LEVEL);
                    const squareOffset = xOffsetOriginal + badgeGap - 5;
                    // Text position: shifted 7px left from badge for clarity with connection lines
                    const xOffset = xOffsetOriginal - 7;

                    // Check if this taxon has a parent-child relationship
                    const relationship = parentChildRelationships?.get(seriesName);

                    return (
                      <g key={seriesName}>
                        {/* Parent-child relationship indicator triangle */}
                        {relationship && (
                          <path
                            d={relationship.role === 'parent'
                              ? 'M -2.4,0 L 0,2.4 L 2.4,0 Z'  // Downward triangle
                              : 'M -2.4,0 L 0,-2.4 L 2.4,0 Z' // Upward triangle
                            }
                            transform={`translate(-3, ${(yScale(seriesName) ?? 0) + yScale.bandwidth() / 2})`}
                            fill={relationship.color}
                            opacity={0.9}
                          />
                        )}
                        {/* Colored square for rank */}
                        <rect
                          x={squareOffset}
                          y={(yScale(seriesName) ?? 0) + yScale.bandwidth() / 2 - squareSize / 2}
                          width={squareSize}
                          height={squareSize}
                          fill={rankColor}
                          opacity={0.25}
                          rx={2}
                        />
                        {/* Rank letter badge */}
                        <text
                          x={squareOffset + squareSize / 2}
                          y={(yScale(seriesName) ?? 0) + yScale.bandwidth() / 2}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          style={{
                            fontSize: '9px',
                            fontWeight: 600,
                            fill: rankColor
                          }}
                        >
                          {rankAbbrev}
                        </text>
                        {/* Taxa name - Bold & Italic for parent nodes */}
                        <text
                          x={xOffset}
                          y={(yScale(seriesName) ?? 0) + yScale.bandwidth() / 2}
                          textAnchor="end"
                          dominantBaseline="middle"
                          className="text-xs fill-current"
                          title={seriesName}
                          style={{
                            fontWeight: isParentNode ? 600 : 'normal',
                            fontStyle: isParentNode ? 'italic' : 'normal',
                            fill: isParentNode ? '#374151' : '#9ca3af'
                          }}
                        >
                          {cleanName}
                        </text>
                      </g>
                    );
                  })}
                </g>

                {/* Parent-Child Connection Lines */}
                {filteredFlattenedTree && filteredFlattenedTree.length > 0 && (
                  <g className="parent-child-lines">
                    {filteredFlattenedTree.map((taxon, index) => {
                      // Skip if this is the last item in the list
                      if (index >= filteredFlattenedTree.length - 1) return null;

                      const nextTaxon = filteredFlattenedTree[index + 1];
                      const taxonName = taxon.node.originalName || taxon.name;
                      const nextTaxonName = nextTaxon.node.originalName || nextTaxon.name;

                      // Debug logging
                      if (index === 0) {
                        console.log('[HEATMAP CONNECTION LINES] filteredFlattenedTree length:', filteredFlattenedTree.length);
                        console.log('[HEATMAP CONNECTION LINES] series:', series);
                        console.log('[HEATMAP CONNECTION LINES] First few taxa:', filteredFlattenedTree.slice(0, 5).map(t => ({
                          name: t.node.originalName || t.name,
                          rank: t.rank,
                          isLeaf: t.node.isLeaf,
                          indentLevel: t.indentLevel
                        })));
                      }

                      // Only render if both taxa are visible in the current series
                      if (!series.includes(taxonName) || !series.includes(nextTaxonName)) return null;

                      // Check if next item is a direct child
                      const isDirectChild = (
                        nextTaxon.indentLevel === taxon.indentLevel + 1 &&
                        nextTaxon.path.includes(taxon.name)
                      );

                      if (!isDirectChild) return null;

                      // Calculate Y positions
                      const parentY = (yScale(taxonName) ?? 0);
                      const childY = (yScale(nextTaxonName) ?? 0);

                      // Calculate X position (left edge of child's indent level)
                      // Match the text offset calculation from Y-axis rendering
                      const squareSize = 12;
                      const badgeGap = 4;
                      const textRightPadding = squareSize + badgeGap + 4;
                      const childIndentLevel = getIndentLevel(nextTaxonName);
                      const xOffsetOriginal = -(textRightPadding + (maxIndentLevel - childIndentLevel) * INDENT_PX_PER_LEVEL);
                      const lineX = xOffsetOriginal - 7 - 10; // 10px to the left of text for visual clarity

                      return (
                        <line
                          key={`parent-child-${taxonName}-${nextTaxonName}`}
                          x1={lineX}
                          y1={parentY + yScale.bandwidth() / 2}
                          x2={lineX}
                          y2={childY + yScale.bandwidth() / 2}
                          stroke="#9ca3af"
                          strokeWidth={2}
                          strokeDasharray="3,3"
                          opacity={0.6}
                        />
                      );
                    })}
                  </g>
                )}

                {/* X-axis */}
                <g className="x-axis" transform={`translate(0, ${plotHeight})`}>
                  {tickValues.map(day => (
                    <g key={day} transform={`translate(${(xScale(day) ?? 0) + xScale.bandwidth() / 2}, 0)`}>
                        <text
                            transform="rotate(-45)"
                            y={10}
                            x={-5}
                            textAnchor="end"
                            dominantBaseline="middle"
                            className="text-xs fill-current text-muted-foreground"
                        >
                            {format(parseISO(day), 'dd MMM')}
                        </text>
                    </g>
                  ))}
                </g>

                {/* Heatmap Cells */}
                <g className="cells">
                  {visibleSeries.map(s => {
                    // Check if this is a parent node (not a leaf in the tree)
                    const taxonInfo = taxonInfoMap.get(s);
                    const isParentNode = taxonInfo && !taxonInfo.node.isLeaf;

                    return (
                      <React.Fragment key={s}>
                        {uniqueDays.map(day => {
                          // Parent nodes: render empty cell
                          if (isParentNode) {
                            return (
                              <g
                                key={`${s}-${day}`}
                                transform={`translate(${xScale(day)}, ${yScale(s)})`}
                              >
                                <rect
                                  width={xScale.bandwidth()}
                                  height={yScale.bandwidth()}
                                  fill="transparent"
                                  stroke="#e5e7eb"
                                  strokeWidth={0.5}
                                />
                              </g>
                            );
                          }

                          // Leaf nodes: render normally with data
                          const cell = cellMap.get(`${day}__${s}`);
                          const cellValue = cell?.value ?? 0;
                          const fillColor = cellValue > 0 ? colorScale(cellValue) : 'hsl(var(--muted)/0.3)';

                          // Determine font size based on cell dimensions
                          const cellWidth = xScale.bandwidth();
                          const cellHeight = yScale.bandwidth();
                          // Calculate font size - scale down for very small cells
                          const fontSize = Math.max(6, Math.min(cellWidth * 1.2, cellHeight / 1.5, 11));
                          // Show text for non-zero values with very minimal thresholds
                          // Only require minimum height, ignore width constraint
                          const showText = cell && cell.value > 0 && cellHeight > 8;

                          return (
                            <g
                              key={`${s}-${day}`}
                              transform={`translate(${xScale(day)}, ${yScale(s)})`}
                              style={{ cursor: 'pointer' }}
                            >
                              <rect
                                width={xScale.bandwidth()}
                                height={yScale.bandwidth()}
                                fill={fillColor}
                                className="stroke-background/50 hover:stroke-foreground"
                                strokeWidth={1}
                                data-cell={JSON.stringify({
                                  day,
                                  species: s,
                                  value: cell?.value ?? 0,
                                  count: cell?.count ?? 0,
                                })}
                              />
                              {showText && (
                                <text
                                  x={xScale.bandwidth() / 2}
                                  y={yScale.bandwidth() / 2}
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                  className="pointer-events-none font-bold select-none"
                                  style={{
                                    fontSize: `${fontSize}px`,
                                    fill: 'white',
                                    paintOrder: 'stroke',
                                    stroke: 'rgba(200,200,200,0.7)',
                                    strokeWidth: '1.2px',
                                    strokeLinejoin: 'round'
                                  }}
                                >
                                  {Math.min(99, cell.value).toFixed(0)}
                                </text>
                              )}
                            </g>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </g>
              </g>
              )}
            </svg>
        </div>
        {/* Click popup for heatmap cells - rendered outside scrollable container */}
        {selectedCell && (
          <div
            id="heatmap-cell-popup"
            className="fixed z-[9999]"
            style={{
              left: `${Math.min(selectedCell.x + 12, typeof window !== 'undefined' ? window.innerWidth - 280 : 500)}px`,
              top: `${selectedCell.y > 200 ? selectedCell.y - 12 : selectedCell.y + 12}px`,
              transform: selectedCell.y > 200 ? 'translateY(-100%)' : 'none',
            }}
          >
            <div className="bg-white border border-gray-200 rounded-lg shadow-xl p-3 max-w-xs">
              <p className="font-bold text-sm text-gray-900">{format(parseISO(selectedCell.day), 'PPP')}</p>
              <div className="flex items-center gap-1.5 mt-1">
                {(() => {
                  const rank = getTaxonomicRank(selectedCell.species);
                  const rankColor = getRankColor(rank);
                  const rankAbbrev = getRankAbbreviation(rank);
                  const rankLabel = rank ? ({
                    'phyl': 'Phylum', 'infraclass': 'Infraclass', 'class': 'Class',
                    'ord': 'Order', 'fam': 'Family', 'gen': 'Genus', 'sp': 'Species'
                  }[rank] ?? rank) : 'Unknown';
                  return (
                    <>
                      <span className="text-[9px] font-bold px-1 py-0 rounded uppercase leading-tight"
                        style={{ backgroundColor: rankColor, color: 'white', minWidth: '14px', textAlign: 'center' }}>
                        {rankAbbrev}
                      </span>
                      <span className="text-xs font-medium" style={{ color: rankColor }}>{rankLabel}</span>
                    </>
                  );
                })()}
              </div>
              <p className="text-sm mt-1">
                <span className="text-gray-700">{stripRankSuffix(selectedCell.species)}:</span>{' '}
                <span className="font-semibold">{selectedCell.value > 0 ? selectedCell.value.toFixed(2) : 'No data'}</span>
              </p>
              {selectedCell.count > 0 && (
                <p className="text-gray-500 text-xs">({selectedCell.count} {selectedCell.count === 1 ? 'record' : 'records'})</p>
              )}
              <div className="flex gap-2 mt-2">
                {onShowInTree && (
                  <button className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium px-2 py-1 rounded border border-blue-200 transition-colors cursor-pointer"
                    onClick={() => { onShowInTree(selectedCell.species); setSelectedCell(null); }}>
                    Show in Tree
                  </button>
                )}
                <button className="text-xs bg-gray-50 hover:bg-gray-100 text-gray-600 font-medium px-2 py-1 rounded border border-gray-200 transition-colors cursor-pointer"
                  onClick={() => setSelectedCell(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
        {onBrushChange && data.length > 0 && (
             <div style={{ height: `${BRUSH_CHART_HEIGHT}px`}} className="w-full mt-1 border rounded-md p-1 shadow-sm bg-card">
                 <ResponsiveContainer width="100%" height="100%">
                     <LineChart
                         data={data}
                         syncId={`brush-sync-${React.useId()}`}
                         margin={{ top: 5, right: margin.right, left: margin.left, bottom: 5 }}
                     >
                         <XAxis 
                            dataKey="time"
                            tickFormatter={formatDateTickBrush}
                            stroke="hsl(var(--muted-foreground))"
                            tick={{ fontSize: '0.65rem' }}
                            height={15}
                            interval="preserveStartEnd"
                          />
                         <Line type="monotone" dataKey={() => 0} stroke="transparent" dot={false} />
                         <Brush 
                             dataKey="time"
                             height={20}
                             stroke="hsl(var(--primary))"
                             tickFormatter={() => ""}
                             startIndex={brushStartIndex}
                             endIndex={brushEndIndex}
                             onChange={onBrushChange}
                             travellerWidth={10}
                             y={30}
                         />
                     </LineChart>
                 </ResponsiveContainer>
             </div>
        )}
    </div>
  );
};

// Memoize component to prevent unnecessary re-renders
export const HeatmapDisplay = React.memo(HeatmapDisplayComponent);

