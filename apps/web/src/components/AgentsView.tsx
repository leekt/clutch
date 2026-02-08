import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { clsx } from 'clsx';
import { useAgents, useDeleteAgent } from '../hooks/useQueries';
import { useStore, selectAgentsList } from '../store';
import { HireAgentModal } from './HireAgentModal';
import { api } from '../lib/api';
import type { Agent, AgentStatus, AgentLifecycleState } from '../types';

const statusConfig: Record<AgentStatus, { label: string; color: string; bgColor: string }> = {
  available: { label: 'Available', color: 'text-green-400', bgColor: 'bg-green-600' },
  busy: { label: 'Busy', color: 'text-yellow-400', bgColor: 'bg-yellow-600' },
  offline: { label: 'Offline', color: 'text-gray-400', bgColor: 'bg-gray-600' },
};

// Organization OS: Lifecycle state config
const lifecycleConfig: Record<AgentLifecycleState, { label: string; icon: string; color: string }> = {
  asleep: { label: 'Asleep', icon: '💤', color: 'text-gray-400' },
  waking: { label: 'Waking', icon: '⏰', color: 'text-yellow-400' },
  working: { label: 'Working', icon: '⚡', color: 'text-green-400' },
  sleeping: { label: 'Going to sleep', icon: '🌙', color: 'text-blue-400' },
};

// Personality style labels
const personalityLabels = {
  style: {
    analytical: 'Analytical',
    creative: 'Creative',
    systematic: 'Systematic',
    pragmatic: 'Pragmatic',
  },
  communication: {
    concise: 'Concise',
    verbose: 'Verbose',
    formal: 'Formal',
    casual: 'Casual',
  },
  decision_making: {
    'data-driven': 'Data-Driven',
    intuitive: 'Intuitive',
    'consensus-seeking': 'Consensus',
    decisive: 'Decisive',
  },
};

const roleColors: Record<string, string> = {
  pm: 'bg-blue-600',
  research: 'bg-purple-600',
  marketing: 'bg-pink-600',
  developer: 'bg-green-600',
  qa: 'bg-orange-600',
};

