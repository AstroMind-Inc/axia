"use client";

import React, { useMemo, useState } from 'react';

interface TLcPoint {
  t_mid_s: number;
  rate_cps: number;
  rate_err_cps?: number;
  counts?: number;
  exposure_s?: number;
}

interface TimeLightCurveProps {
  cadence_s: number;
  points: TLcPoint[];
  stats?: { mean_rate?: number; std_rate?: number; frac_rms?: number | null; bins?: number; zero_exposure_bins?: number; duration_s?: number };
  theme?: 'light' | 'dark';
}

export const TimeLightCurveChart: React.FC<TimeLightCurveProps> = ({ cadence_s, points, stats, theme = 'light' }) => {
  const chartWidth = 800;
  const chartHeight = 320;
  const padding = 50;
  const plotWidth = chartWidth - 2 * padding;
  const plotHeight = chartHeight - 2 * padding;

  // Interactive horizontal scale: zoom/pan on time axis to avoid cutting the tail
  const [timeScale, setTimeScale] = useState<number>(1); // 1=fit, >1 = zoom in
  const [timeOffset, setTimeOffset] = useState<number>(0); // 0..1 fraction across

  if (!points || points.length === 0) {
    return <div className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>No time light curve available</div>;
  }

  const rawMinT = Math.min(...points.map(p => p.t_mid_s));
  const rawMaxT = Math.max(...points.map(p => p.t_mid_s));
  const fullSpan = Math.max(1, rawMaxT - rawMinT);
  const visibleSpan = Math.max(1, fullSpan / Math.max(1, timeScale));
  const minT = rawMinT + Math.max(0, Math.min(1, timeOffset)) * Math.max(0, fullSpan - visibleSpan);
  const maxT = minT + visibleSpan;
  const maxRate = Math.max(...points.map(p => p.rate_cps));

  const colors = theme === 'dark' ? {
    bg: '#0D0C22', axis: '#e5e7eb', grid: '#374151', line: '#00E0FF', err: '#60a5fa'
  } : { bg: '#ffffff', axis: '#111827', grid: '#e5e7eb', line: '#2563eb', err: '#60a5fa' };

  const xScale = (t: number) => padding + ((t - minT) / Math.max(1, maxT - minT)) * plotWidth;
  const yScale = (r: number) => chartHeight - padding - (r / Math.max(1e-9, maxRate)) * plotHeight;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.t_mid_s)} ${yScale(p.rate_cps)}`).join(' ');

  // Build axis ticks
  const buildTicks = (min: number, max: number, n: number) => {
    if (!isFinite(min) || !isFinite(max) || max <= min) return [min];
    const step = (max - min) / Math.max(1, n - 1);
    const ticks: number[] = [];
    for (let i = 0; i < n; i++) ticks.push(min + i * step);
    return ticks;
  };

  const xTicks = buildTicks(minT, maxT, 6);
  const yTicks = [0, maxRate * 0.25, maxRate * 0.5, maxRate * 0.75, maxRate].map(v => Number(v));

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <h3 className={`text-lg font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>Light Curve (cadence {cadence_s}s)</h3>
        {stats && (
          <div className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
            mean={stats.mean_rate} c/s; std={stats.std_rate} ; fracRMS={stats.frac_rms ?? '—'}; bins={stats.bins}
          </div>
        )}
      </div>

      {/* Controls: time zoom and pan */}
      <div className="flex items-center gap-3 mb-2">
        <label className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>Time zoom</label>
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={timeScale}
          onChange={(e) => setTimeScale(Number(e.target.value))}
        />
        {timeScale > 1 && (
          <>
            <label className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>Pan</label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(timeOffset * 100)}
              onChange={(e) => setTimeOffset(Number(e.target.value) / 100)}
            />
          </>
        )}
        <span className={`ml-2 text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Window: {visibleSpan.toFixed(0)} s</span>
      </div>

      <svg width={chartWidth} height={chartHeight} className="border rounded" style={{ backgroundColor: colors.bg }}>
        {/* grid */}
        <defs>
          <pattern id="grid-tlc" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke={colors.grid} strokeWidth="1" opacity="0.35" />
          </pattern>
        </defs>
        <rect width={plotWidth} height={plotHeight} x={padding} y={padding} fill="url(#grid-tlc)" />

        {/* error bars */}
        {points.map((p, i) => (
          <g key={`eb-${i}`}> 
            {typeof p.rate_err_cps === 'number' && p.rate_err_cps > 0 && (
              <>
                <line x1={xScale(p.t_mid_s)} x2={xScale(p.t_mid_s)} y1={yScale(Math.max(0, p.rate_cps - p.rate_err_cps))} y2={yScale(p.rate_cps + p.rate_err_cps)} stroke={colors.err} strokeWidth={1} />
                <line x1={xScale(p.t_mid_s) - 3} x2={xScale(p.t_mid_s) + 3} y1={yScale(p.rate_cps + p.rate_err_cps)} y2={yScale(p.rate_cps + p.rate_err_cps)} stroke={colors.err} />
                <line x1={xScale(p.t_mid_s) - 3} x2={xScale(p.t_mid_s) + 3} y1={yScale(Math.max(0, p.rate_cps - p.rate_err_cps))} y2={yScale(Math.max(0, p.rate_cps - p.rate_err_cps))} stroke={colors.err} />
              </>
            )}
          </g>
        ))}

        {/* curve */}
        <path d={path} fill="none" stroke={colors.line} strokeWidth={2} />
        {points.map((p, i) => (
          <circle key={`pt-${i}`} cx={xScale(p.t_mid_s)} cy={yScale(p.rate_cps)} r={2.5} fill={colors.line} />
        ))}

        {/* axes */}
        <line x1={padding} y1={chartHeight - padding} x2={chartWidth - padding} y2={chartHeight - padding} stroke={colors.axis} />
        <line x1={padding} y1={padding} x2={padding} y2={chartHeight - padding} stroke={colors.axis} />

        {/* X-axis ticks and labels */}
        {xTicks.map((t, i) => (
          <g key={`xt-${i}`}>
            <line x1={xScale(t)} y1={chartHeight - padding} x2={xScale(t)} y2={chartHeight - padding + 5} stroke={colors.axis} />
            <text x={xScale(t)} y={chartHeight - padding + 18} textAnchor="middle" fontSize={10} fill={colors.axis}>
              {Number(t).toFixed(0)}
            </text>
          </g>
        ))}

        {/* Y-axis ticks and labels */}
        {yTicks.map((r, i) => (
          <g key={`yt-${i}`}>
            <line x1={padding - 5} y1={yScale(r)} x2={padding} y2={yScale(r)} stroke={colors.axis} />
            <text x={padding - 8} y={yScale(r) + 3} textAnchor="end" fontSize={10} fill={colors.axis}>
              {r.toFixed(r < 0.1 ? 3 : 2)}
            </text>
          </g>
        ))}

        {/* labels */}
        <text x={chartWidth / 2} y={chartHeight - 10} textAnchor="middle" fontSize={12} fill={colors.axis}>Time (s)</text>
        <text x={20} y={chartHeight / 2} textAnchor="middle" fontSize={12} fill={colors.axis} transform={`rotate(-90, 20, ${chartHeight / 2})`}>Rate (cts/s)</text>
      </svg>
    </div>
  );
};


