import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { clsx } from 'clsx';
import { useTasks, useCreateTask, usePendingReviews } from '../hooks/useQueries';
import { useStore, selectTasksList } from '../store';
import type { Task, TaskState } from '../types';

const stateConfig: Record<TaskState, { label: string; color: string; bgColor: string }> = {
  created: { label: 'Created', color: 'text-gray-400', bgColor: 'bg-gray-600' },
  assigned: { label: 'Assigned', color: 'text-blue-400', bgColor: 'bg-blue-600' },
  running: { label: 'Running', color: 'text-yellow-400', bgColor: 'bg-yellow-600' },
  review: { label: 'In Review', color: 'text-purple-400', bgColor: 'bg-purple-600' },
  rework: { label: 'Rework', color: 'text-orange-400', bgColor: 'bg-orange-600' },
  done: { label: 'Done', color: 'text-green-400', bgColor: 'bg-green-600' },
  cancelled: { label: 'Cancelled', color: 'text-gray-500', bgColor: 'bg-gray-700' },
  failed: { label: 'Failed', color: 'text-red-400', bgColor: 'bg-red-600' },
};

const stateFilters: { value: TaskState | 'all' | 'active'; label: string }[] = [
  { value: 'all', label: 'All Tasks' },
  { value: 'active', label: 'Active' },
  { value: 'created', label: 'Created' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'running', label: 'Running' },
  { value: 'review', label: 'In Review' },
  { value: 'done', label: 'Done' },
  { value: 'failed', label: 'Failed' },
];

export function TasksView() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();

  const [stateFilter, setStateFilter] = useState<TaskState | 'all' | 'active'>('active');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const { isLoading } = useTasks();
  const tasks = useStore(selectTasksList);
  const { setSelectedTask } = useStore();
  const { data: pendingReviews } = usePendingReviews();

  const filteredTasks = tasks.filter((task) => {
    if (stateFilter === 'all') return true;
    if (stateFilter === 'active') {
      return !['done', 'cancelled', 'failed'].includes(task.state);
    }
    return task.state === stateFilter;
  });

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task.taskId);
    navigate(`/tasks/${task.taskId}`);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-gray-400">Loading tasks...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <header className="h-14 px-4 flex items-center justify-between border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">Tasks</h2>
          <span className="text-sm text-gray-400">
            {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
          </span>
          {pendingReviews && pendingReviews.length > 0 && (
            <span className="px-2 py-0.5 bg-purple-600 rounded text-xs">
              {pendingReviews.length} pending review{pendingReviews.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium"
        >
          New Task
        </button>
      </header>

      {/* Filters */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center gap-2 overflow-x-auto">
        {stateFilters.map((filter) => (
          <button
            key={filter.value}
            onClick={() => setStateFilter(filter.value)}
            className={clsx(
              'px-3 py-1 rounded-full text-sm whitespace-nowrap',
              stateFilter === filter.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <p className="text-lg mb-2">No tasks found</p>
            <p className="text-sm">
              {stateFilter === 'all'
                ? 'Create a new task to get started.'
                : `No tasks in "${stateFilters.find((f) => f.value === stateFilter)?.label}" state.`}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {filteredTasks.map((task) => (
              <TaskRow
                key={task.taskId}
                task={task}
                isSelected={task.taskId === taskId}
                onClick={() => handleTaskClick(task)}
                hasPendingReview={pendingReviews?.some((r) => r.taskId === task.taskId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create task modal */}
      {showCreateForm && (
        <CreateTaskModal onClose={() => setShowCreateForm(false)} />
      )}
    </div>
  );
}

interface TaskRowProps {
  task: Task;
  isSelected: boolean;
  onClick: () => void;
  hasPendingReview?: boolean;
}

function TaskRow({ task, isSelected, onClick, hasPendingReview }: TaskRowProps) {
  const config = stateConfig[task.state];
  const agents = useStore((s) => s.agents);
  const assignee = task.assigneeId
    ? Object.values(agents).find((a) => a.id === task.assigneeId)
    : null;

  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full px-4 py-3 text-left hover:bg-gray-800 transition-colors',
        isSelected && 'bg-gray-800'
      )}
    >
      <div className="flex items-start gap-3">
        {/* State indicator */}
        <div
          className={clsx(
            'w-3 h-3 rounded-full mt-1.5 flex-shrink-0',
            config.bgColor
          )}
        />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium truncate">{task.title}</h3>
            {hasPendingReview && (
              <span className="px-2 py-0.5 bg-purple-600 rounded text-xs flex-shrink-0">
                Review needed
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-sm text-gray-400">
            <span className={config.color}>{config.label}</span>
            {assignee && (
              <span className="flex items-center gap-1">
                <span className="w-4 h-4 rounded bg-gray-700 flex items-center justify-center text-xs">
                  {assignee.name[0]}
                </span>
                {assignee.name}
              </span>
            )}
            <span>
              {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
            </span>
          </div>

          {task.description && (
            <p className="mt-1 text-sm text-gray-400 line-clamp-2">
              {task.description}
            </p>
          )}

          {task.error && (
            <p className="mt-1 text-sm text-red-400">
              Error: {task.error.message}
            </p>
          )}
        </div>

        {/* ID */}
        <span className="text-xs text-gray-500 flex-shrink-0">
          {task.taskId.slice(0, 12)}...
        </span>
      </div>
    </button>
  );
}

interface CreateTaskModalProps {
  onClose: () => void;
}

function CreateTaskModal({ onClose }: CreateTaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const createTask = useCreateTask();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      await createTask.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
      });
      onClose();
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Create New Task</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter task title"
              className="w-full bg-gray-700 rounded px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter task description (optional)"
              rows={4}
              className="w-full bg-gray-700 rounded px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || createTask.isPending}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-medium"
            >
              {createTask.isPending ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
