"use client";

import { DataObject, ObjectDetails, loadObjectDetails, loadEnhancedObjectDetails, loadUmapData, UmapDataObject, loadNearestNeighbors, NearestNeighbor } from '@/app/actions/playgroundActions';
import { EnhancedObjectDetails, LightCurveData } from '@/app/types/chat';
import { TimeLightCurveChart } from '../ui/TimeLightCurveChart';
import GLLightCurveChart from '../ui/GLLightCurveChart';
import { LightCurveChart } from '@/app/components/ui/LightCurveChart';
import { UmapVisualization } from '@/app/components/ui/UmapVisualization';
import { NearestNeighbors } from '@/app/components/ui/NearestNeighbors';
import { LayoutContext } from '@/app/context/LayoutContext';
import { usePlayground } from '@/app/context/PlaygroundContext';
import { useSettings } from '@/app/context/SettingsContext';
import { Activity, AlertTriangle, ArrowLeft, CheckCircle, ChevronDown, ChevronRight, ChevronUp, Database, Info, Loader2, Maximize2, Minimize2, Star, X } from 'lucide-react';
import { useContext, useEffect, useState } from 'react';
import { Clipboard } from 'lucide-react';

interface DataObjectInfoProps {
  object: DataObject | null;
  datasetName?: string;
}

