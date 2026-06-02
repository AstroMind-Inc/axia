// app/context/ChatHistoryContext.tsx
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { ChatThread, ChatMessage, ThreadWithMessages } from '@/app/types/chat-history';
import { 
  createChatThread, 
  getChatThreads, 
  getChatThreadWithMessages, 
  saveChatMessage, 
  updateChatThread,
  generateThreadTitle
} from '@/app/actions/chatHistoryActions';

interface ChatHistoryContextType {
  // Thread management
  currentThread: ThreadWithMessages | null;
  threads: ChatThread[];
  isLoading: boolean;
  error: string | null;
  
  // UI state
  isThreadSelectorExpanded: boolean;
  setIsThreadSelectorExpanded: (expanded: boolean) => void;
  
  // Thread operations
  loadThreads: () => Promise<void>;
  loadThread: (threadId: string) => Promise<void>;
  createNewThread: (title?: string) => Promise<string>;
  switchToThread: (threadId: string) => Promise<void>;
  switchToThreadWithObjectRestoration: (threadId: string) => Promise<void>;
  updateThreadTitle: (threadId: string, title: string) => Promise<void>;
  
  // Message operations
  addMessage: (messageData: Omit<ChatMessage, '_id' | 'thread_id' | 'message_index' | 'timestamp'>) => Promise<void>;
  
  // Utility
  clearCurrentThread: () => void;
}

const ChatHistoryContext = createContext<ChatHistoryContextType | undefined>(undefined);

interface ChatHistoryProviderProps {
  children: ReactNode;
}

