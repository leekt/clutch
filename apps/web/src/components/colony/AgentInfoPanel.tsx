import { useStore, selectAgentsList } from '../../store';
import { ROLE_COLOR_HEX } from '../../colony/constants';

interface AgentInfoPanelProps {
  agentId: string;
  onClose: () => void;
}

const lifecycleIcons: Record<string, string> = {
  asleep: '[-]',
  waking: '[~]',
  working: '[*]',
  sleeping: '[.]',
};

export function AgentInfoPanel({ agentId, onClose }: AgentInfoPanelProps) {
  const agents = useStore(selectAgentsList);
  const agent = agents.find((a) => a.agentId === agentId);

  if (!agent) return null;

  const roleColor = ROLE_COLOR_HEX[agent.role] ?? '#94a3b8';

  return (
    <div className="absolute bottom-0 left-0 right-56 bg-gray-900/95 border-t border-gray-700 max-h-48 overflow-y-auto">
      <div className="p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: roleColor }}
            />
            <span className="text-sm font-mono font-bold text-gray-200">
              {agent.name}
            </span>
            <span className="text-xs font-mono text-gray-500 uppercase">
              {agent.role}
            </span>
            <span className="text-xs font-mono text-gray-500">
              {lifecycleIcons[agent.lifecycleState ?? 'asleep']}
              {' '}
              {agent.lifecycleState ?? 'asleep'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-xs font-mono"
          >
            [X]
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* Personality */}
          <div>
            <h4 className="text-[10px] font-mono text-gray-500 uppercase mb-1">
              Personality
            </h4>
            <div className="space-y-0.5">
              {agent.personality?.style && (
                <div className="text-xs font-mono text-gray-400">
                  Style: <span className="text-gray-300">{agent.personality.style}</span>
                </div>
              )}
              {agent.personality?.communication && (
                <div className="text-xs font-mono text-gray-400">
                  Comms: <span className="text-gray-300">{agent.personality.communication}</span>
                </div>
              )}
              {agent.personality?.decision_making && (
                <div className="text-xs font-mono text-gray-400">
                  Decides: <span className="text-gray-300">{agent.personality.decision_making}</span>
                </div>
              )}
            </div>
          </div>

          {/* Strengths */}
          <div>
            <h4 className="text-[10px] font-mono text-gray-500 uppercase mb-1">
              Strengths
            </h4>
            <div className="flex flex-wrap gap-1">
              {(agent.strengths ?? []).slice(0, 4).map((s) => (
                <span
                  key={s}
                  className="text-[10px] font-mono px-1 py-0.5 rounded"
                  style={{ backgroundColor: roleColor + '20', color: roleColor }}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div>
            <h4 className="text-[10px] font-mono text-gray-500 uppercase mb-1">
              Stats
            </h4>
            <div className="space-y-0.5">
              <div className="text-xs font-mono text-gray-400">
                Budget: <span className="text-gray-300">${agent.budget.maxCost ?? '?'}</span>
              </div>
              <div className="text-xs font-mono text-gray-400">
                Tokens: <span className="text-gray-300">{agent.budget.maxTokens?.toLocaleString() ?? '?'}</span>
              </div>
              {agent.lastWakeAt && (
                <div className="text-xs font-mono text-gray-400">
                  Last wake: <span className="text-gray-300">{new Date(agent.lastWakeAt).toLocaleTimeString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        {agent.description && (
          <p className="mt-2 text-[10px] font-mono text-gray-500 border-t border-gray-800 pt-1">
            {agent.description}
          </p>
        )}
      </div>
    </div>
  );
}
