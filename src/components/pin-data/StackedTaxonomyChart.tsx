"use client";

import React, { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, Cell, LabelList } from 'recharts';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Info } from 'lucide-react';
import type { AggregatedTaxonomyData } from '@/lib/edna-taxonomy-processor';

interface StackedTaxonomyChartProps {
  data: AggregatedTaxonomyData;
  fileName: string;
  customTitle?: string;
  customYAxisLabel?: string;
  phylumColors?: { [phylum: string]: string };
  width?: number | string;
  height?: number;
  spotSampleStyles?: {
    chartMarginTop?: number;
    chartMarginRight?: number;
    chartMarginLeft?: number;
    chartMarginBottom?: number;
    xAxisLabelRotation?: number;
    xAxisLabelFontSize?: number;
    xAxisShowDate?: boolean;
    xAxisShowStationName?: boolean;
    xAxisShowSampleId?: boolean;
    xAxisLabelLineMode?: 'single' | 'two-line';
    xAxisLine1Components?: ('date' | 'station' | 'sample')[];
    xAxisLine2Components?: ('date' | 'station' | 'sample')[];
    yAxisLabelFontSize?: number;
    yAxisTitleFontSize?: number;
    yAxisTitleFontWeight?: number | string;
    yAxisTitleAlign?: 'left' | 'center' | 'right';
    chartHeight?: number;
  };
}

/**
 * Default color palette for common marine phyla
 * Colorblind-friendly palette based on Paul Tol and Wong palettes
 * All colors have sufficient contrast against white backgrounds
 */
const DEFAULT_PHYLUM_COLORS: { [key: string]: string } = {
  'Chromista': '#882255',      // Wine/magenta
  'Metazoa': '#0077BB',        // Strong blue
  'Plantae': '#009988',        // Teal
  'Annelida': '#CC3311',       // Vermillion/red-orange
  'Arthropoda': '#33BBEE',     // Cyan
  'Mollusca': '#AA3377',       // Purple/magenta
  'Chordata': '#EE7733',       // Orange
  'Echinodermata': '#0072B2',  // Deep sky blue
  'Cnidaria': '#009E73',       // Bluish green
  'Porifera': '#332288',       // Indigo
  'Bryozoa': '#CC6677',        // Rose
  'Platyhelminthes': '#AA4499', // Violet
  'Ochrophyta': '#997700',     // Olive/dark yellow
  'Myzozoa': '#6699CC',        // Light steel blue
  'Chlorophyta': '#117733',    // Dark green
  'Nematoda': '#CC4411',       // Dark orange-red
  'Cercozoa': '#5566AA',       // Muted blue
  'Haptophyta': '#44AA99',     // Teal green
  'Nemertea': '#994455',       // Dark rose
  'Bigyra': '#666633',         // Olive brown
  'Ciliophora': '#448899',     // Steel teal
};

/**
 * Extended colorblind-friendly palette for additional phyla
 * These colors maintain good contrast and colorblind accessibility
 */
const EXTENDED_COLORS = [
  '#4477AA', // Blue
  '#66CCEE', // Cyan
  '#228833', // Green
  '#CCBB44', // Olive yellow (dark enough for white bg)
  '#EE6677', // Red/pink
  '#AA3377', // Purple
  '#BBBBBB', // Grey
  '#885533', // Brown
  '#CC6644', // Burnt orange
  '#336688', // Steel blue
  '#779944', // Moss green
  '#AA6688', // Mauve
  '#557799', // Slate
  '#886644', // Tan brown
  '#668844', // Olive green
  '#995566', // Dusty rose
];

/**
 * Generate a color for a phylum not in the default palette
 * Uses extended colorblind-friendly palette with hash-based selection
 */
function generatePhylumColor(phylum: string): string {
  let hash = 0;
  for (let i = 0; i < phylum.length; i++) {
    hash = phylum.charCodeAt(i) + ((hash << 5) - hash);
  }

  const index = Math.abs(hash) % EXTENDED_COLORS.length;
  return EXTENDED_COLORS[index];
}

/**
 * Map phylum names to common descriptions for better user understanding
 */
