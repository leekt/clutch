import { formatDistanceToNow } from 'date-fns';
import { clsx } from 'clsx';
import type { Message } from '../types';
import { useStore } from '../store';

interface MessageCardProps {
  message: Message;
  compact?: boolean;
}

// Map message types to display labels and colors
const typeConfig: Record<
  string,
  { label: string; color: string; bgColor: string }
> = {
  'task.request': {
    label: 'Task Request',
    color: 'text-blue-400',
    bgColor: 'bg-blue-600',
  },
  'task.accept': {
    label: 'Accepted',
    color: 'text-green-400',
    bgColor: 'bg-green-600',
  },
  'task.progress': {
    label: 'Progress',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-600',
  },
  'task.result': {
    label: 'Result',
    color: 'text-green-400',
    bgColor: 'bg-green-600',
  },
  'task.error': {
    label: 'Error',
    color: 'text-red-400',
    bgColor: 'bg-red-600',
  },
  'task.cancel': {
    label: 'Cancelled',
    color: 'text-gray-400',
    bgColor: 'bg-gray-600',
  },
  'task.timeout': {
    label: 'Timeout',
    color: 'text-orange-400',
    bgColor: 'bg-orange-600',
  },
  'chat.message': {
    label: 'Chat',
    color: 'text-gray-300',
    bgColor: 'bg-gray-600',
  },
  'chat.system': {
    label: 'System',
    color: 'text-gray-400',
    bgColor: 'bg-gray-700',
  },
  'tool.call': {
    label: 'Tool Call',
    color: 'text-purple-400',
    bgColor: 'bg-purple-600',
  },
  'tool.result': {
    label: 'Tool Result',
    color: 'text-purple-300',
    bgColor: 'bg-purple-500',
  },
  'tool.error': {
    label: 'Tool Error',
    color: 'text-red-400',
    bgColor: 'bg-red-600',
  },
  'agent.register': {
    label: 'Registered',
    color: 'text-blue-300',
    bgColor: 'bg-blue-500',
  },
  'agent.heartbeat': {
    label: 'Heartbeat',
    color: 'text-gray-400',
    bgColor: 'bg-gray-600',
  },
  'agent.update': {
    label: 'Update',
    color: 'text-blue-300',
    bgColor: 'bg-blue-500',
  },
  'routing.decision': {
    label: 'Routed',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-600',
  },
  'routing.failure': {
    label: 'Routing Failed',
    color: 'text-red-400',
    bgColor: 'bg-red-600',
  },
};

function getAgentInitial(agentId: string): string {
  // Extract name from agent:name format
  const name = agentId.replace('agent:', '');
  return name.charAt(0).toUpperCase();
}

function getAgentName(agentId: string): string {
  return agentId.replace('agent:', '');
}

function formatPayload(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload;
  }
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;

    // Common payload formats
    if (obj.message) return String(obj.message);
    if (obj.description) return String(obj.description);
    if (obj.title) return String(obj.title);
    if (obj.result) return String(obj.result);
    if (obj.error) {
      const err = obj.error as Record<string, unknown>;
      return `Error: ${err.message || err.code || 'Unknown error'}`;
    }

    // Progress update
    if (obj.progress !== undefined) {
      return `Progress: ${obj.progress}%${obj.message ? ` - ${obj.message}` : ''}`;
    }

    // Fallback to JSON
    return JSON.stringify(payload, null, 2);
  }
  return String(payload);
}

export function MessageCard({ message, compact = false }: MessageCardProps) {
  const agents = useStore((s) => s.agents);
  const config = typeConfig[message.type] || {
    label: message.type,
    color: 'text-gray-400',
    bgColor: 'bg-gray-600',
  };

  const agent = agents[message.fromAgentId];
  const agentName = agent?.name || getAgentName(message.fromAgentId);
  const agentInitial = agent?.name?.[0]?.toUpperCase() || getAgentInitial(message.fromAgentId);

  const timeAgo = formatDistanceToNow(new Date(message.createdAt), {
    addSuffix: true,
  });

  const payloadText = formatPayload(message.payload);
  const isError = message.type.includes('error') || message.type.includes('failure');

  if (compact) {
    return (
      <div className="flex items-start gap-2 py-1">
        <span className={clsx('text-xs', config.color)}>{config.label}</span>
        <span className="text-sm text-gray-300 truncate flex-1">
          {payloadText.slice(0, 100)}
        </span>
        <span className="text-xs text-gray-500">{timeAgo}</span>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'rounded-lg p-4',
        isError ? 'bg-red-900/20 border border-red-800' : 'bg-gray-800'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className={clsx(
            'w-10 h-10 rounded flex items-center justify-center flex-shrink-0',
            agent?.status === 'available'
              ? 'bg-green-700'
              : agent?.status === 'busy'
              ? 'bg-yellow-700'
              : 'bg-gray-700'
          )}
        >
          <span className="text-sm font-medium">{agentInitial}</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-semibold">{agentName}</span>
            <span
              className={clsx('px-2 py-0.5 rounded text-xs', config.bgColor)}
            >
              {config.label}
            </span>
            {message.domain && (
              <span className="px-2 py-0.5 rounded text-xs bg-gray-700 text-gray-300">
                {message.domain}
              </span>
            )}
            <span className="text-xs text-gray-400">{timeAgo}</span>
          </div>

          {/* Body */}
          <div className="text-gray-300 text-sm whitespace-pre-wrap">
            {payloadText}
          </div>

          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-700">
              <p className="text-xs text-gray-400 mb-2">Attachments:</p>
              <ul className="space-y-1">
                {message.attachments.map((attachment, index) => (
                  <li
                    key={index}
                    className="flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300"
                  >
                    {attachment.kind === 'artifact_ref' && attachment.ref && (
                      <a
                        href={`/api/artifacts/${attachment.ref}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {attachment.ref}
                      </a>
                    )}
                    {attachment.kind === 'url' && attachment.url && (
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {attachment.url}
                      </a>
                    )}
                    {attachment.kind === 'inline' && (
                      <span className="text-gray-400">Inline content</span>
                    )}
                    {attachment.mimeType && (
                      <span className="text-xs text-gray-500">
                        ({attachment.mimeType})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Metadata */}
          {(message.cost || message.runtime || message.tokens) && (
            <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
              {message.cost && <span>Cost: ${parseFloat(message.cost).toFixed(4)}</span>}
              {message.runtime && <span>Runtime: {message.runtime}ms</span>}
              {message.tokens && <span>Tokens: {message.tokens}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
