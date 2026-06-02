// types/chat-history.ts

export interface ChatThread {
  _id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
  user_id: string;
  status: 'active' | 'archived';
  metadata: {
    total_messages: number;
    last_model_used: string | null;
    last_source: {
      obsid: string | null;
      source_name: string | null;
      source_type: string | null;
    };
    // Store the selected data object for this thread
    selected_object: {
      data_obj_id: string;
      dataset_name: string;
      obsid: string | null;
      source_name: string | null;
      source_type: string | null;
    } | null;
  };
}

export interface ChatMessage {
  _id: string;
  thread_id: string;
  message_index: number;
  timestamp: Date;
  message_type: 'user' | 'assistant';
  
  // User message data
  user_input?: {
    text: string;
    selected_object: {
      obsid: string;
      source_name: string;
      source_type: string;
      data_obj_id: string;
    } | null;
    model_settings: {
      model: string;
      response_format: string;
      context_settings: any;
    };
  };
  
  // Assistant response data
  assistant_response?: {
    final_content: string;
    model_used: string;
    agent_conversation: any[];
    is_processing?: boolean;
    has_error?: boolean;
    error_message?: string;
    execution_results: {
      event_analysis?: string;
      metadata_analysis?: string;
      neighbor_analysis?: string;
      critic_review?: string;
      moderator_synthesis?: string;
    };
    performance_metrics: {
      total_time_ms?: number;
      agent_timings?: any;
    };
    tool_executions?: any[];
    artifacts?: any[];
  };
}

export interface ThreadWithMessages extends ChatThread {
  messages: ChatMessage[];
}

export interface MessageFeedback {
  _id: string;
  message_id: string;
  thread_id: string;
  timestamp: Date;
  
  reviewer_info: {
    name: string;
    email?: string;
    role?: string;
  };
  
  source_context: {
    obsid: string | null;
    source_name: string | null;
    source_type: string | null;
  };
  
  conversation_context: {
    question: string;
    answer: string;
    model_used: string;
  };
  
  agent_evaluations: {
    event_analyst: 'correct' | 'incorrect' | 'partially_correct' | null;
    metadata_analyst: 'correct' | 'incorrect' | 'partially_correct' | null;
    neighbor_analyst: 'correct' | 'incorrect' | 'partially_correct' | null;
    final_answer: 'correct' | 'incorrect' | 'partially_correct' | null;
  };
  
  feedback_details: {
    text_feedback: string;
    specific_issues: string[];
    suggestions: string;
    overall_rating: number | null;
  };
  
  metadata: {
    feedback_version: string;
    source_page: string;
  };
}

export interface FeedbackSubmission {
  message_id: string;
  thread_id: string;
  reviewer_info: {
    name: string;
    email?: string;
    role?: string;
  };
  source_context: {
    obsid: string | null;
    source_name: string | null;
    source_type: string | null;
  };
  conversation_context: {
    question: string;
    answer: string;
    model_used: string;
  };
  agent_evaluations: {
    event_analyst: 'correct' | 'incorrect' | 'partially_correct' | null;
    metadata_analyst: 'correct' | 'incorrect' | 'partially_correct' | null;
    neighbor_analyst: 'correct' | 'incorrect' | 'partially_correct' | null;
    final_answer: 'correct' | 'incorrect' | 'partially_correct' | null;
  };
  feedback_details: {
    text_feedback: string;
    specific_issues?: string[];
    suggestions?: string;
    overall_rating?: number;
  };
}