import { useColonyStore } from '../../store/colony';

const EVENT_ICONS: Record<string, string> = {
  'task.assigned': '>>',
  'task.completed': '[OK]',
  'task.failed': '[!!]',
  'agent.woke': '(+)',
  'agent.slept': '(-)',
};

const EVENT_COLORS: Record<string, string> = {
  'task.assigned': 'text-blue-400',
  'task.completed': 'text-green-400',
  'task.failed': 'text-red-400',
  'agent.woke': 'text-yellow-400',
  'agent.slept': 'text-gray-500',
};

export function EventTicker() {
  const { recentEvents } = useColonyStore();

  if (recentEvents.length === 0) {
    return (
      <div className="absolute top-0 left-0 right-0 h-8 bg-gray-900/80 border-b border-gray-700 flex items-center px-4">
        <span className="text-xs text-gray-500 font-mono">
          Waiting for events...
        </span>
      </div>
    );
  }

  return (
    <div className="absolute top-0 left-0 right-0 h-8 bg-gray-900/80 border-b border-gray-700 flex items-center overflow-hidden">
      <div className="flex items-center gap-6 px-4 animate-scroll">
        {recentEvents.slice(0, 10).map((event, i) => (
          <div key={i} className="flex items-center gap-1 whitespace-nowrap">
            <span className={`text-xs font-mono ${EVENT_COLORS[event.type] ?? 'text-gray-400'}`}>
              {EVENT_ICONS[event.type] ?? '[-]'}
            </span>
            <span className="text-xs text-gray-300 font-mono">
              {event.agentName && <span className="text-gray-400">{event.agentName}: </span>}
              {event.taskTitle ?? event.type}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
