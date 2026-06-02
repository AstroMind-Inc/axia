// app/components/chat-history/ChatThreadSelector.tsx
'use client';

import React, { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, MessageCircleIcon, SearchIcon } from 'lucide-react';
import { useChatHistory } from '@/app/context/ChatHistoryContext';
import { ChatThread } from '@/app/types/chat-history';

interface ThreadListItemProps {
  thread: ChatThread;
  isActive: boolean;
  onSelect: (threadId: string) => void;
}

function ThreadListItem({ thread, isActive, onSelect }: ThreadListItemProps) {
  const formatDate = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = diffHours / 24;

    if (diffHours < 1) {
      return 'Just now';
    } else if (diffHours < 24) {
      return `${Math.floor(diffHours)}h ago`;
    } else if (diffDays < 7) {
      return `${Math.floor(diffDays)}d ago`;
    } else {
      return new Date(date).toLocaleDateString();
    }
  };

  return (
    <div
      className={`p-3 cursor-pointer rounded-lg border transition-all hover:bg-gray-50 dark:hover:bg-gray-800 ${
        isActive 
          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' 
          : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
      }`}
      onClick={() => onSelect(thread._id)}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h4 className={`text-sm font-medium truncate ${
            isActive ? 'text-blue-900 dark:text-blue-100' : 'text-gray-900 dark:text-gray-100'
          }`}>
            {thread.title}
          </h4>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {thread.metadata.total_messages} messages
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500">•</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {formatDate(thread.updated_at)}
            </span>
          </div>
          {thread.metadata.last_source.source_name && (
            <div className="mt-1">
              <span className="text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                {thread.metadata.last_source.source_name}
              </span>
            </div>
          )}
        </div>
        {thread.metadata.total_messages > 0 && (
          <div className="ml-2 flex-shrink-0">
            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatThreadSelector() {
  const {
    threads,
    currentThread,
    isLoading,
    error,
    isThreadSelectorExpanded,
    setIsThreadSelectorExpanded,
    createNewThread,
    switchToThreadWithObjectRestoration,
    loadThreads
  } = useChatHistory();

  const [searchQuery, setSearchQuery] = useState('');

  const filteredThreads = threads.filter(thread =>
    thread.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (thread.metadata.last_source.source_name?.toLowerCase().includes(searchQuery.toLowerCase()))
  );



  const handleSelectThread = async (threadId: string) => {
    try {
      await switchToThreadWithObjectRestoration(threadId);
      setIsThreadSelectorExpanded(false);
    } catch (error) {
      console.error('Failed to switch thread:', error);
    }
  };

  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        onClick={() => setIsThreadSelectorExpanded(!isThreadSelectorExpanded)}
        className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        <MessageCircleIcon className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {currentThread ? 'Chat History' : 'Chats'}
        </span>
        {isThreadSelectorExpanded ? (
          <ChevronDownIcon className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronRightIcon className="w-4 h-4 text-gray-500" />
        )}
      </button>

      {/* Expanded Panel */}
      {isThreadSelectorExpanded && (
        <div className="absolute top-full left-0 mt-2 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-96 flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Chat History
          </h3>
        </div>
            
            {/* Search */}
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search chats..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Thread List */}
          <div className="flex-1 overflow-y-auto p-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              </div>
            ) : error ? (
              <div className="p-4 text-center">
                <p className="text-sm text-red-600 dark:text-red-400 mb-2">
                  Failed to load chats
                </p>
                <button
                  onClick={loadThreads}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Try again
                </button>
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-4 text-center">
                {searchQuery ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No chats found matching "{searchQuery}"
                  </p>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No chat history yet. Start a conversation with any dataset object to create your first chat thread.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredThreads.map((thread) => (
                  <ThreadListItem
                    key={thread._id}
                    thread={thread}
                    isActive={currentThread?._id === thread._id}
                    onSelect={handleSelectThread}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Overlay to close when clicking outside */}
      {isThreadSelectorExpanded && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsThreadSelectorExpanded(false)}
        />
      )}
    </div>
  );
}