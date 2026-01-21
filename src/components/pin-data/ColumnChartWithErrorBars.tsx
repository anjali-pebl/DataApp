"use client";

import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ErrorBar, LabelList, Customized } from 'recharts';
import type { SpotSampleGroup } from '@/lib/statistical-utils';

interface SpotSampleStyles {
  barGap?: number;
  barCategoryGap?: number;
  columnBorderWidth?: number;
  whiskerBoxWidth?: number;
  whiskerLineWidth?: number;
  whiskerBoxBorderWidth?: number;
  whiskerCapWidth?: number;
  chartMarginTop?: number;
  chartMarginRight?: number;
  chartMarginLeft?: number;
  chartMarginBottom?: number;
  errorBarWidth?: number;
  errorBarStrokeWidth?: number;
  xAxisLabelRotation?: number;
  xAxisLabelFontSize?: number;
  xAxisShowDate?: boolean;
  xAxisShowStationName?: boolean;
  xAxisShowSampleId?: boolean;
  yAxisLabel?: string; // Custom Y-axis label (overrides parameter name)
  yAxisLabelFontSize?: number;
  yAxisTitleFontSize?: number;
  yAxisTitleFontWeight?: number | string;
  yAxisTitleAlign?: 'left' | 'center' | 'right';
  chartHeight?: number;
  chartTitle?: string; // Custom chart title
}

interface ColumnChartWithErrorBarsProps {
  data: SpotSampleGroup[];
  parameter: string;
  sampleIdColors: Record<string, string>;
  width?: number | string;
  height?: number;
  showXAxisLabels?: boolean;
  spotSampleStyles?: SpotSampleStyles;
  columnColorMode?: 'unique' | 'single';
  singleColumnColor?: string;
  yAxisRange?: { min?: number; max?: number };
  showDateSeparators?: boolean; // Show vertical lines between different sampling days (only in Detailed mode)
}

/**
 * Column Chart with Error Bars for spot-sample data
 * Displays mean values with ± SD error bars
 * Single value samples show column without error bars
 */
