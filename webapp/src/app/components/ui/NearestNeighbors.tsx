"use client";

import React, { useState, useEffect, useRef } from 'react';
import { NearestNeighbor, loadEnhancedObjectDetails, loadObjectDetails } from '@/app/actions/playgroundActions';
import { LightCurveData } from '@/app/types/chat';
import { LightCurveChart } from './LightCurveChart';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

interface NearestNeighborsProps {
  neighbors: NearestNeighbor[];
  isLoading: boolean;
  error: string | null;
  theme?: 'light' | 'dark';
  collectionName: string;
  onNeighborSelect?: (neighbor: NearestNeighbor) => void;
}

interface NeighborCardProps {
  neighbor: NearestNeighbor;
  theme?: 'light' | 'dark';
  collectionName: string;
  onSelect?: (neighbor: NearestNeighbor) => void;
}

const NeighborCard: React.FC<NeighborCardProps> = ({ neighbor, theme = 'light', collectionName, onSelect }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [lightCurveData, setLightCurveData] = useState<LightCurveData | null>(null);
  const [isLoadingLightCurve, setIsLoadingLightCurve] = useState(false);
  const [lightCurveError, setLightCurveError] = useState<string | null>(null);
  const loadedNeighborIdRef = useRef<string | null>(null);
  const cardClass = theme === 'dark' 
    ? 'bg-[#1A1832] border-[#2A254D] text-white hover:bg-[#1E1A3C]' 
    : 'bg-white border-gray-200 text-gray-900 hover:bg-gray-50';

  const textClass = theme === 'dark' ? 'text-gray-300' : 'text-gray-600';
  const valueClass = theme === 'dark' ? 'text-white' : 'text-gray-900';

  // Prepare spectral properties data - split into basic and extended
  const basicProperties = [
    { key: 'hard_hs', label: 'Hard HS', value: neighbor.hard_hs },
    { key: 'hard_hm', label: 'Hard HM', value: neighbor.hard_hm },
    { key: 'hard_ms', label: 'Hard MS', value: neighbor.hard_ms },
    { key: 'flux_significance_b', label: 'Flux Significance B', value: neighbor.flux_significance_b },
  ].filter(prop => prop.value !== undefined && prop.value !== null);

  const extendedProperties = [
    { key: 'var_index_b', label: 'Variability Index B', value: neighbor.var_index_b },
    { key: 'bb_kt', label: 'BB kT', value: neighbor.bb_kt },
    { key: 'powlaw_gamma', label: 'Power Law Gamma', value: neighbor.powlaw_gamma },
    { key: 'powlaw_stat', label: 'Power Law Stat', value: neighbor.powlaw_stat },
    { key: 'bb_stat', label: 'BB Stat', value: neighbor.bb_stat },
    { key: 'brems_stat', label: 'Brems Stat', value: neighbor.brems_stat },
    { key: 'apec_stat', label: 'APEC Stat', value: neighbor.apec_stat },
    { key: 'powlaw_nh', label: 'Power Law NH', value: neighbor.powlaw_nh },
    { key: 'apec_nh', label: 'APEC NH', value: neighbor.apec_nh },
    { key: 'bb_nh', label: 'BB NH', value: neighbor.bb_nh },
    { key: 'brems_kt', label: 'Brems kT', value: neighbor.brems_kt },
  ].filter(prop => prop.value !== undefined && prop.value !== null);

  const totalProperties = basicProperties.length + extendedProperties.length;

  // Load light curve data when card is expanded
  useEffect(() => {
    // Only load if expanded and not already loaded for this specific neighbor
    if (isExpanded && loadedNeighborIdRef.current !== neighbor._id && !isLoadingLightCurve) {
      const loadLightCurve = async () => {
        try {
          setIsLoadingLightCurve(true);
          setLightCurveError(null);
          setLightCurveData(null);
          
          // console.log('Loading light curve for neighbor:', neighbor._id);
          
          // First get full object details (same as main object pattern)
          const fullObjectDetails = await loadObjectDetails({
            collection_name: collectionName,
            object_id: neighbor._id
          });
          
          // Then process enhanced details with full object data
          const enhancedDetails = await loadEnhancedObjectDetails({
            object_data: fullObjectDetails
          });
          
          // Mark as loaded immediately to prevent re-requests
          loadedNeighborIdRef.current = neighbor._id;
          
          if (enhancedDetails.success && enhancedDetails.light_curve) {
            setLightCurveData(enhancedDetails.light_curve);
            // console.log('Light curve loaded successfully for neighbor:', neighbor._id);
          } else {
            console.warn('Light curve processing failed for neighbor:', enhancedDetails.error);
            setLightCurveError(enhancedDetails.error || 'Failed to process light curve');
          }
        } catch (error) {
          console.error('Failed to load light curve for neighbor:', error);
          const errorMessage = error instanceof Error ? error.message : 'Failed to load light curve';
          setLightCurveError(errorMessage);
          // Mark as attempted even on error
          loadedNeighborIdRef.current = neighbor._id;
        } finally {
          setIsLoadingLightCurve(false);
        }
      };

      loadLightCurve();
    }
  }, [isExpanded, neighbor._id, isLoadingLightCurve]); // Only depend on stable primitive values

  // Reset data when neighbor changes
  useEffect(() => {
    if (loadedNeighborIdRef.current && loadedNeighborIdRef.current !== neighbor._id) {
      setLightCurveData(null);
      setLightCurveError(null);
      loadedNeighborIdRef.current = null;
      setIsLoadingLightCurve(false);
    }
  }, [neighbor._id]);

  return (
    <div 
      className={`border rounded-lg p-4 transition-colors ${cardClass}`}
      onDoubleClick={() => onSelect?.(neighbor)}
    >
      {/* Header with basic info */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className={`font-semibold text-sm ${valueClass}`}>
            {neighbor.source_name}
          </h4>
          <div className="flex items-center space-x-2">
            <div className={`text-xs px-2 py-1 rounded ${
              theme === 'dark' ? 'bg-[#00E0FF]/20 text-[#00E0FF]' : 'bg-blue-50 text-blue-600'
            }`}>
              {(neighbor.score * 100).toFixed(1)}% match
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className={`p-1 rounded transition-colors ${
                theme === 'dark' 
                  ? 'hover:bg-[#2A254D] text-gray-400 hover:text-[#00E0FF]' 
                  : 'hover:bg-gray-100 text-gray-500 hover:text-blue-600'
              }`}
              title={isExpanded ? 'Collapse details' : 'Expand details'}
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className={textClass}>
            <span className="font-medium">ObsID:</span> {neighbor.obsid}
          </div>
          {neighbor.source_type && (
            <div className={textClass}>
              <span className="font-medium">Type:</span> {neighbor.source_type}
            </div>
          )}
          {neighbor.source_type_category && (
            <div className={textClass}>
              <span className="font-medium">Category:</span> {neighbor.source_type_category}
            </div>
          )}
          {neighbor.recommended_model && (
            <div className={textClass}>
              <span className="font-medium">Model:</span> {neighbor.recommended_model}
            </div>
          )}
        </div>
      </div>

      {/* Basic Spectral Properties (Always Visible) */}
      {basicProperties.length > 0 && (
        <div className="mb-3">
          <h5 className={`text-xs font-semibold mb-2 ${textClass}`}>
            Spectral Properties
            {!isExpanded && extendedProperties.length > 0 && (
              <span className={`ml-1 text-xs font-normal ${textClass}`}>
                ({basicProperties.length}/{totalProperties})
              </span>
            )}
          </h5>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {basicProperties.map((prop) => (
              <div key={prop.key} className={textClass}>
                <span className="font-medium">{prop.label}:</span>
                <span className={`ml-1 ${valueClass}`}>
                  {typeof prop.value === 'number' ? prop.value.toFixed(3) : prop.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Extended Spectral Properties (Only When Expanded) */}
      {isExpanded && extendedProperties.length > 0 && (
        <div className="mb-3">
          <h5 className={`text-xs font-semibold mb-2 ${textClass}`}>Extended Properties</h5>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {extendedProperties.map((prop) => (
              <div key={prop.key} className={textClass}>
                <span className="font-medium">{prop.label}:</span>
                <span className={`ml-1 ${valueClass}`}>
                  {typeof prop.value === 'number' ? prop.value.toFixed(3) : prop.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Light Curve (Only When Expanded) */}
      {isExpanded && (
        <div className="mt-4 border-t pt-4">
          <div className="flex items-center space-x-2 mb-2">
            <h5 className={`text-xs font-semibold ${textClass}`}>Light Curve</h5>
            {isLoadingLightCurve && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
          </div>
          
          {isLoadingLightCurve ? (
            <div className={`h-32 flex items-center justify-center rounded border ${
              theme === 'dark' ? 'bg-[#0D0C22] border-gray-800' : 'bg-gray-50 border-gray-200'
            }`}>
              <div className="flex items-center text-blue-400">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                <span className="text-xs">Computing light curve...</span>
              </div>
            </div>
          ) : lightCurveError ? (
            <div className={`h-32 flex items-center justify-center rounded border ${
              theme === 'dark' ? 'bg-red-900/20 border-red-800' : 'bg-red-50 border-red-200'
            }`}>
              <div className={`text-center ${
                theme === 'dark' ? 'text-red-300' : 'text-red-700'
              }`}>
                <p className="text-xs font-medium">Failed to load light curve</p>
                <p className="text-xs opacity-70">{lightCurveError}</p>
              </div>
            </div>
          ) : lightCurveData && lightCurveData.total_events > 0 ? (
            <div className="mb-2 overflow-hidden relative border rounded" style={{
              height: '600px',
              width: '100%',
              contain: 'layout style',
              backgroundColor: theme === 'dark' ? '#1A1832' : '#ffffff'
            }}>
              <div className="w-full h-full" style={{ padding: '8px 8px' }}>
                <div style={{
                  transform: 'scale(0.92)',
                  transformOrigin: 'top center',
                  width: '800px',
                  height: '500px',
                  marginLeft: '-3%'
                }}>
                  <LightCurveChart 
                    lightCurveData={lightCurveData} 
                    theme={theme}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className={`h-32 flex items-center justify-center rounded border ${
              theme === 'dark' ? 'bg-[#0D0C22] border-gray-800' : 'bg-gray-50 border-gray-200'
            }`}>
              <div className={`text-center ${textClass}`}>
                <p className="text-xs">No light curve data available</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Usage hint */}
      {!isExpanded && (
        <div className={`text-xs mt-2 ${textClass} opacity-70`}>
          Double-click to select • Click → to expand
        </div>
      )}
    </div>
  );
};

export const NearestNeighbors: React.FC<NearestNeighborsProps> = ({ 
  neighbors, 
  isLoading, 
  error, 
  theme = 'light',
  collectionName,
  onNeighborSelect 
}) => {
  const containerClass = theme === 'dark' 
    ? 'bg-[#111125] text-white' 
    : 'bg-gray-50 text-gray-900';

  const titleClass = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textClass = theme === 'dark' ? 'text-gray-300' : 'text-gray-600';

  if (isLoading) {
    return (
      <div className={`rounded-lg p-4 ${containerClass}`}>
        <h3 className={`text-lg font-semibold mb-4 ${titleClass}`}>
          Nearest Neighbours
        </h3>
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className={`rounded-lg p-4 animate-pulse ${
              theme === 'dark' ? 'bg-[#1A1832]' : 'bg-gray-200'
            }`}>
              <div className={`h-4 rounded mb-2 ${
                theme === 'dark' ? 'bg-[#2A254D]' : 'bg-gray-300'
              }`}></div>
              <div className={`h-3 rounded mb-2 w-3/4 ${
                theme === 'dark' ? 'bg-[#2A254D]' : 'bg-gray-300'
              }`}></div>
              <div className={`h-20 rounded ${
                theme === 'dark' ? 'bg-[#2A254D]' : 'bg-gray-300'
              }`}></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-lg p-4 ${containerClass}`}>
        <h3 className={`text-lg font-semibold mb-4 ${titleClass}`}>
          Nearest Neighbours
        </h3>
        <div className={`p-3 rounded-lg ${
          theme === 'dark' ? 'bg-red-900/20 text-red-300' : 'bg-red-50 text-red-700'
        }`}>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!neighbors.length) {
    return (
      <div className={`rounded-lg p-4 ${containerClass}`}>
        <h3 className={`text-lg font-semibold mb-4 ${titleClass}`}>
          Nearest Neighbours
        </h3>
        <div className={`text-center py-8 ${textClass}`}>
          <p>No similar objects found</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg p-4 ${containerClass}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className={`text-lg font-semibold ${titleClass}`}>
          Nearest Neighbours
        </h3>
        <span className={`text-sm ${textClass}`}>
          {neighbors.length} similar objects • Expand to compute light curves
        </span>
      </div>
      
      <div className="space-y-4 max-h-[1000px] overflow-y-auto">
        {neighbors.map((neighbor) => (
          <NeighborCard
            key={neighbor._id}
            neighbor={neighbor}
            theme={theme}
            collectionName={collectionName}
            onSelect={onNeighborSelect}
          />
        ))}
      </div>
    </div>
  );
};