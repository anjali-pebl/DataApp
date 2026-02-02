"use client";

import React, { useMemo, useState } from 'react';
import {
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart
} from 'recharts';
import type { HaplotypeParseResult } from './csvParser';
import { calculateRarefactionCurve, getRarefactionStats } from '@/lib/rarefaction-utils';
import { fitCurve } from '@/lib/curve-fitting';

interface RarefactionChartProps {
  haplotypeData: HaplotypeParseResult;
  curveFitModel?: string;
  showFittedCurve?: boolean;
  width?: number;
  height?: number;
  chartSize?: number;
  legendXOffset?: number;
  legendYOffset?: number;
  yAxisTitleOffset?: number;
  maxYAxis?: number | null;
  showLegend?: boolean;
}

export function RarefactionChart({
  haplotypeData,
  width,
  height: initialHeight = 120,
  chartSize: propChartSize = 300,
  legendXOffset = 25,
  legendYOffset = 100,
  yAxisTitleOffset = 20,
  maxYAxis = null,
  showLegend = true
}: RarefactionChartProps) {
  const chartSize = propChartSize;

  const rarefactionCurve = useMemo(() => {
    return calculateRarefactionCurve(haplotypeData);
  }, [haplotypeData]);

  const stats = useMemo(() => {
    return getRarefactionStats(rarefactionCurve);
  }, [rarefactionCurve]);

  const curveFit = useMemo(() => {
    return fitCurve(rarefactionCurve.dataPoints, 'logarithmic');
  }, [rarefactionCurve]);

  const chartData = useMemo(() => {
    const maxSamples = stats.totalSamples;
    const extrapolationSamples = maxSamples + 6;
    const smoothPoints = 100;

    const data: Array<{
      x: number;
      y?: number;
      fitted?: number;
      fittedUpper?: number;
      fittedLower?: number;
      extrapolation?: number;
      extrapolationUpper?: number;
      extrapolationLower?: number;
      sampleName?: string;
      newSpecies?: number;
      percentage?: string;
    }> = [];

    if (curveFit) {
      const { a, b } = curveFit.parameters;

      const residuals = rarefactionCurve.dataPoints.map((point, idx) => {
        const x = idx + 1;
        const predicted = a * Math.log(x) + b;
        return point.cumulativeSpecies - predicted;
      });
      const sumSquaredResiduals = residuals.reduce((sum, r) => sum + r * r, 0);
      const standardError = Math.sqrt(sumSquaredResiduals / (rarefactionCurve.dataPoints.length - 2));

      for (let i = 0; i <= smoothPoints; i++) {
        const x = 1 + (maxSamples - 1) * i / smoothPoints;
        const fitted = a * Math.log(x) + b;

        data.push({
          x,
          fitted: Math.max(0, fitted),
          fittedUpper: fitted + standardError,
          fittedLower: fitted - standardError  // Don't clamp - let Area create proper ribbon
        });
      }

      const extrapolationPoints = 50;
      for (let i = 0; i <= extrapolationPoints; i++) {
        const x = maxSamples + (6 * i) / extrapolationPoints;
        const extrapolation = a * Math.log(x) + b;
        const extrapolationSE = standardError * 1.5;

        data.push({
          x,
          extrapolation: Math.max(0, extrapolation),
          extrapolationUpper: extrapolation + extrapolationSE,
          extrapolationLower: extrapolation - extrapolationSE  // Don't clamp - let Area create proper ribbon
        });
      }
    }

    rarefactionCurve.dataPoints.forEach(point => {
      const sampleNumber = point.sampleIndex + 1;
      const speciesCount = point.cumulativeSpecies;

      data.push({
        x: sampleNumber,
        y: speciesCount,
        sampleName: point.sampleName,
        newSpecies: point.newSpecies,
        percentage: ((speciesCount / stats.totalSpecies) * 100).toFixed(1)
      });
    });

    data.sort((a, b) => a.x - b.x);

    console.log('[RAREFACTION-CHART] Chart data with log fit and extrapolation:', data.length, 'points');
    console.log('[RAREFACTION-CHART] Curve fit R²:', curveFit?.r2.toFixed(3));
    console.log('[RAREFACTION-CHART] Extrapolation range:', maxSamples, 'to', extrapolationSamples);

    return data;
  }, [rarefactionCurve, stats.totalSpecies, stats.totalSamples, curveFit]);

  // Calculate nice tick intervals
  const getNiceInterval = (range: number): number => {
    const roughInterval = range / 5; // Aim for ~5 ticks
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughInterval)));
    const normalized = roughInterval / magnitude;

    let niceFactor;
    if (normalized <= 1) niceFactor = 1;
    else if (normalized <= 2) niceFactor = 2;
    else if (normalized <= 5) niceFactor = 5;
    else niceFactor = 10;

    return niceFactor * magnitude;
  };

  // Round to neat numbers for axis max
  const roundToNeatNumber = (value: number): number => {
    if (value <= 0) return 5;

    // Find the appropriate rounding increment based on value magnitude
    let increment: number;
    if (value <= 20) increment = 5;
    else if (value <= 50) increment = 10;
    else if (value <= 100) increment = 20;
    else if (value <= 200) increment = 50;
    else increment = 100;

    return Math.ceil(value / increment) * increment;
  };

  const xAxisInterval = useMemo(() => {
    return getNiceInterval(stats.totalSamples + 6);
  }, [stats.totalSamples]);

  // Calculate actual max Y value being used (auto or custom)
  const actualMaxY = useMemo(() => {
    const autoMax = roundToNeatNumber(Math.ceil(stats.totalSpecies) + 5);
    return maxYAxis !== null ? maxYAxis : autoMax;
  }, [stats.totalSpecies, maxYAxis]);

  const yAxisInterval = useMemo(() => {
    return getNiceInterval(actualMaxY);
  }, [actualMaxY]);

  // Generate tick arrays
  const xAxisTicks = useMemo(() => {
    const ticks = [];
    const maxX = stats.totalSamples + 7;
    for (let i = 0; i <= maxX; i += xAxisInterval) {
      ticks.push(i);
    }
    // Ensure we include the max value if it's close
    if (ticks[ticks.length - 1] < maxX - xAxisInterval / 2) {
      ticks.push(Math.ceil(maxX / xAxisInterval) * xAxisInterval);
    }
    return ticks;
  }, [stats.totalSamples, xAxisInterval]);

  const yAxisTicks = useMemo(() => {
    const ticks = [];
    for (let i = 0; i <= actualMaxY; i += yAxisInterval) {
      ticks.push(i);
    }
    // Ensure we include the max value if it's close
    if (ticks[ticks.length - 1] < actualMaxY - yAxisInterval / 2) {
      ticks.push(Math.ceil(actualMaxY / yAxisInterval) * yAxisInterval);
    }
    return ticks;
  }, [actualMaxY, yAxisInterval]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length > 0) {
      const data = payload[0].payload;
      return (
        <div className="bg-white border border-gray-300 rounded-md p-3 shadow-lg">
          <p className="font-semibold text-sm">{data.sampleName}</p>
          <p className="text-sm text-gray-700">
            Sample: <span className="font-medium">{data.x}</span>
          </p>
          <p className="text-sm text-gray-700">
            Cumulative species: <span className="font-medium">{data.y}</span>
          </p>
          <p className="text-sm text-gray-700">
            New species: <span className="font-medium">{data.newSpecies}</span>
          </p>
          <p className="text-sm text-gray-700">
            Discovery: <span className="font-medium">{data.percentage}%</span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full flex flex-col items-center">
      <div style={{ width: `${chartSize}px`, height: `${chartSize}px`, position: 'relative' }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: 20, left: 15, bottom: 40 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" opacity={0} />
            <XAxis
              dataKey="x"
              type="number"
              domain={[0, stats.totalSamples + 7]}
              ticks={xAxisTicks}
              allowDecimals={false}
              label={{
                value: 'Samples',
                position: 'insideBottom',
                offset: -10,
                style: { fontSize: 11, fontWeight: 500, fill: '#374151' }
              }}
              tick={{ fontSize: 11, fill: '#6b7280' }}
              stroke="#9ca3af"
            />
            <YAxis
              domain={[0, actualMaxY]}
              ticks={yAxisTicks}
              label={{
                value: 'Species',
                angle: -90,
                position: 'insideLeft',
                offset: yAxisTitleOffset,
                style: { fontSize: 11, fontWeight: 500, fill: '#374151', textAnchor: 'middle' }
              }}
              tick={{ fontSize: 11, fill: '#6b7280' }}
              stroke="#9ca3af"
            />
            <Tooltip content={<CustomTooltip />} />

            <Area
              type="monotone"
              dataKey="fittedUpper"
              stroke="none"
              fill="#228833"
              fillOpacity={0.2}
              isAnimationActive={false}
              connectNulls={true}
              legendType="none"
              baseLine="fittedLower"
            />

            <Area
              type="monotone"
              dataKey="extrapolationUpper"
              stroke="none"
              fill="#CCBB44"
              fillOpacity={0.15}
              isAnimationActive={false}
              connectNulls={true}
              legendType="none"
              baseLine="extrapolationLower"
            />

            <Line
              name="Log Fit"
              type="monotone"
              dataKey="fitted"
              stroke="#228833"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls={true}
            />

            <Line
              name="Extrapolation"
              type="monotone"
              dataKey="extrapolation"
              stroke="#CCBB44"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              isAnimationActive={false}
              connectNulls={true}
            />

            <Line
              name="Observed"
              dataKey="y"
              stroke="none"
              dot={{ fill: '#4477AA', r: 4 }}
              activeDot={{ r: 6 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>

        {showLegend && (
          <div style={{
            position: 'absolute',
            top: `${legendYOffset}px`,
            right: `${legendXOffset}px`,
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            padding: '8px 10px',
            fontSize: '11px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            zIndex: 10
          }}>
            <div style={{ fontWeight: 600, marginBottom: '6px', color: '#374151' }}>Legend</div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
              <div style={{ width: '16px', height: '3px', backgroundColor: '#4477AA', marginRight: '6px' }}></div>
              <span style={{ color: '#374151' }}>Observed</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
              <div style={{ width: '16px', height: '3px', backgroundColor: '#228833', marginRight: '6px' }}></div>
              <span style={{ color: '#374151' }}>Log Fit</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ width: '16px', height: '3px', backgroundColor: '#CCBB44', marginRight: '6px', backgroundImage: 'linear-gradient(to right, #CCBB44 50%, transparent 50%)', backgroundSize: '8px 3px' }}></div>
              <span style={{ color: '#374151' }}>Extrapolation</span>
            </div>
          </div>
        )}
      </div>

      <details open className="border rounded p-2 mt-2">
        <summary className="cursor-pointer font-medium text-xs">
          View Sample Details ({rarefactionCurve.dataPoints.length} samples)
        </summary>
        <div className="mt-2 max-h-48 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-100 sticky top-0">
              <tr>
                <th className="text-left p-1 text-xs">#</th>
                <th className="text-left p-1 text-xs">Sample Name</th>
                <th className="text-right p-1 text-xs">New Species</th>
                <th className="text-right p-1 text-xs">Cumulative</th>
                <th className="text-right p-1 text-xs">% Discovered</th>
              </tr>
            </thead>
            <tbody>
              {rarefactionCurve.dataPoints.map((point, idx) => (
                <tr key={idx} className="border-t hover:bg-gray-50">
                  <td className="p-1 text-xs">{idx + 1}</td>
                  <td className="p-1 font-mono text-xs">{point.sampleName}</td>
                  <td className="text-right p-1 text-xs">
                    {point.newSpecies > 0 ? (
                      <span className="text-green-700 font-medium">+{point.newSpecies}</span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="text-right p-1 font-medium text-xs">{point.cumulativeSpecies}</td>
                  <td className="text-right p-1 text-gray-600 text-xs">
                    {((point.cumulativeSpecies / stats.totalSpecies) * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