export function ChatHistoryProvider({ children }: ChatHistoryProviderProps) {
  const [currentThread, setCurrentThread] = useState<ThreadWithMessages | null>(null);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isThreadSelectorExpanded, setIsThreadSelectorExpanded] = useState(false);



  // Define loadThreads first
  const loadThreads = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await getChatThreads(50, 0, 'active');
      setThreads(result.threads);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load threads');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Define loadThread with useCallback
  const loadThread = useCallback(async (threadId: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const threadWithMessages = await getChatThreadWithMessages(threadId);
      setCurrentThread(threadWithMessages);
      
      // Update the thread in the threads list if it exists
      setThreads(prev => prev.map(thread => 
        thread._id === threadId 
          ? { ...thread, updated_at: threadWithMessages.updated_at }
          : thread
      ));

      // Note: Object restoration is handled by switchToThreadWithObjectRestoration method
    } catch (err) {
      console.error('Failed to load thread:', err);
      setError(err instanceof Error ? err.message : 'Failed to load thread');
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  // 🆕 Check if current thread has processing messages
  const hasProcessingMessages = useCallback(() => {
    if (!currentThread?.messages) return false;
    return currentThread.messages.some((msg: any) => 
      msg.message_type === 'assistant' && 
      msg.assistant_response?.is_processing === true
    );
  }, [currentThread]);
  
  // 🆕 Auto-refresh thread if it has processing messages
  useEffect(() => {
    if (!currentThread?._id) return;
    if (!hasProcessingMessages()) return;
    
    console.log('🔄 Thread has processing messages, starting auto-refresh...');
    
    const intervalId = setInterval(async () => {
      try {
        console.log('🔄 Refreshing thread with processing messages...');
        const threadWithMessages = await getChatThreadWithMessages(currentThread._id);
        setCurrentThread(threadWithMessages);
        
        // Check if still processing
        const stillProcessing = threadWithMessages.messages.some((msg: any) => 
          msg.message_type === 'assistant' && 
          msg.assistant_response?.is_processing === true
        );
        
        if (!stillProcessing) {
          console.log('✅ All messages completed, stopping auto-refresh');
          clearInterval(intervalId);
        }
      } catch (err) {
        console.error('Failed to refresh thread:', err);
      }
    }, 2000); // Poll every 2 seconds
    
    return () => {
      console.log('🛑 Stopping auto-refresh');
      clearInterval(intervalId);
    };
  }, [currentThread?._id, hasProcessingMessages]);

  // Load threads on mount
  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // Listen for chat history updates from outside the context
  useEffect(() => {
    const handleChatHistoryUpdate = async (event: CustomEvent) => {
      console.log('📡 Received chat-history-updated event:', event.detail);
      const { threadId, action } = event.detail;
      
      // Reload threads to reflect new/updated threads
      loadThreads();
      
      // For newly created threads, set immediately (no delay) to prevent race condition
      // The frontend creates the thread synchronously, so we can set it right away
      if (action === 'created' && threadId) {
        console.log('🆕 New thread created, setting as current immediately:', threadId);
        try {
          // Set current thread immediately with just thread metadata
          // The messages will be loaded by backend in the background
          setCurrentThread({
            _id: threadId,
            title: 'New Chat', // Will be updated by backend
            created_at: new Date(),
            updated_at: new Date(),
            user_id: 'default_user',
            status: 'active',
            metadata: {
              total_messages: 0,
              last_model_used: null,
              last_source: {
                obsid: null,
                source_name: null,
                source_type: null
              },
              selected_object: null
            },
            messages: [] // Will be populated as backend saves them
          });
          console.log('✅ New thread set as current immediately (prevents race condition)');
        } catch (error) {
          console.error('❌ Failed to set new thread as current:', error);
        }
      }
      
      // For updated threads, ALWAYS refresh if we have a threadId
      // This includes refreshing the current thread with new messages
      if (action === 'updated' && threadId) {
        console.log('🔄 Refreshing thread with new messages:', threadId);
        try {
          // Wait 2 seconds for backend to save the new messages
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const threadWithMessages = await getChatThreadWithMessages(threadId);
          setCurrentThread(threadWithMessages);
          console.log('✅ Thread refreshed successfully with updated messages');
        } catch (error) {
          console.error('❌ Failed to refresh thread:', error);
        }
      }
    };

    window.addEventListener('chat-history-updated', handleChatHistoryUpdate as unknown as EventListener);
    
    return () => {
      window.removeEventListener('chat-history-updated', handleChatHistoryUpdate as unknown as EventListener);
    };
  }, [loadThreads, currentThread]);



  const createNewThread = async (title?: string): Promise<string> => {
    try {
      setIsLoading(true);
      setError(null);
      
      const defaultTitle = title || 'New Chat';
      const newThread = await createChatThread(defaultTitle);
      
      // Add to threads list
      setThreads(prev => [newThread, ...prev]);
      
      // Set as current thread with empty messages
      setCurrentThread({
        ...newThread,
        messages: []
      });
      
      return newThread._id;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create thread');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const switchToThread = async (threadId: string) => {
    if (currentThread?._id === threadId) return;
    await loadThread(threadId);
  };

  const switchToThreadWithObjectRestoration = async (threadId: string) => {
    if (currentThread?._id === threadId) return;
    
    try {
      setIsLoading(true);
      setError(null);
      
      // Load the thread with messages
      const threadWithMessages = await getChatThreadWithMessages(threadId);
      setCurrentThread(threadWithMessages);
      
      // Update the thread in the threads list
      setThreads(prev => prev.map(thread => 
        thread._id === threadId 
          ? { ...thread, updated_at: threadWithMessages.updated_at }
          : thread
      ));

      // If thread has associated object, restore it
      if (threadWithMessages.metadata?.selected_object) {
        console.log('🎯 Thread has associated object, dispatching restoration event');
        window.dispatchEvent(new CustomEvent('restore-selected-object', { 
          detail: { 
            threadId,
            selectedObject: threadWithMessages.metadata.selected_object,
            isSystemChange: true // Mark this as system-initiated
          } 
        }));
      }
    } catch (err) {
      console.error('Failed to switch to thread with object restoration:', err);
      setError(err instanceof Error ? err.message : 'Failed to switch to thread');
    } finally {
      setIsLoading(false);
    }
  };

  const updateThreadTitle = async (threadId: string, title: string) => {
    try {
      await updateChatThread(threadId, { title });
      
      // Update local state
      setThreads(prev => prev.map(thread => 
        thread._id === threadId 
          ? { ...thread, title, updated_at: new Date() }
          : thread
      ));
      
      if (currentThread?._id === threadId) {
        setCurrentThread(prev => prev ? { ...prev, title, updated_at: new Date() } : null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update thread title');
      throw err;
    }
  };

  const addMessage = async (messageData: Omit<ChatMessage, '_id' | 'thread_id' | 'message_index' | 'timestamp'>) => {
    if (!currentThread) {
      throw new Error('No current thread selected');
    }

    try {
      setError(null);
      const newMessage = await saveChatMessage(currentThread._id, messageData);
      
      // Update current thread messages
      setCurrentThread(prev => {
        if (!prev) return null;
        return {
          ...prev,
          messages: [...prev.messages, newMessage],
          metadata: {
            ...prev.metadata,
            total_messages: prev.messages.length + 1,
            ...(messageData.assistant_response?.model_used && {
              last_model_used: messageData.assistant_response.model_used
            }),
            ...(messageData.user_input?.selected_object && {
              last_source: {
                obsid: messageData.user_input.selected_object.obsid,
                source_name: messageData.user_input.selected_object.source_name,
                source_type: messageData.user_input.selected_object.source_type
              }
            })
          },
          updated_at: new Date()
        };
      });

      // Update thread in threads list
      setThreads(prev => prev.map(thread => 
        thread._id === currentThread._id 
          ? { 
              ...thread, 
              updated_at: new Date(),
              metadata: {
                ...thread.metadata,
                total_messages: thread.metadata.total_messages + 1,
                ...(messageData.assistant_response?.model_used && {
                  last_model_used: messageData.assistant_response.model_used
                }),
                ...(messageData.user_input?.selected_object && {
                  last_source: {
                    obsid: messageData.user_input.selected_object.obsid,
                    source_name: messageData.user_input.selected_object.source_name,
                    source_type: messageData.user_input.selected_object.source_type
                  }
                })
              }
            }
          : thread
      ));

      // Auto-generate title from first user message if title is generic
      if (messageData.message_type === 'user' && 
          currentThread.messages.length === 0 && 
          (currentThread.title === 'New Chat' || currentThread.title.startsWith('New Chat'))) {
        const autoTitle = generateThreadTitle(messageData.user_input?.text || 'Chat');
        await updateThreadTitle(currentThread._id, autoTitle);
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save message');
      throw err;
    }
  };

  const clearCurrentThread = () => {
    setCurrentThread(null);
  };

      const value: ChatHistoryContextType = {
      currentThread,
      threads,
      isLoading,
      error,
      isThreadSelectorExpanded,
      setIsThreadSelectorExpanded,
      loadThreads,
      loadThread,
      createNewThread,
      switchToThread,
      switchToThreadWithObjectRestoration,
      updateThreadTitle,
      addMessage,
      clearCurrentThread
    };

  return (
    <ChatHistoryContext.Provider value={value}>
      {children}
    </ChatHistoryContext.Provider>
  );
}

export function useChatHistory() {
  const context = useContext(ChatHistoryContext);
  if (context === undefined) {
    throw new Error('useChatHistory must be used within a ChatHistoryProvider');
  }
  return context;
}