// app/types/chat.ts
export interface MatchingContent {
  text: string;
  score: number;
  source: string;
  source_name?: string;
  observation_id: string;
}

export interface Metadata {
  matching_contents?: MatchingContent[];
  source_name?: string;
}

export interface AgentConversationMessage {
  agent: string;
  action: 'message' | 'tool_call' | 'summary';
  content: string;
  timestamp?: string;
  details?: string[];
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  metadata?: Metadata;
  enhanced_response?: string;
  agent_conversation?: AgentConversationMessage[];
  is_processing?: boolean;  // 🆕 Flag for in-progress workflows
  tool_executions?: any[];  // Tool execution records for ToolAgent
  artifacts?: any[];  // Generated artifacts (images, visualizations)
  timestamp: string;
}

export interface ChatResponse {
  message: string;
  metadata?: Metadata;
  enhanced_response?: string;
  agent_conversation?: AgentConversationMessage[];
}

// Added interface for custom event data sources
export interface EventSource {
  name?: string;
  obsid?: number | string;
  event_list: number[][];
  source_name?: string;
  source_type?: string;
  [key: string]: unknown;
}

// Light curve and spectrum interfaces
export interface SpectrumDataPoint {
  energy: number;
  energy_min: number;
  energy_max: number;
  count: number;
}

export interface RegionOfInterest {
  name: string;
  energy_min: number;
  energy_max: number;
  energy_center: number;
  count: number;
  significance: 'high' | 'moderate' | 'low' | 'none';
}

export interface LightCurveStatistics {
  total_events: number;
  energy_range: { min: number; max: number };
  mean_energy: number;
  peak_energy: number;
}

export interface LightCurveData {
  total_events: number;
  energy_spectrum: SpectrumDataPoint[];
  regions_of_interest: RegionOfInterest[];
  statistics: LightCurveStatistics;
}

// Time light curve (counts/rate vs time) types
export interface TimeLightCurvePoint {
  t_mid_s: number;
  rate_cps: number;
  rate_err_cps?: number;
  counts?: number;
  exposure_s?: number;
}

export interface TimeLightCurve {
  cadence_s: number;
  points: TimeLightCurvePoint[];
  stats: {
    mean_rate?: number;
    std_rate?: number;
    frac_rms?: number | null;
    bins?: number;
    zero_exposure_bins?: number;
    duration_s?: number;
  };
}

export interface EnhancedObjectDetails {
  success: boolean;
  object_data?: any;
  light_curve?: LightCurveData;
  spectrum_text?: string;
  time_light_curve?: TimeLightCurve;
  gl_light_curve?: {
    summary?: {
      p_var?: number | null;
      index?: number | null;
      m_map?: number | null;
      K?: number;
      median_width_s?: number;
      median_rate_cps?: number;
    };
    segments?: Array<{
      t0_s: number;
      t1_s: number;
      width_s: number;
      counts: number;
      rate_cps: number;
      rate_lo_cps?: number;
      rate_hi_cps?: number;
    }>;
    error?: string;
  };
  spectrum_snapshot?: any;
  de_dt_map?: string | null;  // Base64-encoded PNG image
  error?: string;
}