// app/components/playground/ChatMessage.tsx
"use client";

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Message, MatchingContent, Metadata } from '@/app/types/chat';
import { useSettings } from '@/app/context/SettingsContext';

interface ChatMessageProps extends Omit<Message, 'role'> {
  role: 'user' | 'assistant';
}

export function ChatMessage({ role, content, metadata, enhanced_response }: ChatMessageProps) {
  const [showMetadata, setShowMetadata] = useState(false);
  const [showEnhanced, setShowEnhanced] = useState(false);
  const { theme } = useSettings();

  // Track mounted state to avoid hydration mismatch
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Check if metadata exists and has matching texts
  const hasMetadata = Boolean(metadata?.matching_contents?.length);
  const hasEnhanced = Boolean(enhanced_response);

  // Use more aggressive style overrides
  const textStyles = {
    color: theme === 'dark' ? '#F8F9FA' : '#1A1A1A',
    // Using !important inline to override any CSS variables
    fontWeight: 'normal',
    opacity: 1
  };

  // Theme-based styles with !important flags
  const getUserMessageStyles = () => {
    return theme === 'dark'
      ? 'bg-green-900/15 border-l-4 border-green-700'
      : 'bg-green-50 border-l-4 border-green-500';
  };

  const getAssistantMessageStyles = () => {
    return theme === 'dark'
      ? 'bg-blue-900/10 border-l-4 border-blue-700'
      : 'bg-blue-50 border-l-4 border-blue-500';
  };

  // Only render with correct styles after mounting to avoid hydration issues
  if (!mounted) {
    return null; // Return nothing during SSR to avoid hydration mismatch
  }

  return (
    <div
      className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'} mb-6`}
      data-theme={theme} // Add theme data attribute for CSS targeting
    >
      <div
        className={`max-w-[85%] rounded-lg overflow-hidden ${
          role === 'user' 
            ? getUserMessageStyles()
            : getAssistantMessageStyles()
        }`}
      >
        {/* Message Header */}
        <div className={`px-4 py-2 flex justify-between items-center ${
          theme === 'dark' ? 'bg-black/20 text-gray-300' : 'bg-gray-200/40 text-gray-700'
        }`}>
          <span className="text-sm font-medium" style={{ color: theme === 'dark' ? '#F8F9FA' : '#1A1A1A' }}>
            {role === 'user' ? '👤 You' : '🤖 Assistant'}
          </span>
        </div>

        {/* Main Content with aggressive style overrides */}
        <div className="p-4">
          <div
            className={`whitespace-pre-wrap ${theme === 'dark' ? 'text-gray-100' : 'text-gray-900'}`}
            style={textStyles}
          >
            {content}
          </div>

          {/* Enhanced Response Section */}
          {hasEnhanced && (
            <div className="mt-4">
              <button
                onClick={() => setShowEnhanced(!showEnhanced)}
                className={`flex items-center space-x-2 text-sm transition-colors ${
                  theme === 'dark' ? 'text-purple-400 hover:text-purple-300' : 'text-purple-600 hover:text-purple-700'
                }`}
                style={{ color: theme === 'dark' ? '#C084FC' : '#7E22CE' }}
              >
                <span>Enhanced Response</span>
                {showEnhanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showEnhanced && enhanced_response && (
                <div className={`mt-2 p-3 rounded-md ${
                  theme === 'dark' ? 'bg-purple-900/5 border border-purple-700/20' : 'bg-purple-50 border border-purple-300'
                }`}>
                  <div
                    className={`whitespace-pre-wrap ${theme === 'dark' ? 'text-gray-100' : 'text-gray-900'}`}
                    style={textStyles}
                  >
                    {enhanced_response}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Metadata Section */}
          {hasMetadata && metadata?.matching_contents && (
            <div className="mt-4">
              <button
                onClick={() => setShowMetadata(!showMetadata)}
                className={`flex items-center space-x-2 text-sm transition-colors ${
                  theme === 'dark' ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'
                }`}
                style={{ color: theme === 'dark' ? '#60A5FA' : '#2563EB' }}
              >
                <span>Matching Texts</span>
                {showMetadata ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showMetadata && (
                <div className="mt-2 space-y-2">
                  {metadata.matching_contents.map((match, index) => (
                    <div
                      key={index}
                      className={`p-3 rounded-md ${
                        theme === 'dark' ? 'bg-blue-900/5 border border-blue-700/20' : 'bg-blue-50 border border-blue-300'
                      }`}
                    >
                      <div
                        className={`${theme === 'dark' ? 'text-gray-100' : 'text-gray-900'}`}
                        style={textStyles}
                      >
                        {match.text}
                      </div>
                      <div className={`mt-1 text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                        Match Score: {typeof match.score === 'number'
                          ? (match.score * 100).toFixed(1)
                          : match.score}%
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}