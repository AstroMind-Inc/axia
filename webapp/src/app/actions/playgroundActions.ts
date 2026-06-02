// app/actions/playgroundActions.ts
import { Message } from '@/app/types/chat';
import { MODEL_OPTIONS } from '@/app/constants/models';

// Type Definitions
export interface DataObject {
    // Core identification fields
    _id: string;
    obsid: number;
    source_name: string;
    id?: string;
    type?: string | null;

    // Event data
    event_list?: number[][];           // Array of numbers for event data

    // Coordinates
    ra?: number;                     // Right Ascension
    dec?: number;                    // Declination
    theta?: number;                  // Angular distance from pointing

    // Embeddings and model features
    embedding?: number[];            // Vector embedding of object data
    latents?: number[];              // Latent space representation
    umap_2d?: number[];              // UMAP 2D coordinates [x, y]

    // Source classification
    source_type?: string;            // Object type (QSO, STAR, etc.)
    match_type?: string;             // Match type identifier
    is_garbage?: boolean;            // Flag for invalid sources

    // Observation metadata
    obi?: number;                    // Observation interval ID
    region_id?: number;              // Source region ID
    gti_mjd_obs?: number;            // Observation time (MJD)

    // Photometry
    src_cnts_aper_b?: number;        // Source counts in aperture (band B)
    flux_significance_b?: number;    // Flux significance (band B)
    flux_aper_b?: number;            // Aperture flux (band B)
    flux_bb_aper_b?: number;         // Blackbody aperture flux (band B)

    // Hardness ratios
    hard_hm?: number;                // Hardness ratio (hard/medium)
    hard_hs?: number;                // Hardness ratio (hard/soft)
    hard_ms?: number;                // Hardness ratio (medium/soft)

    // Variability metrics
    var_prob_b?: number;             // Variability probability (band B)
    var_index_b?: number;            // Variability index (band B)

    // Spectral statistics
    powlaw_stat?: number;            // Power law fit statistic
    apec_stat?: number;              // APEC fit statistic
    brems_stat?: number;             // Bremsstrahlung fit statistic
    bb_stat?: number;                // Blackbody fit statistic

    // Spectral model parameters
    powlaw_nh?: number;             // Power law hydrogen column density
    powlaw_gamma?: number;          // Power law photon index
    bb_nh?: number;                 // Blackbody hydrogen column density
    bb_kt?: number;                 // Blackbody temperature (keV)
    brems_kt?: number;              // Bremsstrahlung temperature (keV)
    apec_kt?: number;               // APEC temperature (keV)
    apec_nh?: number;               // APEC hydrogen column density

    // Power law model parameters
    powlaw_gamma_lolim?: number;     // Power law gamma lower limit
    powlaw_gamma_hilim?: number;     // Power law gamma upper limit
    powerlaw_gamma_low?: number;     // Power law gamma lower value
    powerlaw_gamma_high?: number;    // Power law gamma upper value

    // Source classification results
    thermal_classification?: string; // Thermal or non-thermal classification
    recommended_model?: string;      // Best-fit spectral model

    // Other astronomical properties
    z?: number;                      // Redshift
    flux?: number;                   // Overall flux

    // Textual data
    answer?: string;                 // Text summary/answer about the source
    qna?: Array<{                    // Q&A pairs about the source
        question: string;
        answer: string;
    }>;
    extended_qna?: Array<Array<{     // Nested extended Q&A
        question: string;
        answer: string;
    }>>;

    // Allow additional properties with string keys and unknown type
    [key: string]: unknown;
}

export interface Dataset {
    _id: string;
    file_name: string;
    collection_name: string;
    upload_date: Date;
    object_count: number;
}

export interface ObjectDetails extends DataObject {
    source_type: string;
    powlaw_stat: number;
    apec_stat: number;
    brems_stat: number;
    bb_stat: number;
    thermal_classification: string;
    recommended_model: string;
}

interface DatasetObjectsResponse {
    objects: DataObject[];
    total_count: number;
    success?: boolean;
}

// Define the type for matching text in chat metadata
export interface MatchingText {
    text: string;
    score: number;
    source?: string;
}

