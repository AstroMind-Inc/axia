// app/context/PlaygroundContext.tsx
"use client";

import { createContext, useContext, useReducer, ReactNode } from 'react';
import { Message } from '@/app/types/chat';
import { Dataset, DataObject, ObjectDetails, NearestNeighbor } from '@/app/actions/playgroundActions';

interface LoadingState {
  dataset: boolean;
  objectDetails: boolean;
  chat: boolean;
  upload: boolean;
}

interface ErrorState {
  dataset: string | null;
  objectDetails: string | null;
  chat: string | null;
  upload: string | null;
  success: string | null; // Added success key to support success messages
}

interface PlaygroundState {
  // Data Management
  datasets: Dataset[];
  selectedDataset: Dataset | null;
  selectedObject: DataObject | null;
  objectDetails: ObjectDetails | null;
  nearestNeighbors: NearestNeighbor[];

  // Chat Management
  // selectedModel removed - now only in SettingsContext
  apiUrl: string | null,
  responseFormat: 'Normal' | 'Advanced';
  messages: Message[];

  // UI State
  loading: LoadingState;
  errors: ErrorState;
  isConfigPanelOpen: boolean;
}

const initialState: PlaygroundState = {
  // Data Management
  datasets: [],
  selectedDataset: null,
  selectedObject: null,
  objectDetails: null,
  nearestNeighbors: [],

  // Chat Management
  // selectedModel removed - now only in SettingsContext
  responseFormat: 'Normal',
  apiUrl: null,
  messages: [],

  // UI State
  loading: {
    dataset: false,
    objectDetails: false,
    chat: false,
    upload: false,
  },
  errors: {
    dataset: null,
    objectDetails: null,
    chat: null,
    upload: null,
    success: null, // Initialize with null
  },
  isConfigPanelOpen: true,
};

type PlaygroundAction =
  // Dataset Management
  | { type: 'SET_DATASETS'; payload: Dataset[] }
  | { type: 'SET_SELECTED_DATASET'; payload: Dataset | null }
  | { type: 'SET_SELECTED_OBJECT'; payload: DataObject | null }
  | { type: 'SET_OBJECT_DETAILS'; payload: ObjectDetails | null }
  | { type: 'SET_NEAREST_NEIGHBORS'; payload: NearestNeighbor[] }

  // Chat Management
  // SET_MODEL action removed - now only in SettingsContext
  | { type: 'SET_API_URL'; payload: string | null }
  | { type: 'SET_RESPONSE_FORMAT'; payload: 'Normal' | 'Advanced' }
  | { type: 'ADD_MESSAGE'; payload: Message }
  | { type: 'SET_MESSAGES'; payload: Message[] }
  | { type: 'CLEAR_MESSAGES' }

  // UI State Management
  | { type: 'SET_LOADING'; key: keyof LoadingState; payload: boolean }
  | { type: 'SET_ERROR'; key: keyof ErrorState; payload: string | null }
  | { type: 'TOGGLE_CONFIG_PANEL' }
  | { type: 'SET_CONFIG_PANEL'; payload: boolean }
  | { type: 'RESET_STATE' };

function playgroundReducer(state: PlaygroundState, action: PlaygroundAction): PlaygroundState {
  switch (action.type) {
    case 'SET_DATASETS':
      return {
        ...state,
        datasets: action.payload,
      };

    case 'SET_SELECTED_DATASET':
      return {
        ...state,
        selectedDataset: action.payload,
        selectedObject: null,
        objectDetails: null,
        messages: [],
        errors: {
          ...state.errors,
          objectDetails: null,
          chat: null,
          success: null, // Clear success messages when changing datasets
        },
      };

    case 'SET_SELECTED_OBJECT':
      return {
        ...state,
        selectedObject: action.payload,
        objectDetails: null,
        messages: [],
        errors: {
          ...state.errors,
          objectDetails: null,
          chat: null,
          success: null, // Clear success messages when changing objects
        },
      };

    case 'SET_OBJECT_DETAILS':
      return {
        ...state,
        objectDetails: action.payload,
      };

    case 'SET_NEAREST_NEIGHBORS':
      console.log("🔍 Debug - Context SET_NEAREST_NEIGHBORS:", {
        newCount: action.payload.length,
        previousCount: state.nearestNeighbors.length,
        firstNew: action.payload[0] ? {
          id: action.payload[0]._id,
          obsid: action.payload[0].obsid,
          source_name: action.payload[0].source_name
        } : null
      });
      return {
        ...state,
        nearestNeighbors: action.payload,
      };

    // SET_MODEL case removed - now only in SettingsContext

    case 'SET_API_URL':
      return {
        ...state,
        apiUrl: action.payload,
      };

    case 'SET_RESPONSE_FORMAT':
      return {
        ...state,
        responseFormat: action.payload,
      };

    case 'ADD_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, action.payload],
      };

    case 'SET_MESSAGES':
      return {
        ...state,
        messages: action.payload,
      };

    case 'CLEAR_MESSAGES':
      return {
        ...state,
        messages: [],
        errors: {
          ...state.errors,
          chat: null,
        },
      };

    case 'SET_LOADING':
      return {
        ...state,
        loading: {
          ...state.loading,
          [action.key]: action.payload,
        },
      };

    case 'SET_ERROR':
      return {
        ...state,
        errors: {
          ...state.errors,
          [action.key]: action.payload,
        },
      };

    case 'TOGGLE_CONFIG_PANEL':
      return {
        ...state,
        isConfigPanelOpen: !state.isConfigPanelOpen,
      };

    case 'SET_CONFIG_PANEL':
      return {
        ...state,
        isConfigPanelOpen: action.payload,
      };

    case 'RESET_STATE':
      return initialState;

    default:
      return state;
  }
}

const PlaygroundContext = createContext<{
  state: PlaygroundState;
  dispatch: React.Dispatch<PlaygroundAction>;
} | null>(null);

export function PlaygroundProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(playgroundReducer, initialState);
  return (
    <PlaygroundContext.Provider value={{ state, dispatch }}>
      {children}
    </PlaygroundContext.Provider>
  );
}

export function usePlayground() {
  const context = useContext(PlaygroundContext);
  if (!context) {
    throw new Error('usePlayground must be used within a PlaygroundProvider');
  }
  return context;
}

export function usePlaygroundLoading() {
  const { state } = usePlayground();
  return state.loading;
}

export function usePlaygroundErrors() {
  const { state } = usePlayground();
  return state.errors;
}

export function useSelectedData() {
  const { state } = usePlayground();
  return {
    dataset: state.selectedDataset,
    object: state.selectedObject,
    details: state.objectDetails,
  };
}

/**
 * Custom hook to check if the current object has valid event list data
 * @returns boolean indicating if the selected object has event list data
 */
export function useHasEventList(): boolean {
  const { state } = usePlayground();
  const dataObject = state.objectDetails || state.selectedObject;

  if (!dataObject) return false;

  return (
    'event_list' in dataObject &&
    Array.isArray(dataObject.event_list) &&
    dataObject.event_list.length > 0
  );
}

export function useChatState() {
  const { state } = usePlayground();
  return {
    // model: state.selectedModel, - removed
    responseFormat: state.responseFormat,
    messages: state.messages,
    isLoading: state.loading.chat,
    error: state.errors.chat,
  };
}