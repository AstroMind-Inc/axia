"use client";

import React from 'react';
import { LightCurveData, RegionOfInterest } from '@/app/types/chat';

interface LightCurveChartProps {
  lightCurveData: LightCurveData;
  theme?: 'light' | 'dark';
}

export const LightCurveChart: React.FC<LightCurveChartProps> = ({ 
  lightCurveData, 
  theme = 'light' 
}) => {
  const { energy_spectrum, regions_of_interest, statistics } = lightCurveData;

  // Calculate chart dimensions and scaling
  const chartWidth = 800;
  const chartHeight = 400;
  const padding = 60;
  const plotWidth = chartWidth - 2 * padding;
  const plotHeight = chartHeight - 2 * padding;

  // Find max values for scaling
  const maxEnergy = Math.max(...energy_spectrum.map(d => d.energy_max));
  const minEnergy = Math.min(...energy_spectrum.map(d => d.energy_min));
  const maxCount = Math.max(...energy_spectrum.map(d => d.count));

  // Scaling functions
  const xScale = (energy: number) => padding + ((energy - minEnergy) / (maxEnergy - minEnergy)) * plotWidth;
  const yScale = (count: number) => chartHeight - padding - (count / maxCount) * plotHeight;

  // Generate path for spectrum line
  const spectrumPath = energy_spectrum
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(d.energy)} ${yScale(d.count)}`)
    .join(' ');

  // Color scheme based on theme
  const colors = theme === 'dark' ? {
    background: '#1a1a1a',
    text: '#ffffff',
    grid: '#333333',
    spectrum: '#00e0ff',
    regionHigh: '#ff6b6b',
    regionModerate: '#ffd93d',
    regionLow: '#6bcf7f',
    regionNone: '#606060',
    regionBg: 'rgba(255, 255, 255, 0.1)'
  } : {
    background: '#ffffff',
    text: '#333333',
    grid: '#e0e0e0',
    spectrum: '#2563eb',
    regionHigh: '#dc2626',
    regionModerate: '#f59e0b',
    regionLow: '#16a34a',
    regionNone: '#9ca3af',
    regionBg: 'rgba(0, 0, 0, 0.05)'
  };

  const getRegionColor = (significance: string) => {
    switch (significance) {
      case 'high': return colors.regionHigh;
      case 'moderate': return colors.regionModerate;
      case 'low': return colors.regionLow;
      case 'none': return colors.regionNone;
      default: return colors.regionNone;
    }
  };

  return (
    <div className="w-full">
      <div className="mb-4">
        <h3 className={`text-lg font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>
          Energy Spectrum
        </h3>
        <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
          Total Events: {statistics.total_events} | 
          Energy Range: {statistics.energy_range.min.toFixed(2)} - {statistics.energy_range.max.toFixed(2)} keV | 
          Mean Energy: {statistics.mean_energy.toFixed(2)} keV
        </p>
      </div>

      <div className="relative">
        <svg 
          width={chartWidth} 
          height={chartHeight}
          className="border rounded"
          style={{ backgroundColor: colors.background }}
        >
          {/* Grid lines */}
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path 
                d="M 40 0 L 0 0 0 40" 
                fill="none" 
                stroke={colors.grid} 
                strokeWidth="1"
                opacity="0.3"
              />
            </pattern>
          </defs>
          <rect width={plotWidth} height={plotHeight} x={padding} y={padding} fill="url(#grid)" />

          {/* Regions of Interest backgrounds */}
          {regions_of_interest.map((region, index) => (
            <g key={`region-${index}-${region.name}`}>
              <rect
                x={xScale(region.energy_min)}
                y={padding}
                width={xScale(region.energy_max) - xScale(region.energy_min)}
                height={plotHeight}
                fill={getRegionColor(region.significance)}
                opacity="0.2"
              />
              <text
                x={xScale(region.energy_center)}
                y={padding + 20}
                textAnchor="middle"
                fontSize="10"
                fill={getRegionColor(region.significance)}
                fontWeight={region.significance === 'none' ? 'normal' : 'bold'}
                opacity={region.significance === 'none' ? 0.6 : 1}
              >
                {region.name.split('_')[0]}
              </text>
              <text
                x={xScale(region.energy_center)}
                y={padding + 35}
                textAnchor="middle"
                fontSize="9"
                fill={colors.text}
                opacity={region.significance === 'none' ? 0.5 : 0.8}
              >
                {region.count === 0 ? 'No events' : `${region.count} counts`}
              </text>
            </g>
          ))}

          {/* Spectrum line */}
          <path
            d={spectrumPath}
            fill="none"
            stroke={colors.spectrum}
            strokeWidth="2"
          />

          {/* Data points */}
          {energy_spectrum.filter(d => d.count > 0).map((d, index) => (
            <circle
              key={`data-point-${index}-${d.energy}`}
              cx={xScale(d.energy)}
              cy={yScale(d.count)}
              r="3"
              fill={colors.spectrum}
            />
          ))}

          {/* X-axis */}
          <line
            x1={padding}
            y1={chartHeight - padding}
            x2={chartWidth - padding}
            y2={chartHeight - padding}
            stroke={colors.text}
            strokeWidth="2"
          />

          {/* Y-axis */}
          <line
            x1={padding}
            y1={padding}
            x2={padding}
            y2={chartHeight - padding}
            stroke={colors.text}
            strokeWidth="2"
          />

          {/* X-axis labels */}
          {[0, 2, 4, 6, 8, 10].map((energy, index) => {
            if (energy >= minEnergy && energy <= maxEnergy) {
              return (
                <g key={`x-axis-${index}`}>
                  <line
                    x1={xScale(energy)}
                    y1={chartHeight - padding}
                    x2={xScale(energy)}
                    y2={chartHeight - padding + 5}
                    stroke={colors.text}
                  />
                  <text
                    x={xScale(energy)}
                    y={chartHeight - padding + 20}
                    textAnchor="middle"
                    fontSize="12"
                    fill={colors.text}
                  >
                    {energy}
                  </text>
                </g>
              );
            }
            return null;
          })}

          {/* Y-axis labels */}
          {[0, Math.round(maxCount * 0.25), Math.round(maxCount * 0.5), Math.round(maxCount * 0.75), maxCount].map((count, index) => (
            <g key={`y-axis-${index}`}>
              <line
                x1={padding - 5}
                y1={yScale(count)}
                x2={padding}
                y2={yScale(count)}
                stroke={colors.text}
              />
              <text
                x={padding - 10}
                y={yScale(count) + 4}
                textAnchor="end"
                fontSize="12"
                fill={colors.text}
              >
                {count}
              </text>
            </g>
          ))}

          {/* Axis labels */}
          <text
            x={chartWidth / 2}
            y={chartHeight - 10}
            textAnchor="middle"
            fontSize="14"
            fill={colors.text}
            fontWeight="bold"
          >
            Energy (keV)
          </text>
          <text
            x={20}
            y={chartHeight / 2}
            textAnchor="middle"
            fontSize="14"
            fill={colors.text}
            fontWeight="bold"
            transform={`rotate(-90, 20, ${chartHeight / 2})`}
          >
            Counts
          </text>
        </svg>
      </div>

      {/* Legend */}
      {regions_of_interest.length > 0 && (
        <div className="mt-4">
          <h4 className={`text-sm font-semibold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>
            Spectral Line Regions
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            {regions_of_interest.map((region, index) => (
              <div 
                key={`legend-${index}-${region.name}`} 
                className={`flex items-center space-x-2 ${region.significance === 'none' ? 'opacity-60' : ''}`}
              >
                <div
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: getRegionColor(region.significance) }}
                />
                <span className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
                  {region.name.replace('_', ' ')} {region.count === 0 ? '(no events)' : `(${region.count})`}
                </span>
              </div>
            ))}
          </div>
          
          {/* Legend explanation */}
          <div className="mt-2 text-xs opacity-75">
            <div className="flex flex-wrap gap-4">
              <span className={`${theme === 'dark' ? 'text-red-300' : 'text-red-600'}`}>● High (&gt;5)</span>
              <span className={`${theme === 'dark' ? 'text-yellow-300' : 'text-yellow-600'}`}>● Moderate (3-5)</span>
              <span className={`${theme === 'dark' ? 'text-green-300' : 'text-green-600'}`}>● Low (1-2)</span>
              <span className={`${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>● No detection</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};