export interface ChatMetadata {
    matching_texts: MatchingText[];
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    metadata?: ChatMetadata;
    enhanced_response?: string;
    timestamp?: string;
}

interface ChatResponseData {
  fine_tune_model_response: string;
  enhanced_response?: string;
  meta_data?: {
    matching_texts: Array<{
      text: string;
      score: number;
      source: string;
      observation_id: string;
    }>;
  };
}

// Type for metadata in createMessage function
export type MessageMetadata = {
  matching_contents?: Array<{
    text: string;
    score: number;
    source: string;
    observation_id: string;
    metadata?: Record<string, unknown>;
  }>;
  [key: string]: unknown;
};

export function createMessage(
  role: 'user' | 'assistant',
  content: string,
  metadata?: MessageMetadata,
  enhanced_response?: string,
  agent_conversation?: any[],
  tool_executions?: any[],
  artifacts?: any[]
): Message {
  return {
    role,
    content,
    metadata,
    enhanced_response,
    agent_conversation,
    tool_executions,
    artifacts,
    timestamp: new Date().toISOString(),
  };
}

export interface SendChatMessageParams {
  message: string;
  history: Message[];
  model: string;
  model_api_url: string|null;
  response_format: string;
  openai_model?: string | null;
  embeddings?: number[]|null;
  event_list?: number[][]|null; // Added event_list parameter
  data_obj?: DataObject|null; // Added data_obj parameter for astromind-openai model
  neighbors?: NearestNeighbor[]|null; // Added neighbors parameter for multi-agent analysis
  contextSettings?: {
    enabled: boolean;
    selectedFields: string[];
    dataset: string;
  };
  thread_id?: string | null; // Added thread_id for database saving
  agent_config?: {
    eventAnalyst: boolean;
    metadataAnalyst: boolean;
    neighborAnalyst: boolean;
    critic: boolean;
    toolAgent: boolean;
  };
}

// Type for request payload
interface ChatRequestPayload {
  message: string;
  history: Message[];
  model: string;
  openai_model?: string;
  model_api_url?: string;
  response_format: string;
  context_settings?: {
    enabled: boolean;
    selectedFields: string[];
    dataset: string;
  };
  embedding?: number[];
  event_list?: number[][];
  data_obj?: DataObject;
  neighbors?: NearestNeighbor[];
  thread_id?: string; // Added thread_id for database saving
  agent_config?: {
    eventAnalyst: boolean;
    metadataAnalyst: boolean;
    neighborAnalyst: boolean;
    critic: boolean;
    toolAgent: boolean;
  };
}

export async function sendChatMessage({
  message,
  history,
  model,
  model_api_url,
  response_format,
  openai_model,
  embeddings,
  event_list, // Added event_list parameter
  data_obj, // Added data_obj parameter
  neighbors, // Added neighbors parameter
  contextSettings,
  thread_id, // Added thread_id parameter
}: SendChatMessageParams): Promise<Message> {
  try {
    // Prepare the payload
    const payload: ChatRequestPayload = {
      message,
      history,
      model,
      response_format,
    };

    // Add model_api_url if present
    if (model_api_url) {
      payload.model_api_url = model_api_url;
    }

    // Add openai_model if present (for multi-agent workflow)
    if (openai_model) {
      payload.openai_model = openai_model;
    }

    // Add thread_id if present
    if (thread_id) {
      payload.thread_id = thread_id;
    }

    // Add context settings if present
    if (contextSettings) {
      payload.context_settings = contextSettings;
    }

    // Add the appropriate data based on model type
    if (model === "astromind-openai") {
      // For astromind-openai model, send the entire data object
      if (data_obj) {
        payload.data_obj = data_obj;
      }
    } else if (model === "astromind-multi-agent") {
      // For multi-agent model, send data object, event list, and neighbors
      if (data_obj) {
        payload.data_obj = data_obj;
      }
      if (event_list) {
        payload.event_list = event_list;
      }
      if (neighbors) {
        console.log("🔍 Debug - Adding neighbors to payload:", {
          neighborsCount: neighbors.length,
          firstNeighbor: neighbors[0] ? {
            id: neighbors[0]._id,
            obsid: neighbors[0].obsid,
            source_name: neighbors[0].source_name
          } : null
        });
        payload.neighbors = neighbors;
      } else {
        console.log("🔍 Debug - No neighbors to add to payload");
      }
    } else if (model === "qwen-7b-raw-xray-event") {
      if (event_list) {
        payload.event_list = event_list;
      }
    } else if (embeddings) {
      payload.embedding = embeddings;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200000); // 20 minute timeout for multi-agent workflows

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
        signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.json();
      throw new APIError(
        error.message || "Failed to get chat response",
        response.status,
        error.code
      );
    }

    const data = await response.json();

    // Create message with metadata if available
    const assistantMessage = createMessage(
      'assistant',
      data.fine_tune_model_response,
      data.meta_data,
      undefined,
      data.agent_conversation
    );

    return assistantMessage;
  } catch (error) {
    console.error('Error sending chat message:', error);
    throw error;
  }
}

