// app/components/feedback/FeedbackModal.tsx
'use client';

import React, { useState } from 'react';
import { XIcon, MessageSquareIcon } from 'lucide-react';
import { ChatMessage } from '@/app/types/chat-history';
import { FeedbackSubmission } from '@/app/types/chat-history';
import { submitMessageFeedback } from '@/app/actions/chatHistoryActions';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  message: ChatMessage;
  threadId: string;
  sourceContext?: {
    obsid: string | null;
    source_name: string | null;
    source_type: string | null;
  };
  allMessages?: ChatMessage[]; // Add all messages to find the previous user question
}

type EvaluationValue = 'correct' | 'incorrect' | 'partially_correct' | null;

export function FeedbackModal({ isOpen, onClose, message, threadId, sourceContext, allMessages }: FeedbackModalProps) {
  const [reviewerName, setReviewerName] = useState('');
  const [reviewerEmail, setReviewerEmail] = useState('');
  const [evaluations, setEvaluations] = useState({
    event_analyst: null as EvaluationValue,
    metadata_analyst: null as EvaluationValue,
    neighbor_analyst: null as EvaluationValue,
    final_answer: null as EvaluationValue,
  });
  const [textFeedback, setTextFeedback] = useState('');
  const [suggestions, setSuggestions] = useState('');
  const [overallRating, setOverallRating] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!isOpen) return null;

  // Helper function to find the previous user message for this assistant message
  const findPreviousUserMessage = (): string => {
    if (!allMessages || allMessages.length === 0) {
      return 'Previous conversation';
    }

    // Find the index of the current assistant message
    const currentMessageIndex = allMessages.findIndex(m => m._id === message._id);
    
    if (currentMessageIndex === -1) {
      return 'Previous conversation';
    }

    // Look backwards from current message to find the most recent user message
    for (let i = currentMessageIndex - 1; i >= 0; i--) {
      const msg = allMessages[i];
      if (msg.message_type === 'user' && msg.user_input?.text) {
        return msg.user_input.text;
      }
    }

    return 'Previous conversation';
  };

  const handleEvaluationChange = (agent: keyof typeof evaluations, value: EvaluationValue) => {
    setEvaluations(prev => ({
      ...prev,
      [agent]: prev[agent] === value ? null : value // Toggle off if same value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!reviewerName.trim()) {
      setSubmitError('Reviewer name is required');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const feedbackData: FeedbackSubmission = {
        message_id: message._id,
        thread_id: threadId,
        reviewer_info: {
          name: reviewerName.trim(),
          email: reviewerEmail.trim() || undefined,
        },
        source_context: sourceContext || {
          obsid: null,
          source_name: null,
          source_type: null,
        },
        conversation_context: {
          question: findPreviousUserMessage(),
          answer: message.assistant_response?.final_content || '',
          model_used: message.assistant_response?.model_used || 'unknown',
        },
        agent_evaluations: evaluations,
        feedback_details: {
          text_feedback: textFeedback.trim(),
          suggestions: suggestions.trim(),
          overall_rating: overallRating ?? undefined,
        },
      };

      await submitMessageFeedback(feedbackData);
      
      // Reset form and close modal
      setReviewerName('');
      setReviewerEmail('');
      setEvaluations({
        event_analyst: null,
        metadata_analyst: null,
        neighbor_analyst: null,
        final_answer: null,
      });
      setTextFeedback('');
      setSuggestions('');
      setOverallRating(null);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to submit feedback');
    } finally {
      setIsSubmitting(false);
    }
  };

  const EvaluationButton = ({ 
    value, 
    currentValue, 
    label, 
    color 
  }: { 
    value: EvaluationValue; 
    currentValue: EvaluationValue; 
    label: string; 
    color: string; 
  }) => (
    <button
      type="button"
      onClick={() => handleEvaluationChange('event_analyst', value)}
      className={`px-3 py-1 text-xs rounded border transition-colors ${
        currentValue === value
          ? `${color} text-white border-transparent`
          : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
      }`}
    >
      {label}
    </button>
  );

  const AgentEvaluationRow = ({ 
    agent, 
    label 
  }: { 
    agent: keyof typeof evaluations; 
    label: string; 
  }) => (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleEvaluationChange(agent, 'correct')}
          className={`px-3 py-1 text-xs rounded border transition-colors ${
            evaluations[agent] === 'correct'
              ? 'bg-green-600 text-white border-transparent'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
        >
          ✓ Correct
        </button>
        <button
          type="button"
          onClick={() => handleEvaluationChange(agent, 'partially_correct')}
          className={`px-3 py-1 text-xs rounded border transition-colors ${
            evaluations[agent] === 'partially_correct'
              ? 'bg-yellow-600 text-white border-transparent'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
        >
          ~ Partial
        </button>
        <button
          type="button"
          onClick={() => handleEvaluationChange(agent, 'incorrect')}
          className={`px-3 py-1 text-xs rounded border transition-colors ${
            evaluations[agent] === 'incorrect'
              ? 'bg-red-600 text-white border-transparent'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
        >
          ✗ Incorrect
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <MessageSquareIcon className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Provide Feedback
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
          >
            <XIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Source Information */}
          {sourceContext && (
            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                Source Information
              </h3>
              <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                {sourceContext.obsid && (
                  <div>Object ID: <span className="font-mono">{sourceContext.obsid}</span></div>
                )}
                {sourceContext.source_name && (
                  <div>Source Name: <span className="font-medium">{sourceContext.source_name}</span></div>
                )}
                {sourceContext.source_type && (
                  <div>Source Type: <span className="font-medium">{sourceContext.source_type}</span></div>
                )}
              </div>
            </div>
          )}

          {/* Question & Answer */}
          <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
              Question & Answer
            </h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-medium text-gray-700 dark:text-gray-300">Q: </span>
                <span className="text-gray-600 dark:text-gray-400">
                  {findPreviousUserMessage()}
                </span>
              </div>
              <div>
                <span className="font-medium text-gray-700 dark:text-gray-300">A: </span>
                <span className="text-gray-600 dark:text-gray-400">
                  {message.assistant_response?.final_content?.substring(0, 200) || 'No response'}
                  {(message.assistant_response?.final_content?.length || 0) > 200 && '...'}
                </span>
              </div>
            </div>
          </div>

          {/* Reviewer Information */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Reviewer Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={reviewerName}
                  onChange={(e) => setReviewerName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Your name"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email (optional)
                </label>
                <input
                  type="email"
                  value={reviewerEmail}
                  onChange={(e) => setReviewerEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="your.email@example.com"
                />
              </div>
            </div>
          </div>

          {/* Agent Performance Evaluation */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Agent Performance
            </h3>
            <div className="space-y-2 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <AgentEvaluationRow agent="event_analyst" label="Event Analyst" />
              <AgentEvaluationRow agent="metadata_analyst" label="Metadata Analyst" />
              <AgentEvaluationRow agent="neighbor_analyst" label="Neighbor Analyst" />
              <AgentEvaluationRow agent="final_answer" label="Final Answer" />
            </div>
          </div>

          {/* Overall Rating */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Overall Rating (1-5)
            </label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(rating => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => setOverallRating(overallRating === rating ? null : rating)}
                  className={`w-8 h-8 rounded border text-sm font-medium transition-colors ${
                    overallRating === rating
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {rating}
                </button>
              ))}
            </div>
          </div>

          {/* Additional Feedback */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Detailed Feedback
              </label>
              <textarea
                value={textFeedback}
                onChange={(e) => setTextFeedback(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={4}
                placeholder="Provide detailed feedback about the response quality, accuracy, or any issues you noticed..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Suggestions for Improvement
              </label>
              <textarea
                value={suggestions}
                onChange={(e) => setSuggestions(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows={3}
                placeholder="How could this response be improved?"
              />
            </div>
          </div>

          {/* Error Display */}
          {submitError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
              <p className="text-sm text-red-700 dark:text-red-400">{submitError}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !reviewerName.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}