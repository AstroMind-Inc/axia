"use client";

import { useState, useRef, useEffect, useContext, useMemo } from "react";
import {
  Send,
  RefreshCw,
  User,
  AlertCircle,
  AlertTriangle,
  Star,
  ChevronDown,
  ChevronUp,
  Settings,
  Sparkles,
  Info,
  Users,
  ShieldCheck,
  Loader2,
  Atom,
  Minimize2,
  Maximize2,
  PaintBucket,
  Check,
  X
} from "lucide-react";
import { usePlayground } from "@/app/context/PlaygroundContext";
import { useSettings } from "@/app/context/SettingsContext";
import { LayoutContext } from '@/app/context/LayoutContext';// Import layout context
import { useChatHistory } from '@/app/context/ChatHistoryContext';
import {
  sendChatMessage,
  createMessage,
  modelRequiresEventList
} from "@/app/actions/playgroundActions";
import useStreamingChat from "@/app/hooks/useStreamingChat";
import AgentProgressIndicator from "@/app/components/ui/AgentProgressIndicator";
import { ChatThreadSelector } from "@/app/components/chat-history/ChatThreadSelector";
import { FeedbackButton } from "@/app/components/feedback/FeedbackButton";
import { Modal } from "@/app/components/ui/modal";
import AgentSettings, { AgentConfig, DEFAULT_AGENT_CONFIG } from "@/app/components/playground/AgentSettings";
import { marked } from "marked";
import { Message, Metadata, MatchingContent } from "@/app/types/chat";
import { ChatMessage as HistoryChatMessage } from "@/app/types/chat-history";
import { MODEL_OPTIONS } from "@/app/constants/models";

// Animation styles remain the same
const animationStyles = {
  "@keyframes rotate": {
    "0%": { transform: "rotate(0deg)" },
    "100%": { transform: "rotate(360deg)" },
  },
  "@keyframes pulse": {
    "0%": { opacity: 0.6, transform: "scale(1)" },
    "50%": { opacity: 1, transform: "scale(1.05)" },
    "100%": { opacity: 0.6, transform: "scale(1)" },
  },
  "@keyframes orbitRotate": {
    "0%": { transform: "rotate(0deg) translateX(0) rotate(0deg)" },
    "100%": { transform: "rotate(360deg) translateX(0) rotate(-360deg)" },
  },
  "@keyframes atomPulse": {
    "0%": { transform: "scale(1) rotate(0deg)" },
    "50%": { transform: "scale(1.1) rotate(180deg)" },
    "100%": { transform: "scale(1) rotate(360deg)" },
  },
  "@keyframes electronOrbit": {
    "0%": { transform: "rotate(0deg)" },
    "100%": { transform: "rotate(360deg)" },
  },
  "@keyframes selfRotate": {
    "0%": { transform: "rotate(0deg)" },
    "100%": { transform: "rotate(360deg)" },
  },
  "@keyframes slideDown": {
    from: { opacity: 0, transform: "translateY(-10px)" },
    to: { opacity: 1, transform: "translateY(0)" },
  },
  "@keyframes fadeIn": {
    from: { opacity: 0 },
    to: { opacity: 1 },
  },
  "@keyframes sparkleBreath": {
    "0%": { transform: "scale(1) rotate(0deg)" },
    "50%": { transform: "scale(1.2) rotate(180deg)" },
    "100%": { transform: "scale(1) rotate(360deg)" },
  },
  "@keyframes glowing": {
    "0%": { opacity: 0.2 },
    "50%": { opacity: 0.5 },
    "100%": { opacity: 0.2 },
  },
  "@keyframes float": {
    "0%": { transform: "translateY(0)" },
    "50%": { transform: "translateY(-10px)" },
    "100%": { transform: "translateY(0)" },
  },
  "@keyframes twinkle": {
    "0%": { opacity: 0.6, transform: "scale(1)" },
    "50%": { opacity: 1, transform: "scale(1.05)" },
    "100%": { opacity: 0.6, transform: "scale(1)" },
  },
};