/**
 * Streaming chat message for multi-agent workflow
 * Only supports astromind-multi-agent model
 */
export async function* sendStreamingChatMessage({
  message,
  history,
  model,
  model_api_url,
  response_format,
  openai_model,
  embeddings,
  event_list,
  data_obj,
  neighbors,
  contextSettings,
  thread_id, // Added thread_id parameter
  agent_config, // Added agent_config parameter
}: SendChatMessageParams): AsyncGenerator<StreamingUpdate, void, unknown> {
  try {
    // Only support streaming for multi-agent model
    if (model !== "astromind-multi-agent") {
      throw new Error("Streaming is only supported for astromind-multi-agent model");
    }

    // Prepare the payload (same as non-streaming version)
    const payload: ChatRequestPayload = {
      message,
      history,
      model,
      response_format,
    };

    // Add model_api_url if present
    if (model_api_url) {
      payload.model_api_url = model_api_url;
    }

    if (openai_model) {
      payload.openai_model = openai_model;
    }

    // Add thread_id if present
    console.log('🔍 [sendStreamingChatMessage] thread_id received:', thread_id);
    console.log('🔍 [sendStreamingChatMessage] thread_id type:', typeof thread_id);
    if (thread_id) {
      payload.thread_id = thread_id;
      console.log('✅ [sendStreamingChatMessage] Added thread_id to payload:', thread_id);
    } else {
      console.warn('⚠️ [sendStreamingChatMessage] thread_id is falsy, not adding to payload');
    }

    // Add context settings if present
    if (contextSettings) {
      payload.context_settings = contextSettings;
    }

    // Add data for multi-agent model
    if (data_obj) {
      payload.data_obj = data_obj;
    }
    if (event_list) {
      payload.event_list = event_list;
    }
    if (neighbors) {
      console.log("🔍 Debug - Adding neighbors to streaming payload:", {
        neighborsCount: neighbors.length,
        firstNeighbor: neighbors[0] ? {
          id: neighbors[0]._id,
          obsid: neighbors[0].obsid,
          source_name: neighbors[0].source_name
        } : null
      });
      payload.neighbors = neighbors;
    }

    // Add agent configuration if present
    if (agent_config) {
      payload.agent_config = agent_config;
      console.log("🔧 Adding agent configuration to payload:", agent_config);
    }

    // Use the streaming endpoint
    console.log('🚀 Starting streaming request to /api/chat/stream');
    console.log('📦 Streaming payload:', { 
      message: payload.message.slice(0, 50) + '...', 
      model: payload.model,
      hasDataObj: !!payload.data_obj,
      hasEventList: !!payload.event_list,
      hasNeighbors: !!payload.neighbors,
      thread_id: payload.thread_id,  // ← ADD THIS
      hasThreadId: !!payload.thread_id  // ← AND THIS
    });
    console.log('🔍 Full payload keys:', Object.keys(payload));
    
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    console.log('📡 Streaming response received:', response.status, response.statusText);

    if (!response.ok) {
      console.error('🚨 Streaming response not OK:', response.status, response.statusText);
      
      // Try to get error details, but handle both JSON and non-JSON responses
      let errorMessage = `Failed to start streaming chat (${response.status})`;
      let errorCode = 'unknown';
      
      try {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const error = await response.json();
          errorMessage = error.message || errorMessage;
          errorCode = error.code || errorCode;
        } else {
          // Response is not JSON (probably HTML error page)
          const errorText = await response.text();
          console.error('🚨 Non-JSON error response:', errorText.slice(0, 200));
          errorMessage = `Server error: ${response.statusText}`;
        }
      } catch (parseError) {
        console.error('🚨 Error parsing error response:', parseError);
        errorMessage = `Network error: ${response.statusText}`;
      }
      
      throw new APIError(errorMessage, response.status, errorCode);
    }

    // Process the streaming response
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error("No readable stream available");
    }

    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        
        if (done) {
          break;
        }

        // Decode the chunk and add to buffer
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonData = line.slice(6).trim();
              if (jsonData) {
                const update = JSON.parse(jsonData);
                
                // Yield the streaming update
                yield update;
                
                // Break if we receive completion or error
                if (update.type === 'complete' || update.type === 'error') {
                  return;
                }
              }
            } catch (parseError) {
              console.warn('Failed to parse streaming data:', parseError);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

  } catch (error) {
    console.error('Error in streaming chat message:', error);
    yield {
      type: 'error',
      message: `Streaming failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Type definition for streaming updates
export interface StreamingUpdate {
  type: 'start' | 'progress' | 'result' | 'final' | 'complete' | 'error' | 'artifact';
  agent?: string;
  step?: number;
  status?: string;
  message?: string;
  content?: string;
  full_result?: any;
  error?: string;
  total_steps?: number;
  artifact?: {
    type: string;
    name: string;
    description?: string;
    data: any;
    format: string;
  };
  tool_executions?: any[];
  artifacts?: any[];
}

/**
 * Checks if a model requires event_list data
 * @param modelName The name of the model
 * @returns boolean indicating if the model needs event_list data
 */
export function modelRequiresEventList(modelName: string): boolean {
  // Use the supports_event_list flag from the model definition
  const model = MODEL_OPTIONS.find(m => m.value === modelName);
  return model?.supports_event_list || false;
}

/**
 * Checks if an object has valid event list data
 * @param obj The data object to check
 * @returns boolean indicating if event_list data is present and valid
 */
export function hasValidEventList(obj: DataObject | null | undefined): boolean {
  if (!obj) return false;

  // Check if event_list exists and is an array
  if (!('event_list' in obj) || !Array.isArray(obj.event_list)) {
    return false;
  }

  // Check if the event_list has data
  return obj.event_list.length > 0;
}

// API Error Class
export class APIError extends Error {
    constructor(
        message: string,
        public status?: number,
        public code?: string
    ) {
        super(message);
        this.name = 'APIError';
    }
}

// Dataset Management Functions
export async function loadAvailableDatasets(): Promise<Dataset[]> {
    try {
        const response = await fetch('/api/datasets', {
            headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
            const error = await response.json();
            throw new APIError(
                error.message || 'Failed to fetch datasets',
                response.status,
                error.code
            );
        }

        const data = await response.json();
        return data.datasets;
    } catch (error) {
        if (error instanceof APIError) throw error;
        throw new APIError('Failed to load datasets', 500);
    }
}

export async function loadDatasetObjects(
    collectionName: string,
    skip: number = 0,
    limit: number = 20
  ): Promise<DatasetObjectsResponse> {
    try {
      // Use the updated API route with pagination parameters
      const response = await fetch(
        `/api/datasets/${encodeURIComponent(collectionName)}/objects?skip=${skip}&limit=${limit}`,
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new APIError(
          error.message || 'Failed to fetch dataset objects',
          response.status,
          error.code
        );
      }

      const data = await response.json();
      // Return the entire response so we can access the total_count
      return {
        objects: data.objects,
        total_count: data.total_count || data.objects.length
      };
    } catch (error) {
      if (error instanceof APIError) throw error;
      throw new APIError('Failed to load dataset objects', 500);
    }
}


// Object Details Management
export async function loadObjectDetails(params: {
    collection_name: string;
    object_id: string;
}): Promise<ObjectDetails> {
    try {
        const response = await fetch('/api/object-details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new APIError(
                error.message || 'Failed to fetch object details',
                response.status,
                error.code
            );
        }

        return response.json();
    } catch (error) {
        if (error instanceof APIError) throw error;
        throw new APIError('Failed to load object details', 500);
    }
}

// Enhanced Object Details with Light Curve
export async function loadEnhancedObjectDetails(params: {
    object_data: any;
}): Promise<import('../types/chat').EnhancedObjectDetails> {
    try {
        const response = await fetch('/api/object-details-enhanced', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new APIError(
                error.error || 'Failed to process enhanced object details',
                response.status,
                error.code
            );
        }

        return response.json();
    } catch (error) {
        if (error instanceof APIError) throw error;
        throw new APIError('Failed to load enhanced object details', 500);
    }
}

// Helper Functions
export function handleApiError(error: unknown): {
    message: string;
    status?: number;
    code?: string;
} {
    if (error instanceof APIError) {
        return {
            message: error.message,
            status: error.status,
            code: error.code,
        };
    }
    if (error instanceof Error) {
        return { message: error.message };
    }
    return { message: 'An unexpected error occurred' };
}

// UMAP Data Management
export interface UmapDataObject {
    _id: string;
    umap_2d: number[];
    obsid: number;
    source_name: string;
    
    // Hardness ratios
    hard_hs?: number;
    hard_hm?: number;
    hard_ms?: number;
    
    // Numerical features
    flux_significance_b?: number;
    var_index_b?: number;
    bb_kt?: number;
    powlaw_gamma?: number;
    powlaw_stat?: number;
    bb_stat?: number;
    brems_stat?: number;
    apec_stat?: number;
    powlaw_nh?: number;
    apec_nh?: number;
    bb_nh?: number;
    brems_kt?: number;
    
    // Categorical features
    source_type?: string;
    source_type_category?: string;
    recommended_model?: string;
}

export interface UmapDataResponse {
    objects: UmapDataObject[];
    total_count: number;
}

export interface NearestNeighbor {
    _id: string;
    obsid: number;
    source_name: string;
    source_type?: string;
    source_type_category?: string;
    umap_2d?: number[];
    
    // Spectral properties
    hard_hs?: number;
    hard_hm?: number;
    hard_ms?: number;
    flux_significance_b?: number;
    var_index_b?: number;
    bb_kt?: number;
    powlaw_gamma?: number;
    powlaw_stat?: number;
    bb_stat?: number;
    brems_stat?: number;
    apec_stat?: number;
    powlaw_nh?: number;
    apec_nh?: number;
    bb_nh?: number;
    brems_kt?: number;
    recommended_model?: string;
    
    // Similarity score from vector search
    score: number;
    
    // Event list data (needed for backend neighbor analysis)
    event_list?: number[][];
    
    // Note: Light curve computed on-demand via enhanced details API
}

export interface NearestNeighborsResponse {
    neighbors: NearestNeighbor[];
    totalFound: number;
}

export async function loadUmapData(
    collectionName: string, 
    selectedObjectId?: string
): Promise<UmapDataResponse> {
    try {
        const url = `/api/datasets/${encodeURIComponent(collectionName)}/umap-data${
            selectedObjectId ? `?includeObject=${encodeURIComponent(selectedObjectId)}` : ''
        }`;
        
        const response = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
            const error = await response.json();
            throw new APIError(
                error.message || 'Failed to fetch UMAP data',
                response.status,
                error.code
            );
        }

        const data = await response.json();
        return {
            objects: data.objects,
            total_count: data.total_count || data.objects.length
        };
    } catch (error) {
        if (error instanceof APIError) throw error;
        throw new APIError('Failed to load UMAP data', 500);
    }
}

export async function loadNearestNeighbors(
    collectionName: string,
    objectId: string
): Promise<NearestNeighborsResponse> {
    try {
        const url = `/api/datasets/${encodeURIComponent(collectionName)}/nearest-neighbors?objectId=${encodeURIComponent(objectId)}`;
        
        const response = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
            const error = await response.json();
            throw new APIError(
                error.message || 'Failed to fetch nearest neighbors',
                response.status,
                error.code
            );
        }

        const data = await response.json();
        return {
            neighbors: data.neighbors || [],
            totalFound: data.totalFound || 0
        };
    } catch (error) {
        if (error instanceof APIError) throw error;
        throw new APIError('Failed to load nearest neighbors', 500);
    }
}