"use client";

import React, { useMemo, useRef, useEffect, useState } from 'react';
import { scaleLinear, scaleBand } from 'd3-scale';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { TableIcon, TrendingUp, Settings } from "lucide-react";
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

/**
 * Clean species name by removing trailing rank annotations
 * Matches the same logic used in taxonomic-tree-builder.ts
 * e.g., "Gadus sp." → "Gadus", "Actinopterygii (class)" → "Actinopterygii"
 * Also handles double periods like "(sp.)." from SubCam data
 */
function cleanSpeciesName(name: string): string {
  return name
    .replace(/\s*\((phyl|gigaclass|infraclass|class|ord|fam|gen|sp)\.\)\.?\s*$/i, '')  // (sp.). or (sp.)
    .replace(/\s*\((kingdom|phylum|order|family|genus|species)\)\.?\s*$/i, '')  // (species). or (species)
    .replace(/\s+(sp\.?|spp\.?|gen\.?|fam\.?|ord\.?|class\.?)$/i, '')  // trailing sp. or sp
    .trim();
}

export function HaplotypeHeatmap({
  haplotypeData,
  containerHeight,
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
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
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

  // Highlighted taxon for tree view linking
  const [highlightedTaxon, setHighlightedTaxon] = useState<string | null>(null);

  // Sort mode state (hierarchical by default)
  const [sortMode, setSortMode] = useState<SortMode>('hierarchical');

  // Rarefaction curve settings (always use logarithmic fit)
  const curveFitModel: CurveFitModel = 'logarithmic';
  const showFittedCurve = true;
  const [showRarefactionSettings, setShowRarefactionSettings] = useState(false);
  const [rarefactionChartSize, setRarefactionChartSize] = useState(500);
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

  // Fixed row height for heatmap (responsive width is calculated dynamically)

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

      console.log('🔬 No taxonomy data found, fetching from GBIF API...');
      setIsFetchingTaxonomy(true);

      try {
        const taxonomyMap = await lookupSpeciesBatch(
          enrichedData.species,
          15, // maxConcurrent - increased from 5 for faster parallel processing
          (current, total) => setTaxonomyFetchProgress({ current, total }),
          false // useWormsFallback - disabled for eDNA (GBIF provides georeferenced sightings)
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

  // Set up ResizeObserver for container width tracking
  useEffect(() => {
    resizeObserverRef.current = new ResizeObserver(entries => {
      if (!entries || entries.length === 0) return;
      const { width } = entries[0].contentRect;
      setSvgDimensions({ width, height: heatmapHeight });
    });

    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, [heatmapHeight]);

  // Callback ref to measure container when it mounts/unmounts
  const setContainerRef = React.useCallback((node: HTMLDivElement | null) => {
    // Disconnect from previous element
    if (containerRef.current && resizeObserverRef.current) {
      resizeObserverRef.current.unobserve(containerRef.current);
    }

    containerRef.current = node;

    // Connect to new element and measure immediately
    if (node && resizeObserverRef.current) {
      resizeObserverRef.current.observe(node);
      // Immediate measurement for when switching back to heatmap view
      const rect = node.getBoundingClientRect();
      if (rect.width > 0) {
        setSvgDimensions({ width: rect.width, height: heatmapHeight });
      }
    }
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

    // Get unique filtered species (using cleaned names for matching with tree nodes)
    const filteredSpeciesSet = new Set(filtered.map(c => cleanSpeciesName(c.species)));

    // Filter out empty rows if hideEmptyRows is enabled
    let finalFilteredSet = filteredSpeciesSet;
    if (hideEmptyRows) {
      finalFilteredSet = new Set(
        Array.from(filteredSpeciesSet).filter(speciesName => {
          // Check if this species has at least one non-zero value across all sites
          // Match using cleaned names
          const speciesCells = filtered.filter(c => cleanSpeciesName(c.species) === speciesName);
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

  // Calculate parent-child relationships between visible taxa
  // Only shows relationships when BOTH parent and child have data (are visible)
  // Each parent gets one color, all its children adopt that same color
  // Taxa that are both children AND parents get two triangles (one for each role)
  const parentChildRelationships = useMemo(() => {
    if (sortMode !== 'hierarchical' || filteredTaxa.length === 0) {
      return new Map<string, { asParent?: { color: string; childIsDual?: boolean }; asChild?: { color: string } }>();
    }

    const relationships = new Map<string, { asParent?: { color: string; childIsDual?: boolean }; asChild?: { color: string } }>();
    const visibleNames = new Set(filteredTaxa.map(t => t.name));

    // Color palette for parents (Paul Tol colorblind-friendly)
    const colors = [
      '#4477AA', // Blue
      '#EE6677', // Red/pink
      '#228833', // Green
      '#CCBB44', // Olive yellow
      '#66CCEE', // Cyan
      '#AA3377', // Purple
      '#CC6644', // Burnt orange
      '#BBBBBB', // Grey
    ];
    let colorIndex = 0;

    // First pass: identify all parents and their children
    const parentChildMap = new Map<string, string[]>(); // parent name -> child names

    filteredTaxa.forEach((taxon, index) => {
      const children: string[] = [];

      for (let i = index + 1; i < filteredTaxa.length; i++) {
        const potentialChild = filteredTaxa[i];

        if (potentialChild.indentLevel <= taxon.indentLevel) {
          break;
        }

        const isDirectChild = (
          potentialChild.indentLevel === taxon.indentLevel + 1 &&
          potentialChild.path.includes(taxon.name) &&
          visibleNames.has(potentialChild.name)
        );

        if (isDirectChild) {
          children.push(potentialChild.name);
        }
      }

      if (children.length > 0) {
        parentChildMap.set(taxon.name, children);
      }
    });

    // Second pass: assign colors and check if children are also parents (dual)
    filteredTaxa.forEach((taxon) => {
      const children = parentChildMap.get(taxon.name);

      if (children && children.length > 0) {
        const parentColor = colors[colorIndex % colors.length];
        colorIndex++;

        // Check if any child is also a parent (will have dual arrows)
        const childIsDual = children.some(childName => parentChildMap.has(childName));

        // Mark as parent - preserve any existing child role
        const existing = relationships.get(taxon.name) || {};
        relationships.set(taxon.name, { ...existing, asParent: { color: parentColor, childIsDual } });

        // Mark all children with parent's color
        children.forEach(childName => {
          const existingChild = relationships.get(childName) || {};
          relationships.set(childName, { ...existingChild, asChild: { color: parentColor } });
        });
      }
    });

    return relationships;
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
      // Use cleaned species name as key to match tree node names
      const key = `${cleanSpeciesName(cell.species)}__${cell.site}`;
      map.set(key, {
        ...cell,
        displayValue: cell.count > 0 ? cell.count.toString() : '0'
      });
    });
    return map;
  }, [filteredCells]);

  if (!haplotypeData || haplotypeData.species.length === 0) {
    return (
      <div style={{ height: `${containerHeight}px` }} className="flex items-center justify-center text-muted-foreground text-sm p-2 border rounded-md bg-card">
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
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-2 border rounded-md bg-card">
          No species match the selected filters
        </div>
      </div>
    );
  }

  const { width } = svgDimensions;

  // Calculate plot dimensions responsively based on container width
  // Minimum cell width of 30px to ensure readability, but expand to fill space
  const MIN_CELL_WIDTH = 30;
  const ROW_HEIGHT = 20;

  // Available width for the heatmap plot area
  const availableWidth = Math.max(0, width - margin.left - margin.right);

  // Calculate cell width: use available width divided by number of sites, with minimum
  const calculatedCellWidth = sites.length > 0 ? Math.max(MIN_CELL_WIDTH, availableWidth / sites.length) : MIN_CELL_WIDTH;

  // Plot dimensions
  const plotWidth = sites.length * calculatedCellWidth;
  const plotHeight = filteredSpecies.length * ROW_HEIGHT;

  // Use scaleBand for responsive cell sizing
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
  // Match using cleaned names since species param comes from tree (cleaned)
  const getRedListStatus = (species: string): string => {
    const cell = filteredCells.find(c => cleanSpeciesName(c.species) === species);
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
  // Match using cleaned names since species param comes from tree (cleaned)
  const getGBIFData = (species: string): HaplotypeMetadata | null => {
    const cell = filteredCells.find(c => cleanSpeciesName(c.species) === species);
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
    if (!metadata?.taxonomyConfidence) return '#BBBBBB'; // grey (colorblind-friendly)

    switch (metadata.taxonomyConfidence) {
      case 'high': return '#228833'; // green (Paul Tol)
      case 'medium': return '#CCBB44'; // olive yellow (Paul Tol)
      case 'low': return '#EE6677'; // red/pink (Paul Tol)
      default: return '#BBBBBB'; // grey
    }
  };

  return (
    <div className="w-full h-full flex flex-col gap-2">
      {/* Filter Panel */}
      <div className="flex flex-col gap-3 p-3 border rounded-md bg-card shadow-sm">
        {/* View Mode Selector */}
        <div className="flex items-center gap-4 pb-3 border-b">
          <span className="text-sm font-medium">View Mode:</span>
          <div className="flex items-center gap-1 border rounded-md p-1 bg-muted">
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
              <div className="flex items-center gap-1 border rounded-md p-1 bg-muted">
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
          </>
        )}
      </div>

      {/* Conditional Rendering: Heatmap, Rarefaction, or Tree */}
      {viewMode === 'rarefaction' ? (
        /* Rarefaction View */
        <div
          style={{ height: `${heatmapHeight}px` }}
          className="flex-1 w-full border rounded-md p-4 bg-card overflow-auto flex items-center justify-center"
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
          highlightedTaxon={highlightedTaxon}
          showHaplotypeBadges={true}
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
          ref={setContainerRef}
          style={{ height: `${heatmapHeight}px` }}
          className="flex-1 w-full border rounded-md p-2 bg-card overflow-auto"
        >
          {/* Taxonomic Rank Legend (only in hierarchical mode) */}
          {sortMode === 'hierarchical' && (
            <div className="flex flex-wrap items-center justify-end gap-3 text-xs mb-2 pb-2 pr-4 border-b border-border">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: '#882255' }}></div>
                <span className="text-muted-foreground">Kingdom</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: '#AA3377' }}></div>
                <span className="text-muted-foreground">Phylum</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: '#EE6677' }}></div>
                <span className="text-muted-foreground">Class</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: '#CCBB44' }}></div>
                <span className="text-muted-foreground">Order</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: '#228833' }}></div>
                <span className="text-muted-foreground">Family</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: '#66CCEE' }}></div>
                <span className="text-muted-foreground">Genus</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ backgroundColor: '#4477AA' }}></div>
                <span className="text-muted-foreground">Species</span>
              </div>
              <div className="flex items-center gap-2 ml-2 pl-2 border-l border-border">
                <svg width="14" height="14" viewBox="-7 -7 14 14" className="inline-block">
                  <path d="M -2.4,0 L 0,2.4 L 2.4,0 Z" fill="#4477AA" opacity="0.9" />
                </svg>
                <svg width="14" height="14" viewBox="-7 -7 14 14" className="inline-block">
                  <path d="M -2.4,0 L 0,-2.4 L 2.4,0 Z" fill="#4477AA" opacity="0.9" />
                </svg>
                <span className="text-muted-foreground">Parent-Child</span>
              </div>
            </div>
          )}
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
                    className="font-semibold"
                    style={{
                      fontSize: `${styles.yAxisTitleFontSize}px`,
                      fill: 'hsl(var(--foreground))'
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
                  {sites.map(site => {
                    // Wrap long site names onto two lines
                    const maxCharsPerLine = 10;
                    let lines: string[] = [site];

                    if (site.length > maxCharsPerLine) {
                      // Try to split at a space near the middle
                      const midPoint = Math.floor(site.length / 2);
                      const spaceIndex = site.lastIndexOf(' ', midPoint + 3);
                      const altSpaceIndex = site.indexOf(' ', midPoint - 3);

                      if (spaceIndex > 2 && spaceIndex < site.length - 2) {
                        lines = [site.slice(0, spaceIndex), site.slice(spaceIndex + 1)];
                      } else if (altSpaceIndex > 2 && altSpaceIndex < site.length - 2) {
                        lines = [site.slice(0, altSpaceIndex), site.slice(altSpaceIndex + 1)];
                      } else if (site.length > maxCharsPerLine) {
                        // No good space found, split at maxCharsPerLine
                        lines = [site.slice(0, maxCharsPerLine), site.slice(maxCharsPerLine)];
                      }
                    }

                    return (
                      <g key={site} transform={`translate(${(xScale(site) ?? 0) + xScale.bandwidth() / 2}, -15)`}>
                        <text
                          transform="rotate(-90)"
                          x={0}
                          y={0}
                          textAnchor="start"
                          dominantBaseline="middle"
                          className="font-bold"
                          style={{
                            fontSize: `${styles.yAxisLabelFontSize}px`,
                            fill: '#4b5563'
                          }}
                        >
                          {lines.map((line, i) => (
                            <tspan
                              key={i}
                              x={0}
                              dy={i === 0 ? 0 : 14}
                            >
                              {line}
                            </tspan>
                          ))}
                        </text>
                      </g>
                    );
                  })}

                  {/* X-axis title - positioned to the left of site labels */}
                  <text
                    x={-25}
                    y={-50}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="font-semibold"
                    style={{
                      fontSize: `${styles.yAxisTitleFontSize}px`,
                      fill: 'hsl(var(--foreground))'
                    }}
                  >
                    Site
                  </text>
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
                        stroke="hsl(var(--muted-foreground))"
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

                    // Check if this taxon has a parent-child relationship with another visible taxon
                    const relationship = parentChildRelationships.get(speciesName);

                    return (
                      <g key={speciesName}>
                        {/* Parent-child relationship indicator triangles (right side, next to heatmap) */}
                        {/* Child triangle (upward) - shows this taxon has a parent above */}
                        {sortMode === 'hierarchical' && relationship?.asChild && (
                          <path
                            d="M -2.4,0 L 0,-2.4 L 2.4,0 Z"
                            transform={`translate(${relationship.asParent ? -12 : -5}, ${y})`}
                            fill={relationship.asChild.color}
                            opacity={0.9}
                          />
                        )}
                        {/* Parent triangle (downward) - shows this taxon has children below */}
                        {/* Position aligns with child's upward arrow: -12 if child has dual arrows, -5 if child is single */}
                        {sortMode === 'hierarchical' && relationship?.asParent && (
                          <path
                            d="M -2.4,0 L 0,2.4 L 2.4,0 Z"
                            transform={`translate(${relationship.asParent.childIsDual ? -12 : -5}, ${y})`}
                            fill={relationship.asParent.color}
                            opacity={0.9}
                          />
                        )}
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
                            fill: taxonInfo && !taxonInfo.node.isLeaf ? 'hsl(var(--foreground))' : 'hsl(var(--foreground))'
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
                            fill: isNotEvaluated ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))'
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
                                  stroke="hsl(var(--border))"
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
                                <g
                                  transform={`translate(${xScale(site)}, ${yScale(species)})`}
                                  className="cursor-pointer"
                                  onClick={() => {
                                    setHighlightedTaxon(species);
                                    setViewMode('tree');
                                    setTimeout(() => setHighlightedTaxon(null), 4000);
                                  }}
                                >
                                  {/* Cell background */}
                                  <rect
                                    width={xScale.bandwidth()}
                                    height={yScale.bandwidth()}
                                    fill={fillColor}
                                    className="stroke-background/50 hover:stroke-primary hover:stroke-2"
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
                                      <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
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
                              <p className="text-xs text-blue-600 mt-2 pt-2 border-t border-border cursor-pointer hover:underline">
                                Click to show in Tree view
                              </p>
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