const PHYLUM_COMMON_NAMES: { [key: string]: string } = {
  'Ochrophyta': 'Diatoms & Brown Alg',
  'Annelida': 'Segmented Worms',
  'Myzozoa': 'Dinoflagellates',
  'Arthropoda': 'Crustaceans',
  'Echinodermata': 'Sea Stars & Urch',
  'Mollusca': 'Clams & Snails',
  'Chlorophyta': 'Green Algae',
  'Nematoda': 'Roundworms',
  'Cercozoa': 'Protists',
  'Haptophyta': 'Coccolithophores',
  'Chordata': 'Fish & Tunicates',
  'Cnidaria': 'Jellyfish & Corals',
  'Nemertea': 'Ribbon Worms',
  'Bigyra': 'Labyrinthulids',
  'Ciliophora': 'Ciliates',
  'Bryozoa': 'Moss Animals',
  'Platyhelminthes': 'Flatworms',
  'Porifera': 'Sponges'
};

/**
 * Get display name with common name in brackets
 */
function getPhylumDisplayName(phylum: string): string {
  const commonName = PHYLUM_COMMON_NAMES[phylum];
  return commonName ? `${phylum} (${commonName})` : phylum;
}

/**
 * Stacked Bar Chart for eDNA Taxonomy Composition
 *
 * Displays phylum-level community composition across multiple sampling sites
 * X-axis: Sample locations
 * Y-axis: Relative abundance (percentage)
 * Stacks: Different phyla with distinct colors
 */
