// app/components/feedback/FeedbackButton.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { MessageSquareIcon } from 'lucide-react';
import { FeedbackModal } from './FeedbackModal';
import { ChatMessage } from '@/app/types/chat-history';
import { getMessageFeedback } from '@/app/actions/chatHistoryActions';

interface FeedbackButtonProps {
  message: ChatMessage;
  threadId: string;
  sourceContext?: {
    obsid: string | null;
    source_name: string | null;
    source_type: string | null;
  };
  allMessages?: ChatMessage[]; // Add all messages to find the previous user question
}

export function FeedbackButton({ message, threadId, sourceContext, allMessages }: FeedbackButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [hasFeedback, setHasFeedback] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Helper function to check if ID is a valid ObjectId
  const isValidObjectId = (id: string): boolean => {
    // Check if it's a 24-character hex string (ObjectId format)
    return /^[0-9a-fA-F]{24}$/.test(id);
  };

  // Check if feedback exists for this message
  useEffect(() => {
    const checkFeedback = async () => {
      if (message.message_type !== 'assistant') return;
      
      // Skip if message ID is temporary or not a valid ObjectId
      if (message._id.startsWith('temp-') || !isValidObjectId(message._id)) {
        setHasFeedback(false);
        setIsLoading(false);
        return;
      }
      
      try {
        setIsLoading(true);
        const feedbacks = await getMessageFeedback(message._id);
        setHasFeedback(feedbacks.length > 0);
      } catch (error) {
        console.error('Failed to check feedback:', error);
        setHasFeedback(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkFeedback();
  }, [message._id, message.message_type]);

  // Only show feedback button for assistant messages with valid database IDs
  if (message.message_type !== 'assistant' || message._id.startsWith('temp-') || !isValidObjectId(message._id)) {
    return null;
  }

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className="group flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 rounded transition-all duration-200 opacity-60 hover:opacity-100"
        title="Provide feedback on this response"
      >
        <MessageSquareIcon className="w-3 h-3" />
        <span className="hidden group-hover:inline">Feedback</span>
        {hasFeedback && (
          <div className="w-2 h-2 bg-blue-500 rounded-full ml-1" title="Feedback submitted" />
        )}
      </button>

      {isModalOpen && (
        <FeedbackModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            // Re-check feedback status after modal closes
            const recheckFeedback = async () => {
              try {
                const feedbacks = await getMessageFeedback(message._id);
                setHasFeedback(feedbacks.length > 0);
              } catch (error) {
                console.error('Failed to recheck feedback:', error);
              }
            };
            recheckFeedback();
          }}
          message={message}
          threadId={threadId}
          sourceContext={sourceContext}
          allMessages={allMessages}
        />
      )}
    </>
  );
}