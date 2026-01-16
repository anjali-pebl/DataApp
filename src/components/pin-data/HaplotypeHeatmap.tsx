"use client";

import React, { useMemo, useRef, useEffect, useState } from 'react';
import { scaleLinear, scaleBand } from 'd3-scale';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save, TableIcon, TrendingUp, Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { HaplotypeCellData, HaplotypeParseResult, HaplotypeMetadata } from './csvParser';
import type { StyleProperties } from './StylingRulesDialog';
import { RarefactionChart } from './RarefactionChart';
import { RarefactionSettingsDialog } from './RarefactionSettingsDialog';
import type { CurveFitModel } from '@/lib/curve-fitting';
import { lookupSpeciesBatch, getTaxonomyRankAbbreviation } from '@/lib/taxonomy-service';
import { TaxonomicTreeView } from './TaxonomicTreeView';
import { buildTaxonomicTree, flattenTreeForHeatmap, getRankColor, type FlattenedTaxon } from '@/lib/taxonomic-tree-builder';
import { Network, ArrowUpDown } from 'lucide-react';

interface HaplotypeHeatmapProps {
  haplotypeData: HaplotypeParseResult;
  containerHeight: number;
  rowHeight?: number; // Height of each species row (default: 15)
  cellWidth?: number; // Width of each cell/column (default: 12)
  spotSampleStyles?: {
    xAxisLabelRotation?: number;
    xAxisLabelFontSize?: number;
    yAxisLabelFontSize?: number;
    yAxisTitleFontSize?: number;
    yAxisTitleFontWeight?: number | string;
    yAxisTitleAlign?: 'left' | 'center' | 'right';
  };
  onStyleRuleUpdate?: (suffix: string, properties: Partial<StyleProperties>) => void;
  // File information for raw edit mode
  rawFileId?: string;
  rawFileName?: string;
  pinId?: string;
  onOpenRawEditor?: (fileId: string, fileName: string, speciesName?: string) => void;
  // Header metadata
  pinLabel?: string;
  startDate?: Date;
  endDate?: Date;
  fileCategories?: string[];
}

interface ProcessedCell extends HaplotypeCellData {
  displayValue: string;
}

type HaplotypeViewMode = 'heatmap' | 'rarefaction' | 'tree';
type SortMode = 'hierarchical' | 'alphabetical';

/**
 * Get single-letter abbreviation for taxonomic rank
 */
function getRankAbbreviation(rank: string): string {
  const abbrevMap: Record<string, string> = {
    'kingdom': 'K',
    'phylum': 'P',
    'class': 'C',
    'order': 'O',
    'family': 'F',
    'genus': 'G',
    'species': 'S',
    'unknown': '?'
  };
  return abbrevMap[rank.toLowerCase()] || '?';
}

