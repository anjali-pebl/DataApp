"use client";

import React from 'react';
import type { SpotSampleGroup } from '@/lib/statistical-utils';

interface SpotSampleStyles {
  barGap?: number;
  barCategoryGap?: number;
  columnBorderWidth?: number;
  whiskerBoxWidth?: number;
  whiskerSpacing?: number; // Gap between whisker plot centers
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
  xAxisLabelSecondLineOffset?: number;
  xAxisShowDate?: boolean;
  xAxisShowStationName?: boolean;
  xAxisShowSampleId?: boolean;
  yAxisLabel?: string; // Custom Y-axis label (overrides parameter name)
  yAxisLabelFontSize?: number;
  yAxisTitleFontSize?: number;
  yAxisTitleFontWeight?: number | string;
  yAxisTitleAlign?: 'left' | 'center' | 'right';
  yAxisTitleOffset?: number;
  chartHeight?: number;
  chartWidth?: number; // Fixed chart width override
  chartTitle?: string; // Custom chart title
}

interface WhiskerPlotProps {
  data: SpotSampleGroup[];
  parameter: string;
  sampleIdColors: Record<string, string>;
  width?: number | string;
  height?: number;
  showXAxisLabels?: boolean;
  spotSampleStyles?: SpotSampleStyles;
  yAxisRange?: { min?: number; max?: number };
  showDateSeparators?: boolean; // Show vertical lines between different sampling days (only in Detailed mode)
}

/**
 * Whisker Plot (Box Plot) for spot-sample data using SVG
 * Displays min, Q1, median, Q3, max
 * Single value samples show as single dot
 */
