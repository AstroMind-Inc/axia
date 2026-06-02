"use client";

import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { MODEL_OPTIONS } from '@/app/constants/models'; // Import MODEL_OPTIONS

// Define type for model API URLs
type ModelApiUrls = {
  [key: string]: string;
};

// Define type for custom event list data
interface CustomEventData {
  name?: string;
  obsid?: number | string;
  event_list: number[][];
  [key: string]: any; // Allow for other properties
}

// Interface for model configuration from the database
interface ModelConfig {
  model_id: string;
  api_url: string;
  last_updated: string;
}

// Interface for all settings stored in the database
interface StoredSettings {
  feedContext?: boolean;
  selectedFields?: string[];
  responseFormat?: 'Normal' | 'Advanced';
  user_id?: string; // Could be used in the future for multi-user support
  theme?: 'dark' | 'light';
}

type SettingsContextType = {
  feedContext: boolean;
  setFeedContext: (value: boolean) => void;
  selectedFields: string[];
  setSelectedFields: (fields: string[]) => void;
  selectedDataset: string;
  setSelectedDataset: (dataset: string) => void;
  responseFormat: 'Normal' | 'Advanced';
  setResponseFormat: (format: 'Normal' | 'Advanced') => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  modelApiUrls: ModelApiUrls;
  setModelApiUrl: (model: string, url: string) => void;
  getModelApiUrl: (model: string) => string | null;
  // Model config saving states
  isSavingModelConfig: boolean;
  saveModelConfigStatus: 'idle' | 'success' | 'error';
  saveModelConfigMessage: string;
  // General settings saving states and function
  isSavingSettings: boolean;
  saveSettingsStatus: 'idle' | 'success' | 'error';
  saveSettingsMessage: string;
  saveAllSettings: () => Promise<void>;
  settingsModified: boolean;
  // Custom event mode states
  isCustomEventMode: boolean;
  setIsCustomEventMode: (isCustomMode: boolean) => void;
  customEventListData: CustomEventData | null;
  setCustomEventListData: (data: CustomEventData | null) => void;

  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [feedContext, setFeedContext] = useState<boolean>(false);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>('train');
  const [responseFormat, setResponseFormat] = useState<'Normal' | 'Advanced'>('Normal');
  const [selectedModel, setSelectedModel] = useState<string>('astromind-multi-agent');
  const [modelApiUrls, setModelApiUrls] = useState<ModelApiUrls>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [theme, setTheme] = useState<'dark' | 'light'>('light');

  // Custom event mode states
  const [isCustomEventMode, setIsCustomEventMode] = useState<boolean>(false);
  const [customEventListData, setCustomEventListData] = useState<CustomEventData | null>(null);

  // Add a flag to track if user has explicitly selected a model
  const [userSelectedModel, setUserSelectedModel] = useState<boolean>(false);

  // States for saving model config to MongoDB
  const [isSavingModelConfig, setIsSavingModelConfig] = useState<boolean>(false);
  const [saveModelConfigStatus, setSaveModelConfigStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saveModelConfigMessage, setSaveModelConfigMessage] = useState<string>('');

  // States for saving all settings to MongoDB
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);
  const [saveSettingsStatus, setSaveSettingsStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [saveSettingsMessage, setSaveSettingsMessage] = useState<string>('');

  // Track if settings have been modified since last save
  const [settingsModified, setSettingsModified] = useState<boolean>(false);
  const [originalSettings, setOriginalSettings] = useState<StoredSettings>({
    feedContext: false,
    selectedFields: [],
    responseFormat: 'Normal',
    theme: 'light'
  });

  // Reset custom event data when toggling modes
  useEffect(() => {
    if (!isCustomEventMode) {
      // Clear custom event data when exiting custom mode
      setCustomEventListData(null);
    }
  }, [isCustomEventMode]);

  // Custom setSelectedModel that also tracks user selection
  const setSelectedModelWithTracking = (model: string) => {
    setSelectedModel(model);
    setUserSelectedModel(true); // Mark that user has explicitly selected a model

    // Save to sessionStorage immediately to ensure persistence
    try {
      const storedSettings = sessionStorage.getItem('astromind_settings');
      if (storedSettings) {
        const settings = JSON.parse(storedSettings);
        settings.selectedModel = model;
        sessionStorage.setItem('astromind_settings', JSON.stringify(settings));
      } else {
        sessionStorage.setItem('astromind_settings', JSON.stringify({
          selectedModel: model
        }));
      }
    } catch (error) {
      console.error("Error saving model selection to session storage:", error);
    }

    console.log(`User selected model: ${model}`);
  };

  // Check for first-time app load
  useEffect(() => {
    // Check if this is the first time the app has loaded
    const isAppFirstLoad = !sessionStorage.getItem('app_initialized');

    if (isAppFirstLoad) {
      // First time loading app, set default model to astromind-multi-agent
      const astromindModel = MODEL_OPTIONS.find(model => model.value === 'astromind-multi-agent');
      if (astromindModel) {
        setSelectedModel('astromind-multi-agent');
        console.log('First app load: Setting Astromind Multi-Agent as default model');
      }

      // Mark app as initialized
      sessionStorage.setItem('app_initialized', 'true');
    }
  }, []);

  // Function to update API URL for a specific model (with MongoDB persistence)
  const setModelApiUrl = async (model: string, url: string) => {
    // First update the local state for immediate UI feedback
    setModelApiUrls(prev => ({
      ...prev,
      [model]: url
    }));

    // Then save to MongoDB
    try {
      setIsSavingModelConfig(true);
      setSaveModelConfigStatus('idle');
      setSaveModelConfigMessage('');

      const response = await fetch('/api/model-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          modelId: model,
          apiUrl: url,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setSaveModelConfigStatus('success');
        setSaveModelConfigMessage('Model configuration saved successfully');
      } else {
        setSaveModelConfigStatus('error');
        setSaveModelConfigMessage(result.message || 'Failed to save model configuration');
        console.error('Error saving model config:', result.message);
      }
    } catch (error) {
      setSaveModelConfigStatus('error');
      setSaveModelConfigMessage('An error occurred while saving configuration');
      console.error('Error saving model config:', error);
    } finally {
      setIsSavingModelConfig(false);

      // Reset success status after 3 seconds
      if (saveModelConfigStatus === 'success') {
        setTimeout(() => {
          setSaveModelConfigStatus('idle');
          setSaveModelConfigMessage('');
        }, 3000);
      }
    }
  };

  // Function to save all settings to MongoDB
  const saveAllSettings = async () => {
    try {
      setIsSavingSettings(true);
      setSaveSettingsStatus('idle');
      setSaveSettingsMessage('');

      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          feedContext,
          selectedFields,
          responseFormat,
          theme,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setSaveSettingsStatus('success');
        setSaveSettingsMessage('Settings saved successfully');

        // Update original settings to reflect current state
        setOriginalSettings({
          feedContext,
          selectedFields,
          responseFormat,
          theme
        });

        // Reset modified flag
        setSettingsModified(false);
      } else {
        setSaveSettingsStatus('error');
        setSaveSettingsMessage(result.message || 'Failed to save settings');
        console.error('Error saving settings:', result.message);
      }
    } catch (error) {
      setSaveSettingsStatus('error');
      setSaveSettingsMessage('An error occurred while saving settings');
      console.error('Error saving settings:', error);
    } finally {
      setIsSavingSettings(false);

      // Reset success status after 3 seconds
      if (saveSettingsStatus === 'success') {
        setTimeout(() => {
          setSaveSettingsStatus('idle');
          setSaveSettingsMessage('');
        }, 3000);
      }
    }
  };

  // Function to get API URL for a specific model
  const getModelApiUrl = (model: string): string | null => {
    return modelApiUrls[model] || null;
  };

  // Load all settings and model configurations from MongoDB on mount
  useEffect(() => {
    const fetchAllData = async () => {
      try {
        setIsLoading(true);

        // Fetch model configurations
        const modelConfigResponse = await fetch('/api/model-config');
        if (modelConfigResponse.ok) {
          const data = await modelConfigResponse.json();

          if (data.success && data.modelConfigs && Array.isArray(data.modelConfigs)) {
            // Convert array of model configs to the ModelApiUrls format
            const newModelApiUrls: ModelApiUrls = {};

            data.modelConfigs.forEach((config: ModelConfig) => {
              newModelApiUrls[config.model_id] = config.api_url;
            });

            setModelApiUrls(newModelApiUrls);
            console.log('Loaded model configurations from MongoDB:', newModelApiUrls);
          }
        } else {
          console.error('Failed to fetch model configurations');
        }

        // Fetch other settings
        const settingsResponse = await fetch('/api/settings');
        if (settingsResponse.ok) {
          const data = await settingsResponse.json();

          if (data.success && data.settings) {
            // Apply settings from database
            if (data.settings.feedContext !== undefined) {
              setFeedContext(data.settings.feedContext);
            }

            if (data.settings.selectedFields && Array.isArray(data.settings.selectedFields)) {
              setSelectedFields(data.settings.selectedFields);
            }

            if (data.settings.responseFormat) {
              // Back-compat: map legacy 'Enhanced' to 'Advanced'
              const rf = data.settings.responseFormat === 'Enhanced' ? 'Advanced' : data.settings.responseFormat;
              setResponseFormat(rf);
            }

            if (data.settings.theme) {
              setTheme(data.settings.theme);
            }

            // Store original settings to detect changes
            setOriginalSettings({
              feedContext: data.settings.feedContext !== undefined ? data.settings.feedContext : false,
              selectedFields: data.settings.selectedFields && Array.isArray(data.settings.selectedFields)
                ? [...data.settings.selectedFields]
                : [],
              responseFormat: (data.settings.responseFormat === 'Enhanced' ? 'Advanced' : data.settings.responseFormat) || 'Normal',
              theme: data.settings.theme || 'light'
            });

            console.log('Loaded settings from MongoDB:', data.settings);
          }
        } else {
          console.error('Failed to fetch settings');
        }
      } catch (error) {
        console.error('Error fetching data from MongoDB:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllData();
  }, []);

  // Monitor settings changes to update the modified flag
  useEffect(() => {
    if (!isLoading) {
      const isModified =
        feedContext !== originalSettings.feedContext ||
        responseFormat !== originalSettings.responseFormat ||
        JSON.stringify(selectedFields.sort()) !== JSON.stringify((originalSettings.selectedFields || []).sort()) ||
        theme !== originalSettings.theme;

      setSettingsModified(isModified);
    }
  }, [feedContext, selectedFields, responseFormat, theme, originalSettings, isLoading]);

  // Override setters to track modifications
  const setFeedContextWithTracking = (value: boolean) => {
    setFeedContext(value);
  };

  const setSelectedFieldsWithTracking = (fields: string[]) => {
    setSelectedFields(fields);
  };

  const setResponseFormatWithTracking = (format: 'Normal' | 'Advanced') => {
    setResponseFormat(format);
  };

  const setThemeWithTracking = (theme: 'dark' | 'light') => {
    setTheme(theme);
  };

  // Wrapper for setting custom event mode with side effects
  const setIsCustomEventModeWithEffects = (isCustomMode: boolean) => {
    setIsCustomEventMode(isCustomMode);

    // Also store in session storage
    try {
      const storedSettings = sessionStorage.getItem('astromind_settings');
      if (storedSettings) {
        const settings = JSON.parse(storedSettings);
        settings.isCustomEventMode = isCustomMode;
        sessionStorage.setItem('astromind_settings', JSON.stringify(settings));
      }
    } catch (error) {
      console.error("Error saving custom event mode to session storage:", error);
    }
  };

  // Load settings from session storage on mount (fallback mechanism)
  useEffect(() => {
    if (!isLoading) {
      const storedSettings = sessionStorage.getItem('astromind_settings');
      if (storedSettings) {
        try {
          const settings = JSON.parse(storedSettings);

          // Only apply session storage settings if we don't have MongoDB data
          if (originalSettings.feedContext === undefined) {
            setFeedContext(settings.feedContext ?? false);
          }

          if (!originalSettings.selectedFields || originalSettings.selectedFields.length === 0) {
            setSelectedFields(settings.selectedFields ?? []);
          }

          if (!originalSettings.responseFormat) {
            setResponseFormat(settings.responseFormat ?? 'Normal');
          }

          if (!originalSettings.theme) {
            setTheme(settings.theme ?? 'light');
          }

          setSelectedDataset(settings.selectedDataset ?? 'default_dataset');

          // Load custom event mode settings
          if (settings.isCustomEventMode !== undefined) {
            setIsCustomEventMode(settings.isCustomEventMode);
          }

          if (settings.customEventListData) {
            setCustomEventListData(settings.customEventListData);
          }

          // MODIFIED: Respect user's model selection if it exists in session storage
          if (settings.selectedModel) {
            setSelectedModel(settings.selectedModel);
            console.log(`Restored user's model selection from session storage: ${settings.selectedModel}`);

            // If user had previously selected a model, mark it as user-selected
            if (settings.selectedModel !== 'astromind-multi-agent') {
              setUserSelectedModel(true);
            }
          } else if (!userSelectedModel) {
            // Default to astromind-multi-agent only if no user selection
            const astromindModel = MODEL_OPTIONS.find(model => model.value === 'astromind-multi-agent');
            if (astromindModel) {
              setSelectedModel('astromind-multi-agent');
              console.log('No model in session storage, defaulting to Astromind Multi-Agent');
            }
          }

          // Only use session storage model URLs for models that don't have MongoDB configs
          if (settings.modelApiUrls) {
            setModelApiUrls(prev => {
              const mergedUrls = { ...prev };

              // For each model in session storage, only use it if we don't have a MongoDB value
              Object.keys(settings.modelApiUrls).forEach(modelId => {
                if (!mergedUrls[modelId]) {
                  mergedUrls[modelId] = settings.modelApiUrls[modelId];
                }
              });

              return mergedUrls;
            });
          }
        } catch (error) {
          console.error("Error parsing stored settings:", error);
          // Continue with default settings if parsing fails
        }
      } else if (!userSelectedModel) {
        // Only set default if user hasn't made a selection and no session storage exists
        const astromindModel = MODEL_OPTIONS.find(model => model.value === 'astromind-multi-agent');
        if (astromindModel) {
          setSelectedModel('astromind-multi-agent');
          console.log('No session storage found, defaulting to Astromind Multi-Agent');
        }
      }
    }
  }, [isLoading, originalSettings, userSelectedModel]);

  // Save settings to session storage whenever they change
  useEffect(() => {
    try {
      const settings = {
        feedContext,
        selectedDataset,
        selectedFields,
        responseFormat,
        selectedModel,
        modelApiUrls,
        theme,
        isCustomEventMode,
        customEventListData
      };
      sessionStorage.setItem('astromind_settings', JSON.stringify(settings));
    } catch (error) {
      console.error("Error saving settings to session storage:", error);
    }
  }, [
    feedContext,
    selectedDataset,
    selectedFields,
    responseFormat,
    selectedModel,
    modelApiUrls,
    theme,
    isCustomEventMode,
    customEventListData
  ]);

  // For debugging
  useEffect(() => {
    console.log("SettingsContext state updated:");
    console.log("- feedContext:", feedContext);
    console.log("- selectedDataset:", selectedDataset);
    console.log("- selectedFields:", selectedFields);
    console.log("- responseFormat:", responseFormat);
    console.log("- selectedModel:", selectedModel);
    console.log("- userSelectedModel:", userSelectedModel);
    console.log("- modelApiUrls:", modelApiUrls);
    console.log("- theme:", theme);
    console.log("- settingsModified:", settingsModified);
    console.log("- isCustomEventMode:", isCustomEventMode);
    console.log("- customEventListData:", customEventListData ? "Present" : "None");
  }, [
    feedContext,
    selectedDataset,
    selectedFields,
    responseFormat,
    selectedModel,
    userSelectedModel,
    modelApiUrls,
    theme,
    settingsModified,
    isCustomEventMode,
    customEventListData
  ]);

  const value = {
    feedContext,
    setFeedContext: setFeedContextWithTracking,
    selectedFields,
    setSelectedFields: setSelectedFieldsWithTracking,
    selectedDataset,
    setSelectedDataset,
    responseFormat,
    setResponseFormat: setResponseFormatWithTracking,
    selectedModel,
    setSelectedModel: setSelectedModelWithTracking, // Use the tracking version
    modelApiUrls,
    setModelApiUrl,
    getModelApiUrl,
    isSavingModelConfig,
    saveModelConfigStatus,
    saveModelConfigMessage,
    isSavingSettings,
    saveSettingsStatus,
    saveSettingsMessage,
    saveAllSettings,
    settingsModified,
    theme,
    setTheme: setThemeWithTracking,
    // Custom event mode states
    isCustomEventMode,
    setIsCustomEventMode: setIsCustomEventModeWithEffects,
    customEventListData,
    setCustomEventListData
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}