export function StackedTaxonomyChart({
  data,
  fileName,
  customTitle = 'eDNA Phylum Composition',
  customYAxisLabel = 'Relative Abundance (%)',
  phylumColors,
  width = "100%",
  height = 600,
  spotSampleStyles
}: StackedTaxonomyChartProps) {

  // Extract styling properties with defaults
  const styles = {
    chartMarginTop: spotSampleStyles?.chartMarginTop ?? 20,
    chartMarginRight: spotSampleStyles?.chartMarginRight ?? 150,
    chartMarginLeft: spotSampleStyles?.chartMarginLeft ?? 60,
    chartMarginBottom: spotSampleStyles?.chartMarginBottom ?? 80,
    xAxisLabelRotation: spotSampleStyles?.xAxisLabelRotation ?? -45,
    xAxisLabelFontSize: spotSampleStyles?.xAxisLabelFontSize ?? 11,
    xAxisShowDate: spotSampleStyles?.xAxisShowDate ?? true,
    xAxisShowStationName: spotSampleStyles?.xAxisShowStationName ?? true,
    xAxisShowSampleId: spotSampleStyles?.xAxisShowSampleId ?? true,
    xAxisLabelLineMode: spotSampleStyles?.xAxisLabelLineMode ?? 'single',
    xAxisLine1Components: spotSampleStyles?.xAxisLine1Components ?? ['date', 'station', 'sample'],
    xAxisLine2Components: spotSampleStyles?.xAxisLine2Components ?? [],
    yAxisLabelFontSize: spotSampleStyles?.yAxisLabelFontSize ?? 12,
    yAxisTitleFontSize: spotSampleStyles?.yAxisTitleFontSize ?? 14,
    yAxisTitleFontWeight: spotSampleStyles?.yAxisTitleFontWeight ?? 'bold',
    yAxisTitleAlign: spotSampleStyles?.yAxisTitleAlign ?? 'center',
    chartHeight: spotSampleStyles?.chartHeight ?? 600,
    barSize: spotSampleStyles?.barSize ?? 60,
    barCategoryGap: spotSampleStyles?.barCategoryGap ?? "5%"
  };

  // Merge default colors with custom colors
  const colorPalette = { ...DEFAULT_PHYLUM_COLORS, ...phylumColors };

  // Get color for a phylum (use default, custom, or generate)
  const getPhylumColor = (phylum: string): string => {
    return colorPalette[phylum] || generatePhylumColor(phylum);
  };

  // Track which phylum is currently hovered for highlighting
  const [hoveredPhylum, setHoveredPhylum] = useState<string | null>(null);

  // Track which phylum dialog is open
  const [showActionDialog, setShowActionDialog] = useState(false);
  const [selectedPhylum, setSelectedPhylum] = useState<string | null>(null);

  // Gray color for non-hovered elements
  const GRAYED_OUT_COLOR = '#E0E0E0';

  // Transform aggregated data into Recharts format
  // Each object represents one sample with percentages for each phylum
  const chartData = data.samples.map(sample => {
    const sampleData: any = { sample };

    // Add percentage for each phylum (using display names with common names)
    for (const phylum of data.allPhyla) {
      const displayName = getPhylumDisplayName(phylum);
      sampleData[displayName] = data.phylumPercentages[phylum][sample];
      // Also store the original phylum name for lookup
      sampleData[`_${displayName}_original`] = phylum;
    }

    // Add total count for tooltip
    sampleData._totalTaxa = data.totalTaxaPerSample[sample];

    return sampleData;
  });

  // Calculate total abundance for each phylum across all samples for stacking order
  const phylumTotalAbundance: { [phylum: string]: number } = {};
  data.allPhyla.forEach(phylum => {
    phylumTotalAbundance[phylum] = data.samples.reduce((sum, sample) => {
      return sum + (data.phylumPercentages[phylum][sample] || 0);
    }, 0);
  });

  // Sort phyla by total abundance (descending) for stacking - most abundant at bottom
  const phylaSortedByAbundance = [...data.allPhyla].sort((a, b) =>
    phylumTotalAbundance[b] - phylumTotalAbundance[a]
  );

  // Sort phyla alphabetically for legend
  const phylaSortedAlphabetically = [...data.allPhyla].sort();

  console.log('[STACKED-TAXONOMY-CHART] Rendering for file:', fileName);
  console.log('[STACKED-TAXONOMY-CHART] Samples:', data.samples);
  console.log('[STACKED-TAXONOMY-CHART] Phyla:', data.allPhyla);
  console.log('[STACKED-TAXONOMY-CHART] Chart data:', chartData);
  console.log('[STACKED-TAXONOMY-CHART] Phyla by abundance:', phylaSortedByAbundance.map(p => `${p}: ${phylumTotalAbundance[p].toFixed(1)}`));

  // Custom tooltip showing only the hovered phylum
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length && hoveredPhylum) {
      // Find the entry for the hovered phylum
      const hoveredEntry = payload.find((entry: any) => {
        if (entry.dataKey.startsWith('_')) return false;
        const originalPhylum = entry.payload[`_${entry.dataKey}_original`];
        return originalPhylum === hoveredPhylum;
      });

      if (!hoveredEntry) return null;

      const percentage = hoveredEntry.value;
      const originalPhylum = hoveredEntry.payload[`_${hoveredEntry.dataKey}_original`];
      const count = data.phylumCounts[originalPhylum]?.[label] || 0;
      const phylumColor = getPhylumColor(originalPhylum);

      return (
        <div className="bg-card border border-border rounded shadow-lg p-3 max-w-xs">
          <p className="font-semibold text-sm mb-2">{label}</p>
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-4 h-4 rounded"
              style={{ backgroundColor: phylumColor }}
            ></span>
            <div>
              <p className="font-medium text-sm">{hoveredEntry.dataKey}</p>
              <p className="text-sm text-muted-foreground">
                {count} taxa ({percentage.toFixed(1)}%)
              </p>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };


  return (
    <div className="relative w-full" style={{ height: styles.chartHeight, overflow: 'visible' }}>
      {/* Chart Title */}
      <div className="text-center pt-6 mb-2">
        <h3 className="text-lg font-semibold text-foreground">{customTitle}</h3>
      </div>

      {/* Stacked Bar Chart */}
      <ResponsiveContainer width={width} height={styles.chartHeight - 50} style={{ overflow: 'visible' }}>
        <BarChart
          data={chartData}
          margin={{
            top: styles.chartMarginTop,
            right: styles.chartMarginRight,
            left: styles.chartMarginLeft,
            bottom: styles.chartMarginBottom
          }}
          barSize={styles.barSize}
          barCategoryGap={styles.barCategoryGap}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />

          <XAxis
            dataKey="sample"
            label={{
              value: 'Sampling Location',
              position: 'insideBottom',
              offset: -15,
              style: {
                fontSize: `${styles.yAxisTitleFontSize}px`,
                fontWeight: styles.yAxisTitleFontWeight
              }
            }}
            tick={{ fontSize: styles.xAxisLabelFontSize, angle: styles.xAxisLabelRotation, textAnchor: 'end' }}
            height={styles.chartMarginBottom}
            interval={0}
          />

          <YAxis
            domain={[0, 100]}
            ticks={[0, 20, 40, 60, 80, 100]}
            label={{
              value: customYAxisLabel,
              angle: -90,
              position: 'insideLeft',
              offset: 15,
              style: {
                fontSize: `${styles.yAxisTitleFontSize}px`,
                fontWeight: styles.yAxisTitleFontWeight,
                textAnchor: 'middle'
              }
            }}
            tick={{ fontSize: styles.yAxisLabelFontSize }}
          />

          <RechartsTooltip content={<CustomTooltip />} cursor={false} />

          <Legend
            verticalAlign="top"
            align="right"
            layout="vertical"
            wrapperStyle={{
              paddingLeft: '20px',
              fontSize: '12px'
            }}
            iconType="square"
            onMouseEnter={(e: any) => {
              if (e && e.id) setHoveredPhylum(e.id);
            }}
            onMouseLeave={() => setHoveredPhylum(null)}
            onClick={(e: any) => {
              if (e && e.id) {
                setSelectedPhylum(e.id);
                setShowActionDialog(true);
              }
            }}
            formatter={(value, entry: any) => {
              const phylum = entry.id;
              const isHovered = hoveredPhylum === phylum;
              const isGrayedOut = hoveredPhylum !== null && !isHovered;
              return (
                <span
                  style={{
                    fontSize: '11px',
                    color: isGrayedOut ? 'hsl(var(--muted-foreground))' : 'hsl(var(--foreground))',
                    fontWeight: isHovered ? 600 : 400,
                    cursor: 'pointer',
                    textDecoration: isHovered ? 'underline' : 'none'
                  }}
                >
                  {value}
                </span>
              );
            }}
            payload={phylaSortedAlphabetically.map(phylum => {
              const isHovered = hoveredPhylum === phylum;
              const isGrayedOut = hoveredPhylum !== null && !isHovered;
              return {
                value: getPhylumDisplayName(phylum),
                type: 'square',
                color: isGrayedOut ? GRAYED_OUT_COLOR : getPhylumColor(phylum),
                id: phylum
              };
            })}
          />

          {/* Create a Bar component for each phylum - sorted by abundance (most abundant at bottom) */}
          {phylaSortedByAbundance.map((phylum, index) => {
            const displayName = getPhylumDisplayName(phylum);
            const isHovered = hoveredPhylum === phylum;
            const isGrayedOut = hoveredPhylum !== null && !isHovered;
            const barColor = isGrayedOut ? GRAYED_OUT_COLOR : getPhylumColor(phylum);

            return (
              <Bar
                key={phylum}
                dataKey={displayName}
                name={displayName}
                stackId="a"
                fill={barColor}
                radius={index === phylaSortedByAbundance.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                onMouseEnter={() => setHoveredPhylum(phylum)}
                onMouseLeave={() => setHoveredPhylum(null)}
                style={{
                  cursor: 'pointer',
                  transition: 'opacity 0.15s ease-in-out'
                }}
              >
                {/* Use Cell components to apply colors per bar segment */}
                {chartData.map((entry, cellIndex) => (
                  <Cell
                    key={`cell-${cellIndex}`}
                    fill={isGrayedOut ? GRAYED_OUT_COLOR : getPhylumColor(phylum)}
                    opacity={isGrayedOut ? 0.4 : 1}
                  />
                ))}
                <LabelList
                  dataKey={displayName}
                  position="center"
                  formatter={(value: number) => value > 5 ? `${Math.round(value)}%` : ''}
                  style={{
                    fontSize: 10,
                    fill: isGrayedOut ? '#999' : '#fff',
                    fontWeight: 400
                  }}
                />
              </Bar>
            );
          })}

        </BarChart>
      </ResponsiveContainer>

      {/* Compact Search Dialog */}
      <Dialog open={showActionDialog} onOpenChange={setShowActionDialog}>
        <DialogContent className="sm:max-w-[280px] p-3">
          <Button
            onClick={() => {
              if (selectedPhylum) {
                const searchQuery = encodeURIComponent(`${selectedPhylum} phylum marine biology`);
                window.open(`https://www.google.com/search?q=${searchQuery}`, '_blank');
              }
              setShowActionDialog(false);
              setSelectedPhylum(null);
            }}
            className="w-full justify-start gap-2"
            variant="outline"
          >
            <Info className="w-4 h-4" />
            <div className="flex flex-col items-start">
              <span className="font-semibold">Search Online</span>
              <span className="text-xs text-muted-foreground">Open a Google search for this phylum</span>
            </div>
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