export function ColumnChartWithErrorBars({
  data,
  parameter,
  sampleIdColors,
  width = "100%",
  height = 400,
  showXAxisLabels = true,
  spotSampleStyles,
  columnColorMode = 'single',
  singleColumnColor = '#3b82f6',
  yAxisRange,
  showDateSeparators = false
}: ColumnChartWithErrorBarsProps) {

  // Helper function to capitalize first letter of parameter names
  // Converts "length (cm)" -> "Length (cm)", "width (cm)" -> "Width (cm)"
  const capitalizeParameter = (param: string): string => {
    return param.charAt(0).toUpperCase() + param.slice(1);
  };

  // Extract styling properties with defaults
  const baseYAxisLabelFontSize = spotSampleStyles?.yAxisLabelFontSize ?? 12;
  // Add extra top margin when showDateSeparators is true to accommodate date labels
  const dateLabelsTopMargin = showDateSeparators ? 25 : 0;
  const styles = {
    barGap: spotSampleStyles?.barGap ?? 4,
    barCategoryGap: spotSampleStyles?.barCategoryGap ?? 10,
    columnBorderWidth: spotSampleStyles?.columnBorderWidth ?? 0,
    chartMarginTop: (spotSampleStyles?.chartMarginTop ?? 20) + dateLabelsTopMargin,
    chartMarginRight: spotSampleStyles?.chartMarginRight ?? 30,
    chartMarginLeft: spotSampleStyles?.chartMarginLeft ?? 40,
    chartMarginBottom: spotSampleStyles?.chartMarginBottom ?? 80,
    errorBarWidth: spotSampleStyles?.errorBarWidth ?? 4,
    errorBarStrokeWidth: spotSampleStyles?.errorBarStrokeWidth ?? 2,
    xAxisLabelRotation: spotSampleStyles?.xAxisLabelRotation ?? -45,
    xAxisLabelFontSize: spotSampleStyles?.xAxisLabelFontSize ?? 11,
    xAxisShowDate: spotSampleStyles?.xAxisShowDate ?? true,
    xAxisShowStationName: spotSampleStyles?.xAxisShowStationName ?? true,
    xAxisShowSampleId: spotSampleStyles?.xAxisShowSampleId ?? true,
    yAxisLabelFontSize: baseYAxisLabelFontSize,
    yAxisTitleFontSize: spotSampleStyles?.yAxisTitleFontSize ?? (baseYAxisLabelFontSize + 2), // Title is 2px larger than labels
    yAxisTitleFontWeight: spotSampleStyles?.yAxisTitleFontWeight ?? 'normal',
    yAxisTitleAlign: spotSampleStyles?.yAxisTitleAlign ?? 'center',
    chartHeight: spotSampleStyles?.chartHeight ?? 350
  };

  // console.log('[COLUMN-CHART] Rendering for parameter:', parameter);
  // console.log('[COLUMN-CHART] Total data groups:', data.length);
  // console.log('[COLUMN-CHART] Sample colors:', sampleIdColors);
  // console.log('[COLUMN-CHART] Applied styles:', styles);

  // Filter data for this parameter
  const parameterData = data.filter(d => d.parameter === parameter);

  // console.log('[COLUMN-CHART] Filtered data for this parameter:', parameterData.length);
  // console.log('[COLUMN-CHART] First 3 data points:', parameterData.slice(0, 3));

  if (parameterData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No data available for {parameter}
      </div>
    );
  }

  // Transform data for Recharts
  const chartData = parameterData.map((group, index) => {
    // FIX: Do NOT add offsets to mean/SD values - this corrupts the chart!
    // The uniqueness should be achieved through the xAxisLabel key only

    // Only include error bars when there's actual meaningful error (SD > 0 and count > 1)
    const hasError = group.count > 1 && group.stats.sd > 0;

    const result = {
      xAxisLabel: `${group.xAxisLabel}_${index}`, // Make x-axis label unique (this is the key)
      displayLabel: group.xAxisLabel, // Original label for display
      mean: group.stats.mean, // Use ACTUAL mean value for chart
      originalMean: group.stats.mean, // Keep original for tooltip
      sd: group.stats.sd, // Use ACTUAL SD
      originalSd: group.stats.sd, // Keep original for tooltip
      count: group.count,
      sampleId: group.sampleId,
      uniqueId: `${parameter}-${group.date}-${group.sampleId}-${index}`, // Unique identifier
      // Error bar data - only set if there's meaningful error to prevent duplicate keys
      // Setting to undefined prevents Recharts from rendering error bars for these points
      errorY: hasError ? [group.stats.sd, group.stats.sd] : undefined
    };

    // Log first 3 data transformations for debugging
    // if (index < 3) {
    //   console.log(`[COLUMN-CHART-DATA] Bar ${index}:`, {
    //     xLabel: result.displayLabel,
    //     mean: result.mean,
    //     sd: result.sd,
    //     count: result.count,
    //     rawValues: group.values
    //   });
    // }

    return result;
  });

  // Calculate date groups for separators and top labels (when showDateSeparators is true)
  const dateGroups = React.useMemo(() => {
    if (!showDateSeparators) return { groups: [], separatorIndices: [] };

    const groups: Array<{ date: string; startIndex: number; endIndex: number; displayDate: string }> = [];
    const separatorIndices: number[] = [];
    let currentDate = parameterData[0]?.date;
    let startIndex = 0;

    parameterData.forEach((group, index) => {
      if (group.date !== currentDate || index === parameterData.length - 1) {
        // End of current group (or last item)
        const endIndex = group.date !== currentDate ? index - 1 : index;

        // Format the display date (DD/MM/YY)
        const dateObj = new Date(currentDate);
        const displayDate = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${String(dateObj.getFullYear()).slice(-2)}`;

        groups.push({
          date: currentDate,
          startIndex,
          endIndex,
          displayDate
        });

        // Record separator position (between groups)
        if (group.date !== currentDate) {
          separatorIndices.push(index);
          startIndex = index;
          currentDate = group.date;
        }
      }
    });

    // Handle last group if it wasn't closed
    if (groups.length === 0 || groups[groups.length - 1].date !== currentDate) {
      const dateObj = new Date(currentDate);
      const displayDate = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${String(dateObj.getFullYear()).slice(-2)}`;
      groups.push({
        date: currentDate,
        startIndex,
        endIndex: parameterData.length - 1,
        displayDate
      });
    }

    return { groups, separatorIndices };
  }, [showDateSeparators, parameterData]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;

    const data = payload[0].payload;

    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg">
        <p className="font-semibold text-sm mb-2">{data.displayLabel}</p>
        <p className="text-xs mb-1">
          <span className="text-muted-foreground">Sample ID:</span>{' '}
          <span className="font-medium">{data.sampleId}</span>
        </p>
        <p className="text-xs mb-1">
          <span className="text-muted-foreground">Mean:</span>{' '}
          <span className="font-medium">{data.originalMean.toFixed(2)}</span>
        </p>
        {data.count > 1 && (
          <>
            <p className="text-xs mb-1">
              <span className="text-muted-foreground">SD:</span>{' '}
              <span className="font-medium">±{data.originalSd.toFixed(2)}</span>
            </p>
            <p className="text-xs">
              <span className="text-muted-foreground">n =</span>{' '}
              <span className="font-medium">{data.count}</span>
            </p>
          </>
        )}
        {data.count === 1 && (
          <p className="text-xs text-muted-foreground">
            Single measurement
          </p>
        )}
      </div>
    );
  };

  // Custom X-axis tick (rotated for readability)
  const CustomXAxisTick = ({ x, y, payload }: any) => {
    // Extract the display label (remove the _index suffix)
    const displayValue = payload.value?.split('_').slice(0, -1).join('_') || payload.value;

    // Split label into date and sample info
    // Format: "DD/MM/YY [Station-Name Sample-ID]" or "DD/MM/YY [Sample-ID]"
    const labelParts = displayValue.match(/^(.+?)\s+\[(.+?)\]$/);
    const dateLabel = labelParts ? labelParts[1] : displayValue;
    const bracketContent = labelParts ? labelParts[2] : '';

    // Try to split bracket content into station name and sample ID
    // Station names typically have format "Farm-L", sample IDs like "4-SW-1"
    // Split by space to separate them
    const bracketParts = bracketContent.split(' ');
    const stationName = bracketParts.length > 1 ? bracketParts[0] : '';
    const sampleId = bracketParts.length > 1 ? bracketParts[1] : bracketContent;

    // Map component types to their values
    const componentMap: Record<'date' | 'station' | 'sample', string> = {
      date: dateLabel,
      station: stationName,
      sample: sampleId
    };

    // Get label layout configuration
    const labelLineMode = spotSampleStyles?.xAxisLabelLineMode ?? 'two-line';
    const line1Components = spotSampleStyles?.xAxisLine1Components ?? ['date'];
    const line2Components = spotSampleStyles?.xAxisLine2Components ?? ['station', 'sample'];

    // Build final display based on mode
    // Skip date in x-axis labels when showDateSeparators is true (date is shown at top)
    const shouldShowDate = styles.xAxisShowDate && !showDateSeparators;

    if (labelLineMode === 'single') {
      // Single line mode: show all enabled components on one line
      const labelComponents: string[] = [];
      if (shouldShowDate && dateLabel) {
        labelComponents.push(dateLabel);
      }
      if (styles.xAxisShowStationName && stationName) {
        labelComponents.push(stationName);
      }
      if (styles.xAxisShowSampleId && sampleId) {
        labelComponents.push(sampleId);
      }

      const displayText = labelComponents.length > 0 ? labelComponents.join(' ') : '-';

      return (
        <g transform={`translate(${x},${y})`}>
          <text
            x={0}
            y={0}
            dy={16}
            textAnchor="end"
            fill={displayText === '-' ? '#999' : '#666'}
            fontSize={styles.xAxisLabelFontSize}
            transform={`rotate(${styles.xAxisLabelRotation})`}
          >
            {displayText}
          </text>
        </g>
      );
    } else {
      // Two-line mode: distribute components according to line assignments
      const line1Parts: string[] = [];
      const line2Parts: string[] = [];

      // Build line 1 from assigned components (respecting visibility toggles)
      // Skip date when showDateSeparators is true (date is shown at top)
      line1Components.forEach(comp => {
        const value = componentMap[comp];
        if (value) {
          if (comp === 'date' && !shouldShowDate) return;
          if (comp === 'station' && !styles.xAxisShowStationName) return;
          if (comp === 'sample' && !styles.xAxisShowSampleId) return;
          line1Parts.push(value);
        }
      });

      // Build line 2 from assigned components (respecting visibility toggles)
      line2Components.forEach(comp => {
        const value = componentMap[comp];
        if (value) {
          if (comp === 'date' && !shouldShowDate) return;
          if (comp === 'station' && !styles.xAxisShowStationName) return;
          if (comp === 'sample' && !styles.xAxisShowSampleId) return;
          line2Parts.push(value);
        }
      });

      const firstLine = line1Parts.join(' ');
      const secondLine = line2Parts.join(' ');

      return (
        <g transform={`translate(${x},${y})`}>
          {/* First line */}
          {firstLine && (
            <text
              x={0}
              y={0}
              dy={16}
              textAnchor="end"
              fill="#666"
              fontSize={styles.xAxisLabelFontSize}
              transform={`rotate(${styles.xAxisLabelRotation})`}
            >
              {firstLine}
            </text>
          )}
          {/* Second line */}
          {secondLine && (
            <text
              x={0}
              y={0}
              dy={16 + styles.xAxisLabelFontSize + 2}
              textAnchor="end"
              fill="#666"
              fontSize={styles.xAxisLabelFontSize}
              transform={`rotate(${styles.xAxisLabelRotation})`}
            >
              {secondLine}
            </text>
          )}
          {/* Placeholder if nothing to show */}
          {!firstLine && !secondLine && (
            <text
              x={0}
              y={0}
              dy={16}
              textAnchor="end"
              fill="#999"
              fontSize={styles.xAxisLabelFontSize}
              transform={`rotate(${styles.xAxisLabelRotation})`}
            >
              -
            </text>
          )}
        </g>
      );
    }
  };

  // Custom component for rendering date separators and labels
  const DateSeparatorsLayer = (props: any) => {
    if (!showDateSeparators) return null;

    const { xAxisMap, yAxisMap, offset } = props;
    const xAxis = xAxisMap?.[0];
    const yAxis = yAxisMap?.[0];

    if (!xAxis || !yAxis || !xAxis.bandSize) return null;

    const bandSize = xAxis.bandSize;
    const yTop = offset?.top || styles.chartMarginTop;
    const yBottom = yAxis.y + yAxis.height;

    // Render separator lines and date labels
    const elements: React.ReactNode[] = [];

    // Add separator lines at date boundaries
    dateGroups.separatorIndices.forEach((sepIndex, i) => {
      const xPos = xAxis.x + (sepIndex * bandSize);
      elements.push(
        <line
          key={`sep-line-${i}`}
          x1={xPos}
          y1={yTop}
          x2={xPos}
          y2={yBottom}
          stroke="#9ca3af"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
      );
    });

    // Add date labels at the top of each group (scale font size to avoid overlap)
    const defaultFontSize = styles.xAxisLabelFontSize + 1;
    const minFontSize = 8; // Minimum readable font size
    const charWidth = 0.6; // Approximate character width as fraction of font size
    const minSpacing = 5; // Minimum spacing between labels in pixels

    // Calculate label positions first
    const labelPositions = dateGroups.groups.map((group) => {
      const startX = xAxis.x + (group.startIndex * bandSize) + (bandSize / 2);
      const endX = xAxis.x + (group.endIndex * bandSize) + (bandSize / 2);
      return (startX + endX) / 2;
    });

    // Find minimum distance between adjacent labels
    let minDistance = Infinity;
    for (let i = 1; i < labelPositions.length; i++) {
      const distance = labelPositions[i] - labelPositions[i - 1];
      if (distance < minDistance) minDistance = distance;
    }

    // Calculate font size that fits all labels
    // Label width ≈ fontSize * charWidth * numChars (date format "DD/MM/YY" = 8 chars)
    const numChars = 8;
    const maxLabelWidth = minDistance - minSpacing;
    const calculatedFontSize = maxLabelWidth / (charWidth * numChars);
    const fontSize = Math.max(minFontSize, Math.min(defaultFontSize, calculatedFontSize));

    dateGroups.groups.forEach((group, i) => {
      const centerX = labelPositions[i];
      const labelY = yTop - 8;

      elements.push(
        <text
          key={`date-label-${i}`}
          x={centerX}
          y={labelY}
          textAnchor="middle"
          fontSize={fontSize}
          fill="#374151"
          fontWeight={600}
        >
          {group.displayDate}
        </text>
      );
    });

    return <g>{elements}</g>;
  };

  return (
    <ResponsiveContainer width={width} height={styles.chartHeight}>
      <BarChart
        data={chartData}
        margin={{
          top: styles.chartMarginTop,
          right: styles.chartMarginRight,
          left: styles.chartMarginLeft,
          bottom: styles.chartMarginBottom
        }}
        barGap={styles.barGap}
        barCategoryGap={`${styles.barCategoryGap}%`}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />

        {/* Date separators and labels layer */}
        {showDateSeparators && <Customized component={DateSeparatorsLayer} />}

        <XAxis
          dataKey="xAxisLabel"
          height={styles.chartMarginBottom}
          tick={showXAxisLabels ? CustomXAxisTick : false}
          interval={0}
        />

        <YAxis
          label={{
            value: spotSampleStyles?.yAxisLabel || capitalizeParameter(parameter),
            angle: -90,
            position: 'insideLeft',
            style: {
              fontSize: styles.yAxisTitleFontSize,
              fontWeight: styles.yAxisTitleFontWeight,
              textAnchor: 'middle', // SVG uses 'middle' for centering, not 'center'
              fill: '#666' // Match the plot color scheme
            }
          }}
          tick={{ fontSize: styles.yAxisLabelFontSize }}
          domain={[
            yAxisRange?.min !== undefined ? Math.max(0, yAxisRange.min) : 0,
            yAxisRange?.max !== undefined ? yAxisRange.max : 'auto'
          ]}
          allowDataOverflow={true}
        />

        <Tooltip content={<CustomTooltip />} />

        <Bar dataKey="mean" radius={[4, 4, 0, 0]}>
          {chartData.map((entry, index) => {
            // Use single color mode if selected, otherwise use unique colors per sample
            const color = columnColorMode === 'single'
              ? singleColumnColor
              : (sampleIdColors[entry.sampleId] || '#3b82f6');
            return (
              <Cell
                key={`cell-${entry.xAxisLabel}-${index}`}
                fill={color}
                stroke={styles.columnBorderWidth > 0 ? color : 'none'}
                strokeWidth={styles.columnBorderWidth}
              />
            );
          })}
          {/* Data labels on top of each column with white background for visibility */}
          <LabelList
            dataKey="mean"
            position="top"
            content={({ x, y, value, width }: any) => {
              if (value === undefined || value === null) return null;
              const text = typeof value === 'number' ? value.toFixed(2) : String(value);
              const textWidth = text.length * 6.5; // Approximate width based on character count
              const textHeight = 14;
              const padding = 2;
              // Center the label over the bar by using x + width/2
              const centerX = (x as number) + (width as number) / 2;
              return (
                <g>
                  <rect
                    x={centerX - textWidth / 2 - padding}
                    y={(y as number) - textHeight - padding}
                    width={textWidth + padding * 2}
                    height={textHeight + padding}
                    fill="rgba(255, 255, 255, 0.85)"
                    rx={2}
                    ry={2}
                  />
                  <text
                    x={centerX}
                    y={(y as number) - 4}
                    textAnchor="middle"
                    fontSize={11}
                    fill="#333"
                    fontWeight={500}
                  >
                    {text}
                  </text>
                </g>
              );
            }}
          />
          {/*
            Error bars - only rendered when errorY is defined (SD > 0 and count > 1)
            By setting errorY to undefined for data points without meaningful error,
            we prevent duplicate key warnings that occur when multiple error bars
            have identical coordinates (e.g., when SD = 0).
          */}
          <ErrorBar
            dataKey="errorY"
            width={styles.errorBarWidth}
            strokeWidth={styles.errorBarStrokeWidth}
            stroke="#666"
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