export function WhiskerPlot({
  data,
  parameter,
  sampleIdColors,
  width = "100%",
  height = 400,
  showXAxisLabels = true,
  spotSampleStyles,
  yAxisRange,
  showDateSeparators = false
}: WhiskerPlotProps) {

  // Helper function to capitalize first letter of parameter names
  // Converts "length (cm)" -> "Length (cm)", "width (cm)" -> "Width (cm)"
  const capitalizeParameter = (param: string): string => {
    return param.charAt(0).toUpperCase() + param.slice(1);
  };

  // Extract styling properties with defaults
  const baseYAxisLabelFontSize = spotSampleStyles?.yAxisLabelFontSize ?? 12;
  const styles = {
    chartMarginTop: spotSampleStyles?.chartMarginTop ?? 20,
    chartMarginRight: spotSampleStyles?.chartMarginRight ?? 30,
    chartMarginLeft: spotSampleStyles?.chartMarginLeft ?? 60,
    chartMarginBottom: spotSampleStyles?.chartMarginBottom ?? (showXAxisLabels ? 140 : 40),
    xAxisLabelRotation: spotSampleStyles?.xAxisLabelRotation ?? -45,
    xAxisLabelFontSize: spotSampleStyles?.xAxisLabelFontSize ?? 11,
    xAxisLabelSecondLineOffset: spotSampleStyles?.xAxisLabelSecondLineOffset ?? 0,
    xAxisShowDate: spotSampleStyles?.xAxisShowDate ?? true,
    xAxisShowStationName: spotSampleStyles?.xAxisShowStationName ?? true,
    xAxisShowSampleId: spotSampleStyles?.xAxisShowSampleId ?? true,
    yAxisLabelFontSize: baseYAxisLabelFontSize,
    yAxisTitleFontSize: spotSampleStyles?.yAxisTitleFontSize ?? (baseYAxisLabelFontSize + 2), // Title is 2px larger than labels
    yAxisTitleFontWeight: spotSampleStyles?.yAxisTitleFontWeight ?? 'normal',
    yAxisTitleAlign: spotSampleStyles?.yAxisTitleAlign ?? 'center',
    yAxisTitleOffset: spotSampleStyles?.yAxisTitleOffset ?? 40,
    chartHeight: spotSampleStyles?.chartHeight ?? 350,
    chartWidth: spotSampleStyles?.chartWidth,
    whiskerBoxWidth: spotSampleStyles?.whiskerBoxWidth ?? 40,
    whiskerLineWidth: spotSampleStyles?.whiskerLineWidth ?? 2,
    whiskerBoxBorderWidth: spotSampleStyles?.whiskerBoxBorderWidth ?? 2,
    whiskerCapWidth: spotSampleStyles?.whiskerCapWidth ?? 20
  };

  console.log('[WHISKER-PLOT] Rendering whisker plot for parameter:', parameter);
  console.log('[WHISKER-PLOT] Total data groups:', data.length);
  console.log('[WHISKER-PLOT] Sample ID colors:', sampleIdColors);
  console.log('[WHISKER-PLOT] Applied styles:', styles);

  // Filter data for this parameter
  const parameterData = data.filter(d => d.parameter === parameter);

  console.log('[WHISKER-PLOT] Filtered data for this parameter:', parameterData.length);

  if (parameterData.length === 0) {
    console.log('[WHISKER-PLOT] No data for parameter:', parameter);
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No data available for {parameter}
      </div>
    );
  }

  // Helper function to calculate nice round tick values
  const calculateNiceTicks = (maxValue: number, minTicks = 6): number[] => {
    // Add minimal padding (2%) to ensure whisker caps aren't cut off
    const targetMax = maxValue * 1.02;

    // Calculate rough step size for desired number of ticks
    const roughStep = targetMax / (minTicks - 1);

    // Find the magnitude (power of 10)
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));

    // Normalize the step to 1, 2, 4, 5, or 10 times the magnitude for more granular options
    const normalizedStep = roughStep / magnitude;
    let niceStep: number;

    if (normalizedStep <= 1) {
      niceStep = 1 * magnitude;
    } else if (normalizedStep <= 2) {
      niceStep = 2 * magnitude;
    } else if (normalizedStep <= 4) {
      niceStep = 4 * magnitude;
    } else if (normalizedStep <= 5) {
      niceStep = 5 * magnitude;
    } else {
      niceStep = 10 * magnitude;
    }

    // Generate ticks starting from 0
    const ticks: number[] = [0];
    let tick = niceStep;
    while (tick <= targetMax) {
      ticks.push(tick);
      tick += niceStep;
    }

    // Only add one more tick if we're significantly below targetMax
    // This prevents huge gaps while ensuring data fits
    if (ticks[ticks.length - 1] < targetMax) {
      ticks.push(tick);
    }

    // Ensure we have at least minTicks
    while (ticks.length < minTicks) {
      const lastTick = ticks[ticks.length - 1];
      ticks.push(lastTick + niceStep);
    }

    return ticks;
  };

  // Calculate Y-axis domain
  const allValues = parameterData.flatMap(d => [d.stats.min, d.stats.max]).filter(v => !isNaN(v) && isFinite(v));
  const dataMax = allValues.length > 0 ? Math.max(...allValues) : 1;
  const dataMin = allValues.length > 0 ? Math.min(...allValues) : 0;

  // Helper to calculate nice round tick values for a range
  const calculateNiceRange = (minVal: number, maxVal: number, minTicks = 6): { min: number; max: number; ticks: number[] } => {
    const range = maxVal - minVal;
    // Add 10% padding to the range
    const padding = range * 0.1;
    const paddedMin = minVal - padding;
    const paddedMax = maxVal + padding;

    // Calculate step size
    const roughStep = (paddedMax - paddedMin) / (minTicks - 1);
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const normalizedStep = roughStep / magnitude;

    let niceStep: number;
    if (normalizedStep <= 1) niceStep = 1 * magnitude;
    else if (normalizedStep <= 2) niceStep = 2 * magnitude;
    else if (normalizedStep <= 5) niceStep = 5 * magnitude;
    else niceStep = 10 * magnitude;

    // Round min down and max up to nice values
    const niceMin = Math.max(0, Math.floor(paddedMin / niceStep) * niceStep); // Never go below 0
    const niceMax = Math.ceil(paddedMax / niceStep) * niceStep;

    // Generate ticks
    const ticks: number[] = [];
    for (let tick = niceMin; tick <= niceMax + niceStep * 0.5; tick += niceStep) {
      ticks.push(Math.round(tick * 1000) / 1000); // Avoid floating point issues
    }

    return { min: niceMin, max: niceMax, ticks };
  };

  // Use custom range if provided, otherwise calculate from data
  let yMin: number;
  let yMax: number;
  let yTicks: number[];

  if (yAxisRange?.min !== undefined || yAxisRange?.max !== undefined) {
    // Custom range provided
    yMin = yAxisRange.min !== undefined ? Math.max(0, yAxisRange.min) : Math.max(0, dataMin);
    const customMax = yAxisRange.max !== undefined ? yAxisRange.max : dataMax;
    yTicks = calculateNiceTicks(customMax, 8);
    yMax = yAxisRange.max !== undefined ? yAxisRange.max : yTicks[yTicks.length - 1];
  } else {
    // Auto-calculate from data - use data-responsive range
    const niceRange = calculateNiceRange(dataMin, dataMax, 8);
    yMin = niceRange.min;
    yMax = niceRange.max;
    yTicks = niceRange.ticks;
  }

  const yRange = yMax - yMin;

  // Chart dimensions
  const chartHeight = styles.chartHeight;
  // Add extra top margin when showDateSeparators is true to accommodate date labels
  const dateLabelsTopMargin = showDateSeparators ? 20 : 0;
  const margin = {
    top: styles.chartMarginTop + dateLabelsTopMargin,
    right: styles.chartMarginRight,
    bottom: styles.chartMarginBottom,
    left: styles.chartMarginLeft
  };

  // Calculate spacing and width
  let spacing: number;
  let plotWidth: number;
  let chartWidth: number;

  if (styles.chartWidth) {
    // Fixed chart width: calculate spacing to fit all whiskers
    chartWidth = styles.chartWidth;
    plotWidth = chartWidth - margin.left - margin.right;
    spacing = plotWidth / parameterData.length;
  } else {
    // Auto width: use whiskerSpacing setting
    spacing = styles.whiskerSpacing ?? 80;
    plotWidth = spacing * parameterData.length;
    chartWidth = plotWidth + margin.left + margin.right;
  }

  const plotHeight = chartHeight - margin.top - margin.bottom;

  // Scale functions - no padding, start at 0
  const scaleY = (value: number) => {
    const normalized = (value - yMin) / yRange;
    return plotHeight - (normalized * plotHeight);
  };

  // Use direct box width from styles
  const boxWidth = styles.whiskerBoxWidth;

  // Calculate whisker cap width based on percentage of box width
  const whiskerCapWidthPercent = styles.whiskerCapWidth / 100;

  console.log('[WHISKER-PLOT] 📏 Whisker dimensions:');
  console.log('  - whiskerBoxWidth:', boxWidth, 'px (directly set)');
  console.log('  - whiskerSpacing:', spacing, 'px', styles.chartWidth ? '(auto-calculated to fit)' : '(from settings)');
  console.log('  - whiskerLineWidth:', styles.whiskerLineWidth, 'px');
  console.log('  - whiskerBoxBorderWidth:', styles.whiskerBoxBorderWidth, 'px');
  console.log('  - whiskerCapWidth:', styles.whiskerCapWidth, '% of box width');
  console.log('  - number of boxes:', parameterData.length);
  console.log('[WHISKER-PLOT] 📊 Y-axis:');
  console.log('  - Y min:', yMin, '(data-responsive, never below 0)');
  console.log('  - Y max:', yMax);
  console.log('  - Y ticks:', yTicks);
  console.log('  - Data max:', dataMax);
  console.log('[WHISKER-PLOT] 📐 Plot dimensions:');
  console.log('  - Chart width mode:', styles.chartWidth ? `Fixed (${styles.chartWidth}px)` : 'Auto');
  console.log('  - Plot width:', plotWidth, 'px');
  console.log('  - Total chart width:', chartWidth, 'px');

  // Calculate date groups for top labels (when showDateSeparators is true)
  const dateGroups = React.useMemo(() => {
    if (!showDateSeparators) return [];

    const groups: Array<{ date: string; startIndex: number; endIndex: number; centerX: number; displayDate: string }> = [];
    let currentDate = parameterData[0]?.date;
    let startIndex = 0;

    parameterData.forEach((group, index) => {
      if (group.date !== currentDate || index === parameterData.length - 1) {
        // End of current group (or last item)
        const endIndex = group.date !== currentDate ? index - 1 : index;
        const actualEndIndex = group.date !== currentDate ? index - 1 : index;

        // Calculate center position of the group
        const startX = spacing * startIndex + spacing / 2;
        const endX = spacing * actualEndIndex + spacing / 2;
        const centerX = (startX + endX) / 2;

        // Format the date for display (extract from xAxisLabel)
        const firstGroupItem = parameterData[startIndex];
        const labelParts = firstGroupItem.xAxisLabel.match(/^(.+?)\s+\[/);
        const displayDate = labelParts ? labelParts[1] : currentDate;

        groups.push({
          date: currentDate,
          startIndex,
          endIndex: actualEndIndex,
          centerX,
          displayDate
        });

        // Start new group
        if (group.date !== currentDate) {
          currentDate = group.date;
          startIndex = index;
        }
      }
    });

    // Handle last group if not already added
    if (groups.length === 0 || groups[groups.length - 1].date !== currentDate) {
      const startX = spacing * startIndex + spacing / 2;
      const endX = spacing * (parameterData.length - 1) + spacing / 2;
      const centerX = (startX + endX) / 2;

      const firstGroupItem = parameterData[startIndex];
      const labelParts = firstGroupItem?.xAxisLabel.match(/^(.+?)\s+\[/);
      const displayDate = labelParts ? labelParts[1] : currentDate;

      groups.push({
        date: currentDate,
        startIndex,
        endIndex: parameterData.length - 1,
        centerX,
        displayDate
      });
    }

    return groups;
  }, [parameterData, spacing, showDateSeparators]);

  // Tooltip state
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = React.useState({ x: 0, y: 0 });

  const handleMouseEnter = (index: number, event: React.MouseEvent) => {
    setHoveredIndex(index);
    setTooltipPos({ x: event.clientX, y: event.clientY });
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
  };

  return (
    <div className="relative w-full">
      <svg width="100%" height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet">
        {/* Background */}
        <rect width={chartWidth} height={chartHeight} fill="transparent" />

        {/* Chart area */}
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* Grid lines and Y-axis ticks */}
          {yTicks.map((tickValue) => {
            const y = scaleY(tickValue);
            // Format tick value - show as integer if whole number, otherwise show decimal
            const formattedValue = tickValue % 1 === 0 ? tickValue.toString() : tickValue.toFixed(1);
            return (
              <g key={tickValue}>
                <line
                  x1={0}
                  y1={y}
                  x2={plotWidth}
                  y2={y}
                  stroke="#e0e0e0"
                  strokeDasharray="3 3"
                />
                <text
                  x={-10}
                  y={y}
                  textAnchor="end"
                  fontSize={styles.yAxisLabelFontSize}
                  fill="#666"
                  dominantBaseline="middle"
                >
                  {formattedValue}
                </text>
              </g>
            );
          })}

          {/* Left Y-axis vertical line */}
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={plotHeight}
            stroke="#666"
            strokeWidth={1}
          />

          {/* Right Y-axis vertical line */}
          <line
            x1={plotWidth}
            y1={0}
            x2={plotWidth}
            y2={plotHeight}
            stroke="#666"
            strokeWidth={1}
          />

          {/* Top horizontal line */}
          <line
            x1={0}
            y1={0}
            x2={plotWidth}
            y2={0}
            stroke="#666"
            strokeWidth={1}
          />

          {/* Date group labels at top of chart (only when showDateSeparators is true) */}
          {showDateSeparators && (() => {
            // Scale font size to avoid overlap while showing all labels
            const defaultFontSize = styles.xAxisLabelFontSize + 1;
            const minFontSize = 8; // Minimum readable font size
            const charWidth = 0.6; // Approximate character width as fraction of font size
            const minSpacing = 5; // Minimum spacing between labels in pixels

            // Find minimum distance between adjacent labels
            let minDistance = Infinity;
            for (let i = 1; i < dateGroups.length; i++) {
              const distance = dateGroups[i].centerX - dateGroups[i - 1].centerX;
              if (distance < minDistance) minDistance = distance;
            }

            // Calculate font size that fits all labels
            // Label width ≈ fontSize * charWidth * numChars (date format "DD/MM/YY" = 8 chars)
            const numChars = 8;
            const maxLabelWidth = minDistance - minSpacing;
            const calculatedFontSize = maxLabelWidth / (charWidth * numChars);
            const fontSize = Math.max(minFontSize, Math.min(defaultFontSize, calculatedFontSize));

            return dateGroups.map((group, index) => (
              <text
                key={`date-label-${index}`}
                x={group.centerX}
                y={-8}
                textAnchor="middle"
                fontSize={fontSize}
                fill="#374151"
                fontWeight={600}
              >
                {group.displayDate}
              </text>
            ));
          })()}

          {/* Y-axis label */}
          <text
            x={0}
            y={0}
            transform={`translate(${-styles.yAxisTitleOffset}, ${plotHeight / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={styles.yAxisTitleFontSize}
            fill="#666"
            fontWeight={styles.yAxisTitleFontWeight}
          >
            {spotSampleStyles?.yAxisLabel || capitalizeParameter(parameter)}
          </text>

          {/* Date group separator lines - vertical lines between different sampling days (only in Detailed mode) */}
          {showDateSeparators && parameterData.map((group, index) => {
            // Skip first item - no separator needed before it
            if (index === 0) return null;

            const prevGroup = parameterData[index - 1];
            // Only draw separator when date changes
            if (group.date === prevGroup.date) return null;

            // Position the line between the previous and current boxplot
            const separatorX = spacing * index;

            return (
              <line
                key={`date-sep-${index}`}
                x1={separatorX}
                y1={0}
                x2={separatorX}
                y2={plotHeight}
                stroke="#94a3b8"
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={0.7}
              />
            );
          })}

          {/* Box plots */}
          {parameterData.map((group, index) => {
            const x = spacing * index + spacing / 2;
            const color = sampleIdColors[group.sampleId] || '#3b82f6';
            // Create unique key from group properties
            const uniqueKey = `${group.date}-${group.sampleId}-${group.bladeId || 'no-blade'}-${index}`;

            // Single value - draw dot
            if (group.count === 1) {
              const dotY = scaleY(group.stats.median);
              return (
                <g
                  key={uniqueKey}
                  onMouseEnter={(e) => handleMouseEnter(index, e as any)}
                  onMouseLeave={handleMouseLeave}
                  style={{ cursor: 'pointer' }}
                >
                  <circle
                    cx={x}
                    cy={dotY}
                    r={6}
                    fill={color}
                    stroke={color}
                    strokeWidth={styles.whiskerBoxBorderWidth}
                    opacity={hoveredIndex === index ? 1 : 0.8}
                  />
                </g>
              );
            }

            // Box plot
            const minY = scaleY(group.stats.min);
            const q1Y = scaleY(group.stats.Q1);
            const medianY = scaleY(group.stats.median);
            const q3Y = scaleY(group.stats.Q3);
            const maxY = scaleY(group.stats.max);

            return (
              <g
                key={uniqueKey}
                onMouseEnter={(e) => handleMouseEnter(index, e as any)}
                onMouseLeave={handleMouseLeave}
                style={{ cursor: 'pointer' }}
              >
                {/* Upper whisker */}
                <line
                  x1={x}
                  y1={maxY}
                  x2={x}
                  y2={q3Y}
                  stroke={color}
                  strokeWidth={styles.whiskerLineWidth}
                />
                {/* Upper whisker cap */}
                <line
                  x1={x - boxWidth * whiskerCapWidthPercent}
                  y1={maxY}
                  x2={x + boxWidth * whiskerCapWidthPercent}
                  y2={maxY}
                  stroke={color}
                  strokeWidth={styles.whiskerLineWidth}
                />

                {/* Box */}
                <rect
                  x={x - boxWidth / 2}
                  y={q3Y}
                  width={boxWidth}
                  height={q1Y - q3Y}
                  fill={`${color}40`}
                  stroke={color}
                  strokeWidth={styles.whiskerBoxBorderWidth}
                  opacity={hoveredIndex === index ? 1 : 0.8}
                />

                {/* Median line */}
                <line
                  x1={x - boxWidth / 2}
                  y1={medianY}
                  x2={x + boxWidth / 2}
                  y2={medianY}
                  stroke={color}
                  strokeWidth={styles.whiskerBoxBorderWidth + 1}
                />

                {/* Lower whisker */}
                <line
                  x1={x}
                  y1={q1Y}
                  x2={x}
                  y2={minY}
                  stroke={color}
                  strokeWidth={styles.whiskerLineWidth}
                />
                {/* Lower whisker cap */}
                <line
                  x1={x - boxWidth * whiskerCapWidthPercent}
                  y1={minY}
                  x2={x + boxWidth * whiskerCapWidthPercent}
                  y2={minY}
                  stroke={color}
                  strokeWidth={styles.whiskerLineWidth}
                />
              </g>
            );
          })}

          {/* X-axis */}
          <line
            x1={0}
            y1={plotHeight}
            x2={plotWidth}
            y2={plotHeight}
            stroke="#666"
            strokeWidth={1}
          />

          {/* X-axis labels */}
          {showXAxisLabels && parameterData.map((group, index) => {
            const x = spacing * index + spacing / 2;
            // Create unique key from group properties
            const uniqueKey = `label-${group.date}-${group.sampleId}-${group.bladeId || 'no-blade'}-${index}`;

            // Split label into date and sample info
            // Format: "DD/MM/YY [Station-Name Sample-ID]" or "DD/MM/YY [Sample-ID]"
            const labelParts = group.xAxisLabel.match(/^(.+?)\s+\[(.+?)\]$/);
            const dateLabel = labelParts ? labelParts[1] : group.xAxisLabel;
            const bracketContent = labelParts ? labelParts[2] : '';

            // Try to split bracket content into station name and sample ID
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
            if (labelLineMode === 'single') {
              // Single line mode: show all enabled components on one line
              const labelComponents: string[] = [];
              // Skip date in x-axis labels when showDateSeparators is true (date shown at top)
              if (styles.xAxisShowDate && dateLabel && !showDateSeparators) {
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
                <g key={uniqueKey}>
                  <text
                    x={x}
                    y={plotHeight + 15}
                    textAnchor="end"
                    fontSize={styles.xAxisLabelFontSize}
                    fill={displayText === '-' ? '#999' : '#666'}
                    transform={`rotate(${styles.xAxisLabelRotation}, ${x}, ${plotHeight + 15})`}
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
              // Skip date when showDateSeparators is true (date shown at top of chart)
              line1Components.forEach(comp => {
                const value = componentMap[comp];
                if (value) {
                  if (comp === 'date' && (!styles.xAxisShowDate || showDateSeparators)) return;
                  if (comp === 'station' && !styles.xAxisShowStationName) return;
                  if (comp === 'sample' && !styles.xAxisShowSampleId) return;
                  line1Parts.push(value);
                }
              });

              // Build line 2 from assigned components (respecting visibility toggles)
              // Skip date when showDateSeparators is true (date shown at top of chart)
              line2Components.forEach(comp => {
                const value = componentMap[comp];
                if (value) {
                  if (comp === 'date' && (!styles.xAxisShowDate || showDateSeparators)) return;
                  if (comp === 'station' && !styles.xAxisShowStationName) return;
                  if (comp === 'sample' && !styles.xAxisShowSampleId) return;
                  line2Parts.push(value);
                }
              });

              const firstLine = line1Parts.join(' ');
              const secondLine = line2Parts.join(' ');

              const secondLineOffset = styles.xAxisLabelSecondLineOffset || 0;
              const secondLineX = x + secondLineOffset;
              const secondLineY = plotHeight + 15 + styles.xAxisLabelFontSize + 2;

              return (
                <g key={uniqueKey}>
                  {/* First line */}
                  {firstLine && (
                    <text
                      x={x}
                      y={plotHeight + 15}
                      textAnchor="end"
                      fontSize={styles.xAxisLabelFontSize}
                      fill="#666"
                      transform={`rotate(${styles.xAxisLabelRotation}, ${x}, ${plotHeight + 15})`}
                    >
                      {firstLine}
                    </text>
                  )}
                  {/* Second line */}
                  {secondLine && (
                    <text
                      x={secondLineX}
                      y={secondLineY}
                      textAnchor="end"
                      fontSize={styles.xAxisLabelFontSize}
                      fill="#666"
                      transform={`rotate(${styles.xAxisLabelRotation}, ${secondLineX}, ${secondLineY})`}
                    >
                      {secondLine}
                    </text>
                  )}
                  {/* Placeholder if nothing to show */}
                  {!firstLine && !secondLine && (
                    <text
                      x={x}
                      y={plotHeight + 15}
                      textAnchor="end"
                      fontSize={styles.xAxisLabelFontSize}
                      fill="#999"
                      transform={`rotate(${styles.xAxisLabelRotation}, ${x}, ${plotHeight + 15})`}
                    >
                      -
                    </text>
                  )}
                </g>
              );
            }
          })}
        </g>
      </svg>

      {/* Tooltip */}
      {hoveredIndex !== null && (
        <div
          className="fixed bg-background border border-border rounded-lg p-3 shadow-lg z-50 pointer-events-none"
          style={{
            left: tooltipPos.x + 10,
            top: tooltipPos.y + 10
          }}
        >
          <p className="font-semibold text-sm mb-2">{parameterData[hoveredIndex].xAxisLabel}</p>
          <p className="text-xs mb-1">
            <span className="text-muted-foreground">Sample ID:</span>{' '}
            <span className="font-medium">{parameterData[hoveredIndex].sampleId}</span>
          </p>

          {parameterData[hoveredIndex].count > 1 ? (
            <>
              <p className="text-xs mb-1">
                <span className="text-muted-foreground">Max:</span>{' '}
                <span className="font-medium">{parameterData[hoveredIndex].stats.max.toFixed(2)}</span>
              </p>
              <p className="text-xs mb-1">
                <span className="text-muted-foreground">Q3:</span>{' '}
                <span className="font-medium">{parameterData[hoveredIndex].stats.Q3.toFixed(2)}</span>
              </p>
              <p className="text-xs mb-1">
                <span className="text-muted-foreground">Median:</span>{' '}
                <span className="font-medium">{parameterData[hoveredIndex].stats.median.toFixed(2)}</span>
              </p>
              <p className="text-xs mb-1">
                <span className="text-muted-foreground">Q1:</span>{' '}
                <span className="font-medium">{parameterData[hoveredIndex].stats.Q1.toFixed(2)}</span>
              </p>
              <p className="text-xs mb-1">
                <span className="text-muted-foreground">Min:</span>{' '}
                <span className="font-medium">{parameterData[hoveredIndex].stats.min.toFixed(2)}</span>
              </p>
              <p className="text-xs">
                <span className="text-muted-foreground">n =</span>{' '}
                <span className="font-medium">{parameterData[hoveredIndex].count}</span>
              </p>
            </>
          ) : (
            <>
              <p className="text-xs mb-1">
                <span className="text-muted-foreground">Value:</span>{' '}
                <span className="font-medium">{parameterData[hoveredIndex].stats.median.toFixed(2)}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Single measurement
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
