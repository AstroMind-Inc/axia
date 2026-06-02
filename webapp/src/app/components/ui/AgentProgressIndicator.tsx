"use client";
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Check, Clock, AlertTriangle, Wrench, CheckCircle, XCircle } from 'lucide-react';
import ToolOutputRenderer from './ToolOutputRenderer';

interface ToolExecution {
  tool_name: string;
  arguments: Record<string, any>;
  result?: any;
  error?: string;
  status: 'success' | 'error';
  execution_time_ms: number;
  iteration: number;
}

interface AgentUpdate {
  type: 'start' | 'progress' | 'result' | 'final' | 'complete' | 'error' | 'artifact';
  agent?: string;
  step?: number;
  status?: string;
  message?: string;
  content?: string;
  full_result?: any;
  error?: string;
  total_steps?: number;
  tool_executions?: ToolExecution[];
  artifacts?: any[];
  artifact?: {
    type: string;
    name: string;
    description?: string;
    data: any;
    format: string;
  };
}

interface AgentStep {
  agent: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  message?: string;
  content?: string;
  step?: number;
  tool_executions?: ToolExecution[];
  artifacts?: any[];
}

interface AgentProgressIndicatorProps {
  updates: AgentUpdate[];
  isStreaming: boolean;
}

// Tool Execution Card Component
const ToolExecutionCard: React.FC<{ execution: ToolExecution }> = ({ execution }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <Wrench className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">{execution.tool_name}</span>
          {execution.status === 'success' ? (
            <CheckCircle className="w-4 h-4 text-green-500" />
          ) : (
            <XCircle className="w-4 h-4 text-red-500" />
          )}
          <span className="text-xs text-gray-500">({execution.execution_time_ms}ms)</span>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-500" />
        )}
      </button>

      {isExpanded && (
        <div className="px-3 py-2 border-t border-gray-200 bg-gray-50 space-y-2">
          {/* Arguments */}
          <div>
            <h6 className="text-xs font-semibold text-gray-600 mb-1">Arguments:</h6>
            <pre className="text-xs bg-white p-2 rounded border border-gray-200 overflow-x-auto">
              {JSON.stringify(execution.arguments, null, 2)}
            </pre>
          </div>

          {/* Result or Error */}
          <div>
            <h6 className="text-xs font-semibold text-gray-600 mb-1">
              {execution.status === 'success' ? 'Response:' : 'Error:'}
            </h6>
            {execution.status === 'success' ? (
              <ToolOutputRenderer 
                result={execution.result} 
                toolName={execution.tool_name}
              />
            ) : (
              <pre className="text-xs p-2 rounded border overflow-x-auto max-h-48 overflow-y-auto bg-red-50 border-red-200 text-red-900">
                {execution.error}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const AgentProgressIndicator: React.FC<AgentProgressIndicatorProps> = ({ 
  updates, 
  isStreaming 
}) => {
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  
  // Auto-expand agents that have tool executions or artifacts
  React.useEffect(() => {
    updates.forEach(update => {
      if (update.agent === 'ToolAgent' && update.tool_executions && update.tool_executions.length > 0) {
        setExpandedAgents(prev => new Set(prev).add('ToolAgent'));
      }
      if (update.agent === 'MetadataAnalyst' && update.artifacts && update.artifacts.length > 0) {
        setExpandedAgents(prev => new Set(prev).add('MetadataAnalyst'));
      }
    });
  }, [updates]);

  // Process updates to create agent steps
  const agentSteps: AgentStep[] = React.useMemo(() => {
    const stepMap = new Map<string, AgentStep>();
    
    // Initialize default agents in order
    const defaultAgents = ['EventAnalyst', 'MetadataAnalyst', 'NeighborAnalyst', 'Critic', 'ToolAgent', 'ConversationModerator'];
    defaultAgents.forEach((agent, index) => {
      stepMap.set(agent, {
        agent,
        status: 'pending',
        step: index + 1
      });
    });

    // Process updates to update agent statuses
    updates.forEach(update => {
      if (update.agent) {
        const existing = stepMap.get(update.agent) || {
          agent: update.agent,
          status: 'pending' as const,
          step: update.step
        };

        switch (update.type) {
          case 'progress':
            stepMap.set(update.agent, {
              ...existing,
              status: 'running',
              message: update.message,
              step: update.step
            });
            break;
          case 'artifact':
            // Accumulate artifacts for the agent
            const existingArtifacts = existing.artifacts || [];
            stepMap.set(update.agent, {
              ...existing,
              artifacts: [...existingArtifacts, update.artifact]
            });
            break;
          case 'result':
          case 'final':
            stepMap.set(update.agent, {
              ...existing,
              status: 'completed',
              message: update.message,
              content: update.content,
              step: update.step,
              tool_executions: update.tool_executions,
              artifacts: update.artifacts || existing.artifacts
            });
            break;
          case 'error':
            stepMap.set(update.agent, {
              ...existing,
              status: 'error',
              message: update.message || update.error,
              step: update.step
            });
            break;
        }
      }
    });

    // Filter out NeighborAnalyst if it wasn't actually used
    const hasNeighborUpdate = updates.some(u => u.agent === 'NeighborAnalyst');
    if (!hasNeighborUpdate) {
      stepMap.delete('NeighborAnalyst');
    }

    return Array.from(stepMap.values()).sort((a, b) => (a.step || 0) - (b.step || 0));
  }, [updates]);

  const toggleExpanded = (agent: string) => {
    const newExpanded = new Set(expandedAgents);
    if (newExpanded.has(agent)) {
      newExpanded.delete(agent);
    } else {
      newExpanded.add(agent);
    }
    setExpandedAgents(newExpanded);
  };

  const getStatusIcon = (status: AgentStep['status']) => {
    switch (status) {
      case 'completed':
        return <Check className="w-5 h-5 text-green-500" />;
      case 'running':
        return <Clock className="w-5 h-5 text-blue-500 animate-pulse" />;
      case 'error':
        return <AlertTriangle className="w-5 h-5 text-red-500" />;
      default:
        return <div className="w-5 h-5 border-2 border-gray-300 rounded-full" />;
    }
  };

  const getStatusColor = (status: AgentStep['status']) => {
    switch (status) {
      case 'completed':
        return 'border-green-500 bg-green-50';
      case 'running':
        return 'border-blue-500 bg-blue-50 shadow-md';
      case 'error':
        return 'border-red-500 bg-red-50';
      default:
        return 'border-gray-300 bg-gray-50';
    }
  };

  if (!isStreaming && agentSteps.length === 0) {
    return null;
  }

  return (
    <div className="w-full space-y-3 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800">
          Multi-Agent Analysis Progress
        </h3>
        {isStreaming && (
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
            <span className="text-sm text-blue-600 font-medium">Processing...</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {agentSteps.map((step, index) => (
          <div
            key={step.agent}
            className={`border-2 rounded-lg transition-all duration-200 ${getStatusColor(step.status)}`}
          >
            <div className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  {getStatusIcon(step.status)}
                  <div>
                    <h4 className="font-medium text-gray-800">
                      {step.step}. {step.agent}
                    </h4>
                    {step.message && (
                      <p className="text-sm text-gray-600 mt-1">{step.message}</p>
                    )}
                  </div>
                </div>
                
                {(step.content || (step.tool_executions && step.tool_executions.length > 0) || (step.artifacts && step.artifacts.length > 0)) && (
                  <button
                    onClick={() => toggleExpanded(step.agent)}
                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                  >
                    {expandedAgents.has(step.agent) ? (
                      <ChevronDown className="w-5 h-5 text-gray-500" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-gray-500" />
                    )}
                  </button>
                )}
              </div>

              {(step.content || (step.tool_executions && step.tool_executions.length > 0) || (step.artifacts && step.artifacts.length > 0)) && expandedAgents.has(step.agent) && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  {step.content && (
                    <div className="bg-gray-100 rounded-md p-3">
                      <h5 className="text-sm font-medium text-gray-700 mb-2">
                        {step.agent} Result:
                      </h5>
                      <div className="text-sm text-gray-600 whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {step.content}
                      </div>
                    </div>
                  )}

                  {/* Tool Executions Section */}
                  {step.tool_executions && step.tool_executions.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <h5 className="text-sm font-medium text-gray-700 mb-2">
                        Tool Calls ({step.tool_executions.length}):
                      </h5>
                      {step.tool_executions.map((toolExec, idx) => (
                        <ToolExecutionCard key={idx} execution={toolExec} />
                      ))}
                    </div>
                  )}

                  {/* Artifacts Section */}
                  {step.artifacts && step.artifacts.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <h5 className="text-sm font-medium text-gray-700 mb-2">
                        Visual Analysis ({step.artifacts.length}):
                      </h5>
                      {step.artifacts.map((artifact, idx) => (
                        <div key={idx} className="bg-white border border-gray-200 rounded-md overflow-hidden">
                          <div className="px-3 py-2 bg-gray-50 border-b border-gray-200">
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="text-sm font-medium text-gray-700">{artifact.name}</span>
                                {artifact.description && (
                                  <p className="text-xs text-gray-500 mt-0.5">{artifact.description}</p>
                                )}
                              </div>
                              <span className="text-xs text-gray-500 px-2 py-1 bg-gray-200 rounded">
                                {artifact.type}
                              </span>
                            </div>
                          </div>
                          <div className="p-3">
                            <ToolOutputRenderer 
                              result={{ data: artifact.data, format: artifact.format, type: artifact.type }} 
                              toolName={artifact.name}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="mt-4">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Progress</span>
          <span>
            {agentSteps.filter(s => s.status === 'completed').length} / {agentSteps.length} completed
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-300 ease-out"
            style={{
              width: `${(agentSteps.filter(s => s.status === 'completed').length / agentSteps.length) * 100}%`
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default AgentProgressIndicator;