export default function DataObjectInfo({ object, datasetName }: DataObjectInfoProps) {
  const { state, dispatch } = usePlayground();
  const { objectDetails, nearestNeighbors } = state;
  const { isObjectDetailsExpanded, toggleObjectDetails, isMobileView: isLayoutMobile } = useContext(LayoutContext);
  const { theme } = useSettings();

  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [isMobileView, setIsMobileView] = useState<boolean>(false);
  const [isVerySmallScreen, setIsVerySmallScreen] = useState<boolean>(false);
  
  // Enhanced object details state
  const [enhancedDetails, setEnhancedDetails] = useState<EnhancedObjectDetails | null>(null);
  const [lightCurveData, setLightCurveData] = useState<LightCurveData | null>(null);
  const [timeLightCurve, setTimeLightCurve] = useState<any | null>(null);
  
  // UMAP data state
  const [umapData, setUmapData] = useState<UmapDataObject[]>([]);
  const [isLoadingUmap, setIsLoadingUmap] = useState<boolean>(false);
  const [umapError, setUmapError] = useState<string | null>(null);
  const [addedObjectIds, setAddedObjectIds] = useState<Set<string>>(new Set());

  // Nearest neighbors state
  const [isLoadingNeighbors, setIsLoadingNeighbors] = useState<boolean>(false);
  const [neighborsError, setNeighborsError] = useState<string | null>(null);

  // Mobile-specific state
  const [activeTab, setActiveTab] = useState<string>('basic');
  const [isFullScreenMode, setIsFullScreenMode] = useState<boolean>(false);

  // Define available tabs
  const tabs = [
    { id: 'basic', label: 'Basic', icon: <Info className="w-4 h-4" /> },
    { id: 'lightcurve', label: 'Light Curve', icon: <Activity className="w-4 h-4" /> },
    { id: 'embed', label: 'Embedding', icon: <Database className="w-4 h-4" /> },
    { id: 'umap', label: 'UMAP', icon: <Database className="w-4 h-4" /> },
    { id: 'neighbors', label: 'Neighbors', icon: <Star className="w-4 h-4" /> },
    { id: 'summary', label: 'Summary', icon: <Star className="w-4 h-4" /> },
    { id: 'data', label: 'Data', icon: <Activity className="w-4 h-4" /> }
  ];

  // Determine which object data to display - use objectDetails if available, otherwise use object
  const displayObject = objectDetails || object;

  const hasEmbedding = displayObject !== null &&
                    'embedding' in displayObject &&
                    displayObject.embedding !== undefined &&
                    Array.isArray(displayObject.embedding) &&
                    displayObject.embedding.length > 0;

  // Only check if all values are zero if we have an embedding array
  const isValidEmbedding = hasEmbedding &&
                          !displayObject.embedding!.every(val => val === 0);

  // Check for mobile/small screen view
  useEffect(() => {
    const checkMobileView = () => {
      const isMobile = window.innerWidth < 768;
      setIsMobileView(isMobile);
      setIsVerySmallScreen(window.innerWidth < 480);

      // Reset full screen mode when switching to desktop
      if (!isMobile && isFullScreenMode) {
        setIsFullScreenMode(false);
      }
    };

    // Check initially
    checkMobileView();

    // Set up resize listener
    window.addEventListener("resize", checkMobileView);

    // Clean up
    return () => {
      window.removeEventListener("resize", checkMobileView);
    };
  }, [isFullScreenMode]);

  // Fetch full object details when selected object changes
  useEffect(() => {
      async function fetchObjectDetails() {
    if (!object || !object._id) {
      return;
    }

    try {
      setIsLoadingDetails(true);
      setDetailsError(null);
      dispatch({ type: 'SET_LOADING', key: 'objectDetails', payload: true });
      dispatch({ type: 'SET_ERROR', key: 'objectDetails', payload: null });

      // Check if this is an uploaded object (custom ID format like UPD_*)
      const isUploadedObject = object._id.startsWith('UPD_');

      if (isUploadedObject) {
        console.log('Using uploaded object data directly:', object._id);
        
        // For uploaded objects, use the object data directly without database calls
        dispatch({ type: 'SET_OBJECT_DETAILS', payload: {
          ...object,
          source_type: object.source_type || ''
        } as ObjectDetails });

        // Try enhanced processing with the uploaded object data
        try {
          const enhancedDetails = await loadEnhancedObjectDetails({
            object_data: object
          });

          console.log('Received enhanced processing results for uploaded object:', enhancedDetails);
          
          if (enhancedDetails.success) {
            setEnhancedDetails(enhancedDetails);
            if (enhancedDetails.light_curve) {
              setLightCurveData(enhancedDetails.light_curve);
              setTimeLightCurve(enhancedDetails.time_light_curve || null);
            }
          } else {
            console.warn('Enhanced processing failed for uploaded object:', enhancedDetails.error);
          }
        } catch (enhancedError) {
          console.warn('Enhanced processing not available for uploaded objects:', enhancedError);
          // This is expected - enhanced processing might not work with custom objects
        }
      } else {
        // Original object from database - proceed with existing logic
        if (!state.selectedDataset?.collection_name) {
          throw new Error('No dataset selected for original object');
        }

        console.log('Fetching object details from database:', {
          collection_name: state.selectedDataset.collection_name,
          object_id: object._id
        });

        // First fetch the full object details using the existing loadObjectDetails
        const fullObjectDetails = await loadObjectDetails({
          collection_name: state.selectedDataset.collection_name,
          object_id: object._id
        });

        console.log('Received full object details:', fullObjectDetails);
        dispatch({ type: 'SET_OBJECT_DETAILS', payload: fullObjectDetails });

        // Then process the object data for enhanced features
        const enhancedDetails = await loadEnhancedObjectDetails({
          object_data: fullObjectDetails
        });

        console.log('Received enhanced processing results:', enhancedDetails);
        
        if (enhancedDetails.success) {
          setEnhancedDetails(enhancedDetails);
          if (enhancedDetails.light_curve) {
            setLightCurveData(enhancedDetails.light_curve);
            setTimeLightCurve(enhancedDetails.time_light_curve || null);
          }
        } else {
          console.warn('Enhanced processing failed:', enhancedDetails.error);
          // Continue with basic object details even if enhanced processing fails
        }
      }
    } catch (error) {
      console.error('Failed to load object details:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load object details';
      setDetailsError(errorMessage);
      dispatch({ type: 'SET_ERROR', key: 'objectDetails', payload: errorMessage });
    } finally {
      setIsLoadingDetails(false);
      dispatch({ type: 'SET_LOADING', key: 'objectDetails', payload: false });
    }
  }

    fetchObjectDetails();
  }, [object?._id, state.selectedDataset?.collection_name, dispatch]);

  // Fetch initial UMAP data when dataset changes
  useEffect(() => {
    async function fetchInitialUmapData() {
      if (!state.selectedDataset?.collection_name) {
        return;
      }

      try {
        setIsLoadingUmap(true);
        setUmapError(null);
        
        console.log('Fetching initial UMAP data for collection:', state.selectedDataset.collection_name);
        
        // Load base UMAP data without specific object
        const umapResponse = await loadUmapData(state.selectedDataset.collection_name);
        
        console.log(`Received ${umapResponse.objects.length} initial UMAP objects`);
        setUmapData(umapResponse.objects);
        // Track initial object IDs
        setAddedObjectIds(new Set(umapResponse.objects.map(obj => obj._id)));
      } catch (error) {
        console.error('Failed to load initial UMAP data:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to load UMAP data';
        setUmapError(errorMessage);
      } finally {
        setIsLoadingUmap(false);
      }
    }

    fetchInitialUmapData();
  }, [state.selectedDataset?.collection_name]);

  // Add selected object to UMAP data if not already present
  useEffect(() => {
    async function addSelectedObjectToUmap() {
      if (!object?._id) {
        return;
      }

      // If uploaded object has its own UMAP coordinate, inject it directly
      const isUploadedObject = object._id.startsWith('UPD_') || !/^[0-9a-fA-F]{24}$/.test(object._id);
      const hasOwnUmap = Array.isArray(object.umap_2d) && object.umap_2d.length === 2 &&
                         typeof object.umap_2d[0] === 'number' && typeof object.umap_2d[1] === 'number';
      if (isUploadedObject && hasOwnUmap) {
        if (!addedObjectIds.has(object._id)) {
          console.log('Injecting uploaded object into UMAP data:', object._id);
          const injected: UmapDataObject = {
            _id: object._id,
            umap_2d: object.umap_2d as [number, number],
            obsid: object.obsid,
            source_name: object.source_name,
            source_type: object.source_type as any
          };
          setUmapData(prev => [...prev, injected]);
          setAddedObjectIds(prev => new Set([...prev, object._id]));
        }
        return;
      }

      // For original objects, proceed with existing logic
      if (!state.selectedDataset?.collection_name || addedObjectIds.size === 0) {
        return;
      }

      // Check if the selected object is already tracked
      if (addedObjectIds.has(object._id)) {
        return; // Object already exists
      }

      try {
        console.log('Adding selected object to UMAP data:', object._id);
        
        // Fetch just the selected object's UMAP data
        const umapResponse = await loadUmapData(
          state.selectedDataset.collection_name, 
          object._id
        );
        
        // Find the new object in the response
        const newObject = umapResponse.objects.find(obj => obj._id === object._id);
        if (newObject) {
          console.log('Adding new object to existing UMAP data');
          setUmapData(prevData => [...prevData, newObject]);
          setAddedObjectIds(prevIds => new Set([...prevIds, object._id]));
        }
      } catch (error) {
        console.error('Failed to add selected object to UMAP data:', error);
      }
    }

    addSelectedObjectToUmap();
  }, [object?._id]);

  // Fetch nearest neighbors when object changes
  useEffect(() => {
    async function fetchNearestNeighbors() {
      if (!object?._id) {
        dispatch({ type: 'SET_NEAREST_NEIGHBORS', payload: [] });
        return;
      }

      // Check if this is an uploaded object (custom ID format like UPD_* or any non-ObjectId)
      const isUploadedObject = object._id.startsWith('UPD_') || !/^[0-9a-fA-F]{24}$/.test(object._id);

      if (isUploadedObject) {
        // If the object has pca_64d, use it directly to compute neighbors against the dataset
        if (object.pca_64d && Array.isArray(object.pca_64d) && object.pca_64d.length > 0 && state.selectedDataset?.collection_name) {
          try {
            setIsLoadingNeighbors(true);
            setNeighborsError(null);
            console.log('Computing nearest neighbors by vector for uploaded object:', object._id);

            const resp = await fetch('/api/nearest-neighbors', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                collection_name: state.selectedDataset.collection_name,
                vector: object.pca_64d,
                limit: 10
              })
            });

            if (!resp.ok) {
              const err = await resp.json();
              throw new Error(err.error || 'Failed nearest neighbors by vector');
            }

            const data = await resp.json();
            console.log(`Found ${data.neighbors.length} nearest neighbors (uploaded object)`);
            dispatch({ type: 'SET_NEAREST_NEIGHBORS', payload: data.neighbors });
            return;
          } catch (e) {
            console.error('Failed vector-based neighbor search for uploaded object:', e);
            setNeighborsError(e instanceof Error ? e.message : 'Vector neighbor search failed');
            dispatch({ type: 'SET_NEAREST_NEIGHBORS', payload: [] });
            return;
          } finally {
            setIsLoadingNeighbors(false);
          }
        }

        // If no vector is available yet, skip for now
        console.log('Uploaded object missing pca_64d; skipping neighbors:', object._id);
        dispatch({ type: 'SET_NEAREST_NEIGHBORS', payload: [] });
        return;
      }

      // For original objects, proceed with database lookup
      if (!state.selectedDataset?.collection_name) {
        dispatch({ type: 'SET_NEAREST_NEIGHBORS', payload: [] });
        return;
      }

      try {
        setIsLoadingNeighbors(true);
        setNeighborsError(null);
        
        console.log('Fetching nearest neighbors for object:', object._id);
        
        const neighborsResponse = await loadNearestNeighbors(
          state.selectedDataset.collection_name,
          object._id
        );
        
        console.log(`Found ${neighborsResponse.neighbors.length} nearest neighbors`);
        console.log("🔍 Debug - Setting neighbors in context:", {
          neighborsCount: neighborsResponse.neighbors.length,
          firstNeighbor: neighborsResponse.neighbors[0] ? {
            id: neighborsResponse.neighbors[0]._id,
            obsid: neighborsResponse.neighbors[0].obsid,
            source_name: neighborsResponse.neighbors[0].source_name
          } : null
        });
        dispatch({ type: 'SET_NEAREST_NEIGHBORS', payload: neighborsResponse.neighbors });
      } catch (error) {
        console.error('Failed to load nearest neighbors:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to load nearest neighbors';
        setNeighborsError(errorMessage);
        dispatch({ type: 'SET_NEAREST_NEIGHBORS', payload: [] });
      } finally {
        setIsLoadingNeighbors(false);
      }
    }

    fetchNearestNeighbors();
  }, [object?._id, state.selectedDataset?.collection_name, dispatch]);

  const toggleSection = (section: string) => {
    if (expandedSection === section) {
      setExpandedSection(null);
    } else {
      setExpandedSection(section);
    }
  };

  // Handle object selection from UMAP visualization
  const handleObjectSelect = async (objectId: string) => {
    if (!state.selectedDataset?.collection_name) return;
    
    try {
      // Load the full object details for the selected object
      const fullObjectDetails = await loadObjectDetails({
        collection_name: state.selectedDataset.collection_name,
        object_id: objectId
      });
      
      // Update the selected object in the context
      dispatch({ type: 'SET_SELECTED_OBJECT', payload: fullObjectDetails });
      dispatch({ type: 'SET_OBJECT_DETAILS', payload: fullObjectDetails });
      
      // Clear current messages to start fresh chat
      dispatch({ type: 'CLEAR_MESSAGES' });
      
      console.log('Selected new object from UMAP:', objectId);
    } catch (error) {
      console.error('Failed to select object from UMAP:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to select object';
      dispatch({ type: 'SET_ERROR', key: 'objectDetails', payload: errorMessage });
    }
  };

  // Handle neighbor selection from nearest neighbors list
  const handleNeighborSelect = async (neighbor: NearestNeighbor) => {
    if (!state.selectedDataset?.collection_name) return;
    
    try {
      // Load the full object details for the selected neighbor
      const fullObjectDetails = await loadObjectDetails({
        collection_name: state.selectedDataset.collection_name,
        object_id: neighbor._id
      });
      
      // Update the selected object in the context
      dispatch({ type: 'SET_SELECTED_OBJECT', payload: fullObjectDetails });
      dispatch({ type: 'SET_OBJECT_DETAILS', payload: fullObjectDetails });
      
      // Clear current messages to start fresh chat
      dispatch({ type: 'CLEAR_MESSAGES' });
      
      console.log('Selected new object from neighbors:', neighbor._id);
    } catch (error) {
      console.error('Failed to select neighbor object:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to select neighbor';
      dispatch({ type: 'SET_ERROR', key: 'objectDetails', payload: errorMessage });
    }
  };

  // Toggle fullscreen mode for mobile
  const toggleFullScreenMode = () => {
    if (isMobileView) {
      setIsFullScreenMode(!isFullScreenMode);
    }
  };

  if (!object) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <p className={`text-center ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
          Select a dataset object to view details
        </p>
      </div>
    );
  }

  // Format numbers carefully, handling possible NaN values
  const formatNumber = (value: number | null | undefined, decimals = 2, useExp = false) => {
    if (value === null || value === undefined || isNaN(value)) return 'N/A';
    if (useExp || Math.abs(value) < 0.01 || Math.abs(value) > 9999) {
      return value.toExponential(decimals);
    }
    return value.toFixed(decimals);
  };

  // Extract summary from qna if available or use answer field
  const getSummary = () => {
    if (displayObject === null) return 'No summary available';

    if (displayObject.qna && Array.isArray(displayObject.qna) && displayObject.qna.length >= 3) {
      return displayObject.qna[2].answer || 'No summary available';
    }

    if (displayObject.answer) {
      const firstParagraph = displayObject.answer.split('\n\n')[0];
      return firstParagraph;
    }

    return 'No summary available';
  };

  // Render the mobile full-screen version of the component
      if (isMobileView && isObjectDetailsExpanded && isFullScreenMode) {
    return (
      <div className={`fixed inset-0 ${theme === 'dark' ? 'bg-[#0D0C22]' : 'bg-white'} z-50 flex flex-col overflow-hidden`}>
        {/* Header */}
        <div className={`${theme === 'dark' ? 'bg-[#111125] border-gray-800/40' : 'bg-white border-gray-200/40'} p-3 border-b flex items-center justify-between flex-shrink-0`}>
          <div className="flex items-center">
            <button
              onClick={toggleFullScreenMode}
              className={`mr-3 ${theme === 'dark' ? 'text-gray-400 hover:text-[#00E0FF]' : 'text-gray-500 hover:text-blue-600'} transition-colors`}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h2 className={`text-lg font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>
              {object.source_name || object.obsid || 'Object Details'}
            </h2>
          </div>
          <div className="flex items-center space-x-3">
            <span className={`text-xs ${theme === 'dark' ? 'bg-[#1E1A3C] text-[#00E0FF]' : 'bg-blue-50 text-[#2957D8]'} text-xs px-2 py-1 rounded-full`}
                  style={theme !== 'dark' ? { color: '#2957D8' } : {}}>
              {object.source_type || 'Unknown Type'}
            </span>
            <button
              onClick={toggleObjectDetails}
              className={`${theme === 'dark' ? 'text-gray-400 hover:text-[#00E0FF]' : 'text-gray-500 hover:text-blue-600'} transition-colors`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className={`${theme === 'dark' ? 'bg-[#111125] border-gray-800/40' : 'bg-white border-gray-200/40'} p-2 border-b flex-shrink-0 overflow-x-auto`}>
          <div className="flex space-x-2">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center px-3 py-2 rounded-lg ${
                  activeTab === tab.id 
                    ? theme === 'dark'
                      ? 'bg-[#1E1A3C] text-[#00E0FF]'
                      : 'bg-blue-50 text-blue-600'
                    : theme === 'dark'
                      ? 'bg-[#161335] text-gray-400 hover:bg-[#1E1A3C]/70 hover:text-gray-200'
                      : 'bg-gray-50 text-gray-600 hover:bg-blue-50/70 hover:text-blue-600'
                } transition-colors`}
              >
                <span className="mr-1.5">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content Area */}
        <div className={`flex-1 overflow-y-auto p-3 ${theme === 'dark' ? 'bg-[#0D0C22]' : 'bg-gray-50'}`}>
          {/* Light Curve Tab */}
          {activeTab === 'lightcurve' && (
            <div className="space-y-4">
              {lightCurveData && lightCurveData.total_events > 0 ? (
                <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg`}>
                  <LightCurveChart 
                    lightCurveData={lightCurveData} 
                    theme={theme}
                  />
                </div>
              ) : (
                <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg text-center`}>
                  <Activity className={`w-8 h-8 mx-auto mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`} />
                  <p className={`${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    {isLoadingDetails ? 'Loading light curve data...' : 'No event data available for light curve visualization'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Basic Info Tab */}
          {activeTab === 'basic' && displayObject !== null && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg`}>
                  <h3 className={`text-xs uppercase ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>ObsID</h3>
                  <p className={`${theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'} text-xl font-medium truncate`}>{displayObject?.obsid || 'N/A'}</p>
                </div>

                <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg`}>
                  <h3 className={`text-xs uppercase ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Source</h3>
                  <p className={`${theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'} text-xl font-medium truncate`}>{displayObject?.source_name || 'N/A'}</p>
                </div>
              </div>

              <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg`}>
                <h3 className={`text-xs uppercase ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-2`}>Coordinates</h3>
                <div className="grid grid-cols-2 gap-3">
                  {displayObject.ra !== undefined && (
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>RA</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.ra, 6)}</p>
                    </div>
                  )}

                  {displayObject.dec !== undefined && (
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>DEC</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject?.dec, 6)}</p>
                    </div>
                  )}

                  {displayObject?.z !== undefined && (
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>Redshift (z)</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.z, 6)}</p>
                    </div>
                  )}

                  {displayObject.gti_mjd_obs !== undefined && (
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>Obs Date (MJD)</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.gti_mjd_obs, 5)}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Add Event List section in basic info tab */}
              {displayObject.event_list !== undefined && (
                <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg`}>
                  <h3 className={`text-xs uppercase ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-2`}>Event List</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>Start</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.event_list[0][0], 6)}</p>
                    </div>
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>End</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.event_list[1][0], 6)}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg`}>
                <h3 className={`text-xs uppercase ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-2`}>Model Statistics</h3>
                <div className="grid grid-cols-2 gap-3">
                  {displayObject.powlaw_stat !== undefined && (
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>Power Law</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.powlaw_stat, 3)}</p>
                    </div>
                  )}
                  {displayObject.apec_stat !== undefined && (
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>APEC</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.apec_stat, 3)}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Embedding Tab */}
          {activeTab === 'embed' && (
            <div className="space-y-4">
              <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg`}>
                <h3 className={`text-sm font-medium ${theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'} mb-3 flex items-center`}>
                  {!hasEmbedding ? (
                    <AlertTriangle className="w-4 h-4 mr-2 text-red-400" />
                  ) : !isValidEmbedding ? (
                    <AlertTriangle className="w-4 h-4 mr-2 text-red-400" />
                  ) : (
                    <CheckCircle className="w-4 h-4 mr-2 text-green-400" />
                  )}
                  Embedding Status
                </h3>

                {!hasEmbedding ? (
                  <p className="text-red-400">No embedding data available for this object</p>
                ) : !isValidEmbedding ? (
                  <div>
                    <p className="text-red-400 mb-2">Invalid embedding: all values are zero</p>
                    <p className={`${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'} text-sm`}>This may cause issues with the chat functionality. The model needs valid embedding data to generate contextual responses.</p>
                  </div>
                ) : displayObject !== null && (
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-green-400 font-medium">Valid embedding data</span>
                      <span className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                        {displayObject.embedding!.length} dimensions
                      </span>
                    </div>

                    <div className={`${theme === 'dark' ? 'bg-[#161335]' : 'bg-gray-50 border border-gray-200/40'} rounded p-3 max-h-60 overflow-y-auto`}>
                      <div className="flex justify-between items-center mb-2">
                        <span className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Min value: {Math.min(...displayObject.embedding!).toFixed(4)}, max value: {Math.max(...displayObject.embedding!).toFixed(4)}</span>
                      </div>
                      <pre className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'} break-all whitespace-pre-wrap`}>
                        {JSON.stringify(displayObject.embedding!.map(v => parseFloat(v.toFixed(4))), null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* UMAP Tab */}
          {activeTab === 'umap' && (
            <div className="space-y-4">
              <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg`}>
                <h3 className={`text-sm font-medium ${theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'} mb-3 flex items-center`}>
                  {isLoadingUmap ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin text-blue-400" />
                  ) : umapError ? (
                    <AlertTriangle className="w-4 h-4 mr-2 text-red-400" />
                  ) : umapData.length > 0 ? (
                    <CheckCircle className="w-4 h-4 mr-2 text-green-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 mr-2 text-red-400" />
                  )}
                  UMAP Visualization
                </h3>

                {isLoadingUmap ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="flex items-center text-blue-400">
                      <Loader2 className="w-6 h-6 mr-2 animate-spin" />
                      <span>Loading UMAP data...</span>
                    </div>
                  </div>
                ) : umapError ? (
                  <div className="py-4">
                    <p className="text-red-400 mb-2">Failed to load UMAP data</p>
                    <p className={`${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'} text-sm`}>
                      {umapError}
                    </p>
                  </div>
                ) : umapData.length === 0 ? (
                  <div className="py-4">
                    <p className="text-red-400 mb-2">No UMAP data available</p>
                    <p className={`${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'} text-sm`}>
                      This dataset doesn't contain UMAP 2D coordinates for visualization.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className={`${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'} text-sm mb-4`}>
                      Interactive scatter plot showing UMAP 2D embeddings of {umapData.length} objects. 
                      Use the filter to color points by different hardness ratios, and hover over points to see details.
                    </p>
                    <UmapVisualization 
                      umapData={umapData} 
                      theme={theme}
                      selectedObjectId={object?._id}
                      onObjectSelect={handleObjectSelect}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Nearest Neighbors Tab */}
          {activeTab === 'neighbors' && (
            <div className="space-y-4">
              <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg`}>
                <NearestNeighbors
                  neighbors={nearestNeighbors}
                  isLoading={isLoadingNeighbors}
                  error={neighborsError}
                  theme={theme}
                  collectionName={state.selectedDataset?.collection_name || ''}
                  onNeighborSelect={handleNeighborSelect}
                />
              </div>
            </div>
          )}

          {/* Summary Tab */}
          {activeTab === 'summary' && (
            <div className="space-y-4">
              <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg`}>
                <h3 className={`text-sm font-medium ${theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'} mb-3`}>Source Summary</h3>
                <p className={`${theme === 'dark' ? 'text-amber-400' : 'text-amber-600'} whitespace-pre-wrap`}>{getSummary()}</p>
              </div>

              {displayObject !== null && displayObject.answer && displayObject.answer !== getSummary() && (
                <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg`}>
                  <h3 className={`text-sm font-medium ${theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'} mb-3`}>Full Answer</h3>
                  <p className={`${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'} whitespace-pre-wrap`}>{displayObject.answer}</p>
                </div>
              )}

              {displayObject !== null && displayObject.qna && displayObject.qna.length > 0 && (
                <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg`}>
                  <h3 className={`text-sm font-medium ${theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'} mb-3`}>Q&A Data</h3>
                  <div className="space-y-3">
                    {displayObject.qna.map((qa, index) => (
                      <div key={index} className={`pb-3 ${theme === 'dark' ? 'border-gray-800/30' : 'border-gray-200/30'} border-b last:border-b-0 last:pb-0 last:border-b-0 last:pb-0`}>
                        <h4 className={`text-sm font-medium ${theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'} mb-1`}>Q: {qa.question}</h4>
                        <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'} ml-3`}>A: {qa.answer}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Advanced Data Tab */}
          {activeTab === 'data' && displayObject !== null && (
            <div className="space-y-4">
              {/* Add Event List section in data tab */}
              {displayObject.event_list !== undefined && (
                <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg`}>
                  <h3 className={`text-sm font-medium ${theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'} mb-3`}>Event List Data</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>Start Time</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.event_list[0][0], 6)}</p>
                    </div>
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>End Time</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.event_list[1][0], 6)}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg`}>
                <h3 className={`text-sm font-medium ${theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'} mb-3`}>Hardness Ratios</h3>
                <div className="grid grid-cols-2 gap-3">
                  {displayObject.hard_hm !== undefined && (
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>Hard/Medium</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.hard_hm, 3)}</p>
                    </div>
                  )}
                  {displayObject.hard_hs !== undefined && (
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>Hard/Soft</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.hard_hs, 3)}</p>
                    </div>
                  )}
                  {displayObject.hard_ms !== undefined && (
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>Medium/Soft</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.hard_ms, 3)}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg`}>
                <h3 className={`text-sm font-medium ${theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'} mb-3`}>Flux Measurements</h3>
                <div className="space-y-3">
                  {displayObject.flux_aper_b !== undefined && (
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>Aperture Flux</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.flux_aper_b, 3, true)} erg/s/cm²</p>
                    </div>
                  )}
                  {displayObject.flux_bb_aper_b !== undefined && (
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>BB Aperture Flux</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.flux_bb_aper_b, 3, true)} erg/s/cm²</p>
                    </div>
                  )}
                  {displayObject.flux_significance_b !== undefined && (
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>Flux Significance</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.flux_significance_b, 2)}σ</p>
                    </div>
                  )}
                  {displayObject.var_prob_b !== undefined && (
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>Variability Probability</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.var_prob_b, 3)}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Add Event List section */}
              {displayObject.event_list !== undefined && (
                <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg`}>
                  <h3 className={`text-sm font-medium ${theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'} mb-3`}>Event List</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>Start Time</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.event_list[0][0], 6)}</p>
                    </div>
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>End Time</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{formatNumber(displayObject.event_list[1][0], 6)}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className={`${theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'} p-3 rounded-lg`}>
                <h3 className={`text-sm font-medium ${theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'} mb-3`}>Classification</h3>
                <div className="space-y-3">
                  <div>
                    <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>Thermal Classification</h4>
                    <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{displayObject.thermal_classification}</p>
                  </div>
                  {displayObject.recommended_model && (
                    <div>
                      <h4 className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} mb-1`}>Recommended Model</h4>
                      <p className={`${theme === 'dark' ? 'text-white' : 'text-gray-800'} font-medium`}>{displayObject.recommended_model}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Standard view (desktop or collapsed mobile)
  return (
    <div className={`h-full border rounded-lg overflow-hidden flex flex-col ${
      theme === 'dark' ? 'border-gray-800/40' : 'border-gray-200/40 bg-white'
    }`}>
      {/* Header - fixed height with toggle button */}
      <div className={`${isMobileView ? 'py-2 px-2' : 'p-4'} border-b flex-shrink-0 ${
        theme === 'dark' ? 'border-gray-800/40' : 'border-gray-200/40'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <button
              onClick={toggleObjectDetails}
              className={`mr-2 transition-colors ${
                theme === 'dark' ? 'text-gray-400 hover:text-[#00E0FF]' : 'text-gray-500 hover:text-blue-600'
              }`}
              title={isObjectDetailsExpanded ? "Collapse panel" : "Expand panel"}
            >
              {isObjectDetailsExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <div className="flex flex-row items-center">
              <h2 className={`${isVerySmallScreen ? 'text-base' : 'text-lg'} font-semibold mr-2 ${
                theme === 'dark' ? 'text-white' : 'text-gray-800'
              }`}>
                Object Details
              </h2>

              {/* Dataset name - always on same line in mobile */}
              <span className={`text-xs px-2 py-1 rounded-full ${
                theme === 'dark' ? 'bg-[#1E1A3C] text-[#00E0FF]' : 'bg-blue-50 text-[#2957D8]'
              }`}
                  style={theme !== 'dark' ? { color: '#2957D8' } : {}}>
                {datasetName || state.selectedDataset?.file_name || 'Unknown Dataset'}
              </span>
            </div>
          </div>

          {/* Show loading indicator or details status */}
          <div className="flex items-center">
            {isObjectDetailsExpanded && isMobileView && (
              <button
                onClick={toggleFullScreenMode}
                className={`mr-2 transition-colors ${
                  theme === 'dark' ? 'text-[#00E0FF] hover:text-[#33E7FF]' : 'text-blue-600 hover:text-blue-700'
                }`}
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            )}

            {isLoadingDetails ? (
              <div className="flex items-center text-gray-400">
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                <span className="text-xs">Loading...</span>
              </div>
            ) : objectDetails ? (
              <div className={`text-xs ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>
                {isVerySmallScreen ? 'Loaded' : 'Full details loaded'}
              </div>
            ) : detailsError ? (
              <div className="text-xs text-red-400">{isVerySmallScreen ? 'Error' : detailsError}</div>
            ) : (
              <div className="text-xs text-amber-400">{isVerySmallScreen ? 'Basic' : 'Basic data only'}</div>
            )}
          </div>
        </div>
      </div>

      {/* Only show content if expanded */}
              {isObjectDetailsExpanded && (
        <>
          {/* If mobile but not full screen, show prompt to enter full screen mode */}
          {isMobileView ? (
            <div className={`p-3 flex-1 flex flex-col overflow-y-auto ${
              theme === 'dark' ? 'bg-[#111125]/50' : 'bg-gray-50/50'
            }`}>
              {/* Minimal data display */}
              {displayObject !== null && (
                <div className="mb-4 w-full">
                  <div className={`p-3 rounded-lg mb-3 ${
                    theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'
                  }`}>
                    <h3 className={`text-xs uppercase ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                    }`}>ObsID</h3>
                    <p className={`text-xl font-medium truncate ${
                      theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                    }`}>{displayObject?.obsid || 'N/A'}</p>
                  </div>

                  <div className={`p-3 rounded-lg mb-3 ${
                    theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'
                  }`}>
                    <h3 className={`text-xs uppercase ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                    }`}>Source</h3>
                    <p className={`text-xl font-medium truncate ${
                      theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                    }`}>{displayObject?.source_name || 'N/A'}</p>
                  </div>

                  <div className={`p-3 rounded-lg mb-4 ${
                    theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'
                  }`}>
                    <h3 className={`text-xs uppercase ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                    }`}>Type</h3>
                    <p className={`text-xl font-medium truncate ${
                      theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                    }`}>{displayObject?.source_type || displayObject?.type || 'Unknown'}</p>
                  </div>
                </div>
              )}

              <div className="flex flex-col items-center justify-center text-center">
                <Database className={`w-8 h-8 mb-2 ${
                  theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                }`} />
                <p className={`mb-3 ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                }`}>View complete object details in a more comfortable format</p>
                <button
                  onClick={toggleFullScreenMode}
                  className={`px-4 py-2 rounded-lg transition-colors flex items-center ${
                    theme === 'dark' 
                      ? 'bg-[#1E1A3C] hover:bg-[#2A254D] text-[#00E0FF]' 
                      : 'bg-blue-50 hover:bg-blue-100 text-blue-600'
                  }`}
                >
                  <Maximize2 className="w-4 h-4 mr-2" />
                  <span>View Full Details</span>
                </button>
              </div>
            </div>
          ) : (
            /* Desktop expanded view */
            <>
              {/* Embedding status bar */}
              <div className={`p-2 border-b flex-shrink-0 ${
                theme === 'dark' ? 'border-gray-800/40 bg-[#0D0C22]' : 'border-gray-200/40 bg-gray-50'
              }`}>
                <div className="flex items-center justify-between flex-wrap">
                  <div className="flex items-center flex-wrap">
                    <span className={`text-sm font-medium mr-2 ${
                      theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                    }`}>
                      Embedding:
                    </span>
                    {isLoadingDetails ? (
                      <div className="flex items-center text-amber-400">
                        <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                        <span className="text-xs">Loading...</span>
                      </div>
                    ) : !hasEmbedding ? (
                      <div className="flex items-center text-red-400">
                        <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                        <span className="text-xs">Not available</span>
                      </div>
                    ) : !isValidEmbedding ? (
                      <div className="flex items-center text-red-400">
                        <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                        <span className="text-xs">Invalid (zeros)</span>
                      </div>
                    ) : (
                      <div className={`flex items-center ${
                        theme === 'dark' ? 'text-green-400' : 'text-green-600'
                      }`}>
                        <CheckCircle className="w-3.5 h-3.5 mr-1" />
                        <span className="text-xs">Valid ({displayObject?.embedding?.length})</span>
                      </div>
                    )}
                  </div>

                  {/* Show sample of the embedding values */}
                  {hasEmbedding && displayObject !== null && (
                    <div className={`text-xs truncate max-w-[50%] ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                    }`}>
                      [{displayObject.embedding!.slice(0, 3).map(v => v.toFixed(3)).join(', ')}
                      {displayObject.embedding!.length > 3 ? ', ...' : ''}]
                    </div>
                  )}
                </div>
              </div>

              {/* Main info content - scrollable */}
              <div className={`p-4 overflow-y-auto flex-1 ${
                theme === 'dark' ? 'bg-[#111125]/50' : 'bg-gray-50/50'
              }`}>
                {/* Main info cards - responsive grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className={`p-3 rounded-lg flex-1 ${
                    theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'
                  }`}>
                    <h3 className={`text-xs uppercase ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                    }`}>ObsID</h3>
                    <p className={`text-xl font-medium truncate ${
                      theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                    }`}>
                      {displayObject?.obsid || 'N/A'}
                    </p>
                  </div>

                  <div className={`p-3 rounded-lg flex-1 ${
                    theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'
                  }`}>
                    <h3 className={`text-xs uppercase ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                    }`}>Source</h3>
                    <p className={`text-xl font-medium truncate ${
                      theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                    }`}>
                      {displayObject?.source_name || 'N/A'}
                    </p>
                  </div>

                  <div className={`p-3 rounded-lg flex-1 ${
                    theme === 'dark' ? 'bg-[#1A1832]' : 'bg-white border border-gray-200/40'
                  }`}>
                    <h3 className={`text-xs uppercase ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                    }`}>Type</h3>
                    <p className={`text-xl font-medium truncate ${
                      theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                    }`}>
                      {displayObject?.source_type || displayObject?.type || 'Unknown'}
                    </p>
                  </div>
                </div>

                {/* Embedding Data */}
                <div className="mb-2">
                  <button
                    onClick={() => toggleSection('embedding')}
                    className={`w-full flex items-center justify-between p-3 rounded-md transition-colors ${
                      expandedSection === 'embedding' 
                        ? theme === 'dark'
                          ? 'bg-[#1E1A3C] text-[#00E0FF]'
                          : 'bg-blue-50 text-blue-600'
                        : theme === 'dark'
                          ? 'bg-[#1A1832] text-gray-300 hover:bg-[#1E1A3C] hover:text-[#00E0FF]'
                          : 'bg-white text-gray-700 hover:bg-blue-50 hover:text-blue-600 border border-gray-200/40'
                    }`}
                  >
                    <div className="flex items-center">
                      <Database className="w-4 h-4 mr-2" />
                      <span className="font-medium">Embedding Data</span>
                    </div>
                    {expandedSection === 'embedding' ? (
                      <ChevronUp className="w-5 h-5" />
                    ) : (
                      <ChevronDown className="w-5 h-5" />
                    )}
                  </button>

                  {expandedSection === 'embedding' && (
                    <div className={`p-3 mt-1 rounded-md border max-h-40 overflow-y-auto ${
                      theme === 'dark'
                        ? 'bg-[#0D0C22] border-gray-800/40'
                        : 'bg-white border-gray-200/40'
                    }`}>
                      {!hasEmbedding ? (
                        <p className="text-red-400">No embedding data available for this object</p>
                      ) : !isValidEmbedding ? (
                        <div>
                          <p className="text-red-400 mb-2">Invalid embedding: all values are zero</p>
                          <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                            This may cause issues with the chat functionality. The model needs valid embedding data to generate contextual responses.
                          </p>
                        </div>
                      ) : displayObject !== null && (
                        <div>
                          <div className="flex justify-between items-center mb-2">
                            <span className={`font-medium ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>
                              Valid embedding data ({displayObject.embedding!.length} dimensions)
                            </span>
                            <span className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                              min: {Math.min(...displayObject.embedding!).toFixed(4)}, max: {Math.max(...displayObject.embedding!).toFixed(4)}
                            </span>
                          </div>

                          <div className={`rounded p-2 max-h-24 overflow-y-auto ${
                            theme === 'dark' ? 'bg-[#161335]' : 'bg-gray-50 border border-gray-200/40'
                          }`}>
                            <pre className={`text-xs break-all whitespace-pre-wrap ${
                              theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                            }`}>
                              {JSON.stringify(displayObject.embedding!.map(v => parseFloat(v.toFixed(4))), null, 2)}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* UMAP Visualization Section */}
                <div className="mb-2">
                  <button
                    onClick={() => toggleSection('umap')}
                    className={`w-full flex items-center justify-between p-3 rounded-md transition-colors ${
                      expandedSection === 'umap' 
                        ? theme === 'dark'
                          ? 'bg-[#1E1A3C] text-[#00E0FF]'
                          : 'bg-blue-50 text-blue-600'
                        : theme === 'dark'
                          ? 'bg-[#1A1832] text-gray-300 hover:bg-[#1E1A3C] hover:text-[#00E0FF]'
                          : 'bg-white text-gray-700 hover:bg-blue-50 hover:text-blue-600 border border-gray-200/40'
                    }`}
                  >
                    <div className="flex items-center">
                      <Database className="w-4 h-4 mr-2" />
                      <span className="font-medium">UMAP Visualization</span>
                      {isLoadingUmap && <Loader2 className="w-3 h-3 ml-2 animate-spin" />}
                    </div>
                    {expandedSection === 'umap' ? (
                      <ChevronUp className="w-5 h-5" />
                    ) : (
                      <ChevronDown className="w-5 h-5" />
                    )}
                  </button>

                  {expandedSection === 'umap' && (
                    <div className={`p-3 mt-1 rounded-md border ${
                      theme === 'dark'
                        ? 'bg-[#0D0C22] border-gray-800/40'
                        : 'bg-white border-gray-200/40'
                    }`}>
                      {isLoadingUmap ? (
                        <div className="flex items-center justify-center py-8">
                          <div className="flex items-center text-blue-400">
                            <Loader2 className="w-6 h-6 mr-2 animate-spin" />
                            <span>Loading UMAP data...</span>
                          </div>
                        </div>
                      ) : umapError ? (
                        <div className="py-4">
                          <p className="text-red-400 mb-2">Failed to load UMAP data</p>
                          <p className={`${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'} text-sm`}>
                            {umapError}
                          </p>
                        </div>
                      ) : umapData.length === 0 ? (
                        <div className="py-4">
                          <p className="text-red-400 mb-2">No UMAP data available</p>
                          <p className={`${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'} text-sm`}>
                            This dataset doesn't contain UMAP 2D coordinates for visualization.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <p className={`${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'} text-sm`}>
                              Interactive scatter plot of {umapData.length} objects with UMAP 2D embeddings
                            </p>
                            <span className={`text-xs px-2 py-1 rounded ${
                              theme === 'dark' ? 'bg-[#1E1A3C] text-[#00E0FF]' : 'bg-blue-50 text-blue-600'
                            }`}>
                              {umapData.length} points
                            </span>
                          </div>
                          <UmapVisualization 
                            umapData={umapData} 
                            theme={theme}
                            selectedObjectId={object?._id}
                            onObjectSelect={handleObjectSelect}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Nearest Neighbors Section */}
                <div className="mb-2">
                  <button
                    onClick={() => toggleSection('neighbors')}
                    className={`w-full flex items-center justify-between p-3 rounded-md transition-colors ${
                      expandedSection === 'neighbors' 
                        ? theme === 'dark'
                          ? 'bg-[#1E1A3C] text-[#00E0FF]'
                          : 'bg-blue-50 text-blue-600'
                        : theme === 'dark'
                          ? 'bg-[#1A1832] text-gray-300 hover:bg-[#1E1A3C] hover:text-[#00E0FF]'
                          : 'bg-white text-gray-700 hover:bg-blue-50 hover:text-blue-600 border border-gray-200/40'
                    }`}
                  >
                    <div className="flex items-center">
                      <Star className="w-4 h-4 mr-2" />
                      <span className="font-medium">Nearest Neighbors</span>
                      {isLoadingNeighbors && <Loader2 className="w-3 h-3 ml-2 animate-spin" />}
                    </div>
                    {expandedSection === 'neighbors' ? (
                      <ChevronUp className="w-5 h-5" />
                    ) : (
                      <ChevronDown className="w-5 h-5" />
                    )}
                  </button>

                  {expandedSection === 'neighbors' && (
                    <div className={`p-3 mt-1 rounded-md border ${
                      theme === 'dark'
                        ? 'bg-[#0D0C22] border-gray-800/40'
                        : 'bg-white border-gray-200/40'
                    }`}>
                      <NearestNeighbors
                        neighbors={nearestNeighbors}
                        isLoading={isLoadingNeighbors}
                        error={neighborsError}
                        theme={theme}
                        collectionName={state.selectedDataset?.collection_name || ''}
                        onNeighborSelect={handleNeighborSelect}
                      />
                    </div>
                  )}
                </div>

                {/* Light Curve Section */}
                <div className="mb-2">
                  <button
                    onClick={() => toggleSection('lightcurve')}
                    className={`w-full flex items-center justify-between p-3 rounded-md transition-colors ${
                      expandedSection === 'lightcurve' 
                        ? theme === 'dark'
                          ? 'bg-[#1E1A3C] text-[#00E0FF]'
                          : 'bg-blue-50 text-blue-600'
                        : theme === 'dark'
                          ? 'bg-[#1A1832] text-gray-300 hover:bg-[#1E1A3C] hover:text-[#00E0FF]'
                          : 'bg-white text-gray-700 hover:bg-blue-50 hover:text-blue-600 border border-gray-200/40'
                    }`}
                  >
                    <div className="flex items-center">
                      <Activity className="w-4 h-4 mr-2" />
                      <span className="font-medium">Energy Spectrum</span>
                    </div>
                    {expandedSection === 'lightcurve' ? (
                      <ChevronUp className="w-5 h-5" />
                    ) : (
                      <ChevronDown className="w-5 h-5" />
                    )}
                  </button>

                  {expandedSection === 'lightcurve' && (
                    <div className={`p-3 mt-1 rounded-md border ${
                      theme === 'dark'
                        ? 'bg-[#0D0C22] border-gray-800/40'
                        : 'bg-white border-gray-200/40'
                    }`}>
                      {lightCurveData && lightCurveData.total_events > 0 ? (
                        <LightCurveChart 
                          lightCurveData={lightCurveData} 
                          theme={theme}
                        />
                      ) : (
                        <div className="text-center py-8">
                          <Activity className={`w-8 h-8 mx-auto mb-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`} />
                          <p className={`${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                            {isLoadingDetails ? 'Loading spectrum data...' : 'No event data available for spectrum visualization'}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Time Light Curve Section */}
                <div className="mb-2">
                  <button
                    onClick={() => toggleSection('time_lc')}
                    className={`w-full flex items-center justify-between p-3 rounded-md transition-colors ${
                      expandedSection === 'time_lc' 
                        ? theme === 'dark'
                          ? 'bg-[#1E1A3C] text-[#00E0FF]'
                          : 'bg-blue-50 text-blue-600'
                        : theme === 'dark'
                          ? 'bg-[#1A1832] text-gray-300 hover:bg-[#1E1A3C] hover:text-[#00E0FF]'
                          : 'bg-white text-gray-700 hover:bg-blue-50 hover:text-blue-600 border border-gray-200/40'
                    }`}
                  >
                    <div className="flex items-center">
                      <Activity className="w-4 h-4 mr-2" />
                      <span className="font-medium">Light Curve</span>
                    </div>
                    {expandedSection === 'time_lc' ? (
                      <ChevronUp className="w-5 h-5" />
                    ) : (
                      <ChevronDown className="w-5 h-5" />
                    )}
                  </button>

                  {expandedSection === 'time_lc' && (
                    <div className={`p-3 mt-1 rounded-md border ${
                      theme === 'dark'
                        ? 'bg-[#0D0C22] border-gray-800/40'
                        : 'bg-white border-gray-200/40'
                    }`}>
                      {/* Toggle between fixed-cadence and GL */}
                      <div className="flex items-center gap-3 mb-3">
                        <label className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>View</label>
                        <select
                          className={`text-xs px-2 py-1 rounded border ${theme === 'dark' ? 'bg-[#0D0C22] text-gray-200 border-gray-700' : 'bg-white text-gray-800 border-gray-300'}`}
                          value={(typeof window !== 'undefined' ? (sessionStorage.getItem('lcView') || 'fixed') : 'fixed')}
                          onChange={(e) => {
                            try {
                              const v = e.target.value;
                              if (typeof window !== 'undefined') sessionStorage.setItem('lcView', v);
                            } catch {}
                          }}
                        >
                          <option value="fixed">Fixed cadence</option>
                          <option value="gl">GL (adaptive)</option>
                        </select>
                      </div>

                      {(((typeof window !== 'undefined' && (sessionStorage.getItem('lcView') || 'fixed')) || 'fixed') === 'gl') && enhancedDetails?.gl_light_curve?.segments && enhancedDetails.gl_light_curve.segments.length > 0 ? (
                        // GL light curve
                        // @ts-ignore
                        <GLLightCurveChart gl={enhancedDetails.gl_light_curve as any} theme={theme} />
                      ) : timeLightCurve && Array.isArray(timeLightCurve.points) && timeLightCurve.points.length > 0 ? (
                        <TimeLightCurveChart
                          cadence_s={timeLightCurve.cadence_s}
                          points={timeLightCurve.points}
                          stats={timeLightCurve.stats}
                          theme={theme}
                        />
                      ) : (
                        <div className="text-center py-8">
                          <Activity className={`${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} w-8 h-8 mx-auto mb-2`} />
                          <p className={`${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                            {isLoadingDetails ? 'Loading light curve...' : 'No light curve available for this object'}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Energy-Time Map (dE-dt) Section */}
                <div className="mb-2">
                  <button
                    onClick={() => toggleSection('de_dt_map')}
                    className={`w-full flex items-center justify-between p-3 rounded-md transition-colors ${
                      expandedSection === 'de_dt_map' 
                        ? theme === 'dark'
                          ? 'bg-[#1E1A3C] text-[#00E0FF]'
                          : 'bg-blue-50 text-blue-600'
                        : theme === 'dark'
                          ? 'bg-[#1A1832] text-gray-300 hover:bg-[#1E1A3C] hover:text-[#00E0FF]'
                          : 'bg-white text-gray-700 hover:bg-blue-50 hover:text-blue-600 border border-gray-200/40'
                    }`}
                  >
                    <div className="flex items-center">
                      <Activity className="w-4 h-4 mr-2" />
                      <span className="font-medium">Energy-Time Map</span>
                    </div>
                    {expandedSection === 'de_dt_map' ? (
                      <ChevronUp className="w-5 h-5" />
                    ) : (
                      <ChevronDown className="w-5 h-5" />
                    )}
                  </button>

                  {expandedSection === 'de_dt_map' && (
                    <div className={`p-3 mt-1 rounded-md border ${
                      theme === 'dark'
                        ? 'bg-[#0D0C22] border-gray-800/40'
                        : 'bg-white border-gray-200/40'
                    }`}>
                      {enhancedDetails?.de_dt_map ? (
                        <div className="w-full">
                          <img 
                            src={`data:image/png;base64,${enhancedDetails.de_dt_map}`} 
                            alt="Energy-Time Map (dE-dt)" 
                            className="w-full h-auto rounded"
                          />
                          <p className={`text-xs mt-2 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                            E-t map showing normalized time (τ) vs log energy (ε). Dark regions indicate high photon counts.
                          </p>
                        </div>
                      ) : (
                        <div className="text-center py-8">
                          <Activity className={`${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} w-8 h-8 mx-auto mb-2`} />
                          <p className={`${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                            {isLoadingDetails ? 'Loading energy-time map...' : 'No energy-time map available for this object'}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Source Summary Section */}
                <div className="mb-2">
                  <button
                    onClick={() => toggleSection('summary')}
                    className={`w-full flex items-center justify-between p-3 rounded-md transition-colors ${
                      expandedSection === 'summary' 
                        ? theme === 'dark'
                          ? 'bg-[#1E1A3C] text-[#00E0FF]'
                          : 'bg-blue-50 text-blue-600'
                        : theme === 'dark'
                          ? 'bg-[#1A1832] text-gray-300 hover:bg-[#1E1A3C] hover:text-[#00E0FF]'
                          : 'bg-white text-gray-700 hover:bg-blue-50 hover:text-blue-600 border border-gray-200/40'
                    }`}
                  >
                    <div className="flex items-center">
                      <Star className="w-4 h-4 mr-2" />
                      <span className="font-medium">Source Summary</span>
                    </div>
                    {expandedSection === 'summary' ? (
                      <ChevronUp className="w-5 h-5" />
                    ) : (
                      <ChevronDown className="w-5 h-5" />
                    )}
                  </button>

                  {expandedSection === 'summary' && (
                    <div className={`p-3 mt-1 rounded-md border max-h-40 overflow-y-auto ${
                      theme === 'dark'
                        ? 'bg-[#0D0C22] border-gray-800/40'
                        : 'bg-white border-gray-200/40'
                    }`}>
                      <p className={`whitespace-pre-wrap ${
                        theme === 'dark' ? 'text-amber-400' : 'text-amber-600'
                      }`}>{getSummary()}</p>

                      {/* Show view full answer button if there's more content */}
                      {displayObject !== null && displayObject.answer && displayObject.answer.length > getSummary().length && (
                        <button
                          onClick={() => toggleSection('answer')}
                          className={`mt-2 flex items-center text-xs hover:underline ${
                            theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                          }`}
                        >
                          <span>View full answer</span>
                          <ChevronRight className="w-3 h-3 ml-1" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Coordinates & Position */}
                <div className="mb-2">
                  <button
                    onClick={() => toggleSection('coordinates')}
                    className={`w-full flex items-center justify-between p-3 rounded-md transition-colors ${
                      expandedSection === 'coordinates' 
                        ? theme === 'dark'
                          ? 'bg-[#1E1A3C] text-[#00E0FF]'
                          : 'bg-blue-50 text-blue-600'
                        : theme === 'dark'
                          ? 'bg-[#1A1832] text-gray-300 hover:bg-[#1E1A3C] hover:text-[#00E0FF]'
                          : 'bg-white text-gray-700 hover:bg-blue-50 hover:text-blue-600 border border-gray-200/40'
                    }`}
                  >
                    <div className="flex items-center">
                      <Info className="w-4 h-4 mr-2" />
                      <span className="font-medium">Coordinates & Position</span>
                    </div>
                    {expandedSection === 'coordinates' ? (
                      <ChevronUp className="w-5 h-5" />
                    ) : (
                      <ChevronDown className="w-5 h-5" />
                    )}
                  </button>

                  {expandedSection === 'coordinates' && displayObject !== null && (
                    <div className={`p-3 mt-1 rounded-md border max-h-40 overflow-y-auto ${
                      theme === 'dark'
                        ? 'bg-[#0D0C22] border-gray-800/40'
                        : 'bg-white border-gray-200/40'
                    }`}>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {displayObject.ra !== undefined && (
                          <div>
                            <h3 className={`text-sm mb-1 ${
                              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                            }`}>RA</h3>
                            <p className={`font-medium ${
                              theme === 'dark' ? 'text-white' : 'text-gray-800'
                            }`}>{formatNumber(displayObject.ra, 6)}</p>
                          </div>
                        )}

                        {displayObject.dec !== undefined && (
                          <div>
                            <h3 className={`text-sm mb-1 ${
                              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                            }`}>DEC</h3>
                            <p className={`font-medium ${
                              theme === 'dark' ? 'text-white' : 'text-gray-800'
                            }`}>{formatNumber(displayObject?.dec, 6)}</p>
                          </div>
                        )}

                        {displayObject.theta !== undefined && (
                          <div>
                            <h3 className={`text-sm mb-1 ${
                              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                            }`}>Theta</h3>
                            <p className={`font-medium ${
                              theme === 'dark' ? 'text-white' : 'text-gray-800'
                            }`}>{formatNumber(displayObject.theta, 6)}</p>
                          </div>
                        )}

                        {displayObject.z !== undefined && (
                          <div>
                            <h3 className={`text-sm mb-1 ${
                              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                            }`}>Redshift (z)</h3>
                            <p className={`font-medium ${
                              theme === 'dark' ? 'text-white' : 'text-gray-800'
                            }`}>{formatNumber(displayObject.z, 6)}</p>
                          </div>
                        )}

                        {displayObject.region_id !== undefined && (
                          <div>
                            <h3 className={`text-sm mb-1 ${
                              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                            }`}>Region ID</h3>
                            <p className={`font-medium ${
                              theme === 'dark' ? 'text-white' : 'text-gray-800'
                            }`}>{displayObject.region_id}</p>
                          </div>
                        )}

                        {displayObject.gti_mjd_obs !== undefined && (
                          <div>
                            <h3 className={`text-sm mb-1 ${
                              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                            }`}>Observation Date (MJD)</h3>
                            <p className={`font-medium ${
                              theme === 'dark' ? 'text-white' : 'text-gray-800'
                            }`}>{formatNumber(displayObject.gti_mjd_obs, 5)}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Spectral Properties */}
                <div className="mb-2">
                  <button
                    onClick={() => toggleSection('spectral')}
                    className={`w-full flex items-center justify-between p-3 rounded-md transition-colors ${
                      expandedSection === 'spectral' 
                        ? theme === 'dark'
                          ? 'bg-[#1E1A3C] text-[#00E0FF]'
                          : 'bg-blue-50 text-blue-600'
                        : theme === 'dark'
                          ? 'bg-[#1A1832] text-gray-300 hover:bg-[#1E1A3C] hover:text-[#00E0FF]'
                          : 'bg-white text-gray-700 hover:bg-blue-50 hover:text-blue-600 border border-gray-200/40'
                    }`}
                  >
                    <div className="flex items-center">
                      <Activity className="w-4 h-4 mr-2" />
                      <span className="font-medium">Spectral Properties</span>
                    </div>
                    {expandedSection === 'spectral' ? (
                      <ChevronUp className="w-5 h-5" />
                    ) : (
                      <ChevronDown className="w-5 h-5" />
                    )}
                  </button>

                  {expandedSection === 'spectral' && displayObject !== null && (
                    <div className={`p-3 mt-1 rounded-md border max-h-48 overflow-y-auto ${
                      theme === 'dark'
                        ? 'bg-[#0D0C22] border-gray-800/40'
                        : 'bg-white border-gray-200/40'
                    }`}>
                      {/* Spectral content */}
                      <div className="mb-3">
                        <h3 className={`text-sm font-medium mb-2 ${
                          theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                        }`}>Model Fit Statistics</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 ml-2">
                          {displayObject.powlaw_stat !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Power Law</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.powlaw_stat, 3)}</p>
                            </div>
                          )}
                          {displayObject.apec_stat !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>APEC</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.apec_stat, 3)}</p>
                            </div>
                          )}
                          {displayObject.brems_stat !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Bremsstrahlung</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.brems_stat, 3)}</p>
                            </div>
                          )}
                          {displayObject.bb_stat !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Blackbody</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.bb_stat, 3)}</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mb-3">
                        <h3 className={`text-sm font-medium mb-2 ${
                          theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                        }`}>Hardness Ratios</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 ml-2">
                          {displayObject.hard_hm !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Hard/Medium</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.hard_hm, 3)}</p>
                            </div>
                          )}
                          {displayObject.hard_hs !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Hard/Soft</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.hard_hs, 3)}</p>
                            </div>
                          )}
                          {displayObject.hard_ms !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Medium/Soft</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.hard_ms, 3)}</p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Model Parameters */}
                      <div className="mb-3">
                        <h3 className={`text-sm font-medium mb-2 ${
                          theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                        }`}>Model Parameters</h3>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 ml-2">
                          {displayObject.powlaw_nh !== null && displayObject.powlaw_nh !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Power Law N(H)</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.powlaw_nh, 3)}</p>
                            </div>
                          )}
                          {displayObject.powlaw_gamma !== null && displayObject.powlaw_gamma !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Power Law Gamma</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.powlaw_gamma, 3)}</p>
                            </div>
                          )}
                          {displayObject.bb_nh !== null && displayObject.bb_nh !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Blackbody N(H)</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.bb_nh, 3)}</p>
                            </div>
                          )}
                          {displayObject.bb_kt !== null && displayObject.bb_kt !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Blackbody kT</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.bb_kt, 3)}</p>
                            </div>
                          )}
                          {displayObject.brems_kt !== null && displayObject.brems_kt !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Bremsstrahlung kT</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.brems_kt, 3)}</p>
                            </div>
                          )}
                          {displayObject.apec_kt !== null && displayObject.apec_kt !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>APEC kT</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.apec_kt, 3)}</p>
                            </div>
                          )}
                          {displayObject.apec_nh !== null && displayObject.apec_nh !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>APEC N(H)</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.apec_nh, 3)}</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mb-3">
                        <h3 className={`text-sm font-medium mb-2 ${
                          theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                        }`}>Flux Measurements</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 ml-2">
                          {displayObject.flux_aper_b !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Aperture Flux</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.flux_aper_b, 3, true)} erg/s/cm²</p>
                            </div>
                          )}
                          {displayObject.flux_bb_aper_b !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>BB Aperture Flux</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.flux_bb_aper_b, 3, true)} erg/s/cm²</p>
                            </div>
                          )}
                          {displayObject.flux_significance_b !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Flux Significance</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.flux_significance_b, 2)}σ</p>
                            </div>
                          )}
                          {displayObject.var_prob_b !== undefined && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Variability Probability</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.var_prob_b, 3)}</p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Add Event List section */}
                      {displayObject.event_list !== undefined && (
                        <div className={`mb-3`}>
                          <h3 className={`text-sm font-medium mb-2 ${
                            theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                          }`}>Event List</h3>
                          <div className={`grid grid-cols-2 gap-3 ml-2`}>
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Start Time</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.event_list[0][0], 6)}</p>
                            </div>
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>End Time</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{formatNumber(displayObject.event_list[1][0], 6)}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      <div>
                        <h3 className={`text-sm font-medium mb-2 ${
                          theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                        }`}>Classification</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 ml-2">
                          {displayObject.thermal_classification && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Thermal Classification</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{displayObject.thermal_classification}</p>
                            </div>
                          )}
                          {displayObject.recommended_model && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Recommended Model</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>{displayObject.recommended_model}</p>
                            </div>
                          )}
                          {(displayObject.powlaw_gamma_lolim !== undefined || displayObject.powerlaw_gamma_low !== undefined) && (
                            <div>
                              <h4 className={`text-xs mb-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>Power Law γ Range</h4>
                              <p className={`font-medium ${
                                theme === 'dark' ? 'text-white' : 'text-gray-800'
                              }`}>
                                {formatNumber(displayObject.powlaw_gamma_lolim || displayObject.powerlaw_gamma_low, 2)} -
                                {formatNumber(displayObject.powlaw_gamma_hilim || displayObject.powerlaw_gamma_high, 2)}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Full Answer Section (if available and different from summary) */}
                {displayObject !== null && displayObject.answer && displayObject.answer !== getSummary() && (
                  <div className="mb-2">
                    <button
                      onClick={() => toggleSection('answer')}
                      className={`w-full flex items-center justify-between p-3 rounded-md transition-colors ${
                        expandedSection === 'answer' 
                          ? theme === 'dark'
                            ? 'bg-[#1E1A3C] text-[#00E0FF]'
                            : 'bg-blue-50 text-blue-600'
                          : theme === 'dark'
                            ? 'bg-[#1A1832] text-gray-300 hover:bg-[#1E1A3C] hover:text-[#00E0FF]'
                            : 'bg-white text-gray-700 hover:bg-blue-50 hover:text-blue-600 border border-gray-200/40'
                      }`}
                    >
                      <div className="flex items-center">
                        <Database className="w-4 h-4 mr-2" />
                        <span className="font-medium">Full Answer</span>
                      </div>
                      {expandedSection === 'answer' ? (
                        <ChevronUp className="w-5 h-5" />
                      ) : (
                        <ChevronDown className="w-5 h-5" />
                      )}
                    </button>

                    {expandedSection === 'answer' && (
                      <div className={`p-3 mt-1 rounded-md border max-h-48 overflow-y-auto ${
                        theme === 'dark'
                          ? 'bg-[#0D0C22] border-gray-800/40'
                          : 'bg-white border-gray-200/40'
                      }`}>
                        <p className={`whitespace-pre-wrap ${
                          theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                        }`}>{displayObject.answer}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Q&A Data */}
                {displayObject !== null && displayObject.qna && displayObject.qna.length > 0 && (
                  <div className="mb-2">
                    <button
                      onClick={() => toggleSection('qna')}
                      className={`w-full flex items-center justify-between p-3 rounded-md transition-colors ${
                        expandedSection === 'qna' 
                          ? theme === 'dark'
                            ? 'bg-[#1E1A3C] text-[#00E0FF]'
                            : 'bg-blue-50 text-blue-600'
                          : theme === 'dark'
                            ? 'bg-[#1A1832] text-gray-300 hover:bg-[#1E1A3C] hover:text-[#00E0FF]'
                            : 'bg-white text-gray-700 hover:bg-blue-50 hover:text-blue-600 border border-gray-200/40'
                      }`}
                    >
                      <div className="flex items-center">
                        <Database className="w-4 h-4 mr-2" />
                        <span className="font-medium">Q&A Data</span>
                      </div>
                      {expandedSection === 'qna' ? (
                        <ChevronUp className="w-5 h-5" />
                      ) : (
                        <ChevronDown className="w-5 h-5" />
                      )}
                    </button>

                    {expandedSection === 'qna' && (
                      <div className={`p-3 mt-1 rounded-md border max-h-64 overflow-y-auto ${
                        theme === 'dark'
                          ? 'bg-[#0D0C22] border-gray-800/40'
                          : 'bg-white border-gray-200/40'
                      }`}>
                        {displayObject.qna.map((qa, index) => (
                          <div key={index} className={`mb-3 pb-3 last:border-b-0 last:mb-0 last:pb-0 border-b ${
                            theme === 'dark' ? 'border-gray-800/30' : 'border-gray-200/30'
                          }`}>
                            <h4 className={`text-sm font-medium mb-1 ${
                              theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                            }`}>Q: {qa.question}</h4>
                            <p className={`text-sm pl-4 ${
                              theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                            }`}>A: {qa.answer}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Full JSON Data */}
                <div>
                  <button
                    onClick={() => toggleSection('json')}
                    className={`w-full flex items-center justify-between p-3 rounded-md transition-colors ${
                      expandedSection === 'json' 
                        ? theme === 'dark'
                          ? 'bg-[#1E1A3C] text-[#00E0FF]'
                          : 'bg-blue-50 text-blue-600'
                        : theme === 'dark'
                          ? 'bg-[#1A1832] text-gray-300 hover:bg-[#1E1A3C] hover:text-[#00E0FF]'
                          : 'bg-white text-gray-700 hover:bg-blue-50 hover:text-blue-600 border border-gray-200/40'
                    }`}
                  >
                    <div className="flex items-center">
                      <Database className="w-4 h-4 mr-2" />
                      <span className="font-medium">Full Object Data</span>
                    </div>
                    {expandedSection === 'json' ? (
                      <ChevronUp className="w-5 h-5" />
                    ) : (
                      <ChevronDown className="w-5 h-5" />
                    )}
                  </button>

                  {expandedSection === 'json' && displayObject !== null && (
                    <div className={`p-3 mt-1 rounded-md border max-h-96 overflow-y-auto ${
                      theme === 'dark'
                        ? 'bg-[#0D0C22] border-gray-800/40'
                        : 'bg-white border-gray-200/40'
                    }`}>
                      <pre className={`text-xs whitespace-pre-wrap break-all ${
                        theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                      }`}>
                        {JSON.stringify(displayObject, (key, value) => {
                          // Hide the embedding vector to make JSON more readable
                          if (key === 'embedding' || key === 'latents') {
                            return Array.isArray(value) ? `[... ${value.length} values]` : value;
                          }
                          return value;
                        }, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                {/* Spectrum Snapshot (Markdown) */}
                {enhancedDetails?.spectrum_snapshot && (
                  <div className="mt-2">
                    <button
                      onClick={() => toggleSection('spectrum_markdown')}
                      className={`w-full flex items-center justify-between p-3 rounded-md transition-colors ${
                        expandedSection === 'spectrum_markdown'
                          ? theme === 'dark'
                            ? 'bg-[#1E1A3C] text-[#00E0FF]'
                            : 'bg-blue-50 text-blue-600'
                          : theme === 'dark'
                            ? 'bg-[#1A1832] text-gray-300 hover:bg-[#1E1A3C] hover:text-[#00E0FF]'
                            : 'bg-white text-gray-700 hover:bg-blue-50 hover:text-blue-600 border border-gray-200/40'
                      }`}
                    >
                      <div className="flex items-center">
                        <Database className="w-4 h-4 mr-2" />
                        <span className="font-medium">Spectrum Snapshot (Markdown)</span>
                      </div>
                      {expandedSection === 'spectrum_markdown' ? (
                        <ChevronUp className="w-5 h-5" />
                      ) : (
                        <ChevronDown className="w-5 h-5" />
                      )}
                    </button>

                    {expandedSection === 'spectrum_markdown' && (
                      <div className={`p-3 mt-1 rounded-md border ${
                        theme === 'dark'
                          ? 'bg-[#0D0C22] border-gray-800/40'
                          : 'bg-white border-gray-200/40'
                      }`}>
                        {/* Header with copy */}
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-sm font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-800'}`}>Processed Spectrum Text</span>
                          <button
                            onClick={() => {
                              const text = enhancedDetails?.spectrum_text || '';
                              if (text) navigator.clipboard.writeText(text);
                            }}
                            className={`${theme === 'dark' ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-800'} flex items-center text-xs`}
                            title="Copy"
                          >
                            <Clipboard className="w-4 h-4 mr-1" /> Copy
                          </button>
                        </div>
                        {/* Monospace preformatted rendering for perfect alignment */}
                        <pre className={`whitespace-pre-wrap break-words font-mono text-sm ${theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
{enhancedDetails?.spectrum_text || ''}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}