export function HaplotypeHeatmap({
  haplotypeData,
  containerHeight,
  rowHeight = 15,
  cellWidth = 12,
  spotSampleStyles,
  onStyleRuleUpdate,
  rawFileId,
  rawFileName,
  pinId,
  onOpenRawEditor,
  pinLabel,
  startDate,
  endDate,
  fileCategories
}: HaplotypeHeatmapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgDimensions, setSvgDimensions] = useState({ width: 0, height: 0 });
  const { toast } = useToast();

  // Extract styling properties with defaults
  const styles = {
    xAxisLabelRotation: spotSampleStyles?.xAxisLabelRotation ?? -45,
    xAxisLabelFontSize: spotSampleStyles?.xAxisLabelFontSize ?? 11,
    yAxisLabelFontSize: spotSampleStyles?.yAxisLabelFontSize ?? 12,
    yAxisTitleFontSize: spotSampleStyles?.yAxisTitleFontSize ?? 14,
    yAxisTitleFontWeight: spotSampleStyles?.yAxisTitleFontWeight ?? 'normal',
    yAxisTitleAlign: spotSampleStyles?.yAxisTitleAlign ?? 'center'
  };

  // View mode state
  const [viewMode, setViewMode] = useState<HaplotypeViewMode>('heatmap');

  // Sort mode state (hierarchical by default)
  const [sortMode, setSortMode] = useState<SortMode>('hierarchical');

  // Rarefaction curve settings (always use logarithmic fit)
  const curveFitModel: CurveFitModel = 'logarithmic';
  const showFittedCurve = true;
  const [showRarefactionSettings, setShowRarefactionSettings] = useState(false);
  const [rarefactionChartSize, setRarefactionChartSize] = useState(300);
  const [rarefactionLegendXOffset, setRarefactionLegendXOffset] = useState(25);
  const [rarefactionLegendYOffset, setRarefactionLegendYOffset] = useState(100);
  const [rarefactionYAxisTitleOffset, setRarefactionYAxisTitleOffset] = useState(20);
  const [rarefactionMaxYAxis, setRarefactionMaxYAxis] = useState<number | null>(null);
  const [rarefactionShowLegend, setRarefactionShowLegend] = useState(true);

  // Credibility filter state (all enabled by default)
  const [showHigh, setShowHigh] = useState(true);
  const [showModerate, setShowModerate] = useState(true);
  const [showLow, setShowLow] = useState(true);

  // Hide empty rows toggle (enabled by default - hides species with zero values across all sites)
  const [hideEmptyRows, setHideEmptyRows] = useState(true);

  // Hide Red List Status column toggle
  const [showRedListColumn, setShowRedListColumn] = useState(false);

  // Show GBIF/WoRMS Taxonomy column toggle
  const [showGBIFColumn, setShowGBIFColumn] = useState(false);

  // Taxonomy enrichment state
  const [enrichedData, setEnrichedData] = useState<HaplotypeParseResult>(haplotypeData);
  const [isFetchingTaxonomy, setIsFetchingTaxonomy] = useState(false);
  const [taxonomyFetchProgress, setTaxonomyFetchProgress] = useState({ current: 0, total: 0 });

  // Adjustable cell width and height
  const [adjustableCellWidth, setAdjustableCellWidth] = useState(cellWidth);
  const [adjustableRowHeight, setAdjustableRowHeight] = useState(rowHeight);

  // Handler to save current settings as style rule
  const handleSaveSettings = () => {
    if (onStyleRuleUpdate) {
      onStyleRuleUpdate("_Hapl.csv", {
        heatmapCellWidth: adjustableCellWidth,
        heatmapRowHeight: adjustableRowHeight
      });
      toast({
        title: "Settings Saved",
        description: `Cell dimensions saved: ${adjustableCellWidth}px × ${adjustableRowHeight}px for _Hapl files`,
      });
    }
  };

  // Sync enrichedData when haplotypeData changes (file edits detected)
  useEffect(() => {
    console.log('📂 Raw CSV data changed - resetting enriched data');
    setEnrichedData(haplotypeData);
  }, [haplotypeData]);

  // Fetch taxonomy data on mount if not already present
  useEffect(() => {
    const fetchTaxonomyData = async () => {
      // Check if any species already has taxonomy data
      const hasTaxonomyData = enrichedData.data.some(cell => cell.metadata.taxonomySource);

      if (hasTaxonomyData) {
        console.log('✅ Taxonomy data already present, skipping fetch');
        return;
      }

      console.log('🔬 No taxonomy data found, fetching from GBIF/WoRMS APIs...');
      setIsFetchingTaxonomy(true);

      try {
        const taxonomyMap = await lookupSpeciesBatch(
          enrichedData.species,
          15, // maxConcurrent - increased from 5 for faster parallel processing
          (current, total) => setTaxonomyFetchProgress({ current, total })
        );

        // Create enriched data with taxonomy information
        const newData = {
          ...enrichedData,
          data: enrichedData.data.map(cell => {
            const taxonomy = taxonomyMap.get(cell.species);
            if (taxonomy) {
              return {
                ...cell,
                metadata: {
                  ...cell.metadata,
                  taxonomySource: taxonomy.source,
                  taxonId: taxonomy.taxonId,
                  commonNames: taxonomy.commonNames,
                  fullHierarchy: taxonomy.hierarchy,
                  taxonomyConfidence: taxonomy.confidence,
                  taxonomyRank: getTaxonomyRankAbbreviation(taxonomy.rank),
                }
              };
            }
            return cell;
          })
        };

        setEnrichedData(newData);
        console.log(`✅ Taxonomy data enriched for ${taxonomyMap.size}/${enrichedData.species.length} species`);

      } catch (error) {
        console.error('⚠️ Taxonomy lookup failed:', error);
        toast({
          variant: 'destructive',
          title: 'Taxonomy Lookup Failed',
          description: 'Unable to fetch taxonomy data from GBIF/WoRMS APIs'
        });
      } finally {
        setIsFetchingTaxonomy(false);
      }
    };

    fetchTaxonomyData();
  }, [haplotypeData]); // Re-run if haplotypeData changes

  const RED_LIST_COLUMN_WIDTH = 120; // Width for Red List Status column
  const GBIF_COLUMN_WIDTH = 100; // Width for GBIF/WoRMS Taxonomy column

  const FILTER_PANEL_HEIGHT = 100;
  // Tree view needs more height - use minimal filter panel height
  const TREE_VIEW_FILTER_HEIGHT = 10;
  const heatmapHeight = containerHeight - FILTER_PANEL_HEIGHT;
  const treeViewHeight = containerHeight - TREE_VIEW_FILTER_HEIGHT;

  useEffect(() => {
    const resizeObserver = new ResizeObserver(entries => {
      if (!entries || entries.length === 0) return;
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

  // Build taxonomic tree from enriched data
  const taxonomicTree = useMemo(() => {
    return buildTaxonomicTree(enrichedData.data);
  }, [enrichedData]);

  // Flatten tree for hierarchical display
  const flattenedTaxa = useMemo(() => {
    return flattenTreeForHeatmap(taxonomicTree);
  }, [taxonomicTree]);

  // Process and filter data
  const { filteredCells, filteredSpecies, filteredTaxa, sites, maxValue } = useMemo(() => {
    const { data, species, sites } = enrichedData;

    // Filter species by credibility
    const credibilityFilter = (credibility: string) => {
      const cred = credibility.toUpperCase();
      if (cred === 'HIGH' && !showHigh) return false;
      if (cred === 'MODERATE' && !showModerate) return false;
      if (cred === 'LOW' && !showLow) return false;
      return true;
    };

    // Filter cells based on credibility filters
    const filtered = data.filter(cell =>
      credibilityFilter(cell.metadata.credibility)
    );

    // Get unique filtered species
    const filteredSpeciesSet = new Set(filtered.map(c => c.species));

    // Filter out empty rows if hideEmptyRows is enabled
    let finalFilteredSet = filteredSpeciesSet;
    if (hideEmptyRows) {
      finalFilteredSet = new Set(
        Array.from(filteredSpeciesSet).filter(speciesName => {
          // Check if this species has at least one non-zero value across all sites
          const speciesCells = filtered.filter(c => c.species === speciesName);
          return speciesCells.some(c => c.count > 0);
        })
      );
    }

    // Sort based on sort mode
    let sortedSpecies: string[];
    let sortedTaxa: FlattenedTaxon[] = [];

    if (sortMode === 'hierarchical') {
      // Step 1: Get all leaf nodes (species) that match filters
      const leafNodes = flattenedTaxa.filter(taxon =>
        taxon.node.isLeaf && finalFilteredSet.has(taxon.name)
      );

      // Step 2: Only show leaf nodes (species with actual data), not parent taxonomic levels
      // The leafNodes are already in hierarchical order from the depth-first traversal
      sortedTaxa = leafNodes;

      sortedSpecies = sortedTaxa.map(t => t.name);

      console.log('[HEATMAP SORTING] Hierarchical mode (leaf nodes only):', {
        leafCount: leafNodes.length,
        sortedSpecies
      });
    } else {
      // Alphabetical sorting
      sortedSpecies = Array.from(finalFilteredSet).sort((a, b) => a.localeCompare(b));
      console.log('[HEATMAP SORTING] Alphabetical mode - sorted species:', sortedSpecies);
    }

    // Find max value for color scale
    const max = Math.max(...filtered.map(c => c.count), 1);

    return {
      filteredCells: filtered,
      filteredSpecies: sortedSpecies,
      filteredTaxa: sortedTaxa,
      sites,
      maxValue: max
    };
  }, [enrichedData, showHigh, showModerate, showLow, hideEmptyRows, sortMode, flattenedTaxa]);

  // Dynamic species name column width based on sorting mode
  const SPECIES_NAME_WIDTH = useMemo(() => {
    if (sortMode === 'hierarchical' && filteredTaxa.length > 0) {
      // Calculate based on max indent and longest name
      const maxIndent = Math.max(...filteredTaxa.map(t => t.indentLevel), 0);
      const maxNameLength = Math.max(...filteredTaxa.map(t => t.name.length), 0);

      // Formula: indent pixels + char width estimate + padding
      const calculatedWidth = (maxIndent * 20) + (maxNameLength * 7) + 40;
      return Math.max(250, Math.min(calculatedWidth, 500)); // Between 250-500px
    }
    return 200; // Default for alphabetical mode
  }, [sortMode, filteredTaxa]);

  const leftMargin = useMemo(() => {
    let margin = SPECIES_NAME_WIDTH + 20;
    if (showRedListColumn) margin += RED_LIST_COLUMN_WIDTH;
    if (showGBIFColumn) margin += GBIF_COLUMN_WIDTH;
    return margin;
  }, [SPECIES_NAME_WIDTH, showRedListColumn, showGBIFColumn]);

  const margin = { top: 120, right: 20, bottom: 20, left: leftMargin };

  // Purple gradient color scale (matching your screenshot)
  const colorScale = useMemo(() => {
    return scaleLinear<string>()
      .domain([0, maxValue])
      .range(['#e9d5ff', '#6b21a8']) // Light purple → Dark purple
      .clamp(true);
  }, [maxValue]);

  // Create cell lookup map
  const cellMap = useMemo(() => {
    const map = new Map<string, ProcessedCell>();
    filteredCells.forEach(cell => {
      const key = `${cell.species}__${cell.site}`;
      map.set(key, {
        ...cell,
        displayValue: cell.count > 0 ? cell.count.toString() : '0'
      });
    });
    return map;
  }, [filteredCells]);

  if (!haplotypeData || haplotypeData.species.length === 0) {
    return (
      <div style={{ height: `${containerHeight}px` }} className="flex items-center justify-center text-muted-foreground text-sm p-2 border rounded-md bg-white">
        No haplotype data available
      </div>
    );
  }

  if (filteredSpecies.length === 0) {
    return (
      <div style={{ height: `${containerHeight}px` }} className="flex flex-col gap-4">
        {/* Filter Panel */}
        <div className="flex flex-col gap-3 p-3 border rounded-md bg-card shadow-sm">
          <div className="flex items-center gap-6">
            <span className="text-sm font-medium">Credibility Filters:</span>
            <div className="flex items-center gap-2">
              <Checkbox id="high-empty" checked={showHigh} onCheckedChange={setShowHigh} />
              <Label htmlFor="high-empty" className="text-sm cursor-pointer">High</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="moderate-empty" checked={showModerate} onCheckedChange={setShowModerate} />
              <Label htmlFor="moderate-empty" className="text-sm cursor-pointer">Moderate</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="low-empty" checked={showLow} onCheckedChange={setShowLow} />
              <Label htmlFor="low-empty" className="text-sm cursor-pointer">Low</Label>
            </div>
            <div className="flex items-center gap-2 pl-6 border-l">
              <Checkbox id="hideEmpty-empty" checked={hideEmptyRows} onCheckedChange={setHideEmptyRows} />
              <Label htmlFor="hideEmpty-empty" className="text-sm cursor-pointer">Hide Empty Rows</Label>
            </div>
            <div className="flex items-center gap-2 pl-6 border-l">
              <Checkbox id="showRedList-empty" checked={showRedListColumn} onCheckedChange={setShowRedListColumn} />
              <Label htmlFor="showRedList-empty" className="text-sm cursor-pointer">Show RedList Status</Label>
            </div>
            <div className="flex items-center gap-2 pl-6 border-l">
              <Checkbox id="showGBIF-empty" checked={showGBIFColumn} onCheckedChange={setShowGBIFColumn} />
              <Label htmlFor="showGBIF-empty" className="text-sm cursor-pointer">Show Taxonomy</Label>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Label htmlFor="cellHeight-empty" className="text-sm font-medium whitespace-nowrap">Cell Height:</Label>
            <input
              id="cellHeight-empty"
              type="range"
              min="10"
              max="100"
              value={adjustableRowHeight}
              onChange={(e) => setAdjustableRowHeight(Number(e.target.value))}
              className="w-48 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-sm text-muted-foreground min-w-[40px]">{adjustableRowHeight}px</span>

            <Label htmlFor="cellWidth-empty" className="text-sm font-medium whitespace-nowrap ml-6">Cell Width:</Label>
            <input
              id="cellWidth-empty"
              type="range"
              min="5"
              max="150"
              value={adjustableCellWidth}
              onChange={(e) => setAdjustableCellWidth(Number(e.target.value))}
              className="w-48 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-sm text-muted-foreground min-w-[40px]">{adjustableCellWidth}px</span>

            {onStyleRuleUpdate && (
              <Button
                onClick={handleSaveSettings}
                size="sm"
                className="ml-4 h-8 gap-2"
                variant="outline"
              >
                <Save className="h-4 w-4" />
                Save as _hapl Style
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-2 border rounded-md bg-white">
          No species match the selected filters
        </div>
      </div>
    );
  }

  const { width } = svgDimensions;

  // Calculate plot dimensions based on adjustable cell width and row height
  const plotWidth = sites.length * adjustableCellWidth;
  const plotHeight = filteredSpecies.length * adjustableRowHeight;

  // Use fixed bandwidth for xScale based on adjustable cellWidth
  const xScale = scaleBand<string>()
    .domain(sites)
    .range([0, plotWidth])
    .paddingInner(0.05)
    .paddingOuter(0.05);

  const yScale = scaleBand<string>()
    .domain(filteredSpecies)
    .range([0, plotHeight])
    .paddingInner(0.05)
    .paddingOuter(0.05);

  // Get Red List Status for a species from the first available cell
  const getRedListStatus = (species: string): string => {
    const cell = filteredCells.find(c => c.species === species);
    return cell?.metadata?.redListStatus || 'Not Evaluated';
  };

  // Shorten Red List Status for display
  const shortenRedListStatus = (status: string): string => {
    const statusMap: Record<string, string> = {
      'Critically Endangered': 'Crit. Endang.',
      'Endangered': 'Endangered',
      'Vulnerable': 'Vulnerable',
      'Near Threatened': 'Near Threat.',
      'Least Concern': 'Least Conc.',
      'Data Deficient': 'Data Defic.',
      'Not Evaluated': 'N/A'
    };
    return statusMap[status] || status;
  };

  // Get GBIF/WoRMS data for a species
  const getGBIFData = (species: string): HaplotypeMetadata | null => {
    const cell = filteredCells.find(c => c.species === species);
    return cell?.metadata || null;
  };

  // Format GBIF/WoRMS column display
  const formatGBIFDisplay = (metadata: HaplotypeMetadata | null): string => {
    if (!metadata?.taxonomySource) return 'N/A';

    const source = metadata.taxonomySource.toUpperCase();
    const confidence = metadata.taxonomyConfidence?.[0]?.toUpperCase() || '?';

    // Display format: "GBIF-H" (GBIF, High confidence) or "WoRMS-M" (WoRMS, Medium)
    return `${source === 'WORMS' ? 'WoRM' : source}-${confidence}`;
  };

  // Get color based on taxonomy confidence
  const getGBIFColor = (metadata: HaplotypeMetadata | null): string => {
    if (!metadata?.taxonomyConfidence) return '#d1d5db'; // gray

    switch (metadata.taxonomyConfidence) {
      case 'high': return '#10b981'; // green
      case 'medium': return '#f59e0b'; // amber
      case 'low': return '#ef4444'; // red
      default: return '#d1d5db'; // gray
    }
  };

  return (
    <div className="w-full h-full flex flex-col gap-2">
      {/* Filter Panel */}
      <div className="flex flex-col gap-3 p-3 border rounded-md bg-card shadow-sm">
        {/* View Mode Selector */}
        <div className="flex items-center gap-4 pb-3 border-b">
          <span className="text-sm font-medium">View Mode:</span>
          <div className="flex items-center gap-1 border rounded-md p-1 bg-gray-50">
            <Button
              variant={viewMode === 'heatmap' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('heatmap')}
              className="h-8"
            >
              <TableIcon className="h-4 w-4 mr-2" />
              Heatmap
            </Button>
            <Button
              variant={viewMode === 'rarefaction' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('rarefaction')}
              className="h-8"
            >
              <TrendingUp className="h-4 w-4 mr-2" />
              Rarefaction
            </Button>
            <Button
              variant={viewMode === 'tree' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('tree')}
              className="h-8"
            >
              <Network className="h-4 w-4 mr-2" />
              Tree
            </Button>
          </div>

          {/* Rarefaction Settings Button */}
          {viewMode === 'rarefaction' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRarefactionSettings(true)}
              className="h-8 gap-2"
            >
              <Settings className="h-4 w-4" />
              Curve Fit Settings
            </Button>
          )}

          {/* Sort Mode Toggle (only show for heatmap view) */}
          {viewMode === 'heatmap' && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm font-medium">Sort:</span>
              <div className="flex items-center gap-1 border rounded-md p-1 bg-gray-50">
                <Button
                  variant={sortMode === 'hierarchical' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setSortMode('hierarchical')}
                  className="h-8"
                  title="Group taxa by taxonomic hierarchy with indentation"
                >
                  <Network className="h-4 w-4 mr-1" />
                  Hierarchical
                </Button>
                <Button
                  variant={sortMode === 'alphabetical' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setSortMode('alphabetical')}
                  className="h-8"
                  title="Sort taxa alphabetically (A-Z)"
                >
                  <ArrowUpDown className="h-4 w-4 mr-1" />
                  Alphabetical
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Heatmap-specific filters (only show in heatmap mode) */}
        {viewMode === 'heatmap' && (
          <>
            <div className="flex items-center gap-6">
              <span className="text-sm font-medium">Credibility Filters:</span>
          <div className="flex items-center gap-2">
            <Checkbox id="high" checked={showHigh} onCheckedChange={setShowHigh} />
            <Label htmlFor="high" className="text-sm cursor-pointer">High</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="moderate" checked={showModerate} onCheckedChange={setShowModerate} />
            <Label htmlFor="moderate" className="text-sm cursor-pointer">Moderate</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="low" checked={showLow} onCheckedChange={setShowLow} />
            <Label htmlFor="low" className="text-sm cursor-pointer">Low</Label>
          </div>
          <div className="flex items-center gap-2 pl-6 border-l">
            <Checkbox id="hideEmpty" checked={hideEmptyRows} onCheckedChange={setHideEmptyRows} />
            <Label htmlFor="hideEmpty" className="text-sm cursor-pointer">Hide Empty Rows</Label>
          </div>
          <div className="flex items-center gap-2 pl-6 border-l">
            <Checkbox id="showRedList" checked={showRedListColumn} onCheckedChange={setShowRedListColumn} />
            <Label htmlFor="showRedList" className="text-sm cursor-pointer">Show RedList Status</Label>
          </div>
          <div className="flex items-center gap-2 pl-6 border-l">
            <Checkbox id="showGBIF" checked={showGBIFColumn} onCheckedChange={setShowGBIFColumn} />
            <Label htmlFor="showGBIF" className="text-sm cursor-pointer">Show Taxonomy</Label>
          </div>
          <div className="ml-auto flex items-center gap-4">
            {isFetchingTaxonomy && (
              <div className="text-xs text-blue-600 font-medium flex items-center gap-2">
                <div className="animate-spin h-3 w-3 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                Fetching taxonomy: {taxonomyFetchProgress.current}/{taxonomyFetchProgress.total}
              </div>
            )}
            <span className="text-xs text-muted-foreground">
              {filteredSpecies.length} species • {sites.length} sites
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Label htmlFor="cellHeight" className="text-sm font-medium whitespace-nowrap">Cell Height:</Label>
          <input
            id="cellHeight"
            type="range"
            min="10"
            max="100"
            value={adjustableRowHeight}
            onChange={(e) => setAdjustableRowHeight(Number(e.target.value))}
            className="w-48 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-sm text-muted-foreground min-w-[40px]">{adjustableRowHeight}px</span>

          <Label htmlFor="cellWidth" className="text-sm font-medium whitespace-nowrap ml-6">Cell Width:</Label>
          <input
            id="cellWidth"
            type="range"
            min="5"
            max="150"
            value={adjustableCellWidth}
            onChange={(e) => setAdjustableCellWidth(Number(e.target.value))}
            className="w-48 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-sm text-muted-foreground min-w-[40px]">{adjustableCellWidth}px</span>

          {onStyleRuleUpdate && (
            <Button
              onClick={handleSaveSettings}
              size="sm"
              className="ml-4 h-8 gap-2"
              variant="outline"
            >
              <Save className="h-4 w-4" />
              Save as _hapl Style
            </Button>
          )}
        </div>
          </>
        )}
      </div>

      {/* Conditional Rendering: Heatmap, Rarefaction, or Tree */}
      {viewMode === 'rarefaction' ? (
        /* Rarefaction View */
        <div
          style={{ height: `${heatmapHeight}px` }}
          className="flex-1 w-full border rounded-md p-4 bg-white overflow-auto"
        >
          <RarefactionChart
            haplotypeData={enrichedData}
            curveFitModel={curveFitModel}
            showFittedCurve={showFittedCurve}
            height={heatmapHeight - 60}
            chartSize={rarefactionChartSize}
            legendXOffset={rarefactionLegendXOffset}
            legendYOffset={rarefactionLegendYOffset}
            yAxisTitleOffset={rarefactionYAxisTitleOffset}
            maxYAxis={rarefactionMaxYAxis}
            showLegend={rarefactionShowLegend}
          />
        </div>
      ) : viewMode === 'tree' ? (
        /* Tree View */
        <TaxonomicTreeView
          tree={taxonomicTree}
          containerHeight={treeViewHeight}
          onSpeciesClick={(speciesName) => {
            console.log('[HAPLOTYPE HEATMAP] Species clicked:', speciesName);
            console.log('[HAPLOTYPE HEATMAP] Callback available:', {
              hasOnOpenRawEditor: !!onOpenRawEditor,
              rawFileId,
              rawFileName
            });
            if (onOpenRawEditor && rawFileId && rawFileName) {
              console.log('[HAPLOTYPE HEATMAP] Calling onOpenRawEditor');
              onOpenRawEditor(rawFileId, rawFileName, speciesName);
            } else {
              console.log('[HAPLOTYPE HEATMAP] Cannot call onOpenRawEditor - missing data');
            }
          }}
        />
      ) : (
        /* Heatmap View */
        <div
          ref={containerRef}
          style={{ height: `${heatmapHeight}px` }}
          className="flex-1 w-full border rounded-md p-2 bg-white overflow-auto"
        >
        <TooltipProvider>
          <svg width="100%" height={Math.max(plotHeight + margin.top + margin.bottom, 400)}>
            {plotWidth > 0 && plotHeight > 0 && (
              <g transform={`translate(${margin.left},${margin.top})`}>
                {/* Column Headers */}
                <g className="column-headers">
                  {/* Species Name header */}
                  <text
                    x={(() => {
                      let x = -SPECIES_NAME_WIDTH;
                      if (showRedListColumn) x -= RED_LIST_COLUMN_WIDTH;
                      if (showGBIFColumn) x -= GBIF_COLUMN_WIDTH;
                      return x;
                    })()}
                    y={-10}
                    textAnchor="start"
                    dominantBaseline="middle"
                    className="font-bold"
                    style={{
                      fontSize: `${styles.yAxisLabelFontSize}px`,
                      fill: '#4b5563'
                    }}
                  >
                    Species Name
                  </text>

                  {/* Red List Status header */}
                  {showRedListColumn && (
                    <text
                      x={(() => {
                        let x = -RED_LIST_COLUMN_WIDTH + 5;
                        if (showGBIFColumn) x -= GBIF_COLUMN_WIDTH;
                        return x;
                      })()}
                      y={-10}
                      textAnchor="start"
                      dominantBaseline="middle"
                      className="font-bold"
                      style={{
                        fontSize: `${styles.yAxisLabelFontSize}px`,
                        fill: '#4b5563'
                      }}
                    >
                      RedList Status
                    </text>
                  )}

                  {/* GBIF/WoRMS Taxonomy header */}
                  {showGBIFColumn && (
                    <text
                      x={-GBIF_COLUMN_WIDTH + 5}
                      y={-10}
                      textAnchor="start"
                      dominantBaseline="middle"
                      className="font-bold"
                      style={{
                        fontSize: `${styles.yAxisLabelFontSize}px`,
                        fill: '#4b5563'
                      }}
                    >
                      Taxonomy
                    </text>
                  )}

                  {/* Sample names (site headers) - 90 degree rotated (vertical) */}
                  {sites.map(site => (
                    <g key={site} transform={`translate(${(xScale(site) ?? 0) + xScale.bandwidth() / 2}, -15)`}>
                      <text
                        transform="rotate(-90)"
                        x={0}
                        y={5}
                        textAnchor="start"
                        dominantBaseline="middle"
                        className="font-bold"
                        style={{
                          fontSize: `${styles.yAxisLabelFontSize}px`,
                          fill: '#4b5563'
                        }}
                      >
                        {site}
                      </text>
                    </g>
                  ))}
                </g>

                {/* Y-axis (Species names on left) */}
                <g className="y-axis">
                  {/* Connecting lines for parent-child hierarchical relationships */}
                  {sortMode === 'hierarchical' && filteredTaxa.map((taxon, index) => {
                    // Skip if this is the last item in the list
                    if (index >= filteredTaxa.length - 1) return null;

                    const nextTaxon = filteredTaxa[index + 1];

                    // Draw vertical line if next item is a direct child
                    const isDirectChild = (
                      nextTaxon.indentLevel === taxon.indentLevel + 1 &&
                      nextTaxon.path.includes(taxon.name)
                    );

                    if (!isDirectChild) return null;

                    // Calculate Y positions
                    const parentY = (yScale(taxon.name) ?? 0) + yScale.bandwidth() / 2;
                    const childY = (yScale(nextTaxon.name) ?? 0) + yScale.bandwidth() / 2;

                    // Calculate X position (left edge of child's indent)
                    const lineX = (() => {
                      let x = -SPECIES_NAME_WIDTH + nextTaxon.indentLevel * 20 - 10;
                      if (showRedListColumn) x -= RED_LIST_COLUMN_WIDTH;
                      if (showGBIFColumn) x -= GBIF_COLUMN_WIDTH;
                      return x;
                    })();

                    return (
                      <line
                        key={`parent-child-${taxon.name}-${nextTaxon.name}`}
                        x1={lineX}
                        y1={parentY + yScale.bandwidth() / 2}
                        x2={lineX}
                        y2={childY - yScale.bandwidth() / 2}
                        stroke="#9ca3af"
                        strokeWidth={2}
                        strokeDasharray="3,3"
                        opacity={0.6}
                      />
                    );
                  })}

                  {/* Taxa names with rank badges */}
                  {yScale.domain().map(speciesName => {
                    // Find taxon info for hierarchical display
                    const taxonInfo = sortMode === 'hierarchical'
                      ? filteredTaxa.find(t => t.name === speciesName)
                      : null;

                    const indentPx = taxonInfo ? taxonInfo.indentLevel * 20 : 0;
                    const rankColor = taxonInfo ? getRankColor(taxonInfo.rank) : '#4b5563';
                    const rankAbbrev = getRankAbbreviation(taxonInfo?.rank || 'unknown');

                    const badgeX = (() => {
                      let x = -SPECIES_NAME_WIDTH + indentPx - 5;
                      if (showRedListColumn) x -= RED_LIST_COLUMN_WIDTH;
                      if (showGBIFColumn) x -= GBIF_COLUMN_WIDTH;
                      return x;
                    })();

                    const textX = (() => {
                      let x = -SPECIES_NAME_WIDTH + indentPx + 25;
                      if (showRedListColumn) x -= RED_LIST_COLUMN_WIDTH;
                      if (showGBIFColumn) x -= GBIF_COLUMN_WIDTH;
                      return x;
                    })();

                    const y = (yScale(speciesName) ?? 0) + yScale.bandwidth() / 2;

                    return (
                      <g key={speciesName}>
                        {/* Rank badge (colored box with letter) */}
                        {sortMode === 'hierarchical' && taxonInfo && (
                          <>
                            <rect
                              x={badgeX}
                              y={y - 8}
                              width={20}
                              height={16}
                              fill={rankColor}
                              opacity={0.15}
                              rx={2}
                            />
                            <text
                              x={badgeX + 10}
                              y={y}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              style={{
                                fontSize: '10px',
                                fontWeight: 600,
                                fill: rankColor
                              }}
                            >
                              {rankAbbrev}
                            </text>
                          </>
                        )}
                        {/* Species name */}
                        <text
                          x={textX}
                          y={y}
                          textAnchor="start"
                          dominantBaseline="middle"
                          style={{
                            fontSize: `${styles.yAxisLabelFontSize}px`,
                            fontWeight: taxonInfo && !taxonInfo.node.isLeaf ? 600 : styles.yAxisTitleFontWeight,
                            fontStyle: taxonInfo && !taxonInfo.node.isLeaf ? 'italic' : 'normal',
                            fill: taxonInfo && !taxonInfo.node.isLeaf ? '#374151' : '#1f2937'
                          }}
                          title={`${speciesName}${taxonInfo ? ` (${taxonInfo.rank})` : ''}`}
                        >
                          {speciesName}
                        </text>
                      </g>
                    );
                  })}
                </g>

                {/* Red List Status column */}
                {showRedListColumn && (
                  <g className="red-list-column" transform={`translate(${showGBIFColumn ? -(RED_LIST_COLUMN_WIDTH + GBIF_COLUMN_WIDTH) : -RED_LIST_COLUMN_WIDTH}, 0)`}>
                    {filteredSpecies.map(species => {
                      const redListStatus = getRedListStatus(species);
                      const shortStatus = shortenRedListStatus(redListStatus);
                      const isNotEvaluated = redListStatus === 'Not Evaluated';
                      return (
                        <text
                          key={species}
                          x={5}
                          y={(yScale(species) ?? 0) + yScale.bandwidth() / 2}
                          textAnchor="start"
                          dominantBaseline="middle"
                          style={{
                            fontSize: `${styles.yAxisLabelFontSize}px`,
                            fill: isNotEvaluated ? '#d1d5db' : '#4b5563'
                          }}
                        >
                          {shortStatus}
                        </text>
                      );
                    })}
                  </g>
                )}

                {/* GBIF/WoRMS Taxonomy column */}
                {showGBIFColumn && (
                  <g className="gbif-column" transform={`translate(${-GBIF_COLUMN_WIDTH}, 0)`}>
                    {filteredSpecies.map(species => {
                      const metadata = getGBIFData(species);
                      const displayText = formatGBIFDisplay(metadata);
                      const textColor = getGBIFColor(metadata);

                      return (
                        <text
                          key={species}
                          x={5}
                          y={(yScale(species) ?? 0) + yScale.bandwidth() / 2}
                          textAnchor="start"
                          dominantBaseline="middle"
                          style={{
                            fontSize: `${styles.yAxisLabelFontSize}px`,
                            fill: textColor,
                            fontWeight: metadata?.taxonomyConfidence === 'high' ? 600 : 400
                          }}
                        >
                          {displayText}
                        </text>
                      );
                    })}
                  </g>
                )}

                {/* Heatmap Cells */}
                <g className="cells">
                  {filteredSpecies.map(species => {
                    // Check if this is a parent node (no data cells)
                    const taxonInfo = sortMode === 'hierarchical'
                      ? filteredTaxa.find(t => t.name === species)
                      : null;
                    const isParentNode = taxonInfo && !taxonInfo.node.isLeaf;

                    return (
                      <React.Fragment key={species}>
                        {sites.map(site => {
                          // Parent nodes have no data cells, render empty
                          if (isParentNode) {
                            return (
                              <g key={`${species}-${site}`} transform={`translate(${xScale(site)}, ${yScale(species)})`}>
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

                          // Leaf nodes render normally with data
                          const cell = cellMap.get(`${species}__${site}`);
                          const cellValue = cell?.count ?? 0;
                          const fillColor = cellValue > 0 ? colorScale(cellValue) : 'hsl(var(--muted)/0.3)';

                          // Get metadata for tooltip
                          const metadata = cell?.metadata;

                          return (
                            <Tooltip key={`${species}-${site}`} delayDuration={100}>
                              <TooltipTrigger asChild>
                                <g transform={`translate(${xScale(site)}, ${yScale(species)})`}>
                                  {/* Cell background */}
                                  <rect
                                    width={xScale.bandwidth()}
                                    height={yScale.bandwidth()}
                                    fill={fillColor}
                                    className="stroke-background/50"
                                    strokeWidth={1}
                                  />

                                  {/* Cell value (white text) */}
                                  {cell && cellValue > 0 && (
                                    <text
                                      x={xScale.bandwidth() / 2}
                                      y={yScale.bandwidth() / 2}
                                      textAnchor="middle"
                                      dominantBaseline="middle"
                                      className="text-xs font-semibold fill-white pointer-events-none"
                                    >
                                      {cell.displayValue}
                                    </text>
                                  )}
                                </g>
                              </TooltipTrigger>
                            <TooltipContent className="max-w-sm">
                              <p className="font-bold">{species}</p>
                              <p className="text-sm">Site: {site}</p>
                              <p className="text-sm">Haplotype Count: {cellValue}</p>
                              {metadata && (
                                <>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Credibility: <span className="font-semibold">{metadata.credibility}</span>
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Phylum: {metadata.phylum}
                                  </p>
                                  {metadata.redListStatus !== 'Not Evaluated' && (
                                    <p className="text-xs text-red-600 font-semibold">
                                      Red List: {metadata.redListStatus}
                                    </p>
                                  )}
                                  {metadata.taxonomySource && (
                                    <>
                                      <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-gray-200">
                                        <span className="font-semibold">Taxonomy:</span> {metadata.taxonomySource.toUpperCase()}
                                        {metadata.taxonId && ` (ID: ${metadata.taxonId})`}
                                      </p>
                                      {metadata.commonNames && metadata.commonNames.length > 0 && (
                                        <p className="text-xs text-muted-foreground">
                                          Common: {metadata.commonNames[0]}
                                        </p>
                                      )}
                                      {metadata.taxonomyRank && (
                                        <p className="text-xs text-muted-foreground">
                                          Rank: {metadata.taxonomyRank}
                                        </p>
                                      )}
                                      {metadata.taxonomyConfidence && (
                                        <p className={`text-xs font-semibold ${
                                          metadata.taxonomyConfidence === 'high' ? 'text-green-600' :
                                          metadata.taxonomyConfidence === 'medium' ? 'text-amber-600' :
                                          'text-red-600'
                                        }`}>
                                          Confidence: {metadata.taxonomyConfidence}
                                        </p>
                                      )}
                                    </>
                                  )}
                                  {metadata.isInvasive && (
                                    <p className="text-xs text-red-600 font-semibold mt-1">
                                      ⚠️ Invasive: {metadata.invasiveSpeciesName}
                                    </p>
                                  )}
                                </>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </React.Fragment>
                  );
                  })}
                </g>
              </g>
            )}
          </svg>
        </TooltipProvider>
      </div>
      )}

      {/* Rarefaction Plot Settings Dialog */}
      <RarefactionSettingsDialog
        open={showRarefactionSettings}
        onOpenChange={setShowRarefactionSettings}
        chartSize={rarefactionChartSize}
        onChartSizeChange={setRarefactionChartSize}
        legendXOffset={rarefactionLegendXOffset}
        onLegendXOffsetChange={setRarefactionLegendXOffset}
        legendYOffset={rarefactionLegendYOffset}
        onLegendYOffsetChange={setRarefactionLegendYOffset}
        yAxisTitleOffset={rarefactionYAxisTitleOffset}
        onYAxisTitleOffsetChange={setRarefactionYAxisTitleOffset}
        maxYAxis={rarefactionMaxYAxis}
        onMaxYAxisChange={setRarefactionMaxYAxis}
        showLegend={rarefactionShowLegend}
        onShowLegendChange={setRarefactionShowLegend}
        autoMaxYAxis={(() => {
          const totalSpecies = haplotypeData.species.length || 50;
          const autoMax = Math.ceil(totalSpecies) + 5;
          // Round to neat number
          let increment: number;
          if (autoMax <= 20) increment = 5;
          else if (autoMax <= 50) increment = 10;
          else if (autoMax <= 100) increment = 20;
          else if (autoMax <= 200) increment = 50;
          else increment = 100;
          return Math.ceil(autoMax / increment) * increment;
        })()}
      />
    </div>
  );
}