export function AgentsView() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<AgentStatus | 'all'>('all');
  const [showHireModal, setShowHireModal] = useState(false);

  const { isLoading } = useAgents();
  const agents = useStore(selectAgentsList);
  const deleteAgent = useDeleteAgent();

  const handleFireAgent = (agent: Agent) => {
    deleteAgent.mutate({ id: agent.id, agentId: agent.agentId }, {
      onSuccess: () => {
        navigate('/agents', { replace: true });
      },
    });
  };

  const handleMessageAgent = async (agent: Agent) => {
    try {
      const channel = await api.channels.findOrCreateDM(agent.agentId);
      navigate(`/channels/${channel.id}`);
    } catch (error) {
      console.error('Failed to open DM:', error);
    }
  };

  // Auto-open hire modal when there are no agents (onboarding)
  const hasNoAgents = !isLoading && agents.length === 0;
  useEffect(() => {
    if (hasNoAgents) {
      setShowHireModal(true);
    }
  }, [hasNoAgents]);

  const filteredAgents = agents.filter((agent) => {
    if (statusFilter === 'all') return true;
    return agent.status === statusFilter;
  });

  const selectedAgent = agentId
    ? agents.find((a) => a.agentId === agentId)
    : null;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-400">Loading agents...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex">
      {/* Agent list */}
      <div className="flex-1 flex flex-col border-r border-gray-700">
        {/* Header */}
        <header className="h-14 px-4 flex items-center justify-between border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold">Agents</h2>
            <span className="text-sm text-gray-400">
              {filteredAgents.length} agent{filteredAgents.length !== 1 ? 's' : ''}
            </span>
          </div>
          <button
            onClick={() => setShowHireModal(true)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm text-white"
          >
            + Hire Agent
          </button>
        </header>

        {/* Filters */}
        <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2">
          {(['all', 'available', 'busy', 'offline'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={clsx(
                'px-3 py-1 rounded-full text-sm capitalize',
                statusFilter === status
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              )}
            >
              {status}
            </button>
          ))}
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto">
          {filteredAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              {hasNoAgents ? (
                <>
                  <h2 className="text-2xl font-semibold text-gray-200 mb-2">Welcome to Clutch</h2>
                  <p className="text-gray-400 mb-6">Hire your first agent to get started.</p>
                  <button
                    onClick={() => setShowHireModal(true)}
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium"
                  >
                    Hire Your First Agent
                  </button>
                </>
              ) : (
                <p className="text-lg mb-2">No agents match this filter</p>
              )}
            </div>
          ) : (
            <div className="divide-y divide-gray-700">
              {filteredAgents.map((agent) => (
                <AgentRow
                  key={agent.agentId}
                  agent={agent}
                  isSelected={agent.agentId === agentId}
                  onMessage={handleMessageAgent}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Agent detail panel */}
      {selectedAgent && <AgentDetailPanel agent={selectedAgent} onFire={handleFireAgent} onMessage={handleMessageAgent} />}

      {/* Hire agent modal */}
      {showHireModal && (
        <HireAgentModal
          onClose={() => {
            // Only allow closing if at least one agent exists
            if (agents.length > 0) {
              setShowHireModal(false);
            }
          }}
        />
      )}
    </div>
  );
}

interface AgentRowProps {
  agent: Agent;
  isSelected: boolean;
  onMessage: (agent: Agent) => void;
}

function AgentRow({ agent, isSelected, onMessage }: AgentRowProps) {
  const config = statusConfig[agent.status];
  const lifecycle = agent.lifecycleState ? lifecycleConfig[agent.lifecycleState] : null;

  return (
    <div
      className={clsx(
        'px-4 py-3 hover:bg-gray-800 transition-colors',
        isSelected && 'bg-gray-800'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Avatar with lifecycle indicator */}
        <a href={`/agents/${agent.agentId}`} className="relative flex-shrink-0">
          <div
            className={clsx(
              'w-10 h-10 rounded flex items-center justify-center',
              roleColors[agent.role] || 'bg-gray-700'
            )}
          >
            <span className="text-sm font-medium">{agent.name[0]}</span>
          </div>
          {lifecycle && (
            <span className="absolute -bottom-1 -right-1 text-xs" title={lifecycle.label}>
              {lifecycle.icon}
            </span>
          )}
        </a>

        {/* Content */}
        <a href={`/agents/${agent.agentId}`} className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium">{agent.name}</h3>
            <span
              className={clsx(
                'w-2 h-2 rounded-full',
                config.bgColor
              )}
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span className="capitalize">{agent.role}</span>
            <span className={config.color}>{config.label}</span>
            {lifecycle && (
              <span className={clsx('text-xs', lifecycle.color)}>
                · {lifecycle.label}
              </span>
            )}
          </div>
          {agent.strengths && agent.strengths.length > 0 ? (
            <div className="flex gap-1 mt-1 flex-wrap">
              {agent.strengths.slice(0, 3).map((strength) => (
                <span
                  key={strength}
                  className="px-1.5 py-0.5 bg-gray-700/50 rounded text-xs text-gray-400"
                >
                  {strength.replace(/_/g, ' ')}
                </span>
              ))}
              {agent.strengths.length > 3 && (
                <span className="text-xs text-gray-500">+{agent.strengths.length - 3}</span>
              )}
            </div>
          ) : agent.description && (
            <p className="text-sm text-gray-500 mt-1 truncate">
              {agent.description}
            </p>
          )}
        </a>

        {/* Message button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMessage(agent);
          }}
          className="mt-1 px-3 py-1.5 bg-gray-700 hover:bg-blue-600 rounded text-xs text-gray-300 hover:text-white transition-colors flex-shrink-0"
          title={`Message ${agent.name}`}
        >
          Message
        </button>
      </div>
    </div>
  );
}

interface AgentDetailPanelProps {
  agent: Agent;
  onFire: (agent: Agent) => void;
  onMessage: (agent: Agent) => void;
}

function AgentDetailPanel({ agent, onFire, onMessage }: AgentDetailPanelProps) {
  const [confirmFire, setConfirmFire] = useState(false);
  const config = statusConfig[agent.status];
  const lifecycle = agent.lifecycleState ? lifecycleConfig[agent.lifecycleState] : null;

  return (
    <aside className="w-96 bg-gray-850 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-3 mb-3">
          <div className="relative">
            <div
              className={clsx(
                'w-12 h-12 rounded flex items-center justify-center',
                roleColors[agent.role] || 'bg-gray-700'
              )}
            >
              <span className="text-lg font-medium">{agent.name[0]}</span>
            </div>
            {lifecycle && (
              <span className="absolute -bottom-1 -right-1 text-sm" title={lifecycle.label}>
                {lifecycle.icon}
              </span>
            )}
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold">{agent.name}</h3>
            <p className="text-sm text-gray-400 capitalize">{agent.role}</p>
          </div>
          <button
            onClick={() => onMessage(agent)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm text-white"
          >
            Message
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={clsx(
              'w-2 h-2 rounded-full',
              config.bgColor
            )}
          />
          <span className={config.color}>{config.label}</span>
          {lifecycle && (
            <span className={clsx('text-xs px-2 py-0.5 rounded-full bg-gray-700', lifecycle.color)}>
              {lifecycle.label}
            </span>
          )}
          {agent.lastHeartbeat && (
            <span className="text-xs text-gray-500">
              · Last seen {formatDistanceToNow(new Date(agent.lastHeartbeat), { addSuffix: true })}
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      {agent.description && (
        <div className="px-4 py-3 border-b border-gray-700">
          <p className="text-sm text-gray-300">{agent.description}</p>
        </div>
      )}

      {/* Personality (Organization OS) */}
      {agent.personality && Object.keys(agent.personality).length > 0 && (
        <div className="px-4 py-3 border-b border-gray-700">
          <h4 className="text-sm font-medium text-gray-400 mb-2">Personality</h4>
          <div className="flex flex-wrap gap-2">
            {agent.personality.style && (
              <span className="px-2 py-1 bg-purple-600/20 text-purple-300 rounded text-xs">
                {personalityLabels.style[agent.personality.style]}
              </span>
            )}
            {agent.personality.communication && (
              <span className="px-2 py-1 bg-blue-600/20 text-blue-300 rounded text-xs">
                {personalityLabels.communication[agent.personality.communication]}
              </span>
            )}
            {agent.personality.decision_making && (
              <span className="px-2 py-1 bg-green-600/20 text-green-300 rounded text-xs">
                {personalityLabels.decision_making[agent.personality.decision_making]}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Strengths (Organization OS) */}
      {agent.strengths && agent.strengths.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-700">
          <h4 className="text-sm font-medium text-gray-400 mb-2">Strengths</h4>
          <div className="flex flex-wrap gap-1">
            {agent.strengths.map((strength) => (
              <span
                key={strength}
                className="px-2 py-0.5 bg-emerald-600/20 text-emerald-300 rounded text-xs"
              >
                {strength.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Operating Rules (Organization OS) */}
      {agent.operatingRules && agent.operatingRules.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-700">
          <h4 className="text-sm font-medium text-gray-400 mb-2">Operating Rules</h4>
          <ul className="space-y-1">
            {agent.operatingRules.map((rule, idx) => (
              <li key={idx} className="text-xs text-gray-300 flex gap-2">
                <span className="text-gray-500">•</span>
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Preferred Collaborators (Organization OS) */}
      {agent.preferredCollaborators && agent.preferredCollaborators.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-700">
          <h4 className="text-sm font-medium text-gray-400 mb-2">Preferred Collaborators</h4>
          <div className="flex flex-wrap gap-1">
            {agent.preferredCollaborators.map((collab) => (
              <span
                key={collab}
                className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300"
              >
                {collab.replace('agent:', '')}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Capabilities */}
      <div className="px-4 py-3 border-b border-gray-700">
        <h4 className="text-sm font-medium text-gray-400 mb-2">Capabilities</h4>
        <div className="flex flex-wrap gap-1">
          {agent.capabilities.length === 0 ? (
            <span className="text-sm text-gray-500">No capabilities defined</span>
          ) : (
            agent.capabilities.map((cap) => (
              <span
                key={cap.id}
                className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300"
              >
                {cap.id}
                {cap.version && <span className="text-gray-500 ml-1">v{cap.version}</span>}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Permissions */}
      <div className="px-4 py-3 border-b border-gray-700">
        <h4 className="text-sm font-medium text-gray-400 mb-2">Permissions</h4>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(agent.permissions).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <span
                className={clsx(
                  'w-4 h-4 rounded flex items-center justify-center text-xs',
                  value ? 'bg-green-600' : 'bg-gray-700'
                )}
              >
                {value ? '✓' : '×'}
              </span>
              <span className="text-sm capitalize">{key}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Budget */}
      <div className="px-4 py-3 border-b border-gray-700">
        <h4 className="text-sm font-medium text-gray-400 mb-2">Budget Limits</h4>
        <div className="space-y-2">
          {agent.budget.maxTokens !== undefined && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Max Tokens</span>
              <span className="text-gray-300">
                {agent.budget.maxTokens.toLocaleString()}
              </span>
            </div>
          )}
          {agent.budget.maxCost !== undefined && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Max Cost</span>
              <span className="text-gray-300">${agent.budget.maxCost}</span>
            </div>
          )}
          {agent.budget.maxRuntime !== undefined && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Max Runtime</span>
              <span className="text-gray-300">{agent.budget.maxRuntime}s</span>
            </div>
          )}
          {Object.values(agent.budget).every((v) => v === undefined) && (
            <span className="text-sm text-gray-500">No limits set</span>
          )}
        </div>
      </div>

      {/* Session Info (Organization OS) */}
      {(agent.lastWakeAt || agent.lastSleepAt) && (
        <div className="px-4 py-3 border-b border-gray-700">
          <h4 className="text-sm font-medium text-gray-400 mb-2">Session Info</h4>
          <div className="space-y-1 text-xs">
            {agent.lastWakeAt && (
              <div className="flex justify-between">
                <span className="text-gray-400">Last Wake</span>
                <span className="text-gray-300">
                  {formatDistanceToNow(new Date(agent.lastWakeAt), { addSuffix: true })}
                </span>
              </div>
            )}
            {agent.lastSleepAt && (
              <div className="flex justify-between">
                <span className="text-gray-400">Last Sleep</span>
                <span className="text-gray-300">
                  {formatDistanceToNow(new Date(agent.lastSleepAt), { addSuffix: true })}
                </span>
              </div>
            )}
            {agent.currentSessionId && (
              <div className="flex justify-between">
                <span className="text-gray-400">Session</span>
                <code className="text-gray-500 font-mono">{agent.currentSessionId.slice(0, 12)}...</code>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ID */}
      <div className="px-4 py-3 border-b border-gray-700">
        <h4 className="text-sm font-medium text-gray-400 mb-1">Agent ID</h4>
        <code className="text-xs text-gray-500 font-mono">{agent.agentId}</code>
      </div>

      {/* Fire agent */}
      <div className="px-4 py-3 mt-auto">
        {confirmFire ? (
          <div className="space-y-2">
            <p className="text-sm text-red-400">Fire {agent.name}? This cannot be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={() => onFire(agent)}
                className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded text-sm text-white"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmFire(false)}
                className="flex-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmFire(true)}
            className="w-full px-3 py-1.5 bg-gray-800 hover:bg-red-900/50 border border-gray-700 hover:border-red-700 rounded text-sm text-gray-400 hover:text-red-400 transition-colors"
          >
            Fire Agent
          </button>
        )}
      </div>
    </aside>
  );
}
