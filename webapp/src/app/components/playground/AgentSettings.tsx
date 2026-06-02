"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Settings, X, CheckCircle2, Circle } from 'lucide-react';

export interface AgentConfig {
  eventAnalyst: boolean;
  metadataAnalyst: boolean;
  neighborAnalyst: boolean;
  critic: boolean;
  toolAgent: boolean;
  // conversationModerator is always true (required)
}

interface AgentSettingsProps {
  value: AgentConfig;
  onChange: (config: AgentConfig) => void;
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  eventAnalyst: true,
  metadataAnalyst: true,
  neighborAnalyst: true,
  critic: true,
  toolAgent: true,
};

export default function AgentSettings({ value, onChange }: AgentSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleToggle = (agent: keyof AgentConfig) => {
    onChange({
      ...value,
      [agent]: !value[agent],
    });
  };

  const agents = [
    {
      key: 'eventAnalyst' as keyof AgentConfig,
      label: 'Event Analyst',
      description: 'Analyzes X-ray event data with specialized fine-tuned model',
      disabled: false,
    },
    {
      key: 'metadataAnalyst' as keyof AgentConfig,
      label: 'Metadata Analyst',
      description: 'Analyzes metadata and spectral characteristics',
      disabled: false,
    },
    {
      key: 'neighborAnalyst' as keyof AgentConfig,
      label: 'Neighbor Analyst',
      description: 'Compares with similar sources in the dataset',
      disabled: false,
    },
    {
      key: 'critic' as keyof AgentConfig,
      label: 'Critic',
      description: 'Performs critical review of all analyses',
      disabled: false,
    },
    {
      key: 'toolAgent' as keyof AgentConfig,
      label: 'Tool Agent',
      description: 'Dynamic research assistant with external tools',
      disabled: false,
    },
  ];

  const enabledCount = Object.values(value).filter(Boolean).length;

  return (
    <div className="relative inline-block">
      {/* Settings Button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors relative"
        title="Agent Settings"
      >
        <Settings className="w-5 h-5 text-gray-600 dark:text-gray-400" />
        {/* Badge showing number of enabled agents */}
        <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
          {enabledCount}
        </span>
      </button>

      {/* Popup */}
      {isOpen && (
        <div
          ref={popupRef}
          className="absolute right-0 bottom-full mb-2 w-96 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Multi-Agent Configuration
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Select which agents to include in analysis
              </p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          {/* Agent List */}
          <div className="p-2 max-h-96 overflow-y-auto">
            {agents.map((agent) => (
              <button
                key={agent.key}
                onClick={() => !agent.disabled && handleToggle(agent.key)}
                disabled={agent.disabled}
                className={`w-full flex items-start gap-3 p-3 rounded-lg transition-colors ${
                  agent.disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer'
                }`}
              >
                {/* Checkbox */}
                <div className="flex-shrink-0 mt-0.5">
                  {value[agent.key] ? (
                    <CheckCircle2 className="w-5 h-5 text-blue-500" />
                  ) : (
                    <Circle className="w-5 h-5 text-gray-300 dark:text-gray-600" />
                  )}
                </div>

                {/* Agent Info */}
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {agent.label}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {agent.description}
                  </div>
                </div>
              </button>
            ))}

            {/* Always-enabled moderator (info only) */}
            <div className="w-full flex items-start gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 mt-2 border border-blue-200 dark:border-blue-800">
              <div className="flex-shrink-0 mt-0.5">
                <CheckCircle2 className="w-5 h-5 text-blue-500" />
              </div>
              <div className="flex-1 text-left">
                <div className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  Conversation Moderator
                </div>
                <div className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                  Final synthesis (always enabled)
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
            <button
              onClick={() => onChange(DEFAULT_AGENT_CONFIG)}
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
            >
              Reset to defaults
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { DEFAULT_AGENT_CONFIG };

