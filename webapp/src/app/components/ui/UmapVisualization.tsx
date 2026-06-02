"use client";

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { UmapDataObject } from '@/app/actions/playgroundActions';

interface UmapVisualizationProps {
  umapData: UmapDataObject[];
  theme?: 'light' | 'dark';
  selectedObjectId?: string;
  onObjectSelect?: (objectId: string) => void;
}

type ColorBy = 
  // Hardness ratios
  | 'hard_hs' | 'hard_hm' | 'hard_ms'
  // Numerical features
  | 'flux_significance_b' | 'var_index_b' | 'bb_kt' | 'powlaw_gamma'
  | 'powlaw_stat' | 'bb_stat' | 'brems_stat' | 'apec_stat'
  | 'powlaw_nh' | 'apec_nh' | 'bb_nh' | 'brems_kt'
  // Categorical features
  | 'source_type' | 'source_type_category' | 'recommended_model';

const UmapVisualizationComponent: React.FC<UmapVisualizationProps> = ({ 
  umapData, 
  theme = 'light',
  selectedObjectId,
  onObjectSelect
}) => {
  const [colorBy, setColorBy] = useState<ColorBy>('hard_hs');
  const [hoveredPoint, setHoveredPoint] = useState<UmapDataObject | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [hoverContext, setHoverContext] = useState<'small' | 'popup' | null>(null);
  const [mouseCtxWidth, setMouseCtxWidth] = useState<number>(600);
  
  // Range filter state for numerical features
  const [rangeFilter, setRangeFilter] = useState<{min: number, max: number} | null>(null);
  
  // Zoom and pan state
  const [transform, setTransform] = useState({ scale: 1, translateX: 0, translateY: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  // Popup state
  const [isPopupOpen, setIsPopupOpen] = useState(false);

  // Refs for scroll prevention
  const plotContainerRef = useRef<HTMLDivElement>(null);
  const popupContainerRef = useRef<HTMLDivElement>(null);
  const smallGroupRef = useRef<SVGGElement>(null);
  const popupGroupRef = useRef<SVGGElement>(null);

  // Chart dimensions
  const chartWidth = 600;
  const chartHeight = 500;
  const padding = 60;
  const plotWidth = chartWidth - 2 * padding;
  const plotHeight = chartHeight - 2 * padding;

  // Calculate bounds for UMAP coordinates
  const bounds = useMemo(() => {
    if (umapData.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < umapData.length; i++) {
      const x = umapData[i].umap_2d[0];
      const y = umapData[i].umap_2d[1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
      return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    }
    return { minX, maxX, minY, maxY };
  }, [umapData]);

  // Define feature categories
  const numericalFeatures: ColorBy[] = [
    'hard_hs', 'hard_hm', 'hard_ms', 'flux_significance_b', 'var_index_b', 
    'bb_kt', 'powlaw_gamma', 'powlaw_stat', 'bb_stat', 'brems_stat', 
    'apec_stat', 'powlaw_nh', 'apec_nh', 'bb_nh', 'brems_kt'
  ];
  
  const categoricalFeatures: ColorBy[] = [
    'source_type', 'source_type_category', 'recommended_model'
  ];

  const isNumerical = numericalFeatures.includes(colorBy);
  const isCategorical = categoricalFeatures.includes(colorBy);

  // Calculate bounds for numerical features or categories for categorical features
  const colorInfo = useMemo(() => {
    if (isNumerical) {
      const values = umapData
        .map(d => d[colorBy])
        .filter(v => v !== undefined && v !== null && !isNaN(v as number)) as number[];
      
      if (values.length === 0) return { type: 'numerical', min: 0, max: 1, validCount: 0 };
      
      const min = Math.min(...values);
      const max = Math.max(...values);
      
      return {
        type: 'numerical' as const,
        min,
        max,
        validCount: values.length
      };
    } else if (isCategorical) {
      // Get all non-null categorical values
      const values = umapData
        .map(d => d[colorBy])
        .filter(v => v !== undefined && v !== null && v !== '') as string[];
      
      // Count occurrences
      const counts = values.reduce((acc, val) => {
        acc[val] = (acc[val] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      // Get top 6 categories by count
      const topCategories = Object.entries(counts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 6)
        .map(([category]) => category);
      
      return {
        type: 'categorical' as const,
        categories: topCategories,
        allCounts: counts,
        validCount: values.length
      };
    }
    
    return { type: 'none' as const, validCount: 0 };
  }, [umapData, colorBy, isNumerical, isCategorical]);

  // Initialize range filter when colorBy changes to a numerical feature
  useEffect(() => {
    if (isNumerical && colorInfo.type === 'numerical') {
      // Calculate 95% interval (2.5% to 97.5%) to exclude outliers
      const values = umapData
        .map(d => d[colorBy])
        .filter(v => v !== undefined && v !== null && !isNaN(v as number)) as number[];
      
      if (values.length > 0) {
        const sortedValues = values.sort((a, b) => a - b);
        const lowerIndex = Math.floor(sortedValues.length * 0.025);
        const upperIndex = Math.ceil(sortedValues.length * 0.975) - 1;
        
        const p2_5 = sortedValues[lowerIndex];
        const p97_5 = sortedValues[Math.min(upperIndex, sortedValues.length - 1)];
        
        setRangeFilter({ 
          min: Math.max(p2_5, colorInfo.min), 
          max: Math.min(p97_5, colorInfo.max) 
        });
      } else {
        setRangeFilter({ min: colorInfo.min, max: colorInfo.max });
      }
    } else {
      setRangeFilter(null);
    }
  }, [colorBy, isNumerical, colorInfo, umapData]);

  // Scaling functions
  const xScale = useCallback((x: number) => {
    const denom = bounds.maxX - bounds.minX || 1;
    return padding + ((x - bounds.minX) / denom) * plotWidth;
  }, [bounds.maxX, bounds.minX, plotWidth, padding]);
  const yScale = useCallback((y: number) => {
    const denom = bounds.maxY - bounds.minY || 1;
    return chartHeight - padding - ((y - bounds.minY) / denom) * plotHeight;
  }, [bounds.maxY, bounds.minY, chartHeight, plotHeight, padding]);

  // Define categorical color palette with better contrast
  const categoricalColors = [
    '#E53E3E', // Red
    '#3182CE', // Blue  
    '#38A169', // Green
    '#D69E2E', // Orange/Yellow
    '#805AD5', // Purple
    '#DD6B20', // Orange
    '#319795', // Teal
    '#E91E63', // Pink
    '#2D3748', // Dark Gray
    '#795548'  // Brown
  ];

  // Filter data to only show points with valid values for the selected feature
  const filteredData = useMemo(() => {
    const filtered = umapData.filter(obj => {
      const value = obj[colorBy];
      const isSelectedObject = selectedObjectId === obj._id;
      
      // Always include the selected object regardless of filters
      if (isSelectedObject) {
        return true;
      }
      
      // Filter out source_type 'X' unless it's the selected object
      if (colorBy === 'source_type' && obj.source_type === 'X') {
        return false;
      }
      
      // Filter out source_type_category 'Other' unless it's the selected object  
      if (colorBy === 'source_type_category' && obj.source_type_category === 'Other') {
        return false;
      }
      
      if (isNumerical) {
        const numValue = value as number;
        const isValidNumber = value !== undefined && value !== null && !isNaN(numValue);
        if (!isValidNumber) return false;
        
        // Apply range filter for numerical features
        if (rangeFilter) {
          return numValue >= rangeFilter.min && numValue <= rangeFilter.max;
        }
        return true;
      } else if (isCategorical && colorInfo.type === 'categorical' && colorInfo.categories) {
        return value !== undefined && value !== null && value !== '' && 
               colorInfo.categories.includes(value as string);
      }
      return false;
    });
    
    return filtered;
  }, [umapData, colorBy, isNumerical, isCategorical, colorInfo, selectedObjectId, rangeFilter]);

  // Helper function to check if selected object meets current filter criteria
  const selectedObjectMeetsFilter = useMemo(() => {
    if (!selectedObjectId) return true;
    
    const selectedObj = umapData.find(obj => obj._id === selectedObjectId);
    if (!selectedObj) return true;
    
    const value = selectedObj[colorBy];
    
    // Check source_type filter
    if (colorBy === 'source_type' && selectedObj.source_type === 'X') {
      return false;
    }
    
    // Check source_type_category filter
    if (colorBy === 'source_type_category' && selectedObj.source_type_category === 'Other') {
      return false;
    }
    
    if (isNumerical) {
      const numValue = value as number;
      const isValidNumber = value !== undefined && value !== null && !isNaN(numValue);
      if (!isValidNumber) return false;
      
      if (rangeFilter) {
        return numValue >= rangeFilter.min && numValue <= rangeFilter.max;
      }
      return true;
    } else if (isCategorical && colorInfo.type === 'categorical' && colorInfo.categories) {
      return value !== undefined && value !== null && value !== '' && 
             colorInfo.categories.includes(value as string);
    }
    
    return false;
  }, [selectedObjectId, umapData, colorBy, isNumerical, isCategorical, colorInfo, rangeFilter]);

  // Calculate effective color range (either full range or filtered range)
  const effectiveColorRange = useMemo(() => {
    if (isNumerical && colorInfo.type === 'numerical' && rangeFilter) {
      return { min: rangeFilter.min, max: rangeFilter.max };
    } else if (isNumerical && colorInfo.type === 'numerical') {
      return { min: colorInfo.min, max: colorInfo.max };
    }
    return null;
  }, [isNumerical, colorInfo, rangeFilter]);

  // Color mapping function
  const getPointColor = (obj: UmapDataObject) => {
    const value = obj[colorBy];
    const isSelectedObject = selectedObjectId === obj._id;
    
    // Always render selected object in black with highlight
    if (isSelectedObject) {
      return '#000000';
    }

    // If this is the selected object but it doesn't meet filter criteria, show in neutral color
    if (isSelectedObject && !selectedObjectMeetsFilter) {
      return '#000000'; // Black for filtered-out selected object
    }
    
    if (isNumerical && effectiveColorRange) {
      if (value === undefined || value === null || isNaN(value as number)) {
        return theme === 'dark' ? '#606060' : '#cccccc';
      }
      
      const normalized = ((value as number) - effectiveColorRange.min) / (effectiveColorRange.max - effectiveColorRange.min);
      const clampedNormalized = Math.max(0, Math.min(1, normalized));
      
      // Use a color scale from blue (low) to red (high)
      if (theme === 'dark') {
        const red = Math.round(255 * clampedNormalized);
        const blue = Math.round(255 * (1 - clampedNormalized));
        return `rgb(${red}, 100, ${blue})`;
      } else {
        const red = Math.round(200 * clampedNormalized + 55);
        const blue = Math.round(200 * (1 - clampedNormalized) + 55);
        return `rgb(${red}, 80, ${blue})`;
      }
    } else if (isCategorical && colorInfo.type === 'categorical' && colorInfo.categories) {
      if (value === undefined || value === null || value === '') {
        return theme === 'dark' ? '#606060' : '#cccccc';
      }
      
      const categoryIndex = colorInfo.categories.indexOf(value as string);
      if (categoryIndex === -1) {
        return theme === 'dark' ? '#606060' : '#cccccc';
      }
      
      return categoricalColors[categoryIndex] || (theme === 'dark' ? '#606060' : '#cccccc');
    }
    
    return theme === 'dark' ? '#606060' : '#cccccc';
  };

  // Color scheme based on theme
  const colors = theme === 'dark' ? {
    background: '#1a1a1a',
    text: '#ffffff',
    grid: '#333333',
    axis: '#666666',
    tooltip: '#2a2a2a',
    tooltipBorder: '#444444'
  } : {
    background: '#ffffff',
    text: '#000000',
    grid: '#e0e0e0',
    axis: '#999999',
    tooltip: '#ffffff',
    tooltipBorder: '#cccccc'
  };

  // Handle point hover events
  // Throttled nearest-point hover/dblclick via raf
  const hoverRafRef = useRef<number | null>(null);
  const lastHoverClientRef = useRef<{ clientX: number; clientY: number } | null>(null);

  const findNearestPoint = useCallback((clientX: number, clientY: number, groupEl: SVGGElement | null, ctx: 'small' | 'popup'): UmapDataObject | null => {
    if (!groupEl || !groupEl.ownerSVGElement) return null;
    const svg = groupEl.ownerSVGElement as unknown as SVGSVGElement;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = groupEl.getScreenCTM();
    if (!ctm) return null;
    const local = pt.matrixTransform(ctm.inverse());
    const groupX = local.x;
    const groupY = local.y;

    let nearest: UmapDataObject | null = null;
    let bestDistSq = Infinity;
    const denomX = (bounds.maxX - bounds.minX) || 1;
    const denomY = (bounds.maxY - bounds.minY) || 1;
    for (let i = 0; i < filteredData.length; i++) {
      const obj = filteredData[i];
      const px = ctx === 'popup'
        ? padding + ((obj.umap_2d[0] - bounds.minX) / denomX) * (900 - 2 * padding)
        : xScale(obj.umap_2d[0]);
      const py = ctx === 'popup'
        ? 750 - padding - ((obj.umap_2d[1] - bounds.minY) / denomY) * (750 - 2 * padding)
        : yScale(obj.umap_2d[1]);
      const dx = px - groupX;
      const dy = py - groupY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        nearest = obj;
      }
    }
    // Consider points within ~12px radius in screen space -> same threshold in group space depends on scale
    const radiusGroup = 12 / (transform.scale || 1);
    if (bestDistSq > radiusGroup * radiusGroup) return null;
    return nearest;
  }, [filteredData, transform.scale, xScale, yScale, bounds.maxX, bounds.minX, bounds.maxY, bounds.minY, padding]);

  const onSvgMouseMove = useCallback((event: React.MouseEvent<SVGElement>, ctx: 'small' | 'popup', groupEl: SVGGElement | null) => {
    const container = ctx === 'popup' ? popupContainerRef.current : plotContainerRef.current;
    const rect = (container || (event.currentTarget as SVGElement)).getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    setMousePos({ x: localX, y: localY });
    setMouseCtxWidth(rect.width);
    setHoverContext(ctx);
    lastHoverClientRef.current = { clientX: event.clientX, clientY: event.clientY };
    if (hoverRafRef.current == null) {
      const groupNode = groupEl;
      hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = null;
        const coords = lastHoverClientRef.current;
        if (!coords) return;
        const nearest = findNearestPoint(coords.clientX, coords.clientY, groupNode, ctx);
        setHoveredPoint(nearest);
      });
    }
  }, [findNearestPoint]);

  const onSvgDoubleClick = useCallback((event: React.MouseEvent<SVGElement>, groupEl: SVGGElement | null, ctx: 'small' | 'popup') => {
    if (!onObjectSelect) return;
    const nearest = findNearestPoint(event.clientX, event.clientY, groupEl, ctx);
    if (nearest) onObjectSelect(nearest._id);
  }, [findNearestPoint, onObjectSelect]);

  // Zoom and pan handlers
  const handleWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault();
    event.stopPropagation(); // Prevent parent scrolling
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
    
    setTransform(prev => {
      const newScale = Math.max(0.1, Math.min(10, prev.scale * zoomFactor));
      
      // Zoom towards mouse position
      const newTranslateX = mouseX - (mouseX - prev.translateX) * (newScale / prev.scale);
      const newTranslateY = mouseY - (mouseY - prev.translateY) * (newScale / prev.scale);
      
      return {
        scale: newScale,
        translateX: newTranslateX,
        translateY: newTranslateY
      };
    });
  }, []);

  const handleMouseDown = (event: React.MouseEvent<SVGElement>) => {
    if (event.button === 0) { // Left mouse button
      setIsDragging(true);
      setDragStart({ x: event.clientX - transform.translateX, y: event.clientY - transform.translateY });
    }
  };

  const handleMouseMoveSmall = (event: React.MouseEvent<SVGElement>) => {
    if (isDragging) {
      setTransform(prev => ({
        ...prev,
        translateX: event.clientX - dragStart.x,
        translateY: event.clientY - dragStart.y
      }));
    }
    onSvgMouseMove(event, 'small', smallGroupRef.current);
  };
  const handleMouseMovePopup = (event: React.MouseEvent<SVGElement>) => {
    if (isDragging) {
      setTransform(prev => ({
        ...prev,
        translateX: event.clientX - dragStart.x,
        translateY: event.clientY - dragStart.y
      }));
    }
    onSvgMouseMove(event, 'popup', popupGroupRef.current);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Reset zoom and pan
  const resetTransform = () => {
    setTransform({ scale: 1, translateX: 0, translateY: 0 });
  };

  // Direct DOM event listeners for wheel events to completely prevent bubbling
  useEffect(() => {
    const preventScroll = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      // Convert to React synthetic event and handle zoom
      const syntheticEvent = {
        preventDefault: () => {},
        stopPropagation: () => {},
        currentTarget: e.currentTarget,
        clientX: e.clientX,
        clientY: e.clientY,
        deltaY: e.deltaY
      } as React.WheelEvent;
      
      handleWheel(syntheticEvent);
      return false;
    };

    // Add listeners to both containers
    const plotContainer = plotContainerRef.current;
    const popupContainer = popupContainerRef.current;

    if (plotContainer) {
      plotContainer.addEventListener('wheel', preventScroll, { passive: false });
    }
    if (popupContainer) {
      popupContainer.addEventListener('wheel', preventScroll, { passive: false });
    }

    // Cleanup
    return () => {
      if (plotContainer) {
        plotContainer.removeEventListener('wheel', preventScroll);
      }
      if (popupContainer) {
        popupContainer.removeEventListener('wheel', preventScroll);
      }
    };
  }, [handleWheel]);  // Include handleWheel since it's wrapped in useCallback

  // Generate grid lines
  const generateGridLines = () => {
    const gridLines = [];
    const numLines = 5;
    
    // Vertical grid lines
    for (let i = 0; i <= numLines; i++) {
      const x = padding + (i / numLines) * plotWidth;
      gridLines.push(
        <line
          key={`vgrid-${i}`}
          x1={x}
          y1={padding}
          x2={x}
          y2={chartHeight - padding}
          stroke={colors.grid}
          strokeWidth={0.5}
        />
      );
    }
    
    // Horizontal grid lines
    for (let i = 0; i <= numLines; i++) {
      const y = padding + (i / numLines) * plotHeight;
      gridLines.push(
        <line
          key={`hgrid-${i}`}
          x1={padding}
          y1={y}
          x2={chartWidth - padding}
          y2={y}
          stroke={colors.grid}
          strokeWidth={0.5}
        />
      );
    }
    
    return gridLines;
  };

  // Generate axis labels
  const generateAxisLabels = () => {
    const labels = [];
    const numTicks = 5;
    
    // X-axis labels
    for (let i = 0; i <= numTicks; i++) {
      const x = padding + (i / numTicks) * plotWidth;
      const value = bounds.minX + (i / numTicks) * (bounds.maxX - bounds.minX);
      labels.push(
        <text
          key={`xlabel-${i}`}
          x={x}
          y={chartHeight - padding + 20}
          textAnchor="middle"
          fill={colors.text}
          fontSize="12"
        >
          {value.toFixed(1)}
        </text>
      );
    }
    
    // Y-axis labels
    for (let i = 0; i <= numTicks; i++) {
      const y = chartHeight - padding - (i / numTicks) * plotHeight;
      const value = bounds.minY + (i / numTicks) * (bounds.maxY - bounds.minY);
      labels.push(
        <text
          key={`ylabel-${i}`}
          x={padding - 10}
          y={y + 4}
          textAnchor="end"
          fill={colors.text}
          fontSize="12"
        >
          {value.toFixed(1)}
        </text>
      );
    }
    
    return labels;
  };

  if (umapData.length === 0) {
    return (
      <div className={`flex items-center justify-center h-64 ${
        theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
      }`}>
        No UMAP data available
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <label className={`text-sm font-medium ${
          theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
        }`}>
          Color by:
        </label>
        <select
          value={colorBy}
          onChange={(e) => setColorBy(e.target.value as ColorBy)}
          className={`px-3 py-1 rounded border ${
            theme === 'dark' 
              ? 'bg-[#1A1832] border-gray-600 text-white' 
              : 'bg-white border-gray-300 text-gray-800'
          }`}
        >
          <optgroup label="Hardness Ratios">
            <option value="hard_hs">Hard/Soft Ratio</option>
            <option value="hard_hm">Hard/Medium Ratio</option>
            <option value="hard_ms">Medium/Soft Ratio</option>
          </optgroup>
          <optgroup label="Numerical Features">
            <option value="flux_significance_b">Flux Significance (B)</option>
            <option value="var_index_b">Variability Index (B)</option>
            <option value="bb_kt">Blackbody kT</option>
            <option value="powlaw_gamma">Power Law Gamma</option>
            <option value="powlaw_stat">Power Law Stat</option>
            <option value="bb_stat">Blackbody Stat</option>
            <option value="brems_stat">Bremsstrahlung Stat</option>
            <option value="apec_stat">APEC Stat</option>
            <option value="powlaw_nh">Power Law NH</option>
            <option value="apec_nh">APEC NH</option>
            <option value="bb_nh">Blackbody NH</option>
            <option value="brems_kt">Bremsstrahlung kT</option>
          </optgroup>
          <optgroup label="Categorical Features">
            <option value="source_type">Source Type</option>
            <option value="source_type_category">Source Type Category</option>
            <option value="recommended_model">Recommended Model</option>
          </optgroup>
        </select>
        <div className="flex items-center space-x-2 text-xs">
          <span className={`${
            theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {filteredData.length} / {umapData.length} points
          </span>
          {colorInfo.validCount !== umapData.length && (
            <span className={`px-2 py-1 rounded ${
              theme === 'dark' ? 'bg-amber-900/20 text-amber-400' : 'bg-amber-100 text-amber-700'
            }`}>
              {umapData.length - colorInfo.validCount} null values hidden
            </span>
          )}
        </div>
      </div>

      {/* Control buttons */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <button
            onClick={resetTransform}
            className={`px-2 py-1 text-xs rounded ${
              theme === 'dark' 
                ? 'bg-[#1A1832] hover:bg-[#1E1A3C] text-gray-300' 
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            Reset View
          </button>
          <span className={`text-xs ${
            theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
          }`}>
            Zoom: {(transform.scale * 100).toFixed(0)}%
          </span>
        </div>
        <button
          onClick={() => setIsPopupOpen(true)}
          className={`px-3 py-1 text-xs rounded flex items-center space-x-1 ${
            theme === 'dark' 
              ? 'bg-[#1E1A3C] hover:bg-[#2A254D] text-[#00E0FF]' 
              : 'bg-blue-50 hover:bg-blue-100 text-blue-600'
          }`}
        >
          <span>🔍</span>
          <span>Enlarge</span>
        </button>
      </div>

      {/* UMAP Scatter Plot */}
      <div 
        ref={plotContainerRef}
        className="relative" 
        style={{ touchAction: 'none' }} // Prevent touch scrolling on mobile
      >
        <svg
          width={chartWidth}
          height={chartHeight}
          style={{ backgroundColor: colors.background, cursor: isDragging ? 'grabbing' : 'grab' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMoveSmall}
          onMouseUp={handleMouseUp}
          onDoubleClick={(e) => onSvgDoubleClick(e, smallGroupRef.current, 'small')}
          onMouseLeave={() => {
            setHoveredPoint(null);
            setIsDragging(false);
            setHoverContext(null);
          }}
        >
          {/* Transformable content group */}
          <g ref={smallGroupRef} transform={`translate(${transform.translateX}, ${transform.translateY}) scale(${transform.scale})`}>
            {/* Grid lines */}
            {generateGridLines()}
            
            {/* Axis lines */}
            <line
              x1={padding}
              y1={padding}
              x2={padding}
              y2={chartHeight - padding}
              stroke={colors.axis}
              strokeWidth={2}
            />
            <line
              x1={padding}
              y1={chartHeight - padding}
              x2={chartWidth - padding}
              y2={chartHeight - padding}
              stroke={colors.axis}
              strokeWidth={2}
            />
            
            {/* Axis labels */}
            {generateAxisLabels()}
            
            {/* Axis titles */}
            <text
              x={chartWidth / 2}
              y={chartHeight - 10}
              textAnchor="middle"
              fill={colors.text}
              fontSize="14"
              fontWeight="bold"
            >
              UMAP Dimension 1
            </text>
            <text
              x={20}
              y={chartHeight / 2}
              textAnchor="middle"
              fill={colors.text}
              fontSize="14"
              fontWeight="bold"
              transform={`rotate(-90, 20, ${chartHeight / 2})`}
            >
              UMAP Dimension 2
            </text>
            
            {/* Data points (single pass, ensure selected rendered last for on-top effect) */}
            {(() => {
              const nonSelected = [] as UmapDataObject[];
              const selected = [] as UmapDataObject[];
              for (let i = 0; i < filteredData.length; i++) {
                const obj = filteredData[i];
                if (selectedObjectId === obj._id) selected.push(obj); else nonSelected.push(obj);
              }
              const renderPoint = (obj: UmapDataObject, idx: number) => {
                const x = xScale(obj.umap_2d[0]);
                const y = yScale(obj.umap_2d[1]);
                const isHovered = hoveredPoint?._id === obj._id;
                const isSelected = selectedObjectId === obj._id;
                return (
                  <circle
                    key={obj._id || idx}
                    cx={x}
                    cy={y}
                    r={isSelected ? 6 : isHovered ? 5 : 3}
                    fill={getPointColor(obj)}
                    stroke={isHovered || isSelected ? colors.text : 'none'}
                    strokeWidth={isSelected ? 2 : isHovered ? 1 : 0}
                    style={{ cursor: 'pointer', pointerEvents: 'none' }}
                  />
                );
              };
              return (
                <>
                  {nonSelected.map((o, i) => renderPoint(o, i))}
                  {selected.map((o, i) => renderPoint(o, i))}
                </>
              );
            })()}
          </g>
        </svg>

        {/* dblclick handled on SVG directly */}
        
        {/* Tooltip */}
        {hoveredPoint && hoverContext === 'small' && (
          <div
            className={`absolute pointer-events-none z-10 px-3 py-2 rounded shadow-lg border ${
              theme === 'dark' 
                ? 'bg-[#2a2a2a] border-gray-600 text-white' 
                : 'bg-white border-gray-300 text-gray-800'
            }`}
            style={{
              left: mousePos.x + 10,
              top: mousePos.y - 10,
              transform: mousePos.x > chartWidth - 200 ? 'translateX(-100%)' : 'none'
            }}
          >
            <div className="text-sm space-y-1">
              <div><strong>ObsID:</strong> {hoveredPoint.obsid}</div>
              <div><strong>Source:</strong> {hoveredPoint.source_name}</div>
              <div><strong>UMAP:</strong> ({hoveredPoint.umap_2d[0].toFixed(2)}, {hoveredPoint.umap_2d[1].toFixed(2)})</div>
              {hoveredPoint[colorBy] !== undefined && (
                <div><strong>{colorBy.replace('_', '/')}:</strong> {
                  typeof hoveredPoint[colorBy] === 'number' 
                    ? (hoveredPoint[colorBy] as number).toFixed(3)
                    : hoveredPoint[colorBy]
                }</div>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* Color Legend */}
      <div className="flex flex-wrap items-start gap-4">
        <div className={`text-sm font-medium ${
          theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
        }`}>
          {colorBy.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} Legend:
        </div>
        
        {isNumerical && colorInfo.type === 'numerical' && effectiveColorRange ? (
          <div className="flex items-center space-x-2">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: theme === 'dark' ? 'rgb(100, 100, 255)' : 'rgb(80, 80, 255)' }}
            />
            <span className={`text-xs ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              {effectiveColorRange.min.toFixed(3)}
            </span>
            <div className="w-12 h-3 bg-gradient-to-r from-blue-500 to-red-500 rounded" />
            <span className={`text-xs ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              {effectiveColorRange.max.toFixed(3)}
            </span>
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: theme === 'dark' ? 'rgb(255, 100, 100)' : 'rgb(255, 80, 80)' }}
            />
            {rangeFilter && (effectiveColorRange.min !== colorInfo.min || effectiveColorRange.max !== colorInfo.max) && (
              <span className={`text-xs ${
                theme === 'dark' ? 'text-gray-500' : 'text-gray-500'
              }`}>
                (filtered from {colorInfo.min.toFixed(3)} - {colorInfo.max.toFixed(3)})
              </span>
            )}
          </div>
        ) : isCategorical && colorInfo.type === 'categorical' && colorInfo.categories && colorInfo.allCounts ? (
          <div className="flex flex-wrap items-center gap-2">
            {colorInfo.categories.map((category, index) => (
              <div key={category} className="flex items-center space-x-1">
                <div
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: categoricalColors[index] }}
                />
                <span className={`text-xs ${
                  theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                }`}>
                  {category} ({colorInfo.allCounts[category]})
                </span>
              </div>
            ))}
            {Object.keys(colorInfo.allCounts).length > 6 && (
              <span className={`text-xs ${
                theme === 'dark' ? 'text-gray-500' : 'text-gray-500'
              }`}>
                +{Object.keys(colorInfo.allCounts).length - 6} more
              </span>
            )}
          </div>
        ) : null}
        
        {/* Selected object indicator (for all feature types) */}
        {selectedObjectId && !selectedObjectMeetsFilter && !isNumerical && (
          <div className={`mt-2 text-xs ${
            theme === 'dark' ? 'text-gray-500' : 'text-gray-500'
          }`}>
            <div className="flex items-center space-x-1">
              <div className="w-2 h-2 bg-black rounded-full"></div>
              <span>Selected object (outside filter range)</span>
            </div>
          </div>
        )}
      </div>

      {/* Range slider for numerical features */}
      {isNumerical && rangeFilter && colorInfo.type === 'numerical' && (
        <div className="mt-4 space-y-2">
          <div className={`text-sm font-medium ${
            theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
          }`}>
            Filter Range: {rangeFilter.min.toFixed(3)} - {rangeFilter.max.toFixed(3)}
          </div>
          <div className="flex items-center space-x-3">
            <span className={`text-xs ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              {colorInfo.min.toFixed(3)}
            </span>
            <div className="flex-1 relative">

              {/* Min range slider */}
              <input
                type="range"
                min={colorInfo.min}
                max={colorInfo.max}
                step={(colorInfo.max - colorInfo.min) / 1000}
                value={rangeFilter.min}
                onChange={(e) => {
                  const newMin = parseFloat(e.target.value);
                  setRangeFilter(prev => prev ? { 
                    ...prev, 
                    min: Math.min(newMin, prev.max) 
                  } : null);
                }}
                className="absolute w-full h-2 rounded-lg appearance-none cursor-pointer"
                style={{ 
                  zIndex: 1,
                  background: theme === 'dark' ? '#374151' : '#e5e7eb',
                  WebkitAppearance: 'none',
                  height: '8px'
                }}
              />
              {/* Max range slider */}
              <input
                type="range"
                min={colorInfo.min}
                max={colorInfo.max}
                step={(colorInfo.max - colorInfo.min) / 1000}
                value={rangeFilter.max}
                onChange={(e) => {
                  const newMax = parseFloat(e.target.value);
                  setRangeFilter(prev => prev ? { 
                    ...prev, 
                    max: Math.max(newMax, prev.min) 
                  } : null);
                }}
                className="absolute w-full h-2 rounded-lg appearance-none cursor-pointer"
                style={{ 
                  zIndex: 2,
                  background: 'transparent',
                  WebkitAppearance: 'none',
                  height: '8px'
                }}
              />
            </div>
            <span className={`text-xs ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
            }`}>
              {colorInfo.max.toFixed(3)}
            </span>
          </div>
          <div className={`text-xs space-y-1 ${
            theme === 'dark' ? 'text-gray-500' : 'text-gray-500'
          }`}>
            <div>Showing {filteredData.length} / {umapData.length} points</div>
            {selectedObjectId && !selectedObjectMeetsFilter && (
              <div className="flex items-center space-x-1">
                <div className="w-2 h-2 bg-black rounded-full"></div>
                <span>Selected object (outside filter range)</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Popup Modal */}
      {isPopupOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className={`max-w-6xl max-h-[90vh] w-full mx-4 rounded-lg overflow-auto ${
            theme === 'dark' ? 'bg-[#111125]' : 'bg-white'
          }`}>
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className={`text-lg font-semibold ${
                  theme === 'dark' ? 'text-white' : 'text-gray-800'
                }`}>
                  UMAP Visualization - {colorBy.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </h3>
                <button
                  onClick={() => setIsPopupOpen(false)}
                  className={`text-2xl ${
                    theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  ×
                </button>
              </div>

              {/* Controls and legend in popup for feature parity */}
              <div className="flex flex-wrap items-center gap-4 mb-3">
                <label className={`text-sm font-medium ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  Color by:
                </label>
                <select
                  value={colorBy}
                  onChange={(e) => setColorBy(e.target.value as ColorBy)}
                  className={`px-3 py-1 rounded border ${
                    theme === 'dark' 
                      ? 'bg-[#1A1832] border-gray-600 text-white' 
                      : 'bg-white border-gray-300 text-gray-800'
                  }`}
                >
                  <optgroup label="Hardness Ratios">
                    <option value="hard_hs">Hard/Soft Ratio</option>
                    <option value="hard_hm">Hard/Medium Ratio</option>
                    <option value="hard_ms">Medium/Soft Ratio</option>
                  </optgroup>
                  <optgroup label="Numerical Features">
                    <option value="flux_significance_b">Flux Significance (B)</option>
                    <option value="var_index_b">Variability Index (B)</option>
                    <option value="bb_kt">Blackbody kT</option>
                    <option value="powlaw_gamma">Power Law Gamma</option>
                    <option value="powlaw_stat">Power Law Stat</option>
                    <option value="bb_stat">Blackbody Stat</option>
                    <option value="brems_stat">Bremsstrahlung Stat</option>
                    <option value="apec_stat">APEC Stat</option>
                    <option value="powlaw_nh">Power Law NH</option>
                    <option value="apec_nh">APEC NH</option>
                    <option value="bb_nh">Blackbody NH</option>
                    <option value="brems_kt">Bremsstrahlung kT</option>
                  </optgroup>
                  <optgroup label="Categorical Features">
                    <option value="source_type">Source Type</option>
                    <option value="source_type_category">Source Type Category</option>
                    <option value="recommended_model">Recommended Model</option>
                  </optgroup>
                </select>
                <div className="flex items-center space-x-2 text-xs">
                  <span className={`${
                    theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                  }`}>
                    {filteredData.length} / {umapData.length} points
                  </span>
                </div>
              </div>
              {/* Legend in popup */}
              <div className="mb-3">
                <div className={`text-sm font-medium ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  {colorBy.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} Legend:
                </div>
                {isNumerical && colorInfo.type === 'numerical' && effectiveColorRange ? (
                  <div className="flex items-center space-x-2 mt-1">
                    <div
                      className="w-4 h-4 rounded"
                      style={{ backgroundColor: theme === 'dark' ? 'rgb(100, 100, 255)' : 'rgb(80, 80, 255)' }}
                    />
                    <span className={`text-xs ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      {effectiveColorRange.min.toFixed(3)}
                    </span>
                    <div className="w-24 h-3 bg-gradient-to-r from-blue-500 to-red-500 rounded" />
                    <span className={`text-xs ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                      {effectiveColorRange.max.toFixed(3)}
                    </span>
                    <div
                      className="w-4 h-4 rounded"
                      style={{ backgroundColor: theme === 'dark' ? 'rgb(255, 100, 100)' : 'rgb(255, 80, 80)' }}
                    />
                  </div>
                ) : isCategorical && colorInfo.type === 'categorical' && colorInfo.categories && colorInfo.allCounts ? (
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {colorInfo.categories.map((category, index) => (
                      <div key={category} className="flex items-center space-x-1">
                        <div
                          className="w-3 h-3 rounded"
                          style={{ backgroundColor: categoricalColors[index] }}
                        />
                        <span className={`text-xs ${
                          theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                          {category} ({colorInfo.allCounts[category]})
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              
              {/* Enlarged UMAP visualization */}
              <div 
                ref={popupContainerRef}
                className="relative w-full"
                style={{ touchAction: 'none' }} // Prevent touch scrolling on mobile
              >
                <svg
                  width={900}
                  height={750}
                  style={{ backgroundColor: colors.background, cursor: isDragging ? 'grabbing' : 'grab' }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMovePopup}
                  onMouseUp={handleMouseUp}
                  onDoubleClick={(e) => onSvgDoubleClick(e, popupGroupRef.current, 'popup')}
                  onMouseLeave={() => {
                    setHoveredPoint(null);
                    setIsDragging(false);
                    setHoverContext(null);
                  }}
                >
                  {/* Transformable content group */}
                  <g ref={popupGroupRef} transform={`translate(${transform.translateX}, ${transform.translateY}) scale(${transform.scale})`}>
                    {/* Grid lines */}
                    {generateGridLines()}
                    
                    {/* Axis lines */}
                    <line
                      x1={padding}
                      y1={padding}
                      x2={padding}
                      y2={750 - padding}
                      stroke={colors.axis}
                      strokeWidth={2}
                    />
                    <line
                      x1={padding}
                      y1={750 - padding}
                      x2={900 - padding}
                      y2={750 - padding}
                      stroke={colors.axis}
                      strokeWidth={2}
                    />
                    {/* Axis labels and titles in popup */}
                    {(() => {
                      const labels: React.ReactElement[] = [];
                      const numTicks = 5;
                      for (let i = 0; i <= numTicks; i++) {
                        const x = padding + (i / numTicks) * (900 - 2 * padding);
                        const xv = bounds.minX + (i / numTicks) * (bounds.maxX - bounds.minX);
                        labels.push(
                          <text key={`pxlabel-${i}`} x={x} y={750 - padding + 20} textAnchor="middle" fill={colors.text} fontSize="12">{xv.toFixed(1)}</text>
                        );
                      }
                      for (let i = 0; i <= numTicks; i++) {
                        const y = 750 - padding - (i / numTicks) * (750 - 2 * padding);
                        const yv = bounds.minY + (i / numTicks) * (bounds.maxY - bounds.minY);
                        labels.push(
                          <text key={`pylabel-${i}`} x={padding - 10} y={y + 4} textAnchor="end" fill={colors.text} fontSize="12">{yv.toFixed(1)}</text>
                        );
                      }
                      return (
                        <>
                          {labels}
                          <text x={900 / 2} y={750 - 10} textAnchor="middle" fill={colors.text} fontSize="14" fontWeight="bold">UMAP Dimension 1</text>
                          <text x={20} y={750 / 2} textAnchor="middle" fill={colors.text} fontSize="14" fontWeight="bold" transform={`rotate(-90, 20, ${750 / 2})`}>UMAP Dimension 2</text>
                        </>
                      );
                    })()}
                    
                    {/* Data points (single pass, selected last) */}
                    {(() => {
                      const nonSelected = [] as UmapDataObject[];
                      const selected = [] as UmapDataObject[];
                      for (let i = 0; i < filteredData.length; i++) {
                        const obj = filteredData[i];
                        if (selectedObjectId === obj._id) selected.push(obj); else nonSelected.push(obj);
                      }
                      const renderPoint = (obj: UmapDataObject, idx: number) => {
                        const x = padding + ((obj.umap_2d[0] - bounds.minX) / ((bounds.maxX - bounds.minX) || 1)) * (900 - 2 * padding);
                        const y = 750 - padding - ((obj.umap_2d[1] - bounds.minY) / ((bounds.maxY - bounds.minY) || 1)) * (750 - 2 * padding);
                        const isHovered = hoveredPoint?._id === obj._id;
                        const isSelected = selectedObjectId === obj._id;
                        return (
                          <circle
                            key={obj._id || idx}
                            cx={x}
                            cy={y}
                            r={isSelected ? 8 : isHovered ? 6 : 4}
                            fill={getPointColor(obj)}
                            stroke={isHovered || isSelected ? colors.text : 'none'}
                            strokeWidth={isSelected ? 3 : isHovered ? 1 : 0}
                            style={{ cursor: 'pointer', pointerEvents: 'none' }}
                          />
                        );
                      };
                      return (
                        <>
                          {nonSelected.map((o, i) => renderPoint(o, i))}
                          {selected.map((o, i) => renderPoint(o, i))}
                        </>
                      );
                    })()}
                  </g>
                </svg>
                {/* Tooltip for popup */}
                {hoveredPoint && hoverContext === 'popup' && (
                  <div
                    className={`absolute pointer-events-none z-10 px-3 py-2 rounded shadow-lg border ${
                      theme === 'dark' 
                        ? 'bg-[#2a2a2a] border-gray-600 text-white' 
                        : 'bg-white border-gray-300 text-gray-800'
                    }`}
                    style={{
                      left: mousePos.x + 10,
                      top: mousePos.y - 10,
                      transform: mousePos.x > (mouseCtxWidth - 200) ? 'translateX(-100%)' : 'none'
                    }}
                  >
                    <div className="text-sm space-y-1">
                      <div><strong>ObsID:</strong> {hoveredPoint.obsid}</div>
                      <div><strong>Source:</strong> {hoveredPoint.source_name}</div>
                      <div><strong>UMAP:</strong> ({hoveredPoint.umap_2d[0].toFixed(2)}, {hoveredPoint.umap_2d[1].toFixed(2)})</div>
                      {(() => {
                        const raw = hoveredPoint[colorBy] as unknown;
                        if (raw === undefined || raw === null || raw === '') return null;
                        const text = typeof raw === 'number' ? (raw as number).toFixed(3) : String(raw);
                        return (
                          <div>
                            <strong>{colorBy.replace('_', '/')}:</strong> {text}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const UmapVisualization = React.memo(UmapVisualizationComponent);