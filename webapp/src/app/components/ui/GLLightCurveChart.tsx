"use client";

import React from 'react';

interface GLStep {
  t0_s: number;
  t1_s: number;
  width_s: number;
  counts: number;
  rate_cps: number;
  rate_lo_cps?: number;
  rate_hi_cps?: number;
}

interface GLInfo {
  summary?: {
    p_var?: number | null;
    index?: number | null;
    m_map?: number | null;
    K?: number;
    median_width_s?: number;
    median_rate_cps?: number;
  };
  segments?: GLStep[];
}

interface GLLightCurveChartProps {
  gl: GLInfo;
  theme?: 'light' | 'dark';
}

export const GLLightCurveChart: React.FC<GLLightCurveChartProps> = ({ gl, theme = 'light' }) => {
  const segments = gl.segments || [];
  if (!segments.length) {
    return <div className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>No GL light curve available</div>;
  }

  const chartWidth = 800;
  const chartHeight = 320;
  const padding = 50;
  const plotWidth = chartWidth - 2 * padding;
  const plotHeight = chartHeight - 2 * padding;

  const minT = Math.min(...segments.map(s => s.t0_s));
  const maxT = Math.max(...segments.map(s => s.t1_s));
  const maxR = Math.max(...segments.map(s => s.rate_hi_cps ?? s.rate_cps));

  const colors = theme === 'dark' ? {
    bg: '#0D0C22', axis: '#e5e7eb', grid: '#374151', step: '#10b981', band: 'rgba(16,185,129,0.2)'
  } : { bg: '#ffffff', axis: '#111827', grid: '#e5e7eb', step: '#059669', band: 'rgba(16,185,129,0.15)' };

  const xScale = (t: number) => padding + ((t - minT) / Math.max(1, maxT - minT)) * plotWidth;
  const yScale = (r: number) => chartHeight - padding - (r / Math.max(1e-9, maxR)) * plotHeight;

  // Build step path and CI polygons
  const stepPath = () => {
    let d = '';
    segments.forEach((s, i) => {
      const y = yScale(s.rate_cps);
      const x0 = xScale(s.t0_s);
      const x1 = xScale(s.t1_s);
      if (i === 0) d += `M ${x0} ${y} `;
      d += `L ${x1} ${y} `;
      if (i < segments.length - 1) {
        // vertical jump to next segment start
        const yNext = yScale(segments[i + 1].rate_cps);
        d += `L ${x1} ${yNext} `;
      }
    });
    return d.trim();
  };

  const ciBands = segments.map((s, idx) => {
    const x0 = xScale(s.t0_s);
    const x1 = xScale(s.t1_s);
    const yLo = yScale(s.rate_lo_cps ?? s.rate_cps);
    const yHi = yScale(s.rate_hi_cps ?? s.rate_cps);
    return (
      <rect
        key={`band-${idx}`}
        x={x0}
        y={Math.min(yLo, yHi)}
        width={Math.max(1, x1 - x0)}
        height={Math.abs(yHi - yLo)}
        fill={colors.band}
      />
    );
  });

  // axis ticks
  const buildTicks = (min: number, max: number, n: number) => {
    if (!isFinite(min) || !isFinite(max) || max <= min) return [min];
    const step = (max - min) / Math.max(1, n - 1);
    const ticks: number[] = [];
    for (let i = 0; i < n; i++) ticks.push(min + i * step);
    return ticks;
  };
  const xTicks = buildTicks(minT, maxT, 6);
  const yTicks = [0, maxR * 0.25, maxR * 0.5, maxR * 0.75, maxR].map(v => Number(v));

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <h3 className={`text-lg font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>Light Curve (GL step)</h3>
        {gl.summary && (
          <div className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
            m_MAP={gl.summary.m_map ?? '—'}; K={gl.summary.K ?? '—'}; p_var={gl.summary.p_var ?? '—'}; index={gl.summary.index ?? '—'}
          </div>
        )}
      </div>

      <svg width={chartWidth} height={chartHeight} className="border rounded" style={{ backgroundColor: colors.bg }}>
        <defs>
          <pattern id="grid-gl" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke={colors.grid} strokeWidth="1" opacity="0.35" />
          </pattern>
        </defs>
        <rect width={plotWidth} height={plotHeight} x={padding} y={padding} fill="url(#grid-gl)" />

        {/* CI bands per step */}
        {ciBands}

        {/* step line */}
        <path d={stepPath()} fill="none" stroke={colors.step} strokeWidth={2} />

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

export default GLLightCurveChart;


