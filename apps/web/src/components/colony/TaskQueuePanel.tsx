import { clsx } from 'clsx';
import { useStore, selectActiveTasksList } from '../../store';

const stateColors: Record<string, string> = {
  created: 'bg-gray-500',
  assigned: 'bg-blue-500',
  running: 'bg-yellow-500',
  review: 'bg-purple-500',
  rework: 'bg-orange-500',
  done: 'bg-green-500',
  cancelled: 'bg-gray-500',
  failed: 'bg-red-500',
};

export function TaskQueuePanel() {
  const tasks = useStore(selectActiveTasksList);

  return (
    <div className="absolute top-10 right-0 w-56 max-h-[60vh] bg-gray-900/90 border-l border-gray-700 overflow-y-auto">
      <div className="p-2 border-b border-gray-700">
        <h3 className="text-xs font-mono text-gray-400 uppercase tracking-wider">
          Task Queue ({tasks.length})
        </h3>
      </div>

      {tasks.length === 0 ? (
        <div className="p-3 text-xs text-gray-500 font-mono">No active tasks</div>
      ) : (
        <ul className="divide-y divide-gray-800">
          {tasks.slice(0, 15).map((task) => (
            <li key={task.taskId} className="p-2 hover:bg-gray-800/50">
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className={clsx('w-1.5 h-1.5 rounded-full', stateColors[task.state])}
                />
                <span className="text-[10px] text-gray-500 font-mono uppercase">
                  {task.state}
                </span>
              </div>
              <p className="text-xs text-gray-300 font-mono truncate">
                {task.title}
              </p>
              {task.assignee && (
                <p className="text-[10px] text-gray-500 font-mono mt-0.5">
                  &gt; {task.assignee.name}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