export default function ChatWindow() {
  const { state, dispatch } = usePlayground();
  const {
    feedContext,
    selectedFields,
    selectedDataset,
    responseFormat,
    modelApiUrls,
    getModelApiUrl,
    selectedModel,
    setSelectedModel,
    theme, // Get theme from settings
    isCustomEventMode,
    customEventListData
  } = useSettings();
  const {
    messages,
    selectedObject,
    objectDetails,
    errors,
    loading,
  } = state;
  const { isChatExpanded, toggleChat } = useContext(LayoutContext); // Use layout context
  
  // Chat history functionality  
  const {
    currentThread,
    isThreadSelectorExpanded,
    clearCurrentThread
  } = useChatHistory();



  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [typingText, setTypingText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [currentResponse, setCurrentResponse] = useState("");
  const [isSavingToHistory, setIsSavingToHistory] = useState(false);
  const [isMobileView, setIsMobileView] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isRestoringFromThread, setIsRestoringFromThread] = useState(false);
  const [isInActiveConversation, setIsInActiveConversation] = useState(false);
  const [lastSaveTime, setLastSaveTime] = useState<number | null>(null);
  const [recentlyCompletedRestoration, setRecentlyCompletedRestoration] = useState(false);
  const restorationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const restorationGracePeriodRef = useRef<NodeJS.Timeout | null>(null);

  // Streaming chat hook
  const {
    isStreaming,
    streamingUpdates,
    currentAgent,
    error: streamingError,
    sendStreamingMessage,
    clearStreamingState,
    getAgentProgress
  } = useStreamingChat();
  const [showControlPanel, setShowControlPanel] = useState(false);
  const [showMessage, setShowMessage] = useState(true);
  const [modelInitialized, setModelInitialized] = useState(false);
  const [expandedEnhanced, setExpandedEnhanced] = useState<
    Record<number, boolean>
  >({});
  const [expandedMetadata, setExpandedMetadata] = useState<
    Record<number, boolean>
  >({});
  const [expandedAgentConversation, setExpandedAgentConversation] = useState<
    Record<number, boolean>
  >({});
  const [expandedExchanges, setExpandedExchanges] = useState<
    Record<string, boolean>
  >({});
  const [openaiModel, setOpenaiModel] = useState<string>("gpt-5");
  const [showOpenaiModelMenu, setShowOpenaiModelMenu] = useState<boolean>(false);
  const [agentConfig, setAgentConfig] = useState<AgentConfig>(DEFAULT_AGENT_CONFIG);
  const openaiMenuRef = useRef<HTMLDivElement | null>(null);
  const openaiModelRef = useRef<string>(openaiModel);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (openaiMenuRef.current && !openaiMenuRef.current.contains(event.target as Node)) {
        setShowOpenaiModelMenu(false);
      }
    }
    if (showOpenaiModelMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showOpenaiModelMenu]);

  // Keep a ref in sync with the latest OpenAI model and persist to session
  useEffect(() => {
    openaiModelRef.current = openaiModel;
    try {
      sessionStorage.setItem('astromind_openai_model', openaiModel);
    } catch {}
  }, [openaiModel]);

  // Initialize OpenAI model from session if available
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('astromind_openai_model');
      if (saved) setOpenaiModel(saved);
    } catch {}
  }, []);

  // Validation state
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<string>("");
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [apiUrlsLoaded, setApiUrlsLoaded] = useState(false);

  // Color theme state (from outdated branch)
  const [colorTheme, setColorTheme] = useState<'default' | 'blue' | 'green' | 'purple' | 'red' | 'orange' | 'teal' | 'pink'>('default');
  const [showThemeDropdown, setShowThemeDropdown] = useState(false);

  // Track if object details are loaded for enabling chat
  const hasObjectDetails = !!objectDetails;

  // Check if embedding data is valid
  const dataObjectToUse = objectDetails || selectedObject;
  const hasEmbedding =
    dataObjectToUse &&
    "embedding" in dataObjectToUse &&
    dataObjectToUse.embedding !== undefined &&
    Array.isArray(dataObjectToUse.embedding) &&
    dataObjectToUse.embedding.length > 0;

  // Only check if all values are zero if we have an embedding array
  const isValidEmbedding =
    hasEmbedding && !dataObjectToUse.embedding!.every((val) => val === 0);

  // Filter available models based on API configuration - memoized to prevent excessive re-computation
  const availableModels = useMemo(() => {
    return MODEL_OPTIONS.filter((model) => {
      // Include models that don't require API
      if (!model.api_required) {
        return true;
      }

      // For API-required models, check if URL is configured
      const hasApiUrl = !!modelApiUrls[model.value];
      
      // Include models that require API but have a valid API URL configured
      return model.api_required && hasApiUrl;
    });
  }, [modelApiUrls]);

  // Get the API URL for the currently selected model
  const currentModelApiUrl = getModelApiUrl(selectedModel);

  // Verify if the selected model is available (has API URL if required)
  const isSelectedModelAvailable = availableModels.some(
    (model) => model.value === selectedModel
  );

  // Check if the object has event list data
  const hasEventList =
    dataObjectToUse &&
    'event_list' in dataObjectToUse &&
    Array.isArray(dataObjectToUse.event_list) &&
    dataObjectToUse.event_list.length > 0;

  // Check if current model requires event list data
  const requiresEventList = modelRequiresEventList(selectedModel);

  const handleResetChat = () => {
    dispatch({ type: "CLEAR_MESSAGES" });
    setInput("");
    setTypingText("");
    setIsTyping(false);
    setExpandedEnhanced({});
    setExpandedMetadata({});
    setExpandedAgentConversation({});
    setExpandedExchanges({});
  };

  useEffect(() => {
    // Check if astromind-openai has its API URL loaded
    if (modelApiUrls['astromind-openai']) {
      setApiUrlsLoaded(true);
      console.log("API URLs loaded, astromind-openai API URL is available:", modelApiUrls['astromind-openai']);
    }
  }, [modelApiUrls]);

  // Check for mobile view
  useEffect(() => {
    const checkMobileView = () => {
      setIsMobileView(window.innerWidth < 768);
    };

    // Check initially
    checkMobileView();

    // Set up resize listener
    window.addEventListener("resize", checkMobileView);

    // Clean up
    return () => {
      window.removeEventListener("resize", checkMobileView);
    };
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingText, showMessage]);

  // Clear chat input when object selection changes (debounced to prevent excessive clears during restoration)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isLoadingHistory) {
        setInput("");
      }
    }, 50);
    
    return () => clearTimeout(timer);
  }, [selectedObject?._id, selectedDataset, isLoadingHistory]);

  useEffect(() => {
    // Only clear thread for genuine user-initiated changes, not during any system processes
    // Also don't clear if user has an active thread with messages (continuing conversation)
    const hasActiveThread = currentThread && currentThread._id && messages.length > 0;
    
    if (!isLoadingHistory && !isRestoringFromThread && !isInActiveConversation && !isSavingToHistory && !hasActiveThread && !recentlyCompletedRestoration) {
      // Clear any ongoing streaming progress when user changes object/dataset
      clearStreamingState();
      handleResetChat();
      
      // Clear current thread when object/dataset changes so a new thread will be created
      // This handles user-initiated changes (manual object selection)
      console.log('🔄 User-initiated object/dataset change - clearing current thread');
      clearCurrentThread();
    } else {
      // Log which protection is active
      const protections = [];
      if (isLoadingHistory) protections.push('loading history');
      if (isRestoringFromThread) protections.push('restoring from thread');
      if (isInActiveConversation) protections.push('active conversation');
      if (isSavingToHistory) protections.push('saving to history');
      if (hasActiveThread) protections.push('active thread with messages');
      if (recentlyCompletedRestoration) protections.push('recent restoration');
      
      console.log(`🔒 Object change during ${protections.join(', ')} - preserving thread`);
    }
  }, [selectedModel, selectedObject?._id, selectedDataset, currentThread, messages.length, clearStreamingState, recentlyCompletedRestoration]);

  // Track currentThread changes for debugging
  useEffect(() => {
    console.log('🧵 THREAD STATE CHANGED:', {
      hasCurrentThread: !!currentThread,
      threadId: currentThread?._id
    });
  }, [currentThread]);

  // Listen for object restoration events from chat history
  useEffect(() => {
    const handleRestoreSelectedObject = async (event: Event) => {
      const customEvent = event as CustomEvent;
      console.log('🎯 Received restore-selected-object event:', customEvent.detail);
      const { selectedObject: threadObject, isSystemChange } = customEvent.detail;
      
      if (threadObject && threadObject.data_obj_id && threadObject.dataset_name && isSystemChange) {
        try {
          console.log('🔄 Starting thread restoration for object:', threadObject);
          
          // Clear any existing restoration timeout
          if (restorationTimeoutRef.current) {
            clearTimeout(restorationTimeoutRef.current);
          }
          
          // Set restoration state to prevent thread clearing during all restoration operations
          setIsRestoringFromThread(true);
          setIsLoadingHistory(true);
          
          // Update dataset if different
          if (selectedDataset !== threadObject.dataset_name) {
            dispatch({ type: 'SET_SELECTED_DATASET', payload: threadObject.dataset_name });
          }
          
          // Fetch the full object details
          const objectResponse = await fetch('/api/object-details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              collection_name: threadObject.dataset_name,
              object_id: threadObject.data_obj_id
            })
          });
          
          if (objectResponse.ok) {
            const objectData = await objectResponse.json();
            console.log('✅ Object restored successfully:', objectData);
            dispatch({ type: 'SET_SELECTED_OBJECT', payload: objectData });
          } else {
            console.error('Failed to restore object:', objectResponse.status);
          }
        } catch (error) {
          console.error('Error restoring selected object:', error);
          // Clear restoration state on error
          setIsRestoringFromThread(false);
          setRecentlyCompletedRestoration(false);
          if (restorationTimeoutRef.current) {
            clearTimeout(restorationTimeoutRef.current);
          }
          if (restorationGracePeriodRef.current) {
            clearTimeout(restorationGracePeriodRef.current);
          }
        } finally {
          // Reset loading history flag immediately
          setIsLoadingHistory(false);
          // Keep restoration flag active longer to handle cascading DataObjectInfo updates
          console.log('📝 Object restoration API complete, keeping restoration state active for cascading updates');
          
          // Fallback: Clear restoration state after 5 seconds as safety net
          restorationTimeoutRef.current = setTimeout(() => {
            setIsRestoringFromThread(false);
            setRecentlyCompletedRestoration(false);
            console.log('🔓 Restoration state cleared by timeout (safety net)');
          }, 5000);
        }
      }
    };

    window.addEventListener('restore-selected-object', handleRestoreSelectedObject);
    
    return () => {
      window.removeEventListener('restore-selected-object', handleRestoreSelectedObject);
      // Clean up any pending restoration timeouts
      if (restorationTimeoutRef.current) {
        clearTimeout(restorationTimeoutRef.current);
      }
      if (restorationGracePeriodRef.current) {
        clearTimeout(restorationGracePeriodRef.current);
      }
    };
  }, [dispatch, selectedDataset]);

  // Text typing animation effect
  useEffect(() => {
    if (isTyping && currentResponse) {
      const timeout = setTimeout(() => {
        if (typingText.length < currentResponse.length) {
          setTypingText(currentResponse.substring(0, typingText.length + 1));
        } else {
          setIsTyping(false);
        }
      }, 3); // Much faster typing speed

      return () => clearTimeout(timeout);
    }
  }, [typingText, isTyping, currentResponse]);

  useEffect(() => {
    if (availableModels.length > 0 && apiUrlsLoaded && !modelInitialized) {
      console.log("Running model initialization in ChatWindow (with API URLs loaded)");
      console.log("Current selected model:", selectedModel);

      // Update logged info to show both models and their API URLs
      console.log("Available models:", availableModels.map(m => m.value));
      console.log("Model API URLs:", modelApiUrls);

      // Check if the currently selected model is available
      const isCurrentModelAvailable = availableModels.some(
        model => model.value === selectedModel
      );

      if (!isCurrentModelAvailable) {
        console.log("Current model not available in availableModels list");

        // First try to use astromind-multi-agent as the default
        const astromindModel = availableModels.find(model => model.value === 'astromind-multi-agent');

        if (astromindModel) {
          // Default to astromind-multi-agent if it's available and current model isn't
          console.log("Defaulting to Astromind Multi-Agent as fallback");
          setSelectedModel('astromind-multi-agent');
        } else {
          // Fall back to first available model if astromind-multi-agent isn't available
          console.log("Astromind Multi-Agent not available, falling back to first model:", availableModels[0].value);
          setSelectedModel(availableModels[0].value);
        }
      } else {
        console.log("Current model is available, keeping selection:", selectedModel);
      }

      setModelInitialized(true);
    }
  }, [availableModels, selectedModel, modelApiUrls, apiUrlsLoaded, modelInitialized, setSelectedModel]);

  // Clear messages when thread is cleared (user changes objects manually)
  useEffect(() => {
    // Don't clear messages if they were just saved (within last 20 seconds)
    // Extended from 5s to 20s to account for slow MongoDB saves in WSL2 (can take 7-14s)
    const recentlySaved = lastSaveTime && (Date.now() - lastSaveTime < 20000);
    
    if (!currentThread && messages.length > 0 && !isLoadingHistory && !isRestoringFromThread && !isInActiveConversation && !isSavingToHistory && !recentlySaved) {
      console.log('🧹 Thread cleared - removing old messages');
      dispatch({ type: 'SET_MESSAGES', payload: [] });
    } else if (!currentThread && messages.length > 0) {
      // Log why messages are being preserved
      const protections = [];
      if (isLoadingHistory) protections.push('loading history');
      if (isRestoringFromThread) protections.push('restoring from thread');
      if (isInActiveConversation) protections.push('active conversation');
      if (isSavingToHistory) protections.push('saving to history');
      if (recentlySaved) protections.push('recently saved');
      
      console.log(`🔒 Messages preserved during ${protections.join(', ')} - not clearing`);
    }
  }, [currentThread, messages.length, dispatch, lastSaveTime]);

  // Clear restoration state when thread changes or is cleared
  useEffect(() => {
    if (!currentThread && isRestoringFromThread) {
      console.log('🔓 Thread cleared - ending restoration state');
      if (restorationTimeoutRef.current) {
        clearTimeout(restorationTimeoutRef.current);
      }
      if (restorationGracePeriodRef.current) {
        clearTimeout(restorationGracePeriodRef.current);
      }
      setIsRestoringFromThread(false);
      setRecentlyCompletedRestoration(false);
    } else if (currentThread && isRestoringFromThread && messages.length > 0) {
      // If we have a thread with messages and restoration is active, 
      // and messages are loaded, restoration is complete
      console.log('🔓 Thread messages loaded - ending restoration state');
      if (restorationTimeoutRef.current) {
        clearTimeout(restorationTimeoutRef.current);
      }
      setIsRestoringFromThread(false);
      
      // Set grace period to prevent immediate thread clearing
      setRecentlyCompletedRestoration(true);
      console.log('🛡️ Starting restoration grace period to prevent thread clearing');
      
      // Clear grace period after 1 second
      if (restorationGracePeriodRef.current) {
        clearTimeout(restorationGracePeriodRef.current);
      }
      restorationGracePeriodRef.current = setTimeout(() => {
        setRecentlyCompletedRestoration(false);
        console.log('🔓 Restoration grace period ended');
      }, 1000);
    }
  }, [currentThread, isRestoringFromThread, messages.length]);

  // Load messages from chat history when a thread is selected
  useEffect(() => {
    if (currentThread && currentThread.messages && currentThread.messages.length > 0 && !isLoadingHistory) {
      // Ensure we only load history when the currently selected object matches the thread's object
      const threadSelectedObject = currentThread.metadata?.selected_object;
      const threadObjId = threadSelectedObject?.data_obj_id;
      const threadDataset = threadSelectedObject?.dataset_name;
      
      // For uploaded files, we need more flexible matching logic
      const isUploadedFile = threadObjId && threadObjId.startsWith('UPD_');
      
      let selectionMatchesThread = false;
      if (!threadObjId || !threadDataset) {
        selectionMatchesThread = true;
      } else if (isUploadedFile) {
        // For uploaded files, match by custom ID (which could be in _id or other fields)
        const selectedObsid = selectedObject?.obsid ? String(selectedObject.obsid) : '';
        const threadObsid = threadSelectedObject?.obsid ? String(threadSelectedObject.obsid) : '';
        
        selectionMatchesThread = Boolean(
          selectedObject?._id === threadObjId || 
          selectedObject?.source_name === threadObjId ||
          (selectedObsid && threadObsid && selectedObsid === threadObsid)
        );
      } else {
        // For regular dataset objects, match by ObjectId and dataset
        selectionMatchesThread = selectedObject?._id === threadObjId && selectedDataset === threadDataset;
      }

      if (!selectionMatchesThread) {
        console.log('🚫 Skipping history load - thread object does not match current selection', {
          threadObjId,
          threadDataset,
          selectedObjectId: selectedObject?._id,
          selectedDataset,
          isUploadedFile
        });
        return;
      }

      // Load history if:
      // 1. Message count changed, OR
      // 2. Any message is still processing (to show progressive updates)
      const timeSinceLastSave = lastSaveTime ? Date.now() - lastSaveTime : Infinity;
      const recentlySaved = timeSinceLastSave < 3000; // 3 seconds
      
      const hasProcessingMessages = currentThread.messages.some((msg: any) => 
        msg.message_type === 'assistant' && msg.assistant_response?.is_processing === true
      );
      
      const messageCountChanged = currentThread.messages.length !== messages.length;
      const shouldLoadForProgress = hasProcessingMessages && !recentlySaved;
      
      const shouldLoadHistory = (messageCountChanged || shouldLoadForProgress) && 
        !isLoading && !isStreaming && !isSavingToHistory && !isInActiveConversation && !recentlySaved;
      
      if (shouldLoadHistory) {
        const reason = messageCountChanged ? 'message count changed' : 
                      hasProcessingMessages ? 'processing messages updated' : 'unknown';
        console.log(`📚 Loading chat history (${reason}):`, currentThread._id, 
          `(${currentThread.messages.length} history vs ${messages.length} displayed, processing: ${hasProcessingMessages})`);
        setIsLoadingHistory(true);
        
        // Convert chat history messages to playground messages format
        const historyMessages: Message[] = [];
        
        for (const historyMessage of currentThread.messages) {
          if (historyMessage.message_type === 'user' && historyMessage.user_input) {
            historyMessages.push({
              role: 'user',
              content: historyMessage.user_input.text,
              timestamp: new Date(historyMessage.timestamp).toISOString(),
            });
          } else if (historyMessage.message_type === 'assistant' && historyMessage.assistant_response) {
            const agentConv = historyMessage.assistant_response.agent_conversation || [];
            const isProc = historyMessage.assistant_response.is_processing || false;
            
            console.log(`📩 Loading assistant message:`, {
              content_preview: historyMessage.assistant_response.final_content?.substring(0, 50),
              content_is_undefined: historyMessage.assistant_response.final_content === undefined,
              content_is_null: historyMessage.assistant_response.final_content === null,
              agent_conversation_length: agentConv.length,
              agent_conversation_sample: agentConv.slice(0, 2),
              is_processing: isProc,
              has_execution_results: !!historyMessage.assistant_response.execution_results,
              artifacts_count: historyMessage.assistant_response.artifacts?.length || 0,
              tool_executions_count: historyMessage.assistant_response.tool_executions?.length || 0,
              artifacts_names: historyMessage.assistant_response.artifacts?.map((a: any) => a.name) || []
            });
            
            historyMessages.push({
              role: 'assistant',
              content: historyMessage.assistant_response.final_content || '⏳ Processing...',
              enhanced_response: historyMessage.assistant_response.final_content,
              agent_conversation: agentConv,
              is_processing: isProc,
              tool_executions: historyMessage.assistant_response.tool_executions,
              artifacts: historyMessage.assistant_response.artifacts,
              timestamp: new Date(historyMessage.timestamp).toISOString(),
            });
          }
        }
        
        // Replace current messages with history messages
        dispatch({ type: 'SET_MESSAGES', payload: historyMessages });
        console.log('✅ Chat history messages loaded:', historyMessages.length);
        
        // Reset loading flag after a brief delay
        setTimeout(() => setIsLoadingHistory(false), 150);
      } else if (currentThread.messages.length !== messages.length && recentlySaved) {
        console.log('🚫 Skipping history load - recently saved messages, preventing stale data overwrite');
      }
    }
  }, [currentThread, dispatch, messages.length, isLoading, isStreaming, isSavingToHistory, isLoadingHistory, isInActiveConversation, lastSaveTime, selectedObject?._id, selectedDataset]);

  const toggleEnhancedSection = (index: number) => {
    setExpandedEnhanced((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const toggleMetadataSection = (index: number) => {
    setExpandedMetadata((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const toggleAgentConversationSection = (index: number) => {
    setExpandedAgentConversation((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  };

  const toggleExchangeExpansion = (messageIndex: number, exchangeIndex: number) => {
    const key = `${messageIndex}-${exchangeIndex}`;
    setExpandedExchanges((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // 🆕 Convert agent_conversation from DB to streaming updates format
  const convertAgentConversationToUpdates = (
    agentConversation: any[], 
    isProcessing: boolean,
    toolExecutions?: any[],
    artifacts?: any[]
  ) => {
    if (!agentConversation || agentConversation.length === 0) {
      console.log('⚠️ No agent_conversation data to convert');
      return [];
    }
    
    console.log(`🔄 Converting ${agentConversation.length} agent exchanges, processing: ${isProcessing}`, 
      agentConversation.map(e => ({ agent: e.role || e.agent, hasContent: !!e.content })));
    
    const updates: any[] = [];
    
    agentConversation.forEach((exchange: any, index: number) => {
      const agent = exchange.role || exchange.agent || 'Unknown';
      const content = exchange.content || '';
      const status = isProcessing && index === agentConversation.length - 1 ? 'running' : 'completed';
      
      const update: any = {
        type: status === 'running' ? 'progress' : 'result',
        agent: agent,
        step: index + 1,
        status: content ? 'completed' : 'in_progress',
        message: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
        content: content
      };
      
      // Add tool_executions to ToolAgent
      if (agent === 'ToolAgent' && toolExecutions && toolExecutions.length > 0) {
        update.tool_executions = toolExecutions;
      }
      
      // Add artifacts to the correct agent based on the agent field
      if ((agent === 'MetadataAnalyst' || agent === 'ToolAgent') && artifacts && artifacts.length > 0) {
        // Filter artifacts to only include those tagged for this specific agent
        const agentArtifacts = artifacts.filter((a: any) => a.agent === agent);
        if (agentArtifacts.length > 0) {
          update.artifacts = agentArtifacts;
        }
      }
      
      updates.push(update);
    });
    
    return updates;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    // Mark as active conversation to prevent thread clearing during message flow
    setIsInActiveConversation(true);
    console.log('💬 Starting active conversation - protecting thread from clearing');

    // Check if we're in custom event mode
    if (isCustomEventMode) {
      // For custom mode, check if we have event data
      if (!customEventListData || !customEventListData.event_list) {
        dispatch({
          type: "SET_ERROR",
          key: "chat",
          payload: "No event list data available. Please upload a .pkl file first.",
        });
        setIsInActiveConversation(false);
        return;
      }
    } else {
      // In normal mode, require selected dataset and object
      if (!selectedDataset || !selectedObject) {
        setIsInActiveConversation(false);
        return;
      }

      // Additional validation for specific models (removed since only astromind-openai is available)
    }

    // Check if the model requires event_list data
    const needsEventList = modelRequiresEventList(selectedModel);

    // Get the appropriate data based on model requirements
    let eventListData: number[][] | null = null;  // Explicitly typed as 2D array
    let embeddingData = null;

    if (needsEventList) {
      // For event list models
      if (isCustomEventMode) {
        // Use the custom event data in custom mode
        if (customEventListData && customEventListData.event_list && Array.isArray(customEventListData.event_list)) {
          eventListData = customEventListData.event_list as number[][];  // Explicitly cast to 2D array
          console.log(`Using custom event data from source: ${customEventListData.name || 'unknown'}, events: ${customEventListData.event_list.length}`);
        } else {
          dispatch({
            type: "SET_ERROR",
            key: "chat",
            payload: "The selected model requires event list data, but no valid data was found in the uploaded file.",
          });
          setIsInActiveConversation(false);
          return;
        }
      } else {
        // Normal mode - use dataset object
        if (dataObjectToUse && 'event_list' in dataObjectToUse && Array.isArray(dataObjectToUse.event_list)) {
          // Make sure the event_list is a 2D array
          if (Array.isArray(dataObjectToUse.event_list[0])) {
            eventListData = dataObjectToUse.event_list as number[][];
          } else {
            // Handle case where it might be a 1D array
            console.warn("Event list is not a 2D array, may cause issues");
            setIsInActiveConversation(false);
            return;
          }
        } else {
          // Multi-agent workflow now handles missing event_list gracefully
          // It will skip event analyst and neighbor analyst steps if data is missing
          console.log(`Event list not found for object, multi-agent will adapt workflow`);
          eventListData = null;
        }
      }
    } else if (!isCustomEventMode) {
      // For embedding models (only in normal mode)
      if (hasEmbedding) {
        embeddingData = dataObjectToUse.embedding!;

        // Warn if embedding is all zeros
        if (!isValidEmbedding) {
          console.warn(
            "Invalid embedding detected (all zeros). This may affect response quality."
          );
        }
      } else if (!objectDetails) {
        dispatch({
          type: "SET_ERROR",
          key: "chat",
          payload: "Waiting for full object details to load. Please try again in a moment.",
        });
        setIsInActiveConversation(false);
        return;
      }
    }

    // Verify model availability (only in normal mode, as custom mode doesn't depend on object)
    if (!isCustomEventMode && !isSelectedModelAvailable) {
      dispatch({
        type: "SET_ERROR",
        key: "chat",
        payload: "Selected model is not available. Please choose another model.",
      });
      setIsInActiveConversation(false);
      return;
    }

    // Hide control panel on mobile when sending message
    if (isMobileView) {
      setShowControlPanel(false);
    }

    // Clear any previous errors
    dispatch({ type: "SET_ERROR", key: "chat", payload: null });

    const userMessage = createMessage("user", input);
    dispatch({ type: "ADD_MESSAGE", payload: userMessage });
    setInput("");
    setIsLoading(true);
    setTypingText("");
    setShowMessage(false); // Hide message initially to show animation

    // Update loading state in the context
    dispatch({ type: "SET_LOADING", key: "chat", payload: true });

    try {
      // Prepare context settings - in custom mode, we don't use dataset context
      const contextSettings = isCustomEventMode
        ? { enabled: false, selectedFields: [], dataset: "" }
        : {
            enabled: feedContext,
            selectedFields: selectedFields,
            dataset: selectedDataset,
          };

      // Debug logging for neighbors
      if (selectedModel === "astromind-multi-agent") {
        console.log("🔍 Debug - Sending chat with neighbors:", {
          hasNeighbors: !!state.nearestNeighbors,
          neighborsCount: state.nearestNeighbors?.length || 0,
          neighbors: state.nearestNeighbors?.slice(0, 2), // Log first 2 for debugging
          stateKeys: Object.keys(state),
          hasSelectedObject: !!state.selectedObject
        });
        console.log("🔍 Debug - Full nearestNeighbors array:", state.nearestNeighbors);
      }

      // Clear previous streaming state
      clearStreamingState();

      let response;

      // Prepare thread_id - create thread if needed BEFORE sending message
      let threadId: string | null = null;
      let isNewThreadCreated = false;
      
      if (currentThread && currentThread._id) {
        threadId = currentThread._id;
        console.log('📋 Using existing thread:', threadId);
      } else {
        // Create new thread before sending message
        isNewThreadCreated = true;
        const threadTitle = input.length > 50 ? input.substring(0, 47) + '...' : input;
        console.log('📁 Creating new thread:', threadTitle);
        
        try {
          const createThreadResponse = await fetch('/api/chat-threads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              title: threadTitle,
              selected_object: selectedObject ? {
                data_obj_id: String(selectedObject._id || ''),
                dataset_name: String(selectedDataset || ''),
                obsid: String(selectedObject.obsid || selectedObject._id || ''),
                source_name: String(selectedObject.source_name || selectedObject.name || ''),
                source_type: String(selectedObject.source_type || '')
              } : null
            })
          });
          
          if (createThreadResponse.ok) {
            const newThread = await createThreadResponse.json();
            threadId = newThread._id;
            console.log('✅ New thread created with ID:', threadId);
            console.log('🔍 Thread object:', newThread);
          } else {
            const errorText = await createThreadResponse.text();
            console.error('❌ Failed to create thread:', createThreadResponse.status, errorText);
          }
        } catch (error) {
          console.error('❌ Error creating thread:', error);
        }
      }
      
      // Validate thread_id before proceeding
      if (!threadId) {
        console.error('❌ CRITICAL: No thread_id available! Messages will not be saved!');
        console.error('  currentThread:', currentThread);
        console.error('  isNewThreadCreated:', isNewThreadCreated);
        // Still proceed with request, but warn user
        dispatch({
          type: "SET_ERROR",
          key: "chat",
          payload: "Warning: Chat thread could not be created. Messages may not be saved to history.",
        });
      } else {
        console.log('✅ thread_id confirmed:', threadId);
      }
      
      // Use streaming for multi-agent model, regular for others
      if (selectedModel === "astromind-multi-agent") {
        console.log("🚀 Using streaming multi-agent workflow with thread_id:", threadId);
        
        response = await sendStreamingMessage({
          message: input,
          embeddings: embeddingData,
          event_list: eventListData,
          data_obj: dataObjectToUse,
          neighbors: state.nearestNeighbors,
          history: messages,
          model: selectedModel,
          model_api_url: currentModelApiUrl,
          response_format: responseFormat,
          openai_model: openaiModelRef.current,
          contextSettings: contextSettings,
          thread_id: threadId, // Backend will save messages
          agent_config: agentConfig, // Agent configuration
        });
      } else {
        console.log("📞 Using regular chat message with thread_id:", threadId);
        
        response = await sendChatMessage({
          message: input,
          embeddings: embeddingData,
          event_list: eventListData,
          data_obj: (selectedModel === "astromind-openai" || selectedModel === "astromind-multi-agent") ? dataObjectToUse : null,
          neighbors: selectedModel === "astromind-multi-agent" ? state.nearestNeighbors : null,
          history: messages,
          model: selectedModel,
          model_api_url: currentModelApiUrl,
          response_format: responseFormat,
          openai_model: openaiModelRef.current,
          contextSettings: contextSettings,
          thread_id: threadId, // Backend will save messages
        });
      }

      // Handle response if we got one
      if (response) {
        // For streaming responses (multi-agent), skip typing animation since user already saw real-time progress
        // For non-streaming responses, use typing animation for better UX
        if (selectedModel === "astromind-multi-agent") {
          console.log("✨ Streaming completed - showing final result immediately");
          // Skip typing animation for streaming responses
          setCurrentResponse(response.content);
          setTypingText(response.content); // Set full text immediately
          setIsTyping(false); // No typing animation
          setShowMessage(true);
        } else {
          // Use typing animation for non-streaming responses
          setCurrentResponse(response.content);
          setTypingText("");
          setIsTyping(true);
          setShowMessage(true);
        }

        // Add the response message to the chat
        dispatch({
          type: "ADD_MESSAGE",
          payload: response,
        });

        // Update ChatHistory context - Backend already saved messages to DB
        if (threadId) {
          console.log('🔄 Notifying ChatHistory context of update...');
          try {
            const action = isNewThreadCreated ? 'created' : 'updated';
            
            window.dispatchEvent(new CustomEvent('chat-history-updated', { 
              detail: { threadId, action } 
            }));
            
            console.log(`✅ Context update event dispatched: ${action} thread ${threadId}`);
            console.log('💾 Messages saved by backend automatically');
            
            // Mark save time for UI coordination
            setLastSaveTime(Date.now());
          } catch (contextError) {
            console.log('⚠️ Context update failed (non-critical):', contextError);
          }
        } else {
          console.log('⚠️ No thread_id available - messages may not be saved');
        }
        
        // Keep active conversation state for a bit longer to prevent premature cleanup
        // ChatHistoryContext needs 2 seconds to fetch and set currentThread
        setTimeout(() => {
          setIsInActiveConversation(false);
          console.log('✅ Active conversation completed (delayed)');
        }, 2500); // 2.5 seconds - slightly longer than ChatHistoryContext fetch delay
      }
    } catch (error) {
      console.error("Error in chat:", error);
      dispatch({
        type: "SET_ERROR",
        key: "chat",
        payload: "Failed to get response from the model. Please try again.",
      });
      setShowMessage(true);
    } finally {
      setIsLoading(false);
      dispatch({ type: "SET_LOADING", key: "chat", payload: false });
      // Ensure active conversation state is cleared even if there was an error
      setIsInActiveConversation(false);
    }
  };

  const handleValidate = async () => {
    // Only validate if we have messages
    if (messages.length === 0) return;

    setValidating(true);

    try {
      // Find the last assistant message and user message
      const assistantMessages = messages.filter(
        (msg) => msg.role === "assistant"
      );
      if (assistantMessages.length === 0) {
        setValidationResult("No assistant messages to validate.");
        setShowValidationModal(true);
        return;
      }

      const lastAssistantMessage =
        assistantMessages[assistantMessages.length - 1];

      // Debug: Check what's in the metadata
      console.log(
        "DEBUG - Last assistant message metadata:",
        lastAssistantMessage.metadata
      );

      // Find the user message that preceded the assistant message
      let userMessage = "Tell me about this object";
      const assistantIndex = messages.findIndex(
        (msg) =>
          msg.role === "assistant" &&
          msg.content === lastAssistantMessage.content
      );

      if (assistantIndex > 0 && messages[assistantIndex - 1].role === "user") {
        userMessage = messages[assistantIndex - 1].content;
      }

      // Extract source name from metadata if available, or use selectedObject if available
      let sourceName: string | null = null;

      // First priority: Try to get from metadata
      if (
        lastAssistantMessage.metadata &&
        "source_name" in lastAssistantMessage.metadata
      ) {
        sourceName = String(lastAssistantMessage.metadata.source_name);
        console.log("Found source_name in metadata:", sourceName);
      }
      // Second priority: Use the currently selected object's source_name
      else if (state.selectedObject && state.selectedObject.source_name) {
        sourceName = state.selectedObject.source_name;
        console.log(
          "Using currently selected object's source_name:",
          sourceName
        );
        // Log object details for debugging
        if (state.objectDetails) {
          console.log("Selected object details:", {
            source_name: state.objectDetails.source_name,
            source_type: state.objectDetails.source_type,
          });
        }
      }
      // Third priority: Try to extract from metadata.matching_texts if available
      else if (
        lastAssistantMessage.metadata &&
        lastAssistantMessage.metadata.matching_contents &&
        lastAssistantMessage.metadata.matching_contents.length > 0
      ) {
        const firstMatch = lastAssistantMessage.metadata.matching_contents[0];
        if (firstMatch.source_name) {
          sourceName = firstMatch.source_name;
          console.log(
            "Extracted source_name from first matching text:",
            sourceName
          );
        }
      } else {
        console.log("No source_name found in metadata or selected object.");
      }

      // Get context from metadata if available
      let context: Array<string> = [];
      if (
        lastAssistantMessage.metadata &&
        lastAssistantMessage.metadata.matching_contents
      ) {
        context = lastAssistantMessage.metadata.matching_contents.map(
          (match) => match.text
        );
        console.log("Found matching_texts in metadata:", context);
      } else {
        console.log("No matching_texts found in metadata.");
      }

      // Extract source context data from the currently selected object
      let sourceContext = null;
      if (state.objectDetails) {
        sourceContext = {
          source_name: state.objectDetails.source_name,
          source_type: state.objectDetails.source_type,
          answer: state.objectDetails.answer,
          qna: state.objectDetails.qna,
        };
        console.log("Using object details for source context:", sourceContext);
      } else if (state.selectedObject) {
        sourceContext = {
          source_name: state.selectedObject.source_name,
          source_type: state.selectedObject.source_type,
          answer: state.selectedObject.answer,
          qna: state.selectedObject.qna,
        };
        console.log("Using selected object for source context:", sourceContext);
      }

      console.log("Sending validation request with:", {
        answer: lastAssistantMessage.content.substring(0, 100) + "...",
        context:
          context.length > 0
            ? context.map((c) => c.substring(0, 50) + "...")
            : "No context",
        userMessage,
        sourceName,
        source_context: sourceContext,
      });

      // Call the validation API with the updated payload
      const response = await fetch("/api/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          answer: lastAssistantMessage.content,
          context: context,
          userMessage: userMessage,
          sourceId: sourceName,
          source_context: sourceContext,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Validation API error:", response.status, errorText);
        throw new Error(
          `Validation request failed: ${response.status} ${errorText}`
        );
      }

      const data = await response.json();
      console.log("Validation API response:", data);

      // Check if the response contains an error
      if (data.result.error) {
        setValidationResult(`Error: ${data.result.error}`);
      }
      // Check for required fields
      else if (data.result.accuracy_rating !== undefined && data.result.evaluation) {
        // Format the validation result with accuracy rating and evaluation
        const formattedResult = `
  
  **Accuracy Rating**: ${data.result.accuracy_rating}/10
  
  **Evaluation**:
  ${data.result.evaluation}
        `;
        setValidationResult(formattedResult);
      }
      // Handle case where the expected fields are missing
      else {
        setValidationResult("Invalid validation response: Missing required fields (accuracy_rating, evaluation)");
      }

      setShowValidationModal(true);
    } catch (error) {
      console.error("Error validating:", error);
      setValidationResult(
        "An error occurred during validation. Please try again."
      );
      setShowValidationModal(true);
    } finally {
      setValidating(false);
    }
  };

  const toggleControlPanel = () => {
    setShowControlPanel(!showControlPanel);
  };

  // Get color based on theme and colorTheme
  const getAssistantBgColor = () => {
    if (theme === 'dark') {
      switch (colorTheme) {
        case 'blue': return 'from-[#1a365d]/95 to-[#0f2942]/95 text-white';
        case 'green': return 'from-[#065f46]/95 to-[#064e3b]/95 text-white';
        case 'purple': return 'from-[#4a1d96]/95 to-[#312e81]/95 text-white';
        case 'red': return 'from-[#7a1d96]/95 to-[#5e0e81]/95 text-white';
        case 'orange': return 'from-[#ff9900]/95 to-[#ff6600]/95 text-white';
        case 'teal': return 'from-[#0097a7]/95 to-[#006a6a]/95 text-white';
        case 'pink': return 'from-[#ff69b4]/95 to-[#ff33cc]/95 text-white';
        default: return 'from-[#1a365d]/95 to-[#0f2942]/95 text-white';
      }
    } else {
      switch (colorTheme) {
        case 'blue': return 'from-blue-100 to-blue-50 text-gray-800';
        case 'green': return 'from-green-100 to-green-50 text-gray-800';
        case 'purple': return 'from-purple-100 to-purple-50 text-gray-800';
        case 'red': return 'from-red-100 to-red-50 text-gray-800';
        case 'orange': return 'from-orange-100 to-orange-50 text-gray-800';
        case 'teal': return 'from-teal-100 to-teal-50 text-gray-800';
        case 'pink': return 'from-pink-100 to-pink-50 text-gray-800';
        default: return 'from-gray-100 to-white text-gray-800';
      }
    }
  };

  const getUserBgColor = () => {
    if (theme === 'dark') {
      switch (colorTheme) {
        case 'blue': return 'from-blue-800/90 to-blue-900/90 text-white';
        case 'green': return 'from-[#1c4c1c]/90 to-[#133613]/90 text-white';
        case 'purple': return 'from-purple-800/90 to-purple-900/90 text-white';
        case 'red': return 'from-red-800/90 to-red-900/90 text-white';
        case 'orange': return 'from-orange-800/90 to-orange-900/90 text-white';
        case 'teal': return 'from-teal-800/90 to-teal-900/90 text-white';
        case 'pink': return 'from-pink-800/90 to-pink-900/90 text-white';
        default: return 'from-blue-800/90 to-blue-900/90 text-white';
      }
    } else {
      switch (colorTheme) {
        case 'blue': return 'from-blue-200 to-blue-100 text-gray-800';
        case 'green': return 'from-green-200 to-green-100 text-gray-800';
        case 'purple': return 'from-purple-200 to-purple-100 text-gray-800';
        case 'red': return 'from-red-200 to-red-100 text-gray-800';
        case 'orange': return 'from-orange-200 to-orange-100 text-gray-800';
        case 'teal': return 'from-teal-200 to-teal-100 text-gray-800';
        case 'pink': return 'from-pink-200 to-pink-100 text-gray-800';
        default: return 'from-gray-200 to-gray-100 text-gray-800';
      }
    }
  };

  // Get color for enhanced section header
  const getEnhancedHeaderColor = () => {
    if (theme === 'dark') {
      switch (colorTheme) {
        case 'blue': return 'from-blue-900/95 to-blue-800/95 border-blue-500/30 text-blue-200';
        case 'green': return 'from-green-900/95 to-green-800/95 border-green-500/30 text-green-200';
        case 'purple': return 'from-[#4a1d96]/95 to-[#312e81]/95 border-purple-500/30 text-purple-200';
        case 'red': return 'from-red-900/95 to-red-800/95 border-red-500/30 text-red-200';
        case 'orange': return 'from-orange-900/95 to-orange-800/95 border-orange-500/30 text-orange-200';
        case 'teal': return 'from-teal-900/95 to-teal-800/95 border-teal-500/30 text-teal-200';
        case 'pink': return 'from-pink-900/95 to-pink-800/95 border-pink-500/30 text-pink-200';
        default: return 'from-[#4a1d96]/95 to-[#312e81]/95 border-purple-500/30 text-purple-200';
      }
    } else {
      switch (colorTheme) {
        case 'blue': return 'from-blue-200 to-blue-100 border-blue-300/50 text-blue-800';
        case 'green': return 'from-green-200 to-green-100 border-green-300/50 text-green-800';
        case 'purple': return 'from-purple-200 to-purple-100 border-purple-300/50 text-purple-800';
        case 'red': return 'from-red-200 to-red-100 border-red-300/50 text-red-800';
        case 'orange': return 'from-orange-200 to-orange-100 border-orange-300/50 text-orange-800';
        case 'teal': return 'from-teal-200 to-teal-100 border-teal-300/50 text-teal-800';
        case 'pink': return 'from-pink-200 to-pink-100 border-pink-300/50 text-pink-800';
        default: return 'from-purple-200 to-purple-100 border-purple-300/50 text-purple-800';
      }
    }
  };

  // Get color for source references header
  const getSourceHeaderColor = () => {
    if (theme === 'dark') {
      switch (colorTheme) {
        case 'blue': return 'from-blue-900/95 to-blue-800/95 border-blue-500/30 text-blue-200';
        case 'green': return 'from-[#065f46]/95 to-[#064e3b]/95 border-green-500/30 text-green-200';
        case 'purple': return 'from-purple-900/95 to-purple-800/95 border-purple-500/30 text-purple-200';
        case 'red': return 'from-red-900/95 to-red-800/95 border-red-500/30 text-red-200';
        case 'orange': return 'from-orange-900/95 to-orange-800/95 border-orange-500/30 text-orange-200';
        case 'teal': return 'from-teal-900/95 to-teal-800/95 border-teal-500/30 text-teal-200';
        case 'pink': return 'from-pink-900/95 to-pink-800/95 border-pink-500/30 text-pink-200';
        default: return 'from-[#065f46]/95 to-[#064e3b]/95 border-green-500/30 text-green-200';
      }
    } else {
      switch (colorTheme) {
        case 'blue': return 'from-blue-200 to-blue-100 border-blue-300/50 text-blue-800';
        case 'green': return 'from-green-200 to-green-100 border-green-300/50 text-green-800';
        case 'purple': return 'from-purple-200 to-purple-100 border-purple-300/50 text-purple-800';
        case 'red': return 'from-red-200 to-red-100 border-red-300/50 text-red-800';
        case 'orange': return 'from-orange-200 to-orange-100 border-orange-300/50 text-orange-800';
        case 'teal': return 'from-teal-200 to-teal-100 border-teal-300/50 text-teal-800';
        case 'pink': return 'from-pink-200 to-pink-100 border-pink-300/50 text-pink-800';
        default: return 'from-green-200 to-green-100 border-green-300/50 text-green-800';
      }
    }
  };

  // Get color for loading indicator
  const getLoadingIndicatorColors = () => {
    if (theme === 'dark') {
      switch (colorTheme) {
        case 'blue': return 'text-blue-400';
        case 'green': return 'text-green-400';
        case 'purple': return 'text-purple-400';
        case 'red': return 'text-red-400';
        case 'orange': return 'text-orange-400';
        case 'teal': return 'text-teal-400';
        case 'pink': return 'text-pink-400';
        default: return 'text-[#00E0FF]';
      }
    } else {
      switch (colorTheme) {
        case 'blue': return 'text-blue-500';
        case 'green': return 'text-green-500';
        case 'purple': return 'text-purple-500';
        case 'red': return 'text-red-500';
        case 'orange': return 'text-orange-500';
        case 'teal': return 'text-teal-500';
        case 'pink': return 'text-pink-500';
        default: return 'text-blue-500';
      }
    }
  };

  // Get electron orbit colors
  const getElectronOrbitColors = () => {
    if (theme === 'dark') {
      switch (colorTheme) {
        case 'blue': return { first: 'border-blue-400/30', second: 'border-blue-400/20', third: 'border-blue-400/10' };
        case 'green': return { first: 'border-green-400/30', second: 'border-green-400/20', third: 'border-green-400/10' };
        case 'purple': return { first: 'border-purple-400/30', second: 'border-purple-400/20', third: 'border-purple-400/10' };
        case 'red': return { first: 'border-red-400/30', second: 'border-red-400/20', third: 'border-red-400/10' };
        case 'orange': return { first: 'border-orange-400/30', second: 'border-orange-400/20', third: 'border-orange-400/10' };
        case 'teal': return { first: 'border-teal-400/30', second: 'border-teal-400/20', third: 'border-teal-400/10' };
        case 'pink': return { first: 'border-pink-400/30', second: 'border-pink-400/20', third: 'border-pink-400/10' };
        default: return { first: 'border-[#00E0FF]/30', second: 'border-[#00E0FF]/20', third: 'border-[#00E0FF]/10' };
      }
    } else {
      switch (colorTheme) {
        case 'blue': return { first: 'border-blue-500/30', second: 'border-blue-500/20', third: 'border-blue-500/10' };
        case 'green': return { first: 'border-green-500/30', second: 'border-green-500/20', third: 'border-green-500/10' };
        case 'purple': return { first: 'border-purple-500/30', second: 'border-purple-500/20', third: 'border-purple-500/10' };
        case 'red': return { first: 'border-red-500/30', second: 'border-red-500/20', third: 'border-red-500/10' };
        case 'orange': return { first: 'border-orange-500/30', second: 'border-orange-500/20', third: 'border-orange-500/10' };
        case 'teal': return { first: 'border-teal-500/30', second: 'border-teal-500/20', third: 'border-teal-500/10' };
        case 'pink': return { first: 'border-pink-500/30', second: 'border-pink-500/20', third: 'border-pink-500/10' };
        default: return { first: 'border-blue-500/30', second: 'border-blue-500/20', third: 'border-blue-500/10' };
      }
    }
  };

  return (
    <div className={`flex flex-col h-full ${
      theme === 'dark' 
        ? 'bg-gradient-to-b from-[#1E2330] to-[#0A1020]' 
        : 'bg-gradient-to-b from-gray-50 to-gray-100'
    }`}>
      {/* Chat Header */}
      <div className={`p-2 md:p-4 border-b backdrop-blur-sm flex-shrink-0 ${
        theme === 'dark' 
          ? 'border-gray-700/60 bg-[#2A3040]/40' 
          : 'border-gray-200/60 bg-gray-100/40'
      } ${isThreadSelectorExpanded ? 'space-y-3' : ''}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ChatThreadSelector />
            <button
            onClick={toggleChat} // Use the context toggle function
            className={`mr-3 transition-colors ${
              theme === 'dark' 
                ? 'text-gray-400 hover:text-[#00E0FF]' 
                : 'text-gray-500 hover:text-blue-600'
            }`}
            title={isChatExpanded ? "Collapse chat" : "Expand chat"}
          >
            {isChatExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <h2 className={`text-base md:text-lg font-semibold ${
            theme === 'dark' ? 'text-white' : 'text-[#0066cc]'
          }`}>
            PLLM Chat
          </h2>
          {selectedObject && !isMobileView && (
            <span 
              className={`ml-2 text-xs px-2 py-1 rounded-full truncate max-w-[150px] md:max-w-xs ${
                theme === 'dark' 
                  ? 'bg-[#1E1A3C] text-[#00E0FF]' 
                  : 'bg-blue-50 text-[#2957D8]'
              }`}
              style={theme !== 'dark' ? { color: '#2957D8' } : {}}
            >
              {selectedObject.obsid}
              {selectedObject.source_type && ` - ${selectedObject.source_type}`}
              {selectedObject.source_name && ` - ${selectedObject.source_name}`}
            </span>
          )}
          {selectedObject && !hasObjectDetails && (
            <span className="ml-2 text-xs text-amber-400">(Loading...)</span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {isMobileView && (
            <button
              onClick={toggleControlPanel}
              className={`p-1.5 rounded-md transition-colors ${
                theme === 'dark' 
                  ? 'bg-[#1A1832] hover:bg-[#2A2850] text-[#00E0FF]' 
                  : 'bg-gray-100 hover:bg-gray-200 text-blue-600'
              }`}
              aria-label={showControlPanel ? "Hide controls" : "Show controls"}
            >
              <Settings className="h-4 w-4" />
            </button>
          )}

          <div className="flex items-center space-x-1 md:space-x-2">

            {/* Validate button removed */}

            {/* Color Theme Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowThemeDropdown(!showThemeDropdown)}
                className={`flex items-center justify-center rounded-md transition-colors
                  ${theme === "dark"
                    ? "bg-gray-700 hover:bg-gray-600 text-gray-200"
                    : "bg-gray-200 hover:bg-gray-300 text-gray-700"
                  }
                  px-1.5 py-1.5 md:px-2 md:py-1.5 text-xs font-medium
                `}
              >
                <PaintBucket className="w-3.5 h-3.5 md:mr-1" />
                <span className="hidden md:inline">Theme</span>
              </button>

              {showThemeDropdown && (
                <div
                  className={`absolute right-0 mt-1 w-40 rounded-md shadow-lg z-50 ${
                    theme === "dark"
                      ? "bg-gray-800 border border-gray-700"
                      : "bg-white border border-gray-200"
                  }`}
                >
                  <div className="py-1">
                    {[
                      { id: 'default', name: 'Default', color: theme === 'dark' ? 'bg-[#1A2030]' : 'bg-white' },
                      { id: 'blue', name: 'Blue', color: theme === 'dark' ? 'bg-blue-900' : 'bg-blue-100' },
                      { id: 'green', name: 'Green', color: theme === 'dark' ? 'bg-green-900' : 'bg-green-100' },
                      { id: 'purple', name: 'Purple', color: theme === 'dark' ? 'bg-purple-900' : 'bg-purple-100' },
                      { id: 'red', name: 'Red', color: theme === 'dark' ? 'bg-red-900' : 'bg-red-100' },
                      { id: 'orange', name: 'Orange', color: theme === 'dark' ? 'bg-orange-900' : 'bg-orange-100' },
                      { id: 'teal', name: 'Teal', color: theme === 'dark' ? 'bg-teal-900' : 'bg-teal-100' },
                      { id: 'pink', name: 'Pink', color: theme === 'dark' ? 'bg-pink-900' : 'bg-pink-100' }
                    ].map((option) => (
                      <button
                        key={option.id}
                        className={`flex items-center w-full px-4 py-2 text-sm ${
                          theme === "dark" ? "text-gray-200 hover:bg-gray-700" : "text-gray-700 hover:bg-gray-100"
                        } ${colorTheme === option.id ? (theme === "dark" ? "bg-gray-700" : "bg-gray-100") : ""}`}
                        onClick={() => {
                          setColorTheme(option.id as any);
                          setShowThemeDropdown(false);
                        }}
                      >
                        <div className={`w-4 h-4 rounded-full mr-2 ${option.color}`}></div>
                        {option.name}
                        {colorTheme === option.id && (
                          <Check className="w-4 h-4 ml-auto" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Reset button removed */}
          </div>
          </div>
        </div>
      </div>

      {/* Only show content if expanded */}
      {isChatExpanded && (
        <>
          {/* Mobile selection info banner */}
          {isMobileView && selectedObject && (
            <div className={`px-3 py-1.5 text-xs flex items-center justify-between overflow-hidden flex-shrink-0 ${
              theme === 'dark' 
                ? 'bg-[#1A2030] text-gray-200' 
                : 'bg-gray-100 text-gray-700'
            }`}>
              <div className="truncate">
                <span className={`mr-1 ${
                  theme === 'dark' ? 'text-[#00E0FF]' : 'text-[#2957D8]'
                }`} style={theme !== 'dark' ? { color: '#2957D8' } : {}}>Object:</span>
                {selectedObject.source_name || `ID: ${selectedObject._id}`}
              </div>
            </div>
          )}

          {/* Custom event data info banner */}
          {isMobileView && isCustomEventMode && customEventListData && (
            <div className={`px-3 py-1.5 text-xs flex items-center justify-between overflow-hidden flex-shrink-0 ${
              theme === 'dark' 
                ? 'bg-[#1A2030] text-gray-200' 
                : 'bg-gray-100 text-gray-700'
            }`}>
              <div className="truncate">
                <span className={`mr-1 ${
                  theme === 'dark' ? 'text-[#00E0FF]' : 'text-[#2957D8]'
                }`} style={theme !== 'dark' ? { color: '#2957D8' } : {}}>Custom data:</span>
                {customEventListData.name || 'Uploaded event data'}
                {customEventListData.obsid && ` (ObsID: ${customEventListData.obsid})`}
              </div>
            </div>
          )}

          {/* Mobile control panel */}
          {isMobileView && showControlPanel && (
            <div
              className={`p-3 border-b space-y-2 md:space-y-4 backdrop-blur-sm flex-shrink-0 ${
                theme === 'dark' 
                  ? 'bg-[#1A2030] border-gray-700/50' 
                  : 'bg-white border-gray-200/50'
              }`}
              style={{ animation: "slideDown 0.3s ease forwards" }}
            >
              <div className="space-y-2">
                <label className={`block text-xs font-medium mb-1 ${
                  theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  Model
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className={`w-full rounded-md py-1.5 px-3 text-sm font-medium border focus:outline-none appearance-none cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    theme === 'dark' 
                      ? 'bg-[#2A3040] text-gray-100 border-gray-600/50 focus:border-[#00E0FF] focus:ring-1 focus:ring-[#00E0FF]/30' 
                      : 'bg-white text-gray-800 border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30'
                  }`}
                  disabled={loading.chat || isLoading}
                >
                  {MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Error display */}
          {errors.chat && (
            <div className={`text-xs md:text-sm px-3 md:px-4 py-1.5 md:py-2 flex items-center flex-shrink-0 ${
              theme === 'dark' 
                ? 'bg-red-900/20 border border-red-800 text-red-300' 
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}>
              <AlertCircle className="w-3 md:w-4 h-3 md:h-4 mr-1 md:mr-2 flex-shrink-0" />
              <span>{errors.chat}</span>
            </div>
          )}

          {/* Object details status message */}
          {selectedObject && !hasObjectDetails && !loading.objectDetails && (
            <div className={`text-xs md:text-sm px-3 md:px-4 py-1.5 md:py-2 flex items-center flex-shrink-0 ${
              theme === 'dark' 
                ? 'bg-amber-900/20 border border-amber-800 text-amber-300' 
                : 'bg-amber-50 border border-amber-200 text-amber-700'
            }`}>
              <AlertCircle className="w-3 md:w-4 h-3 md:h-4 mr-1 md:mr-2 flex-shrink-0" />
              <span>Loading object details...</span>
            </div>
          )}

          {/* Messages Container - This is the key scrollable area */}
          <div
            ref={chatContainerRef}
            className={`flex-1 overflow-y-auto p-3 md:p-4 space-y-3 md:space-y-4 min-h-0 ${
              theme === 'dark' ? 'bg-[#1A2030]/80' : 'bg-gray-50/80'
            }`}
            style={{
              backgroundImage: theme === 'dark'
                ? "radial-gradient(circle at 10% 20%, rgba(40, 50, 60, 0.08) 0%, rgba(10, 20, 30, 0.04) 90%)"
                : "radial-gradient(circle at 10% 20%, rgba(240, 240, 240, 0.1) 0%, rgba(240, 240, 240, 0.05) 90%)",
              overscrollBehavior: "contain",
            }}
          >
            {messages.length === 0 ? (
              <div className="h-full w-full flex items-center justify-center">
                <div className="text-center space-y-3 p-0">
                  <div className={`mx-auto w-20 h-20 md:w-24 md:h-24 rounded-full flex items-center justify-center mb-3 md:mb-4 relative overflow-hidden`}>
                    {/* Animation elements here */}
                    <div
                      className="relative"
                      style={{ animation: "sparkleBreath 6s infinite ease-in-out" }}
                    >
                      <Sparkles className={`w-10 h-10 md:w-12 md:h-12 ${
                        theme === 'dark' ? 'text-[#00E0FF]' : 'text-[#2957D8]'
                      }`} />
                    </div>
                  </div>
                  <p className={`text-sm md:text-base ${
                    theme === 'dark' ? 'text-gray-100' : 'text-gray-700'
                  }`}>
                    {!selectedObject
                      ? "Select a dataset object to start exploring"
                      : "Discover Your Data"}
                  </p>
                </div>
              </div>
            ) : (
              messages.map((message: Message, index: number) => (
                <div
                  key={index}
                  className={`flex space-x-2 md:space-x-3 ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  } ${
                    index === messages.length - 1 &&
                    !showMessage &&
                    message.role === "assistant"
                      ? "hidden"
                      : ""
                  }`}
                  style={{ animation: "fadeIn 0.5s ease-in-out" }}
                >
                  {/* Bot avatar - Removed */}
                  
                  {/* Message content */}
                  {message.role === "user" ? (
                    // User message
                    <div className={`max-w-[85%] rounded-lg bg-gradient-to-br user-message ${getUserBgColor()}`}>
                      <div className="p-2 md:p-3 text-sm md:text-base">
                        {message.content}
                      </div>
                    </div>
                  ) : (
                    // Three-section assistant message
                    <div className="max-w-[85%] w-full space-y-3">
                      {/* 🆕 Show agent progress if message has agent_conversation */}
                      {message.agent_conversation && message.agent_conversation.length > 0 && (
                        <div className="w-full">
                          <AgentProgressIndicator 
                            updates={convertAgentConversationToUpdates(
                              message.agent_conversation, 
                              (message as any).is_processing || false,
                              message.tool_executions,
                              message.artifacts
                            )} 
                            isStreaming={(message as any).is_processing || false}
                          />
                        </div>
                      )}
                      
                      {/* Main response content */}
                      <div className={`rounded-lg overflow-hidden assistant-message ${
                        theme === 'dark' 
                          ? colorTheme === 'blue' ? 'border border-blue-700' 
                          : colorTheme === 'green' ? 'border border-green-700'
                          : colorTheme === 'purple' ? 'border border-purple-700'
                          : colorTheme === 'red' ? 'border border-red-700'
                          : colorTheme === 'orange' ? 'border border-orange-700'
                          : colorTheme === 'teal' ? 'border border-teal-700'
                          : colorTheme === 'pink' ? 'border border-pink-700'
                          : 'border border-gray-600'
                          : colorTheme === 'blue' ? 'border border-blue-300'
                          : colorTheme === 'green' ? 'border border-green-300'
                          : colorTheme === 'purple' ? 'border border-purple-300'
                          : colorTheme === 'red' ? 'border border-red-300'
                          : colorTheme === 'orange' ? 'border border-orange-300'
                          : colorTheme === 'teal' ? 'border border-teal-300'
                          : colorTheme === 'pink' ? 'border border-pink-300'
                          : 'border border-gray-300'
                      }`}>
                        {/* Main content section */}
                        <div className={`p-2 md:p-3 text-sm md:text-base ${
                          theme === 'dark' 
                            ? colorTheme === 'blue' ? 'bg-blue-900/80 text-white' 
                            : colorTheme === 'green' ? 'bg-green-900/80 text-white'
                            : colorTheme === 'purple' ? 'bg-purple-900/80 text-white'
                            : colorTheme === 'red' ? 'bg-red-900/80 text-white'
                            : colorTheme === 'orange' ? 'bg-orange-900/80 text-white'
                            : colorTheme === 'teal' ? 'bg-teal-900/80 text-white'
                            : colorTheme === 'pink' ? 'bg-pink-900/80 text-white'
                            : 'bg-[#1A2030] text-white'
                            : colorTheme === 'blue' ? 'bg-blue-900/20 text-gray-800'
                            : colorTheme === 'green' ? 'bg-green-900/20 text-gray-800'
                            : colorTheme === 'purple' ? 'bg-purple-900/20 text-gray-800'
                            : colorTheme === 'red' ? 'bg-red-900/20 text-gray-800'
                            : colorTheme === 'orange' ? 'bg-orange-900/20 text-gray-800'
                            : colorTheme === 'teal' ? 'bg-teal-900/20 text-gray-800'
                            : colorTheme === 'pink' ? 'bg-pink-900/20 text-gray-800'
                            : 'bg-white text-gray-800'
                        }`}>
                          {index === messages.length - 1 && isTyping ? (
                            <div
                              className="markdown-content"
                              dangerouslySetInnerHTML={{
                                __html: marked.parse(typingText || ''),
                              }}
                            />
                          ) : (
                            <div
                              className="markdown-content"
                              dangerouslySetInnerHTML={{
                                __html: marked.parse(message.content || '⏳ Loading...'),
                              }}
                            />
                          )}
                        </div>

                      {/* Enhanced response section - Collapsible */}
                      {message.enhanced_response && (
                        <div>
                          <button
                            onClick={() => toggleEnhancedSection(index)}
                            className={`w-full bg-gradient-to-br p-2 text-xs md:text-sm border-t flex items-center justify-between ${getEnhancedHeaderColor()}`}
                          >
                            <div className="flex items-center">
                              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                              <span className="font-medium">
                                Enhanced Analysis
                              </span>
                            </div>
                            {expandedEnhanced[index] ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>

                          {expandedEnhanced[index] && (
                            <div
                              className={`bg-gradient-to-br p-2 md:p-3 text-xs md:text-sm border-t max-h-40 overflow-y-auto ${getEnhancedHeaderColor()}`}
                              style={{ animation: "slideDown 0.3s ease forwards" }}
                            >
                              <div>
                                {message.enhanced_response}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Source references section - Collapsible */}
                      {message.metadata &&
                        message.metadata.matching_contents &&
                        message.metadata.matching_contents.length > 0 && (
                          <div>
                            <button
                              onClick={() => toggleMetadataSection(index)}
                              className={`w-full bg-gradient-to-br p-2 text-xs border-t flex items-center justify-between ${getSourceHeaderColor()}`}
                            >
                              <div className="flex items-center">
                                <Info className="w-3.5 h-3.5 mr-1.5" />
                                <span className="font-medium">
                                  Source References
                                </span>
                              </div>
                              {expandedMetadata[index] ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                            </button>

                            {expandedMetadata[index] && (
                              <div
                                className={`bg-gradient-to-br p-2 md:p-3 text-xs border-t max-h-40 overflow-y-auto ${getSourceHeaderColor()}`}
                                style={{
                                  animation: "slideDown 0.3s ease forwards",
                                }}
                              >
                                <div className="space-y-2">
                                  {message.metadata.matching_contents.map(
                                    (match: MatchingContent, idx: number) => (
                                      <div
                                        key={idx}
                                        className={`p-2 rounded-md hover:border-opacity-60 transition-colors ${
                                          theme === 'dark'
                                            ? 'bg-green-900/30 border border-green-700/40 hover:border-green-600/60'
                                            : 'bg-green-50 border border-green-200/60 hover:border-green-300/80'
                                        }`}
                                      >
                                        <div className="flex justify-between items-center mb-1">
                                          <span className={`text-xs font-medium ${
                                            theme === 'dark' ? 'text-green-200' : 'text-green-700'
                                          }`}>
                                            {match.source || "Source"}{" "}
                                            {match.observation_id
                                              ? `- Obs ID: ${match.observation_id}`
                                              : ""}
                                          </span>
                                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                                            theme === 'dark'
                                              ? 'bg-green-700/50 text-green-100'
                                              : 'bg-green-100 text-green-700'
                                          }`}>
                                            Score:{" "}
                                            {typeof match.score === "number"
                                              ? match.score.toFixed(3)
                                              : match.score}
                                          </span>
                                        </div>
                                        <p className={`text-xs italic ${
                                          theme === 'dark' ? 'text-green-100' : 'text-green-700'
                                        }`}>
                                          {match.text}
                                        </p>
                                      </div>
                                    )
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                      {/* Agent conversation section - Collapsible */}
                      {message.agent_conversation && 
                        message.agent_conversation.length > 0 && (
                          <div>
                            <button
                              onClick={() => toggleAgentConversationSection(index)}
                              className={`w-full bg-gradient-to-br p-2 text-xs md:text-sm border-t flex items-center justify-between ${
                                theme === 'dark'
                                  ? colorTheme === 'blue' ? 'bg-blue-800/50 text-blue-100 border-blue-700/50'
                                  : colorTheme === 'green' ? 'bg-green-800/50 text-green-100 border-green-700/50'
                                  : colorTheme === 'purple' ? 'bg-purple-800/50 text-purple-100 border-purple-700/50'
                                  : colorTheme === 'red' ? 'bg-red-800/50 text-red-100 border-red-700/50'
                                  : colorTheme === 'orange' ? 'bg-orange-800/50 text-orange-100 border-orange-700/50'
                                  : colorTheme === 'teal' ? 'bg-teal-800/50 text-teal-100 border-teal-700/50'
                                  : colorTheme === 'pink' ? 'bg-pink-800/50 text-pink-100 border-pink-700/50'
                                  : 'bg-purple-900/50 text-purple-100 border-purple-700/50'
                                  : colorTheme === 'blue' ? 'bg-blue-100/80 text-blue-800 border-blue-300/60'
                                  : colorTheme === 'green' ? 'bg-green-100/80 text-green-800 border-green-300/60'
                                  : colorTheme === 'purple' ? 'bg-purple-100/80 text-purple-800 border-purple-300/60'
                                  : colorTheme === 'red' ? 'bg-red-100/80 text-red-800 border-red-300/60'
                                  : colorTheme === 'orange' ? 'bg-orange-100/80 text-orange-800 border-orange-300/60'
                                  : colorTheme === 'teal' ? 'bg-teal-100/80 text-teal-800 border-teal-300/60'
                                  : colorTheme === 'pink' ? 'bg-pink-100/80 text-pink-800 border-pink-300/60'
                                  : 'bg-purple-50 text-purple-800 border-purple-300/60'
                              }`}
                            >
                              <div className="flex items-center">
                                <Users className="w-3.5 h-3.5 mr-1.5" />
                                <span className="font-medium">
                                  Agent Debate ({message.agent_conversation.length} exchanges)
                                </span>
                              </div>
                              {expandedAgentConversation[index] ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                            </button>

                            {expandedAgentConversation[index] && (
                              <div
                                className={`bg-gradient-to-br p-2 md:p-3 text-xs md:text-sm border-t max-h-60 overflow-y-auto ${
                                  theme === 'dark'
                                    ? colorTheme === 'blue' ? 'bg-blue-800/30 border-blue-700/50'
                                    : colorTheme === 'green' ? 'bg-green-800/30 border-green-700/50'
                                    : colorTheme === 'purple' ? 'bg-purple-800/30 border-purple-700/50'
                                    : colorTheme === 'red' ? 'bg-red-800/30 border-red-700/50'
                                    : colorTheme === 'orange' ? 'bg-orange-800/30 border-orange-700/50'
                                    : colorTheme === 'teal' ? 'bg-teal-800/30 border-teal-700/50'
                                    : colorTheme === 'pink' ? 'bg-pink-800/30 border-pink-700/50'
                                    : 'bg-purple-900/30 border-purple-700/50'
                                    : colorTheme === 'blue' ? 'bg-blue-100/60 border-blue-300/60'
                                    : colorTheme === 'green' ? 'bg-green-100/60 border-green-300/60'
                                    : colorTheme === 'purple' ? 'bg-purple-100/60 border-purple-300/60'
                                    : colorTheme === 'red' ? 'bg-red-100/60 border-red-300/60'
                                    : colorTheme === 'orange' ? 'bg-orange-100/60 border-orange-300/60'
                                    : colorTheme === 'teal' ? 'bg-teal-100/60 border-teal-300/60'
                                    : colorTheme === 'pink' ? 'bg-pink-100/60 border-pink-300/60'
                                    : 'bg-purple-50/80 border-purple-300/60'
                                }`}
                                style={{ animation: "slideDown 0.3s ease forwards" }}
                              >
                                <div className="space-y-2">
                                  {message.agent_conversation.map((exchange: any, idx: number) => {
                                    const exchangeKey = `${index}-${idx}`;
                                    const isExpanded = expandedExchanges[exchangeKey];
                                    const shouldTruncate = exchange.content.length > 300;
                                    
                                    return (
                                      <div
                                        key={idx}
                                        className={`p-2 rounded-md ${
                                          exchange.action === 'tool_call'
                                            ? theme === 'dark'
                                              ? 'bg-yellow-900/40 border border-yellow-700/40'
                                              : 'bg-yellow-50 border border-yellow-200/60'
                                            : exchange.action === 'summary'
                                              ? theme === 'dark'
                                                ? 'bg-gray-800/40 border border-gray-600/40'
                                                : 'bg-gray-50 border border-gray-200/60'
                                              : theme === 'dark'
                                                ? 'bg-blue-900/40 border border-blue-700/40'
                                                : 'bg-blue-50 border border-blue-200/60'
                                        }`}
                                      >
                                        <div className="flex justify-between items-center mb-1">
                                          <span className={`text-xs font-medium ${
                                            exchange.action === 'tool_call'
                                              ? theme === 'dark' ? 'text-yellow-200' : 'text-yellow-700'
                                              : exchange.action === 'summary'
                                                ? theme === 'dark' ? 'text-gray-200' : 'text-gray-700'
                                                : theme === 'dark' ? 'text-blue-200' : 'text-blue-700'
                                          }`}>
                                            {exchange.agent}
                                          </span>
                                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                                            exchange.action === 'tool_call'
                                              ? theme === 'dark'
                                                ? 'bg-yellow-700/50 text-yellow-100'
                                                : 'bg-yellow-100 text-yellow-700'
                                              : exchange.action === 'summary'
                                                ? theme === 'dark'
                                                  ? 'bg-gray-700/50 text-gray-100'
                                                  : 'bg-gray-100 text-gray-700'
                                                : theme === 'dark'
                                                  ? 'bg-blue-700/50 text-blue-100'
                                                  : 'bg-blue-100 text-blue-700'
                                          }`}>
                                            {exchange.action}
                                          </span>
                                          {exchange.model && (
                                            <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                                              exchange.action === 'tool_call'
                                                ? theme === 'dark' ? 'bg-yellow-700/30 text-yellow-100' : 'bg-yellow-50 text-yellow-700'
                                                : exchange.action === 'summary'
                                                  ? theme === 'dark' ? 'bg-gray-700/30 text-gray-100' : 'bg-gray-100 text-gray-700'
                                                  : theme === 'dark' ? 'bg-blue-700/30 text-blue-100' : 'bg-blue-100 text-blue-700'
                                            }`}>
                                              {exchange.model}
                                            </span>
                                          )}
                                        </div>
                                        <div>
                                          <p className={`text-xs whitespace-pre-wrap ${
                                            exchange.action === 'tool_call'
                                              ? theme === 'dark' ? 'text-yellow-100' : 'text-yellow-700'
                                              : exchange.action === 'summary'
                                                ? theme === 'dark' ? 'text-gray-100' : 'text-gray-700'
                                                : theme === 'dark' ? 'text-blue-100' : 'text-blue-700'
                                          }`}>
                                            {shouldTruncate && !isExpanded
                                              ? `${exchange.content.substring(0, 300)}...`
                                              : exchange.content}
                                          </p>
                                          {shouldTruncate && (
                                            <button
                                              onClick={() => toggleExchangeExpansion(index, idx)}
                                              className={`mt-1 text-xs underline hover:no-underline ${
                                                exchange.action === 'tool_call'
                                                  ? theme === 'dark' ? 'text-yellow-300' : 'text-yellow-600'
                                                  : exchange.action === 'summary'
                                                    ? theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                                                    : theme === 'dark' ? 'text-blue-300' : 'text-blue-600'
                                              }`}
                                            >
                                              {isExpanded ? 'Show less' : 'Show more'}
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                    </div>
                  
                  {/* Feedback Button for Assistant Messages - Only show for saved messages */}
                  {message.role === "assistant" && currentThread && currentThread.messages && (
                    (() => {
                      // Find corresponding history message by content and type
                      const historyMessage = currentThread.messages.find(hMsg => 
                        hMsg.message_type === 'assistant' && 
                        hMsg.assistant_response?.final_content === message.content
                      );
                      
                      return historyMessage ? (
                        <div className="mt-2 flex justify-end">
                          <FeedbackButton
                            message={historyMessage}
                            threadId={currentThread._id}
                            sourceContext={{
                              obsid: selectedObject ? String(selectedObject.obsid || selectedObject._id || '') : null,
                              source_name: selectedObject ? String(selectedObject.source_name || selectedObject.name || '') : null,
                              source_type: selectedObject ? String(selectedObject.source_type || '') : null
                            }}
                            allMessages={currentThread.messages}
                          />
                        </div>
                      ) : null;
                    })()
                  )}
                    </div>
                  )}

                  {/* User avatar */}
                  {message.role === "user" && (
                    <div className={`w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center flex-shrink-0 border ${
                      theme === 'dark' 
                        ? colorTheme === 'blue' ? 'bg-blue-900 border-blue-700' 
                        : colorTheme === 'green' ? 'bg-green-900 border-green-700'
                        : colorTheme === 'purple' ? 'bg-purple-900 border-purple-700'
                        : colorTheme === 'red' ? 'bg-red-900 border-red-700'
                        : colorTheme === 'orange' ? 'bg-orange-900 border-orange-700'
                        : colorTheme === 'teal' ? 'bg-teal-900 border-teal-700'
                        : colorTheme === 'pink' ? 'bg-pink-900 border-pink-700'
                        : 'bg-[#1A2030] border-gray-600'
                        : colorTheme === 'blue' ? 'bg-blue-100 border-blue-300'
                        : colorTheme === 'green' ? 'bg-green-100 border-green-300'
                        : colorTheme === 'purple' ? 'bg-purple-100 border-purple-300'
                        : colorTheme === 'red' ? 'bg-red-100 border-red-300'
                        : colorTheme === 'orange' ? 'bg-orange-100 border-orange-300'
                        : colorTheme === 'teal' ? 'bg-teal-100 border-teal-300'
                        : colorTheme === 'pink' ? 'bg-pink-100 border-pink-300'
                        : 'bg-white border-gray-300'
                    }`}>
                      <User className={`w-4 h-4 md:w-5 md:h-5 ${
                        theme === 'dark' 
                          ? colorTheme === 'blue' ? 'text-blue-300' 
                          : colorTheme === 'green' ? 'text-green-300'
                          : colorTheme === 'purple' ? 'text-purple-300'
                          : colorTheme === 'red' ? 'text-red-300'
                          : colorTheme === 'orange' ? 'text-orange-300'
                          : colorTheme === 'teal' ? 'text-teal-300'
                          : colorTheme === 'pink' ? 'text-pink-300'
                          : 'text-blue-400'
                          : colorTheme === 'blue' ? 'text-blue-600'
                          : colorTheme === 'green' ? 'text-green-600'
                          : colorTheme === 'purple' ? 'text-purple-600'
                          : colorTheme === 'red' ? 'text-red-600'
                          : colorTheme === 'orange' ? 'text-orange-600'
                          : colorTheme === 'teal' ? 'text-teal-600'
                          : colorTheme === 'pink' ? 'text-pink-600'
                          : 'text-blue-500'
                      }`} />
                    </div>
                  )}
                </div>
              ))
            )}

            {isLoading && (
              <div className="flex justify-start space-x-2 md:space-x-3">
                <div className={`rounded-lg p-3 md:p-5 max-w-[85%] ${
                  theme === 'dark' 
                    ? colorTheme === 'blue' ? 'bg-blue-900/80 border border-blue-700' 
                    : colorTheme === 'green' ? 'bg-green-900/80 border border-green-700'
                    : colorTheme === 'purple' ? 'bg-purple-900/80 border border-purple-700'
                    : colorTheme === 'red' ? 'bg-red-900/80 border border-red-700'
                    : colorTheme === 'orange' ? 'bg-orange-900/80 border border-orange-700'
                    : colorTheme === 'teal' ? 'bg-teal-900/80 border border-teal-700'
                    : colorTheme === 'pink' ? 'bg-pink-900/80 border border-pink-700'
                    : 'bg-gradient-to-br from-[#1A2030]/90 to-[#0A1020]/90 border border-gray-600'
                    : colorTheme === 'blue' ? 'bg-blue-50 border border-blue-300'
                    : colorTheme === 'green' ? 'bg-green-50 border border-green-300'
                    : colorTheme === 'purple' ? 'bg-purple-50 border border-purple-300'
                    : colorTheme === 'red' ? 'bg-red-50 border border-red-300'
                    : colorTheme === 'orange' ? 'bg-orange-50 border border-orange-300'
                    : colorTheme === 'teal' ? 'bg-teal-50 border border-teal-300'
                    : colorTheme === 'pink' ? 'bg-pink-50 border border-pink-300'
                    : 'bg-gradient-to-br from-gray-100 to-white border border-gray-300'
                }`}>
                  {/* Animated atom */}
                  <div className="relative h-12 w-12 mx-auto mt-2">
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ animation: "atomPulse 3s infinite ease-in-out" }}
                    >
                      <Atom className={`w-8 h-8 ${getLoadingIndicatorColors()}`} />
                    </div>
                    {/* Electron orbits */}
                    <div
                      className={`absolute inset-0 rounded-full border ${getElectronOrbitColors().first}`}
                      style={{ animation: "electronOrbit 4s infinite linear" }}
                    ></div>
                    <div
                      className={`absolute inset-0 rounded-full border rotate-45 ${getElectronOrbitColors().second}`}
                      style={{
                        animation: "electronOrbit 3s infinite linear reverse",
                      }}
                    ></div>
                    <div
                      className={`absolute inset-0 rounded-full border rotate-90 ${getElectronOrbitColors().third}`}
                      style={{ animation: "electronOrbit 5s infinite linear" }}
                    ></div>
                  </div>
                  <div className={`text-xs text-center mt-2 md:mt-3 ${
                    theme === 'dark' ? 'text-blue-200' : 'text-[#2957D8]'
                  }`}>
                    AstroMind is working...
                  </div>
                </div>
              </div>
            )}

            {/* Agent Progress Indicator for Multi-Agent Streaming */}
            {/* Only show during active streaming - once complete, progress is shown in message */}
            {isStreaming && (
              <div className="mb-4">
                <AgentProgressIndicator 
                  updates={streamingUpdates} 
                  isStreaming={isStreaming} 
                />
              </div>
            )}

            {/* Reference to scroll to bottom */}
            <div ref={messagesEndRef} />

            {/* Validation Modal */}
            <Modal
              isOpen={showValidationModal}
              onClose={() => setShowValidationModal(false)}
              title="Answer Validation"
              theme={theme}
            >
              <div className={`prose max-w-none ${
                theme === 'dark' ? 'prose-invert text-white' : 'text-gray-800'
              }`}>
                {validationResult ? (
                  <div
                    dangerouslySetInnerHTML={{
                      __html: marked.parse(validationResult),
                    }}
                  />
                ) : (
                  <p>No validation results available.</p>
                )}
              </div>
            </Modal>
          </div>

          {/* Input and Controls - Fixed height at bottom */}
          <div className={`p-2 md:p-4 border-t space-y-2 md:space-y-4 backdrop-blur-sm flex-shrink-0 ${
            theme === 'dark' 
              ? 'border-gray-700/60 bg-[#2A3040]/40' 
              : 'border-gray-200/60 bg-gray-100/40'
          }`}>
            {/* Model Selection - Desktop Only */}
            {!isMobileView && (
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <label className={`block text-xs font-medium ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                  }`}>
                    Model
                  </label>
                  {/* Agent Settings - Only show for multi-agent model */}
                  {selectedModel === 'astromind-multi-agent' && (
                    <AgentSettings 
                      value={agentConfig} 
                      onChange={setAgentConfig}
                    />
                  )}
                </div>
                <div className="relative">
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className={`w-full rounded-md py-1.5 px-3 text-sm font-medium border focus:outline-none appearance-none cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      theme === 'dark' 
                        ? 'bg-[#2A3040] text-gray-100 border-gray-600/50 focus:border-[#00E0FF] focus:ring-1 focus:ring-[#00E0FF]/30' 
                        : 'bg-white text-gray-800 border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30'
                    }`}
                    disabled={loading.chat || isLoading}
                  >
                    {MODEL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  {selectedModel === 'astromind-multi-agent' && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2" ref={openaiMenuRef}>
                      <button
                        type="button"
                        title={`OpenAI model: ${openaiModel}`}
                        onClick={() => setShowOpenaiModelMenu((v) => !v)}
                        className={`${
                          theme === 'dark'
                            ? 'text-gray-200 bg-gray-800 hover:bg-gray-700 border border-gray-700'
                            : 'text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-300'
                        } px-2 py-1 rounded flex items-center space-x-1`}
                      >
                        <span className="text-xs font-medium">{openaiModel}</span>
                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd"/></svg>
                      </button>
                      {showOpenaiModelMenu && (
                        <div
                          className={`absolute z-10 right-0 w-56 rounded-md shadow-lg border ${
                            theme === 'dark' ? 'bg-[#0D0C22] border-gray-700' : 'bg-white border-gray-200'
                          }`}
                          style={{ bottom: 'calc(100% + 8px)' }}
                        >
                          {[
                            { key: 'gpt-5', label: 'gpt-5', hint: 'Highest quality and reasoning; slower responses' },
                            { key: 'gpt-5-mini', label: 'gpt-5-mini', hint: 'Balanced quality and speed; good default' },
                            { key: 'gpt-5-nano', label: 'gpt-5-nano', hint: 'Fastest and lowest cost; brief answers' },
                          ].map((opt) => (
                            <button
                              key={opt.key}
                              title={opt.hint}
                              onClick={() => {
                                setOpenaiModel(opt.key);
                                setShowOpenaiModelMenu(false);
                              }}
                              className={`w-full text-left px-3 py-2 text-sm ${
                                theme === 'dark'
                                  ? (openaiModel === opt.key ? 'bg-gray-700 text-white' : 'text-gray-200 hover:bg-gray-800')
                                  : (openaiModel === opt.key ? 'bg-gray-100 text-gray-800' : 'text-gray-700 hover:bg-gray-100')
                              }`}
                            >
                              <div className="flex flex-col">
                                <span className="font-medium">{opt.label}</span>
                                <span className={`${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'} text-xs`}>{opt.hint}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Message Input */}
            <form onSubmit={handleSubmit} className="flex space-x-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  isCustomEventMode
                    ? customEventListData
                      ? `Ask about event data from ${customEventListData.name || 'uploaded source'}...`
                      : "Upload a .pkl file to start chatting"
                    : selectedObject
                      ? hasObjectDetails
                        ? "Ask about this object..."
                        : "Waiting for object details to load..."
                      : "Please select a dataset object to start chatting"
                }
                disabled={(isCustomEventMode && !customEventListData) ||
                          (!isCustomEventMode && (!selectedObject || !hasObjectDetails)) ||
                          isLoading}
                className={`flex-1 rounded-md px-3 md:px-4 py-2 md:py-2.5 text-sm border focus:outline-none focus:ring-1 disabled:opacity-50 disabled:cursor-not-allowed ${
                  theme === 'dark' 
                    ? 'bg-[#1A2030] text-white placeholder-gray-400 border-gray-600/50 focus:border-[#00E0FF] focus:ring-1 focus:ring-[#00E0FF]/30' 
                    : 'bg-white text-gray-800 placeholder-gray-500 border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30'
                }`}
              />

              <button
                type="submit"
                disabled={
                  !input.trim() ||
                  isLoading ||
                  (isCustomEventMode ? !customEventListData : (!selectedObject || !hasObjectDetails))
                }
                className={`flex items-center justify-center w-9 h-9 md:w-10 md:h-10 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors hover:opacity-90 ${
                  theme === 'dark'
                    ? 'bg-gradient-to-r from-[#00E0FF] to-blue-400 text-[#0D0C22]'
                    : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
                }`}
              >
                <Send className="w-4 h-4 md:w-5 md:h-5" />
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}