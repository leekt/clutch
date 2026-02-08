import { useState } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { clsx } from 'clsx';
import {
  useTask,
  useMessagesByTask,
  useReviewsByTask,
  useArtifactsByTask,
  useApproveReview,
  useRejectReview,
  useUpdateTaskState,
} from '../hooks/useQueries';
import { useStore } from '../store';
import { MessageCard } from './MessageCard';
import type { TaskState, Review } from '../types';

interface TaskDetailPanelProps {
  taskId: string;
}

const stateConfig: Record<TaskState, { label: string; color: string }> = {
  created: { label: 'Created', color: 'bg-gray-600' },
  assigned: { label: 'Assigned', color: 'bg-blue-600' },
  running: { label: 'Running', color: 'bg-yellow-600' },
  review: { label: 'In Review', color: 'bg-purple-600' },
  rework: { label: 'Rework', color: 'bg-orange-600' },
  done: { label: 'Done', color: 'bg-green-600' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-600' },
  failed: { label: 'Failed', color: 'bg-red-600' },
};

export function TaskDetailPanel({ taskId }: TaskDetailPanelProps) {
  const { setRightPanel } = useStore();
  const [activeTab, setActiveTab] = useState<'messages' | 'reviews' | 'artifacts'>('messages');

  const { data: task, isLoading: taskLoading } = useTask(taskId);
  const { data: messages, isLoading: messagesLoading } = useMessagesByTask(taskId);
  const { data: reviews } = useReviewsByTask(taskId);
  const { data: artifactsData } = useArtifactsByTask(taskId);

  const agents = useStore((s) => s.agents);
  const assignee = task?.assigneeId
    ? Object.values(agents).find((a) => a.id === task.assigneeId)
    : null;

  const pendingReview = reviews?.find((r) => r.status === 'pending');

  if (taskLoading) {
    return (
      <aside className="w-96 bg-gray-850 border-l border-gray-700 flex items-center justify-center">
        <div className="text-gray-400">Loading task...</div>
      </aside>
    );
  }

  if (!task) {
    return (
      <aside className="w-96 bg-gray-850 border-l border-gray-700 flex items-center justify-center">
        <div className="text-gray-400">Task not found</div>
      </aside>
    );
  }

  const config = stateConfig[task.state];

  return (
    <aside className="w-96 bg-gray-850 border-l border-gray-700 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <span className={clsx('px-2 py-0.5 rounded text-xs', config.color)}>
            {config.label}
          </span>
          <button
            onClick={() => setRightPanel(false)}
            className="text-gray-400 hover:text-white"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <h3 className="text-lg font-semibold">{task.title}</h3>
        {task.description && (
          <p className="text-sm text-gray-400 mt-1">{task.description}</p>
        )}
      </div>

      {/* Meta info */}
      <div className="px-4 py-3 border-b border-gray-700 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Task ID</span>
          <span className="text-gray-300 font-mono text-xs">{task.taskId}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Run ID</span>
          <span className="text-gray-300 font-mono text-xs">{task.runId}</span>
        </div>
        {assignee && (
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Assignee</span>
            <span className="flex items-center gap-1">
              <span className="w-5 h-5 rounded bg-gray-700 flex items-center justify-center text-xs">
                {assignee.name[0]}
              </span>
              {assignee.name}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-gray-400">Created</span>
          <span className="text-gray-300">
            {format(new Date(task.createdAt), 'MMM d, yyyy HH:mm')}
          </span>
        </div>
        {task.startedAt && (
          <div className="flex justify-between">
            <span className="text-gray-400">Started</span>
            <span className="text-gray-300">
              {formatDistanceToNow(new Date(task.startedAt), { addSuffix: true })}
            </span>
          </div>
        )}
        {task.completedAt && (
          <div className="flex justify-between">
            <span className="text-gray-400">Completed</span>
            <span className="text-gray-300">
              {formatDistanceToNow(new Date(task.completedAt), { addSuffix: true })}
            </span>
          </div>
        )}
      </div>

      {/* Pending review banner */}
      {pendingReview && (
        <ReviewBanner review={pendingReview} taskId={taskId} />
      )}

      {/* Error display */}
      {task.error && (
        <div className="px-4 py-3 bg-red-900/20 border-b border-red-800">
          <p className="text-sm text-red-400 font-medium">
            Error: {task.error.code}
          </p>
          <p className="text-sm text-red-300 mt-1">{task.error.message}</p>
          {task.error.retryable && (
            <p className="text-xs text-red-400 mt-1">This error is retryable</p>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        {(['messages', 'reviews', 'artifacts'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              'flex-1 px-4 py-2 text-sm font-medium capitalize',
              activeTab === tab
                ? 'text-white border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-white'
            )}
          >
            {tab}
            {tab === 'messages' && messages && (
              <span className="ml-1 text-gray-500">({messages.length})</span>
            )}
            {tab === 'reviews' && reviews && (
              <span className="ml-1 text-gray-500">({reviews.length})</span>
            )}
            {tab === 'artifacts' && artifactsData && (
              <span className="ml-1 text-gray-500">({artifactsData.count})</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'messages' && (
          <div className="space-y-3">
            {messagesLoading ? (
              <div className="text-gray-400 text-center py-4">Loading...</div>
            ) : !messages || messages.length === 0 ? (
              <div className="text-gray-500 text-center py-4">No messages</div>
            ) : (
              messages.map((message) => (
                <MessageCard key={message.messageId} message={message} compact />
              ))
            )}
          </div>
        )}

        {activeTab === 'reviews' && (
          <div className="space-y-3">
            {!reviews || reviews.length === 0 ? (
              <div className="text-gray-500 text-center py-4">No reviews</div>
            ) : (
              reviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))
            )}
          </div>
        )}

        {activeTab === 'artifacts' && (
          <div className="space-y-2">
            {!artifactsData || artifactsData.count === 0 ? (
              <div className="text-gray-500 text-center py-4">No artifacts</div>
            ) : (
              artifactsData.artifacts.map((artifact) => (
                <a
                  key={artifact.artifactId}
                  href={`/api/artifacts/${artifact.artifactId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-3 bg-gray-800 rounded hover:bg-gray-750"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-blue-400 truncate">
                      {artifact.path}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatFileSize(artifact.size)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {artifact.mimeType || 'Unknown type'}
                  </div>
                </a>
              ))
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      {!['done', 'cancelled', 'failed'].includes(task.state) && (
        <TaskActions taskId={taskId} currentState={task.state} />
      )}
    </aside>
  );
}

interface ReviewBannerProps {
  review: Review;
  taskId: string;
}

function ReviewBanner({ review, taskId: _taskId }: ReviewBannerProps) {
  const [comments, setComments] = useState('');
  const approveReview = useApproveReview();
  const rejectReview = useRejectReview();

  const handleApprove = async () => {
    await approveReview.mutateAsync({ id: review.id, comments: comments || undefined });
    setComments('');
  };

  const handleReject = async () => {
    if (!comments.trim()) {
      alert('Please provide a reason for rejection');
      return;
    }
    await rejectReview.mutateAsync({ id: review.id, comments });
    setComments('');
  };

  return (
    <div className="px-4 py-3 bg-purple-900/20 border-b border-purple-800">
      <p className="text-sm text-purple-300 font-medium mb-2">Review Required</p>
      <textarea
        value={comments}
        onChange={(e) => setComments(e.target.value)}
        placeholder="Add review comments..."
        rows={2}
        className="w-full bg-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
      />
      <div className="flex gap-2 mt-2">
        <button
          onClick={handleApprove}
          disabled={approveReview.isPending}
          className="flex-1 px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-sm font-medium disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={handleReject}
          disabled={rejectReview.isPending}
          className="flex-1 px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-sm font-medium disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

interface ReviewCardProps {
  review: Review;
}

function ReviewCard({ review }: ReviewCardProps) {
  const statusColors = {
    pending: 'bg-yellow-600',
    approved: 'bg-green-600',
    rejected: 'bg-red-600',
  };

  return (
    <div className="p-3 bg-gray-800 rounded">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-400">
          {review.reviewerId.replace('agent:', '')}
        </span>
        <span
          className={clsx(
            'px-2 py-0.5 rounded text-xs capitalize',
            statusColors[review.status]
          )}
        >
          {review.status}
        </span>
      </div>
      {review.comments && (
        <p className="text-sm text-gray-300">{review.comments}</p>
      )}
      {review.feedback?.issues && review.feedback.issues.length > 0 && (
        <ul className="mt-2 space-y-1">
          {review.feedback.issues.map((issue, i) => (
            <li key={i} className="text-sm text-red-400">
              [{issue.severity}] {issue.message}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-gray-500 mt-2">
        {formatDistanceToNow(new Date(review.createdAt), { addSuffix: true })}
      </p>
    </div>
  );
}

interface TaskActionsProps {
  taskId: string;
  currentState: TaskState;
}

function TaskActions({ taskId, currentState: _currentState }: TaskActionsProps) {
  const updateState = useUpdateTaskState();

  const handleCancel = async () => {
    if (confirm('Are you sure you want to cancel this task?')) {
      await updateState.mutateAsync({ id: taskId, state: 'cancelled' });
    }
  };

  return (
    <div className="p-4 border-t border-gray-700">
      <button
        onClick={handleCancel}
        disabled={updateState.isPending}
        className="w-full px-4 py-2 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded text-sm font-medium disabled:opacity-50"
      >
        Cancel Task
      </button>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
