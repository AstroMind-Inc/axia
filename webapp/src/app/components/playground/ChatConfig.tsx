"use client";

import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useContext } from 'react';
import {
  Search, Loader2, ChevronDown, ChevronUp, Database,
  Globe, Table, FileText, PlusCircle, X, Filter,
  Check, ToggleLeft, ToggleRight, Upload, AlertCircle, AlertTriangle,
  Minimize2, Menu
} from 'lucide-react';
import { DataObject, modelRequiresEventList } from '@/app/actions/playgroundActions';
import { usePlayground } from '@/app/context/PlaygroundContext';
import { loadAvailableDatasets } from '@/app/actions/playgroundActions';
import { useSettings } from '@/app/context/SettingsContext';
import { LayoutContext } from '@/app/context/LayoutContext';
import FileUploadModal from '@/app/components/ui/FileUploadModal';
import JsonUploadModal from '@/app/components/ui/JsonUploadModal';

const PAGE_SIZE = 20;

export interface ChatConfigHandle {
  focusSearchInput: (value: string) => void;
  triggerSearch: () => void;
}



const ChatConfig = forwardRef<ChatConfigHandle, Record<string, never>>((_, ref) => {
  const { state, dispatch } = usePlayground();
  const { datasets, selectedDataset, selectedObject } = state;
  const { isDataExpanded, toggleData } = useContext(LayoutContext);
  const {
    theme,
    setSelectedDataset,
    selectedModel,
    getModelApiUrl
  } = useSettings();

  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [objects, setObjects] = useState<DataObject[]>([]);
  const [filteredObjects, setFilteredObjects] = useState<DataObject[]>([]);
  const [hasMoreData, setHasMoreData] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [shouldUpdateObserver, setShouldUpdateObserver] = useState(false);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [loadedMoreData, setLoadedMoreData] = useState(false);
  const [sourceTypes, setSourceTypes] = useState<string[]>([]);
  const [selectedSourceType, setSelectedSourceType] = useState<string>('');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [showSourceTypeDisplay, setShowSourceTypeDisplay] = useState(false);
  const [searchMessage, setSearchMessage] = useState<string>('');
  const objectsContainerRef = useRef<HTMLDivElement>(null);
  const isLoadingMore = useRef(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const [initialLoading, setInitialLoading] = useState(true);



  // States for uploaded data management
  const [uploadedObjects, setUploadedObjects] = useState<DataObject[]>([]);
  const [uploadedSearchTerm, setUploadedSearchTerm] = useState<string>('');
  const [uploadPrefix, setUploadPrefix] = useState<string>('');
  const [isOriginalDataExpanded, setIsOriginalDataExpanded] = useState<boolean>(true);
  const [isUploadedDataExpanded, setIsUploadedDataExpanded] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showJsonUploadModal, setShowJsonUploadModal] = useState<boolean>(false);

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [isSmallScreen, setIsSmallScreen] = useState(false); // For extra small screens

  const [showAddDataSourceModal, setShowAddDataSourceModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Current data source mode: 'original' | 'uploaded'
  const [currentDataSource, setCurrentDataSource] = useState<'original' | 'uploaded'>('original');

  // Check if current model requires event list data
  const requiresEventList = modelRequiresEventList(selectedModel);

  // Handle JSON file upload
  const handleJsonFileUpload = async (file: File, prefix: string, isPruned: boolean) => {
    setUploadError(null);
    setIsLoading(true);

    try {
      const text = await file.text();
      let jsonData: any;

      try {
        jsonData = JSON.parse(text);
      } catch (parseError) {
        throw new Error('Invalid JSON format. Please upload a valid JSON file.');
      }

      // Handle both array and single object with event_list key
      let objectsArray: any[];
      if (Array.isArray(jsonData)) {
        objectsArray = jsonData;
      } else if (jsonData.event_list && Array.isArray(jsonData.event_list)) {
        objectsArray = jsonData.event_list;
      } else {
        throw new Error('JSON must be an array of objects or an object with an "event_list" key containing an array.');
      }

      if (objectsArray.length === 0) {
        throw new Error('No objects found in the uploaded data.');
      }

      // Validate and process objects
      const processedObjects: DataObject[] = [];
      for (let i = 0; i < objectsArray.length; i++) {
        const obj = objectsArray[i];
        
        // Validate mandatory event_list field
        if (!obj.event_list || !Array.isArray(obj.event_list)) {
          throw new Error(`Object at index ${i} is missing the mandatory "event_list" field or it's not an array.`);
        }

        // Generate ID and display name
        const generatedId = `${prefix}_${i + 1}`;
        let displayName = generatedId;
        
        if (obj.obsid && obj.source_name) {
          displayName = `${obj.obsid} - ${obj.source_name}`;
        } else if (obj.obsid) {
          displayName = `${obj.obsid}`;
        } else if (obj.source_name) {
          displayName = obj.source_name;
        } else {
          // Add a name field if no obsid or source_name
          obj.name = generatedId;
          displayName = generatedId;
        }

        const processedObject: DataObject = {
          _id: generatedId,
          obsid: obj.obsid || parseInt(generatedId.split('_').pop() || '0'),
          source_name: obj.source_name || displayName,
          event_list: obj.event_list,
          name: obj.name || displayName,
          ...obj // Include all other properties
        };

        processedObjects.push(processedObject);
      }

      // Save to appdata/user_uploaded_sources
      const result = await saveUploadedData(processedObjects, prefix, isPruned);
      if (result && (result as any).failed) {
        return result;
      }
      
      // Reload all uploaded data from database to ensure consistency and capture server-added fields
      const reloadedObjects = await loadUploadedData();
      
      setCurrentDataSource('uploaded');
      setIsUploadedDataExpanded(true);
      setIsOriginalDataExpanded(false);

      // Clear messages and show success
      dispatch({ type: 'CLEAR_MESSAGES' });
      dispatch({
        type: 'SET_ERROR',
        key: 'success',
        payload: `Successfully uploaded ${processedObjects.length} objects with prefix "${prefix}"`
      });

      // Auto-select first object from the new upload, using the reloaded version (now with embeddings)
      if (processedObjects.length > 0) {
        const targetId = processedObjects[0]._id;
        const selectedFromReload = (reloadedObjects || []).find(o => o._id === targetId) || (reloadedObjects || [])[0];
        if (selectedFromReload) {
          dispatch({ type: 'SET_SELECTED_OBJECT', payload: selectedFromReload });

          // Proactively compute nearest neighbors so the right pane and chat have them immediately
          try {
            if (selectedFromReload.pca_64d && Array.isArray(selectedFromReload.pca_64d) && selectedFromReload.pca_64d.length > 0 && state.selectedDataset?.collection_name) {
              const resp = await fetch('/api/nearest-neighbors', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  collection_name: state.selectedDataset.collection_name,
                  vector: selectedFromReload.pca_64d,
                  limit: 10
                })
              });
              if (resp.ok) {
                const data = await resp.json();
                dispatch({ type: 'SET_NEAREST_NEIGHBORS', payload: data.neighbors || [] });
              } else {
                dispatch({ type: 'SET_NEAREST_NEIGHBORS', payload: [] });
              }
            } else {
              // No vector yet; clear neighbors
              dispatch({ type: 'SET_NEAREST_NEIGHBORS', payload: [] });
            }
          } catch (e) {
            dispatch({ type: 'SET_NEAREST_NEIGHBORS', payload: [] });
          }
          // Close the JSON upload modal once object selection and neighbors are set
          setShowJsonUploadModal(false);
        }
      }

    } catch (error) {
      console.error('Error uploading JSON file:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to process the uploaded file';
      setUploadError(errorMessage);
      dispatch({
        type: 'SET_ERROR',
        key: 'dataset',
        payload: errorMessage
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Save uploaded data to MongoDB appdata/user_uploaded_sources
  const saveUploadedData = async (objects: DataObject[], prefix: string, isPruned: boolean) => {
    try {
      // Debug the objects before upload
      console.log('🚀 Frontend: Uploading objects:', objects.length);
      objects.forEach((obj, index) => {
        console.log(`📋 Object ${index + 1}:`, {
          id: obj._id || obj.obsid || 'unknown',
          hasUmap2d: !!obj.umap_2d,
          hasPca64d: !!obj.pca_64d,
          hasEventList: !!obj.event_list,
          eventListLength: obj.event_list ? obj.event_list.length : 0,
          eventListType: typeof obj.event_list,
          objectKeys: Object.keys(obj).slice(0, 15) // Show first 15 keys
        });
      });

      // Use the same model URL the chat flow uses for raw event models
      const eventModelUrl = getModelApiUrl('qwen-7b-raw-xray-event') || getModelApiUrl(selectedModel);

      const response = await fetch('/api/uploaded-sources', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          objects,
          prefix,
          model_api_url: eventModelUrl,
          is_pruned: isPruned
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to save uploaded data to server');
      }

      console.log('Successfully saved uploaded data:', result.message);
      if (result.failedItems && Array.isArray(result.failedItems) && result.failedItems.length > 0) {
        return { failed: result.failedItems } as any;
      }
      
      // Display detailed debug information
      if (result.debugInfo && result.debugInfo.length > 0) {
        console.log('🔍 Server-side debug information:');
        result.debugInfo.forEach((debug: any, index: number) => {
          console.log(`📋 Object ${index + 1} (${debug.objectId}):`, debug);
        });
      }
    } catch (error) {
      console.error('Error saving uploaded data:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to save uploaded data');
    }
  };

  // Load uploaded data from MongoDB appdata/user_uploaded_sources
  const loadUploadedData = async (): Promise<DataObject[] | undefined> => {
    try {
      const response = await fetch('/api/uploaded-sources', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        if (response.status === 404) {
          // No uploaded data exists yet, which is fine
          setUploadedObjects([]);
          return [];
        }
        throw new Error(result.error || 'Failed to load uploaded data from server');
      }

      // Use the flattened objects from the API response
      setUploadedObjects(result.objects || []);
      console.log(`Loaded ${result.objects?.length || 0} uploaded objects from ${result.datasets?.length || 0} datasets`);
      return result.objects || [];
      
    } catch (error) {
      console.error('Error loading uploaded data:', error);
      // Don't throw here, just set empty array as fallback
      setUploadedObjects([]);
      return [];
    }
  };

  // Delete uploaded dataset by prefix
  const deleteUploadedDataset = async (prefix: string) => {
    try {
      const response = await fetch(`/api/uploaded-sources?prefix=${encodeURIComponent(prefix)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to delete uploaded dataset');
      }

      console.log('Successfully deleted uploaded dataset:', result.message);
      
      // Reload data after deletion
      await loadUploadedData();
      
      // If the currently selected object was from this dataset, clear selection
      if (selectedObject && selectedObject._id.startsWith(prefix)) {
        dispatch({ type: 'SET_SELECTED_OBJECT', payload: null });
      }
      
    } catch (error) {
      console.error('Error deleting uploaded dataset:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to delete uploaded dataset');
    }
  };

  // Load uploaded data on component mount
  useEffect(() => {
    loadUploadedData();
  }, []);

  // Handle successful uploads
  const handleUploadSuccess = async () => {
    // Close data source modal if it's open
    setShowAddDataSourceModal(false);

    // Refresh datasets list after successful upload
    try {
      setIsLoading(true);
      const datasets = await loadAvailableDatasets();
      dispatch({ type: 'SET_DATASETS', payload: datasets });

      // Select the newly added dataset (it should be the last one)
      if (datasets.length > 0) {
        const newDataset = datasets[datasets.length - 1];
        handleDatasetChange(newDataset.collection_name);
      }
    } catch (error) {
      console.error('Error refreshing datasets:', error);
      dispatch({
        type: 'SET_ERROR',
        key: 'dataset',
        payload: 'Failed to refresh datasets after upload'
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Reset search and show all objects
  const resetSearch = () => {
    console.log("Resetting search");
    setSearchTerm('');
    setIsSearchActive(false);
    setSelectedSourceType('');
    setSearchMessage('');

    // Reload the first page of results with no filters
    if (selectedDataset) {
      fetchDatasetObjects(selectedDataset.collection_name, 0, false);
    }
  };

  // Handle filter change
  const handleSourceTypeChange = (sourceType: string) => {
    console.log(`Source type change request: "${sourceType}"`);

    // Update state
    setSelectedSourceType(sourceType);

    // Reset pagination
    setCurrentPage(0);

    // Reset the search message
    setSearchMessage('');

    // If we're clearing the filter
    if (!sourceType) {
      setIsSearchActive(!!searchTerm);

      // Fetch data with only the search term (if any)
      if (selectedDataset) {
        fetchDatasetObjects(
          selectedDataset.collection_name,
          0,
          false,
          {
            term: searchTerm
          }
        );
      }
    } else {
      // Apply the filter (with search term if present)
      setIsSearchActive(true);

      if (selectedDataset) {
        fetchDatasetObjects(
          selectedDataset.collection_name,
          0,
          false,
          {
            term: searchTerm,
            sourceType: sourceType
          }
        );
      }
    }

    // Close the filter dropdown
    setIsFilterOpen(false);
  };

  useEffect(() => {
    // Set a timer to hide the loading animation after 2.5 seconds
    const timer = setTimeout(() => {
      setInitialLoading(false);
    }, 2500);

    // Clean up the timer
    return () => clearTimeout(timer);
  }, []);

  // Generate default upload prefix
  useEffect(() => {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');
    setUploadPrefix(`UPD_${year}_${month}_${day}_${hour}_${minute}`);
  }, []);

  // Check if we're in mobile view on component mount and window resize
  useEffect(() => {
    const checkScreenSize = () => {
      const isMobile = window.innerWidth < 768; // Standard md breakpoint
      const isSmall = window.innerWidth < 480; // Custom xs breakpoint
      setIsMobileView(isMobile);
      setIsSmallScreen(isSmall);

      // Auto-collapse on mobile by default
      if (isMobile && !isCollapsed) {
        setIsCollapsed(true);
      }
      // Auto-expand on desktop
      if (!isMobile && isCollapsed) {
        setIsCollapsed(false);
      }
    };

    // Check initially
    checkScreenSize();

    // Set up resize listener
    window.addEventListener('resize', checkScreenSize);

    // Clean up
    return () => {
      window.removeEventListener('resize', checkScreenSize);
    };
  }, [isCollapsed]);

  // Load initial data when dataset changes
  useEffect(() => {
    if (selectedDataset?.collection_name) {
      console.log("Dataset changed to:", selectedDataset.collection_name);
      setIsLoading(true);
      setObjects([]);
      setFilteredObjects([]);
      setCurrentPage(0);
      setHasMoreData(true);
      setSearchTerm('');
      setIsSearchActive(false);
      setSelectedSourceType('');
      setSearchMessage('');

      // Reset loading ref
      isLoadingMore.current = false;

      fetchDatasetObjects(selectedDataset.collection_name, 0, false)
        .catch((error) => {
          console.error("Error fetching initial objects:", error);
          dispatch({
            type: 'SET_ERROR',
            key: 'dataset',
            payload: 'Failed to load dataset objects'
          });
          setIsLoading(false);
        });
    }
  }, [selectedDataset?.collection_name, dispatch]);

  // Set first object as selected when objects load initially
  useEffect(() => {
    if (objects.length > 0 && !selectedObject) {
      handleObjectChange(objects[0]._id);
    }
  }, [objects, selectedObject]);

  // Set first dataset as selected if none is selected
  useEffect(() => {
    if (datasets.length > 0 && !selectedDataset) {
      handleDatasetChange(datasets[0].collection_name);
    }
  }, [datasets, selectedDataset]);

  // Set up intersection observer for infinite scroll
  useEffect(() => {
    if (!objectsContainerRef.current) return;
    if (filteredObjects.length === 0 || !hasMoreData) return;
    if (isLoading || isLoadingMore.current) return;

    console.log("Setting up intersection observer, filtered objects:", filteredObjects.length);

    const options = {
      root: objectsContainerRef.current,
      rootMargin: '0px 0px 100px 0px',
      threshold: 0.1
    };

    const observer = new IntersectionObserver(handleObserver, options);

    // Add a sentinel element at the end of the list to trigger loading more
    setTimeout(() => {
      const sentinel = document.getElementById('objects-sentinel');
      if (sentinel) {
        console.log("Observing sentinel element");
        observer.observe(sentinel);
      } else {
        console.warn("Sentinel element not found");
      }
    }, 100);

    return () => {
      observer.disconnect();
    };
  }, [filteredObjects.length, hasMoreData, isLoading, shouldUpdateObserver]);

  const handleObserver = (entries: IntersectionObserverEntry[]) => {
    const target = entries[0];
    if (target.isIntersecting && hasMoreData && !isLoading && !isLoadingMore.current) {
      console.log("Sentinel element intersecting, loading more objects");
      loadMoreObjects();
    }
  };

  // Updated fetchDatasetObjects function to support server-side search
  const fetchDatasetObjects = async (
    collectionName: string,
    page: number,
    append = false,
    searchParams?: {
      term?: string,
      sourceType?: string
    }
  ) => {
    // Double-check we're not already loading
    if (isLoadingMore.current) {
      console.log("Already loading data, skipping fetchDatasetObjects call");
      return;
    }

    console.log("Fetching objects for collection:", collectionName, "page:", page, "append:", append, "searchParams:", searchParams);

    try {
      isLoadingMore.current = true;
      setIsLoading(true);
      setLoadedMoreData(false);

      // Calculate skip value based on page number
      const skip = page * PAGE_SIZE;

      // Build the API URL with search parameters
      let url = `/api/datasets/${collectionName}?skip=${skip}&limit=${PAGE_SIZE}`;

      if (searchParams?.term && searchParams.term.trim() !== '') {
        url += `&search=${encodeURIComponent(searchParams.term.trim())}`;
      }

      if (searchParams?.sourceType && searchParams.sourceType.trim() !== '') {
        url += `&sourceType=${encodeURIComponent(searchParams.sourceType)}`;
      }

      console.log(`Fetching with URL: ${url}`);

      // Make API request
      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Error fetching data');
      }

      console.log("API response:", data);

      // Extract source types from response
      if (data?.objects?.length > 0) {
        // Extract source types from objects
        const types = Array.from(
          new Set(
            data.objects
              .map((obj: { source_type?: string }) => obj.source_type)
              .filter((type : any): type is string =>
                typeof type === 'string' && type.trim() !== ''
              )
          )
        ).sort();

        console.log("Source types from response:", types);

        // type-guard helper
        const isString = (x: unknown): x is string => typeof x === "string";

        if (page === 0 || types.length > 0) {
          setSourceTypes(prev => {
            // keep only the strings, which also narrows the type
            const cleaned = [...prev, ...types].filter(isString);

            // cleaned is now string[]
            return Array.from(new Set(cleaned)).sort();
          });
        }
      }

      // Update total count from API response
      if (data && 'total_count' in data) {
        setTotalCount(data.total_count);
      }

      // Append or replace existing objects
      if (data && data.objects) {
        if (data.objects.length === 0 && page > 0) {
          console.log("Received 0 objects on page > 0, setting hasMoreData to false");
          setHasMoreData(false);
          return;
        }

        let newObjects;
        if (append) {
          newObjects = [...objects, ...data.objects];
          setObjects(newObjects);
          setFilteredObjects(newObjects);
          setLoadedMoreData(true); // Flag that we've loaded more data
        } else {
          newObjects = data.objects;
          setObjects(newObjects);
          setFilteredObjects(newObjects);
        }

        // Check if we have more data to load
        setHasMoreData(data.objects.length === PAGE_SIZE);

        // Set search message for zero results
        if (data.objects.length === 0 && (searchParams?.term || searchParams?.sourceType)) {
          const searchDesc = searchParams.term ? `"${searchParams.term}"` : '';
          const typeDesc = searchParams.sourceType ? `type "${searchParams.sourceType}"` : '';
          const connector = searchParams.term && searchParams.sourceType ? ' and ' : '';

          setSearchMessage(`No objects found matching ${searchDesc}${connector}${typeDesc}`);
        } else {
          setSearchMessage('');
        }
      } else {
        console.error("Invalid response format:", data);
        setHasMoreData(false);
      }

      setCurrentPage(page);

    } catch (error) {
      console.error('Error loading objects:', error);
      dispatch({
        type: 'SET_ERROR',
        key: 'dataset',
        payload: 'Failed to load dataset objects'
      });
      setHasMoreData(false);
    } finally {
      setIsLoading(false);
      isLoadingMore.current = false;

      // Set timeout to clear the "loaded more" message after a while
      if (append) {
        setTimeout(() => {
          setLoadedMoreData(false);
        }, 5000);
      }
    }
  };

  // Updated loadMoreObjects function to maintain search context
  const loadMoreObjects = () => {
    if (isLoading || !hasMoreData || !selectedDataset || isLoadingMore.current) return;

    const nextPage = currentPage + 1;
    fetchDatasetObjects(
      selectedDataset.collection_name,
      nextPage,
      true,
      {
        term: searchTerm,
        sourceType: selectedSourceType
      }
    );
  };

  const handleDatasetChange = (collectionName: string) => {
    const dataset = datasets.find(d => d.collection_name === collectionName);
    if (dataset) {
      dispatch({ type: 'SET_SELECTED_DATASET', payload: dataset });
      dispatch({ type: 'SET_SELECTED_OBJECT', payload: null });
      dispatch({ type: 'CLEAR_MESSAGES' });
      setSearchTerm('');
      setIsSearchActive(false);
      setSelectedDataset(dataset.collection_name);
    }
  };

  const handleObjectChange = (objectId: string) => {
    const object = objects.find(obj => obj._id === objectId);
    if (object) {
      dispatch({ type: 'SET_SELECTED_OBJECT', payload: object });
      dispatch({ type: 'CLEAR_MESSAGES' });

      // Auto-collapse on mobile after selection
      if (isMobileView) {
        setIsCollapsed(true);
      }
    }
  };

  // Handle uploaded object selection
  const handleUploadedObjectChange = (objectId: string) => {
    const object = uploadedObjects.find(obj => obj._id === objectId);
    if (object) {
      dispatch({ type: 'SET_SELECTED_OBJECT', payload: object });
      dispatch({ type: 'CLEAR_MESSAGES' });
      setCurrentDataSource('uploaded');

      // Auto-collapse on mobile after selection
      if (isMobileView) {
        setIsCollapsed(true);
      }
    }
  };

  // Filter uploaded objects based on search
  const filteredUploadedObjects = uploadedSearchTerm
    ? uploadedObjects.filter(obj =>
        (obj.obsid?.toString() || '').includes(uploadedSearchTerm) ||
        ((obj.source_name || '') as string).toLowerCase().includes(uploadedSearchTerm.toLowerCase()) ||
        ((typeof obj.name === 'string' ? obj.name : '') || '').toLowerCase().includes(uploadedSearchTerm.toLowerCase())
      )
    : uploadedObjects;

  // Updated search handler to use server-side search
  const handleSearch = () => {
    console.log("Search triggered for:", searchTerm);

    // If search is empty, reset to show all objects
    if (!searchTerm || searchTerm.trim() === '') {
      if (!selectedSourceType) {
        resetSearch();
      } else {
        // Keep source type filter but clear search term
        handleSourceTypeChange(selectedSourceType);
      }
      return;
    }

    // Set search active state
    setIsSearchActive(true);

    // Reset to page 0 for new searches
    setCurrentPage(0);

    // Clear any previous search messages
    setSearchMessage('');

    // Use server-side search
    if (selectedDataset) {
      fetchDatasetObjects(
        selectedDataset.collection_name,
        0,
        false,
        {
          term: searchTerm,
          sourceType: selectedSourceType
        }
      );
    }
  };

  // Toggle collapsed state for mobile
  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  // Toggle filter menu visibility
  const toggleFilter = () => {
    console.log("Toggle filter clicked");
    setIsFilterOpen(!isFilterOpen);
  };

  // Handle clicks outside the filter menu to close it
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Expose methods to parent component via ref
  useImperativeHandle(ref, () => ({
    focusSearchInput: (value: string) => {
      if (searchInputRef.current) {
        searchInputRef.current.focus();
        searchInputRef.current.value = value;
        setSearchTerm(value);
      }
    },
    triggerSearch: () => {
      if (searchButtonRef.current) {
        searchButtonRef.current.click();
      }
    }
  }));

  // Handle the option selection in the Add Source modal
  const handleSourceOptionSelect = (option: string) => {
    if (option === 'local-files') {
      // Close the Add Source modal and open the Upload modal
      setShowAddDataSourceModal(false);
      setShowUploadModal(true);
    } else {
      // For now, just close the modal for other options
      setShowAddDataSourceModal(false);
    }
  };



  return (
    <div className={`flex flex-col h-full overflow-hidden ${
      theme === 'dark' 
        ? 'bg-[#111125]' 
        : 'bg-white'
    }`}>
      {/* Collapsed state - show toggle button only */}
      {!isDataExpanded ? (
        <div className="h-full flex flex-col items-center justify-center p-2">
          <button
            onClick={toggleData}
            className={`p-3 rounded-lg transition-colors ${
              theme === 'dark' 
                ? 'bg-[#1A1832] hover:bg-[#2A2850] text-[#00E0FF]' 
                : 'bg-gray-100 hover:bg-gray-200 text-blue-600'
            }`}
            title="Expand Configuration Panel"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      ) : (
        // Expanded state - show full content
        <>
          {initialLoading ? (
            // Loading animation
            <div className="flex flex-col items-center justify-center h-full p-6 space-y-4">
              <div className={`animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 ${
                theme === 'dark' 
                  ? 'border-[#00E0FF]' 
                  : 'border-blue-600'
              }`}></div>
              <p className={`text-sm font-medium animate-pulse ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
              }`}>
                Loading configuration...
              </p>
            </div>
          ) : (
            <>
              {/* Header with toggle button */}
              <div className={`p-3 sm:p-4 border-b flex justify-between items-center ${
                theme === 'dark' 
                  ? 'border-gray-800/40' 
                  : 'border-gray-200/40'
              }`}>
                <h2 className={`text-lg font-semibold ${
                  theme === 'dark' ? 'text-white' : 'text-gray-800'
                }`}>Configuration</h2>

                {/* Toggle button */}
                <button
                  onClick={toggleData}
                  className={`flex items-center justify-center p-1.5 rounded-md transition-colors ${
                    theme === 'dark' 
                      ? 'bg-[#1A1832] hover:bg-[#2A2850] text-[#00E0FF]' 
                      : 'bg-gray-100 hover:bg-gray-200 text-blue-600'
                  }`}
                  title="Collapse Configuration Panel"
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
              </div>

              {/* Main content */}
              <div className="overflow-auto flex-1">
                <div className="p-3 sm:p-4 space-y-4 sm:space-y-6">
                  {/* Data Sources - Expandable Sections */}
                  <div className="space-y-3">
                    {/* Model compatibility warning when using uploaded/custom data */}
                    {!requiresEventList && currentDataSource === 'uploaded' && (
                      <div className={`flex items-start xs:items-center text-xs px-3 py-2 rounded-md ${
                        theme === 'dark' 
                          ? 'bg-amber-900/20 text-amber-400' 
                          : 'bg-amber-50 text-amber-600'
                      }`}>
                        <AlertCircle className="w-3.5 h-3.5 mr-1.5 flex-shrink-0 mt-0.5 xs:mt-0" />
                        <span>Current model doesn&apos;t support event list data. Please select a compatible model to use uploaded data.</span>
                      </div>
                    )}

                    {/* Original Data Section */}
                    <div className={`border rounded-md ${
                      theme === 'dark' ? 'border-gray-700/50' : 'border-gray-200/40'
                    }`}>
                      <button
                        onClick={() => {
                          setIsOriginalDataExpanded(!isOriginalDataExpanded);
                          if (!isOriginalDataExpanded) {
                            setCurrentDataSource('original');
                            setIsUploadedDataExpanded(false);
                          }
                        }}
                        className={`w-full p-3 flex justify-between items-center ${
                          isOriginalDataExpanded 
                            ? theme === 'dark' ? 'bg-[#1A1832]' : 'bg-gray-50'
                            : ''
                        }`}
                      >
                        <div className="flex items-center">
                          <Database className={`h-4 w-4 mr-2 ${
                            theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                          }`} />
                          <span className={`text-sm font-medium ${
                            theme === 'dark' ? 'text-white' : 'text-gray-800'
                          }`}>
                            Original Data
                          </span>
                          {currentDataSource === 'original' && selectedObject && (
                            <span className={`ml-2 text-xs px-2 py-1 rounded ${
                              theme === 'dark' ? 'bg-[#00E0FF]/20 text-[#00E0FF]' : 'bg-blue-100 text-blue-600'
                            }`}>
                              Selected
                            </span>
                          )}
                        </div>
                        {isOriginalDataExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>

                      {isOriginalDataExpanded && (
                        <div className="p-3 border-t border-gray-700/50">
                          {/* Dataset Selection */}
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <label className={`block text-sm font-medium ${
                                theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                              }`}>Data Source</label>
                              <button
                                onClick={() => setShowAddDataSourceModal(true)}
                                className={`flex items-center text-xs transition-colors ${
                                  theme === 'dark' 
                                    ? 'text-[#00E0FF] hover:text-[#00E0FF]/80' 
                                    : 'text-blue-600 hover:text-blue-500'
                                }`}
                              >
                                <PlusCircle className="h-3.5 w-3.5 mr-1" />
                                <span className="whitespace-nowrap">Add Source</span>
                              </button>
                            </div>
                            <div className="relative">
                              <Database className={`absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`} />
                              <select
                                value={selectedDataset?.collection_name || ''}
                                onChange={(e) => handleDatasetChange(e.target.value)}
                                className={`w-full appearance-none rounded-md p-2.5 pl-10 pr-8 text-sm border focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                                  theme === 'dark' 
                                    ? 'bg-[#0D0C22] text-gray-300 border-gray-700 focus:border-[#00E0FF] focus:ring-[#00E0FF]' 
                                    : 'bg-white text-gray-700 border-gray-300 focus:border-blue-500'
                                } transition-colors`}
                              >
                                {datasets.map((dataset) => (
                                  <option key={dataset.collection_name} value={dataset.collection_name}>
                                    {dataset.file_name}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown className={`absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 pointer-events-none ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`} />
                            </div>
                          </div>

                          {/* Object Selection - Only show when dataset is selected and we're in original data mode */}
                          {selectedDataset && currentDataSource === 'original' && (
                            <div className="space-y-2 mt-4">
                              <div className="flex justify-between items-center mb-2">
                                <div className="flex items-center">
                                  <h3 className={`text-sm font-medium ${
                                    theme === 'dark' ? 'text-white' : 'text-gray-800'
                                  }`}>Objects</h3>
                                  {isLoading && (
                                    <Loader2 className="ml-2 h-3 w-3 animate-spin text-gray-400" />
                                  )}
                                  {objects.length > 0 && (
                                    <span className={`text-xs ml-2 ${
                                      theme === 'dark' ? 'text-gray-500' : 'text-gray-600'
                                    }`}>
                                      {filteredObjects.length} of {totalCount}
                                    </span>
                                  )}
                                </div>

                                <button
                                  onClick={() => setShowSourceTypeDisplay(!showSourceTypeDisplay)}
                                  className={`flex items-center text-xs ${
                                    theme === 'dark' 
                                      ? 'text-gray-400 hover:text-[#00E0FF]' 
                                      : 'text-gray-500 hover:text-blue-600'
                                  }`}
                                  title={showSourceTypeDisplay ? "Show source names" : "Show source types"}
                                >
                                  <span className="mr-1 hidden xs:inline-block">
                                    {showSourceTypeDisplay ? "Names" : "Types"}
                                  </span>
                                  {showSourceTypeDisplay ? (
                                    <ToggleRight className="h-4 w-4" />
                                  ) : (
                                    <ToggleLeft className="h-4 w-4" />
                                  )}
                                </button>
                              </div>

                              {/* Search and filter component */}
                              <div className="relative mb-2">
                                <div className="flex flex-col xs:flex-row space-y-2 xs:space-y-0">
                                  <div className="relative flex-grow">
                                    <Search className={`absolute left-2.5 top-2.5 h-4 w-4 ${
                                      theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                                    }`} />
                                    <input
                                      ref={searchInputRef}
                                      type="text"
                                      value={searchTerm}
                                      onChange={(e) => {
                                        setSearchTerm(e.target.value);
                                      }}
                                      placeholder="Search objects..."
                                      className={`w-full pl-9 pr-8 py-2.5 text-sm rounded-md xs:rounded-l-md xs:rounded-r-none border focus:outline-none focus:ring-1 ${
                                        theme === 'dark' 
                                          ? 'bg-[#0D0C22] text-gray-300 border-gray-700 focus:border-[#00E0FF] focus:ring-[#00E0FF]' 
                                          : 'bg-white text-gray-700 border-gray-300 focus:border-blue-500 focus:ring-blue-500/20'
                                      } transition-colors`}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          handleSearch();
                                        }
                                      }}
                                    />
                                    {searchTerm && (
                                      <button
                                        onClick={() => {
                                          setSearchTerm('');
                                          if (!selectedSourceType) {
                                            resetSearch();
                                          } else {
                                            handleSourceTypeChange(selectedSourceType);
                                          }
                                        }}
                                        className={`absolute right-2 top-1/2 transform -translate-y-1/2 ${
                                          theme === 'dark' 
                                            ? 'text-gray-400 hover:text-white' 
                                            : 'text-gray-500 hover:text-gray-700'
                                        }`}
                                      >
                                        <X className="h-4 w-4" />
                                      </button>
                                    )}
                                  </div>

                                  <div className="flex">
                                    {/* Filter Button */}
                                    <div className="relative" ref={filterMenuRef}>
                                      <button
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          toggleFilter();
                                        }}
                                        className={`p-2.5 rounded-l-md xs:rounded-l-none border ${
                                          isFilterOpen 
                                            ? theme === 'dark' 
                                              ? 'bg-[#1A1832] border-gray-700' 
                                              : 'bg-gray-100 border-gray-300' 
                                            : theme === 'dark' 
                                              ? 'bg-[#0D0C22] hover:bg-[#1A1832] border-gray-700' 
                                              : 'bg-white hover:bg-gray-100 border-gray-300'
                                        } ${isSmallScreen ? 'w-1/2 flex justify-center' : ''}`}
                                        aria-label="Filter"
                                      >
                                        <Filter size={16} className={selectedSourceType
                                          ? theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                                          : theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                                        } />
                                      </button>

                                      {/* Filter dropdown */}
                                      {isFilterOpen && (
                                        <div className={`absolute right-0 top-full mt-1 w-60 rounded-md shadow-lg z-20 border ${
                                          theme === 'dark' 
                                            ? 'bg-[#0D0C22] border-gray-700' 
                                            : 'bg-white border-gray-200'
                                        }`}>
                                          <div className="p-2">
                                            <div className={`text-xs font-medium mb-2 ${
                                              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                                            }`}>Filter by Source Type</div>
                                            <div className="space-y-1 max-h-48 overflow-y-auto">
                                              <div
                                                key="all"
                                                className={`flex items-center px-2 py-1.5 rounded cursor-pointer ${
                                                  theme === 'dark' 
                                                    ? 'hover:bg[#1A1832]' 
                                                    : 'hover:bg-gray-100'
                                                }`}
                                                onClick={() => handleSourceTypeChange('')}
                                              >
                                                <div className="w-4 h-4 mr-2 flex items-center justify-center">
                                                  {!selectedSourceType && <Check size={12} className={
                                                    theme === 'dark' ? 'text[#00E0FF]' : 'text-blue-600'
                                                  } />}
                                                </div>
                                                <span className={`text-sm ${
                                                  theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                                                }`}>All Types</span>
                                              </div>
                                              {sourceTypes.map((type) => (
                                                <div
                                                  key={type}
                                                  className={`flex items-center px-2 py-1.5 rounded cursor-pointer ${
                                                    theme === 'dark' 
                                                      ? 'hover:bg-[#1A1832]' 
                                                      : 'hover:bg-gray-100'
                                                  }`}
                                                  onClick={() => handleSourceTypeChange(type)}
                                                >
                                                  <div className="w-4 h-4 mr-2 flex items-center justify-center">
                                                    {selectedSourceType === type && <Check size={12} className={
                                                      theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                                                    } />}
                                                  </div>
                                                  <span className={`text-sm ${
                                                    theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                                                  }`}>{type}</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* Search Button */}
                                    <button
                                      ref={searchButtonRef}
                                      onClick={handleSearch}
                                      className={`px-3 py-2.5 text-sm rounded-r-md border border-l-0 transition-colors focus:outline-none focus:ring-1 ${
                                        theme === 'dark'
                                          ? 'bg-[#1a1a2e] hover:bg-[#252547] text-gray-300 border-gray-700 focus:ring-[#00E0FF]'
                                          : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-300 focus:ring-blue-500'
                                      } ${isSmallScreen ? 'w-1/2 flex justify-center' : ''}`}
                                    >
                                      <Search className="h-4 w-4" />
                                    </button>
                                  </div>
                                </div>
                              </div>

                              {/* Objects list */}
                              <div className="relative">
                                <div
                                  ref={objectsContainerRef}
                                  className={`h-64 sm:h-96 rounded-md border focus-within:ring-1 overflow-y-auto ${
                                    theme === 'dark' 
                                      ? 'bg-[#0D0C22] text-gray-300 border-gray-700 focus-within:border-[#00E0FF] focus-within:ring-[#00E0FF]' 
                                      : 'bg-white text-gray-700 border-gray-300 focus-within:border-blue-500 focus-within:ring-blue-500/20'
                                  }`}
                                >
                                  {filteredObjects.length > 0 ? (
                                    <div className="py-1">
                                      {filteredObjects.map((obj) => (
                                        <div
                                          key={obj._id}
                                          onClick={() => handleObjectChange(obj._id)}
                                          className={`py-2 px-3 cursor-pointer transition-colors ${
                                            selectedObject?._id === obj._id 
                                              ? theme === 'dark'
                                                ? 'bg-[#1E1A3C] text-[#00E0FF]' 
                                                : 'bg-blue-50 text-blue-600'
                                              : theme === 'dark'
                                                ? 'text-gray-300 hover:bg-[#1A1832]'
                                                : 'text-gray-700 hover:bg-gray-100'
                                          }`}
                                        >
                                          <div className="truncate">
                                            <span className="font-medium">{obj.obsid}</span>
                                            {showSourceTypeDisplay ? (
                                              obj.source_type ? (
                                                <> - <span className="opacity-90">{obj.source_type}</span></>
                                              ) : (
                                                <> - <span className="opacity-70">Unknown</span></>
                                              )
                                            ) : (
                                              obj.source_name && (
                                                <> - <span className="opacity-90">{obj.source_name}</span></>
                                              )
                                            )}
                                            {!showSourceTypeDisplay && obj.source_type && (
                                              <> <span className={`ml-1 px-1.5 py-0.5 text-xs rounded font-medium ${
                                                theme === 'dark'
                                                  ? 'bg-[#1A1832] text-[#00E0FF]'
                                                  : 'bg-blue-100 text-blue-600'
                                              }`}>{obj.source_type}</span></>
                                            )}
                                          </div>
                                        </div>
                                      ))}

                                      {/* Load More button */}
                                      {hasMoreData && (
                                        <div className="py-3 flex justify-center">
                                          <button
                                            onClick={loadMoreObjects}
                                            className={`px-3 py-1.5 text-xs rounded flex items-center ${
                                              theme === 'dark'
                                                ? 'bg-[#1A1832] text-[#00E0FF] hover:bg-[#2A2850]'
                                                : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                                            }`}
                                            disabled={isLoading || isLoadingMore.current}
                                          >
                                            {isLoading ? (
                                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                            ) : (
                                              <PlusCircle className="w-3 h-3 mr-1" />
                                            )}
                                            Load More
                                          </button>
                                        </div>
                                      )}

                                      {/* Sentinel element for infinite scroll */}
                                      {hasMoreData && (
                                        <div id="objects-sentinel" className="h-4" />
                                      )}
                                    </div>
                                  ) : (
                                    <div className="h-full flex items-center justify-center py-4">
                                      {isLoading ? (
                                        <div className="flex flex-col items-center">
                                          <Loader2 className={`w-5 h-5 animate-spin mb-2 ${
                                            theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                                          }`} />
                                          <p className={`text-sm ${
                                            theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                                          }`}>
                                            {isSearchActive ? 'Searching...' : 'Loading objects...'}
                                          </p>
                                        </div>
                                      ) : (
                                        <p className={`text-sm px-4 text-center ${
                                          theme === 'dark' ? 'text-gray-500' : 'text-gray-500'
                                        }`}>
                                          {searchMessage || "No objects available"}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Uploaded Data Section */}
                    <div className={`border rounded-md ${
                      theme === 'dark' ? 'border-gray-700/50' : 'border-gray-200/40'
                    }`}>
                      <button
                        onClick={() => {
                          setIsUploadedDataExpanded(!isUploadedDataExpanded);
                          if (!isUploadedDataExpanded) {
                            setCurrentDataSource('uploaded');
                            setIsOriginalDataExpanded(false);
                          }
                        }}
                        className={`w-full p-3 flex justify-between items-center ${
                          isUploadedDataExpanded 
                            ? theme === 'dark' ? 'bg-[#1A1832]' : 'bg-gray-50'
                            : ''
                        }`}
                      >
                        <div className="flex items-center">
                          <Upload className={`h-4 w-4 mr-2 ${
                            theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                          }`} />
                          <span className={`text-sm font-medium ${
                            theme === 'dark' ? 'text-white' : 'text-gray-800'
                          }`}>
                            Uploaded Data
                          </span>
                          {uploadedObjects.length > 0 && (
                            <span className={`ml-2 text-xs px-2 py-1 rounded ${
                              theme === 'dark' ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'
                            }`}>
                              {uploadedObjects.length} objects
                            </span>
                          )}
                          {currentDataSource === 'uploaded' && selectedObject && (
                            <span className={`ml-2 text-xs px-2 py-1 rounded ${
                              theme === 'dark' ? 'bg-[#00E0FF]/20 text-[#00E0FF]' : 'bg-blue-100 text-blue-600'
                            }`}>
                              Selected
                            </span>
                          )}
                        </div>
                        {isUploadedDataExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>

                      {isUploadedDataExpanded && (
                        <div className="p-3 border-t border-gray-700/50">
                          {/* Upload button */}
                          <div className="space-y-3">
                            <button
                              onClick={() => setShowJsonUploadModal(true)}
                              className={`w-full p-3 border-2 border-dashed rounded-md transition-colors ${
                                theme === 'dark'
                                  ? 'border-gray-700 hover:border-[#00E0FF]/50 text-gray-300 hover:text-white'
                                  : 'border-gray-300 hover:border-blue-400 text-gray-600 hover:text-gray-800'
                              }`}
                            >
                              <div className="flex items-center justify-center">
                                <Upload className="w-5 h-5 mr-2" />
                                <span className="text-sm font-medium">Upload JSON Data</span>
                              </div>
                              <p className={`text-xs mt-1 ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                              }`}>
                                Upload JSON files with event_list data
                              </p>
                            </button>

                            {/* Uploaded objects list */}
                            {uploadedObjects.length > 0 && (
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <h3 className={`text-sm font-medium ${
                                    theme === 'dark' ? 'text-white' : 'text-gray-800'
                                  }`}>
                                    Uploaded Objects ({uploadedObjects.length})
                                  </h3>
                                </div>

                                {/* Search for uploaded objects */}
                                <div className="relative">
                                  <Search className={`absolute left-2.5 top-2.5 h-4 w-4 ${
                                    theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                                  }`} />
                                  <input
                                    type="text"
                                    value={uploadedSearchTerm}
                                    onChange={(e) => setUploadedSearchTerm(e.target.value)}
                                    placeholder="Search uploaded objects..."
                                    className={`w-full pl-9 pr-8 py-2.5 text-sm rounded-md border focus:outline-none focus:ring-1 ${
                                      theme === 'dark' 
                                        ? 'bg-[#0D0C22] text-gray-300 border-gray-700 focus:border-[#00E0FF] focus:ring-[#00E0FF]' 
                                        : 'bg-white text-gray-700 border-gray-300 focus:border-blue-500 focus:ring-blue-500/20'
                                    } transition-colors`}
                                  />
                                  {uploadedSearchTerm && (
                                    <button
                                      onClick={() => setUploadedSearchTerm('')}
                                      className={`absolute right-2 top-1/2 transform -translate-y-1/2 ${
                                        theme === 'dark' 
                                          ? 'text-gray-400 hover:text-white' 
                                          : 'text-gray-500 hover:text-gray-700'
                                      }`}
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>

                                {/* Objects list */}
                                <div className={`h-64 rounded-md border overflow-y-auto ${
                                  theme === 'dark' 
                                    ? 'bg-[#0D0C22] text-gray-300 border-gray-700' 
                                    : 'bg-white text-gray-700 border-gray-300'
                                }`}>
                                  {filteredUploadedObjects.length > 0 ? (
                                    <div className="py-1">
                                      {filteredUploadedObjects.map((obj) => (
                                        <div
                                          key={obj._id}
                                          onClick={() => handleUploadedObjectChange(obj._id)}
                                          className={`py-2 px-3 cursor-pointer transition-colors ${
                                            selectedObject?._id === obj._id 
                                              ? theme === 'dark'
                                                ? 'bg-[#1E1A3C] text-[#00E0FF]' 
                                                : 'bg-blue-50 text-blue-600'
                                              : theme === 'dark'
                                                ? 'text-gray-300 hover:bg-[#1A1832]'
                                                : 'text-gray-700 hover:bg-gray-100'
                                          }`}
                                        >
                                          <div className="truncate">
                                            <span className="font-medium">{obj.obsid}</span>
                                            {obj.source_name && obj.source_name !== (typeof obj.name === 'string' ? obj.name : '') && (
                                              <> - <span className="opacity-90">{obj.source_name}</span></>
                                            )}
                                            {typeof obj.name === 'string' && obj.name && (
                                              <> <span className={`ml-1 px-1.5 py-0.5 text-xs rounded font-medium ${
                                                theme === 'dark'
                                                  ? 'bg-[#1A1832] text-[#00E0FF]'
                                                  : 'bg-blue-100 text-blue-600'
                                              }`}>{obj.name as string}</span></>
                                            )}
                                          </div>
                                          <div className={`text-xs mt-1 ${
                                            theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                                          }`}>
                                            Events: Pruned {obj.event_list?.length || 0}
                                            {Array.isArray((obj as any)?.original_event_list) && (obj as any).original_event_list.length > 0 && (
                                              <> | Raw {(obj as any).original_event_list.length}</>
                                            )} points
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="h-full flex items-center justify-center py-4">
                                      <p className={`text-sm text-center ${
                                        theme === 'dark' ? 'text-gray-500' : 'text-gray-500'
                                      }`}>
                                        {uploadedSearchTerm ? 'No matching objects found' : 'Upload JSON data to see objects here'}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Upload error display */}
                            {uploadError && (
                              <div className={`p-3 rounded-md ${
                                theme === 'dark' ? 'bg-red-900/20 text-red-400' : 'bg-red-50 text-red-600'
                              }`}>
                                <div className="flex items-start">
                                  <AlertTriangle className="w-4 h-4 mr-2 flex-shrink-0 mt-0.5" />
                                  <span className="text-sm">{uploadError}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>


                  </div>
                </div>
              </div>

              {/* Mobile collapsed state indicators */}
              {isMobileView && isCollapsed && (
                <div className={`p-2 md:hidden border-t ${
                  theme === 'dark' 
                    ? 'bg-[#1A1832] border-gray-800/40' 
                    : 'bg-gray-50 border-gray-200/40'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div className={`w-2 h-2 rounded-full mr-2 ${
                        theme === 'dark' ? 'bg-[#00E0FF]' : 'bg-blue-600'
                      }`}></div>
                      <span className={`text-xs truncate max-w-[150px] ${
                        theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                      }`}>
                        {currentDataSource === 'original' && selectedObject ? (
                          selectedObject.source_name || `Object ID: ${selectedObject._id}`
                        ) : currentDataSource === 'uploaded' && selectedObject ? (
                          (typeof selectedObject.name === 'string' ? selectedObject.name : null) || `Uploaded: ${selectedObject._id}`
                        ) : (
                          'Select data source'
                        )}
                      </span>
                    </div>
                    <button
                      onClick={toggleCollapse}
                      className={`text-xs px-2 py-1 rounded ${
                        theme === 'dark' 
                          ? 'text-[#00E0FF] bg-[#2A2850]' 
                          : 'text-blue-600 bg-blue-50'
                      }`}
                    >
                      Change
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* JSON Upload Modal */}
      <JsonUploadModal
        isOpen={showJsonUploadModal}
        onClose={() => setShowJsonUploadModal(false)}
        onUpload={handleJsonFileUpload}
        defaultPrefix={uploadPrefix}
      />

      {/* Add New Data Source Modal */}
      {showAddDataSourceModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-3">
          <div className={`rounded-lg max-w-lg w-full overflow-hidden border ${
            theme === 'dark' 
              ? 'bg-[#111125] border-gray-700' 
              : 'bg-white border-gray-300'
          }`}>
            <div className={`flex justify-between items-center p-3 sm:p-4 border-b ${
              theme === 'dark' 
                ? 'border-gray-700/50' 
                : 'border-gray-200'
            }`}>
              <h3 className={`text-lg font-medium ${
                theme === 'dark' ? 'text-white' : 'text-gray-800'
              }`}>Add New Data Source</h3>

              <button
                onClick={() => setShowAddDataSourceModal(false)}
                className={`p-1 rounded-full ${
                  theme === 'dark' 
                    ? 'text-gray-400 hover:text-white hover:bg-gray-700/30' 
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                }`}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4">
              <p className={`text-sm ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
              }`}>Select a data source type to connect:</p>

              <div className="grid grid-cols-1 xs:grid-cols-2 gap-3 sm:gap-4">
                {[
                  { id: 'database', icon: Database, name: 'Database', desc: 'Connect to MongoDB, PostgreSQL, etc.' },
                  { id: 'api', icon: Globe, name: 'API', desc: 'Connect to REST or GraphQL APIs' },
                  { id: 'local-files', icon: FileText, name: 'Local Files', desc: 'Upload JSON data files with embeddings or event lists' },
                  { id: 'data-warehouse', icon: Table, name: 'Data Warehouse', desc: 'Connect to Snowflake, BigQuery, etc.' }
                ].map((source) => (
                  <button
                    key={source.id}
                    className={`flex flex-col items-center text-center p-3 sm:p-4 rounded-lg border transition-colors ${
                      theme === 'dark'
                        ? 'bg-[#1A1832] hover:bg-[#2A2850] border-gray-700/50'
                        : 'bg-gray-50 hover:bg-gray-100 border-gray-200'
                    }`}
                    onClick={() => handleSourceOptionSelect(source.id)}
                  >
                    <source.icon className={`h-6 w-6 sm:h-8 sm:w-8 mb-2 ${
                      theme === 'dark' ? 'text-[#00E0FF]' : 'text-blue-600'
                    }`} />
                    <span className={`font-medium ${
                      theme === 'dark' ? 'text-white' : 'text-gray-800'
                    }`}>{source.name}</span>
                    <span className={`text-xs mt-1 ${
                      theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                    }`}>{source.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={`border-t p-3 sm:p-4 ${
              theme === 'dark' 
                ? 'border-gray-700/50 bg-[#0D0C22]' 
                : 'border-gray-200 bg-gray-50'
            }`}>
              <p className={`text-xs text-center ${
                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
              }`}>
                Database, API, and Data Warehouse connectors are in development. JSON file upload is available now.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* File Upload Modal */}
      <FileUploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onSuccess={handleUploadSuccess}
      />
    </div>
  );
});

// Add display name to fix the ESLint warning
ChatConfig.displayName = 'ChatConfig';

export default ChatConfig;
