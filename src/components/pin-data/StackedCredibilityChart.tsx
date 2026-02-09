"use client";

import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, LabelList } from 'recharts';
import type { AggregatedCredData } from '@/lib/edna-cred-processor';

interface StackedCredibilityChartProps {
  data: AggregatedCredData;
  fileName: string;
  customTitle?: string;
  customYAxisLabel?: string;
  gbifTrueColor?: string;
  gbifFalseColor?: string;
  width?: number | string;
  height?: number;
}

/**
 * Stacked Column Chart for eDNA Credibility Scores
 *
 * Displays species counts grouped by credibility level (Low/Moderate/High)
 * and stacked by GBIF validation status (TRUE/FALSE)
 */
export function StackedCredibilityChart({
  data,
  fileName,
  customTitle = 'Detection Credibility Score',
  customYAxisLabel = 'Species Count',
  gbifTrueColor = '#2D5F8D', // Dark blue for verified (colorblind-friendly)
  gbifFalseColor = '#7FB3D5', // Light blue for unverified (colorblind-friendly)
  width = "100%",
  height = 400
}: StackedCredibilityChartProps) {

  // Transform aggregated data into Recharts format
  const chartData = [
    {
      category: 'Low',
      'GBIF Verified': data.low_gbif_true,
      'GBIF Unverified': data.low_gbif_false
    },
    {
      category: 'Moderate',
      'GBIF Verified': data.moderate_gbif_true,
      'GBIF Unverified': data.moderate_gbif_false
    },
    {
      category: 'High',
      'GBIF Verified': data.high_gbif_true,
      'GBIF Unverified': data.high_gbif_false
    }
  ];

  console.log('[STACKED-CRED-CHART] Rendering for file:', fileName);
  console.log('[STACKED-CRED-CHART] Chart data:', chartData);
  console.log('[STACKED-CRED-CHART] Total unique species:', data.totalUniqueSpecies);

  // Custom tooltip to show detailed counts
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const verified = payload[0]?.value || 0;
      const unverified = payload[1]?.value || 0;
      const total = verified + unverified;

      return (
        <div className="bg-card border border-border rounded shadow-lg p-3">
          <p className="font-semibold text-sm mb-1">{label} Credibility</p>
          <p className="text-sm text-blue-700 dark:text-blue-400">
            <span className="inline-block w-3 h-3 mr-1 rounded" style={{ backgroundColor: gbifTrueColor }}></span>
            GBIF Verified: {verified}
          </p>
          <p className="text-sm text-orange-600 dark:text-orange-400">
            <span className="inline-block w-3 h-3 mr-1 rounded" style={{ backgroundColor: gbifFalseColor }}></span>
            GBIF Unverified: {unverified}
          </p>
          <p className="text-sm font-semibold mt-1 pt-1 border-t border-border">
            Total: {total}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="relative w-full flex flex-col items-center" style={{ height }}>
      {/* Chart Title - centered over the chart */}
      <div className="text-center pt-4 mb-4">
        <h3 className="text-lg font-semibold text-foreground">{customTitle}</h3>
      </div>

      {/* Chart and Legend Container */}
      <div className="flex items-start justify-center gap-6" style={{ height: height - 60 }}>
        {/* Chart Container - larger width */}
        <div style={{ width: '450px', height: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 20, right: 30, left: 50, bottom: 40 }}
              barCategoryGap="20%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="category"
                tick={{ fontSize: 12 }}
              />
              <YAxis
                label={{
                  value: customYAxisLabel,
                  angle: -90,
                  position: 'insideLeft',
                  offset: 20,
                  style: { fontSize: '14px', fontWeight: 'bold', textAnchor: 'middle' }
                }}
                tick={{ fontSize: 12 }}
              />
              <Tooltip content={<CustomTooltip />} />

              {/* GBIF Verified (Bottom of stack - Dark Blue) */}
              <Bar
                dataKey="GBIF Verified"
                stackId="a"
                fill={gbifTrueColor}
                radius={[0, 0, 0, 0]}
              >
                <LabelList
                  dataKey="GBIF Verified"
                  position="center"
                  formatter={(value: number) => value > 0 ? value : ''}
                  style={{ fontSize: 11, fill: '#fff', fontWeight: 600 }}
                />
              </Bar>

              {/* GBIF Unverified (Top of stack - Light Blue) */}
              <Bar
                dataKey="GBIF Unverified"
                stackId="a"
                fill={gbifFalseColor}
                radius={[4, 4, 0, 0]}
              >
                <LabelList
                  dataKey="GBIF Unverified"
                  position="center"
                  formatter={(value: number) => value > 0 ? value : ''}
                  style={{ fontSize: 11, fill: '#fff', fontWeight: 600 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Legend - positioned to the right of chart */}
        <div className="bg-card/80 border border-border rounded shadow-sm px-4 py-3 mt-8">
          <p className="text-sm font-medium text-foreground mb-3">
            Total Unique Species: {data.totalUniqueSpecies}
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-4 rounded" style={{ backgroundColor: gbifTrueColor }}></span>
              <span className="text-sm text-muted-foreground">GBIF Verified</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-4 h-4 rounded" style={{ backgroundColor: gbifFalseColor }}></span>
              <span className="text-sm text-muted-foreground">GBIF Unverified</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
