"use client";

import { useEffect, useContext } from 'react';
import { usePlayground } from '@/app/context/PlaygroundContext';
import { loadAvailableDatasets } from '@/app/actions/playgroundActions';
import ChatConfig from "@/app/components/playground/ChatConfig";
import DataObjectInfo from "@/app/components/playground/DataObjectInfo";
import ChatWindow from "@/app/components/playground/ChatWindow";
import PanelResizer from "@/app/components/ui/PanelResizer";
import { LayoutProvider, LayoutContext } from '@/app/context/LayoutContext';
import { ChatHistoryProvider } from '@/app/context/ChatHistoryContext';
import { useSettings } from '@/app/context/SettingsContext';
import { CheckCircle, AlertCircle } from 'lucide-react';

function PlaygroundContent() {
  const { state, dispatch } = usePlayground();
  const { selectedDataset, selectedObject, messages, errors } = state;
  const { 
    isDataExpanded, 
    isChatExpanded, 
    isObjectDetailsExpanded, 
    isMobileView, 
    isTabletView,
    chatPanelWidth,
    objectDetailsPanelWidth,
    isResizing
  } = useContext(LayoutContext);
  const { theme, isCustomEventMode } = useSettings();

  // Load available datasets on component mount
  useEffect(() => {
    async function fetchDatasets() {
      try {
        dispatch({ type: 'SET_LOADING', key: 'dataset', payload: true });
        const datasets = await loadAvailableDatasets();
        dispatch({ type: 'SET_DATASETS', payload: datasets });
      } catch (error) {
        dispatch({
          type: 'SET_ERROR',
          key: 'dataset',
          payload: 'Failed to load datasets'
        });
      } finally {
        dispatch({ type: 'SET_LOADING', key: 'dataset', payload: false });
      }
    }

    fetchDatasets();
  }, [dispatch]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Page Header - Compact for more space */}
      <div className="px-4 py-2 flex-shrink-0 border-b border-gray-800/20">
        <h1 className={`text-xl font-bold ${
          theme === 'dark' ? 'text-white' : 'text-gray-800'
        }`}>
          PLLM Playground
        </h1>
      </div>

      {/* Error and Success Alerts */}
      {Object.entries(errors).some(([key, message]) => message) && (
        <div className="px-4 py-2 flex-shrink-0">
          {Object.entries(errors).map(([key, message]) =>
            message && (
              <div
                key={key}
                className={`rounded-lg p-3 mb-2 ${
                  key === 'success'
                    ? theme === 'dark'
                      ? 'bg-blue-500/10 border border-blue-500/20' 
                      : 'bg-blue-50 border border-blue-200'
                    : theme === 'dark'
                      ? 'bg-red-500/10 border border-red-500/20'
                      : 'bg-red-50 border border-red-200'
                }`}
              >
                <p className={`flex items-center text-sm ${
                  key === 'success'
                    ? theme === 'dark' ? 'text-blue-400' : 'text-blue-600'
                    : theme === 'dark' ? 'text-red-400' : 'text-red-600'
                }`}>
                  {key === 'success' ? (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2 flex-shrink-0" />
                      {message}
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0" />
                      {message}
                    </>
                  )}
                </p>
              </div>
            )
          )}
        </div>
      )}

      {/* Main 3-Column Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel - Configuration (Small) */}
        <div className={`flex-shrink-0 border-r ${
          theme === 'dark' ? 'border-gray-800/40' : 'border-gray-200/40'
        } ${
          isMobileView 
            ? isDataExpanded ? 'w-80' : 'w-12'
            : isTabletView
              ? isDataExpanded ? 'w-72' : 'w-16' 
              : isDataExpanded ? 'w-80' : 'w-20'
        } transition-all duration-300`}>
          <div className={`h-full ${
            theme === 'dark' 
              ? 'bg-[#111125]' 
              : 'bg-white'
          }`}>
            <ChatConfig />
          </div>
        </div>

        {/* Main Content Area with Resizable Panels */}
        <div className="flex-1 flex overflow-hidden" data-main-content>
          {/* Middle Panel - Chat Interface (Resizable) */}
          <div 
            className={`flex flex-col overflow-hidden transition-all duration-200 ${
              isResizing ? 'transition-none' : ''
            }`}
            style={{ 
              width: !isCustomEventMode && isObjectDetailsExpanded && !isMobileView && !isTabletView
                ? `${chatPanelWidth}%` 
                : '100%' 
            }}
          >
            <div className={`h-full ${
              theme === 'dark' 
                ? 'bg-[#111125]' 
                : 'bg-white'
            }`}>
              <ChatWindow />
            </div>
          </div>

          {/* Panel Resizer - Only show on desktop when object details are expanded */}
          {!isCustomEventMode && isObjectDetailsExpanded && !isMobileView && !isTabletView && (
            <PanelResizer />
          )}

          {/* Right Panel - Object Details (Resizable) */}
          {!isCustomEventMode && (
            <div 
              className={`flex-shrink-0 border-l ${
                theme === 'dark' ? 'border-gray-800/40' : 'border-gray-200/40'
              } ${
                isMobileView 
                  ? isObjectDetailsExpanded ? 'w-80' : 'w-12'
                  : isTabletView
                    ? isObjectDetailsExpanded ? 'w-72' : 'w-16'
                    : isObjectDetailsExpanded 
                      ? 'transition-all duration-200' 
                      : 'w-20'
              } ${
                isObjectDetailsExpanded && !isMobileView && !isTabletView && !isResizing 
                  ? 'transition-all duration-200' 
                  : isResizing ? 'transition-none' : 'transition-all duration-300'
              }`}
              style={{ 
                width: isObjectDetailsExpanded && !isMobileView && !isTabletView
                  ? `${objectDetailsPanelWidth}%` 
                  : undefined 
              }}
            >
              <div className={`h-full ${
                theme === 'dark' 
                  ? 'bg-[#111125]' 
                  : 'bg-white'
              }`}>
                <DataObjectInfo
                  object={selectedObject}
                  datasetName={selectedDataset?.file_name}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Playground() {
  return (
    <LayoutProvider>
      <ChatHistoryProvider>
        <PlaygroundContent />
      </ChatHistoryProvider>
    </LayoutProvider>
  );
}