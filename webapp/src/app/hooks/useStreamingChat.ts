import { useState, useCallback } from 'react';
import { sendStreamingChatMessage, StreamingUpdate, SendChatMessageParams } from '@/app/actions/playgroundActions';
import { Message } from '@/app/types/chat';
import { createMessage } from '@/app/actions/playgroundActions';

interface UseStreamingChatState {
  isStreaming: boolean;
  streamingUpdates: StreamingUpdate[];
  currentAgent: string | null;
  error: string | null;
}

interface UseStreamingChatReturn extends UseStreamingChatState {
  sendStreamingMessage: (params: SendChatMessageParams) => Promise<Message | null>;
  clearStreamingState: () => void;
  getAgentProgress: () => {
    completed: number;
    total: number;
    percentage: number;
  };
}

export function useStreamingChat(): UseStreamingChatReturn {
  const [state, setState] = useState<UseStreamingChatState>({
    isStreaming: false,
    streamingUpdates: [],
    currentAgent: null,
    error: null,
  });

  const clearStreamingState = useCallback(() => {
    setState({
      isStreaming: false,
      streamingUpdates: [],
      currentAgent: null,
      error: null,
    });
  }, []);

  const getAgentProgress = useCallback(() => {
    const completedAgents = state.streamingUpdates.filter(
      update => update.type === 'result' || update.type === 'final'
    );
    
    // Get total steps from start message or estimate from updates
    const startUpdate = state.streamingUpdates.find(u => u.type === 'start');
    const totalSteps = startUpdate?.total_steps || Math.max(4, completedAgents.length + 1);
    
    return {
      completed: completedAgents.length,
      total: totalSteps,
      percentage: (completedAgents.length / totalSteps) * 100
    };
  }, [state.streamingUpdates]);

  const sendStreamingMessage = useCallback(async (params: SendChatMessageParams): Promise<Message | null> => {
    try {
      // Clear previous state
      setState(prev => ({
        ...prev,
        isStreaming: true,
        streamingUpdates: [],
        currentAgent: null,
        error: null,
      }));

      let finalResult: any = null;
      let finalContent = '';

      // Process streaming updates
      for await (const update of sendStreamingChatMessage(params)) {
        console.log('🔄 Streaming update:', update);

        setState(prev => ({
          ...prev,
          streamingUpdates: [...prev.streamingUpdates, update],
          currentAgent: update.agent || prev.currentAgent,
        }));

        // Handle different update types
        switch (update.type) {
          case 'start':
            console.log('📡 Streaming started:', update.message);
            break;
            
          case 'progress':
            console.log(`⏳ ${update.agent} is ${update.status}:`, update.message);
            break;
            
          case 'artifact':
            console.log(`🖼️ ${update.agent} generated artifact:`, update.artifact?.name);
            break;
            
          case 'result':
            console.log(`✅ ${update.agent} completed:`, update.content?.slice(0, 100));
            break;
            
          case 'final':
            console.log('🏁 Final result received');
            finalResult = update.full_result;
            finalContent = update.content || '';
            break;
            
          case 'error':
            console.error('❌ Streaming error:', update.error);
            setState(prev => ({
              ...prev,
              error: update.message || update.error || 'Unknown streaming error',
              isStreaming: false,
            }));
            return null;
            
          case 'complete':
            console.log('✨ Streaming completed');
            break;
        }
      }

      // Mark streaming as complete
      setState(prev => ({
        ...prev,
        isStreaming: false,
        currentAgent: null,
      }));

      // Create final message from streaming result
      if (finalResult || finalContent) {
        const assistantMessage = createMessage(
          'assistant',
          finalContent || finalResult?.response || 'Analysis completed',
          finalResult?.meta_data,
          finalResult?.event_result !== finalResult?.response ? finalResult?.event_result : undefined,
          finalResult?.agent_conversation,
          finalResult?.tool_executions,
          finalResult?.artifacts
        );

        return assistantMessage;
      }

      return null;

    } catch (error) {
      console.error('Error in streaming chat:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown streaming error';
      setState(prev => ({
        ...prev,
        error: errorMessage,
        isStreaming: false,
        currentAgent: null,
      }));

      return null;
    }
  }, []);

  return {
    ...state,
    sendStreamingMessage,
    clearStreamingState,
    getAgentProgress,
  };
}

export default useStreamingChat;