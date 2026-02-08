import { Link, useLocation, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { useStore, selectAgentsList, selectActiveTasksList, selectChannelsList } from '../store';
import { usePendingReviews } from '../hooks/useQueries';

const statusColors: Record<string, string> = {
  available: 'bg-green-500',
  busy: 'bg-yellow-500',
  offline: 'bg-gray-500',
};

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

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const { sidebarView, setSidebarView, setSelectedTask, unreadByChannel } = useStore();
  const agents = useStore(selectAgentsList);
  const tasks = useStore(selectActiveTasksList);
  const channels = useStore(selectChannelsList);

  const { data: pendingReviews } = usePendingReviews();
  const pendingReviewCount = pendingReviews?.length ?? 0;

  const onlineAgentCount = agents.filter((a) => a.status !== 'offline').length;

  return (
    <aside className="w-64 bg-sidebar flex flex-col border-r border-gray-700">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold">Clutch</h1>
        <p className="text-sm text-gray-400">AI Agent Organization</p>
      </div>

      {/* View tabs */}
      <div className="flex border-b border-gray-700">
        <button
          onClick={() => setSidebarView('channels')}
          className={clsx(
            'flex-1 px-3 py-2 text-sm font-medium',
            sidebarView === 'channels'
              ? 'text-white border-b-2 border-blue-500'
              : 'text-gray-400 hover:text-white'
          )}
        >
          Channels
        </button>
        <button
          onClick={() => setSidebarView('tasks')}
          className={clsx(
            'flex-1 px-3 py-2 text-sm font-medium relative',
            sidebarView === 'tasks'
              ? 'text-white border-b-2 border-blue-500'
              : 'text-gray-400 hover:text-white'
          )}
        >
          Tasks
          {pendingReviewCount > 0 && (
            <span className="absolute top-1 right-2 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center">
              {pendingReviewCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setSidebarView('agents')}
          className={clsx(
            'flex-1 px-3 py-2 text-sm font-medium',
            sidebarView === 'agents'
              ? 'text-white border-b-2 border-blue-500'
              : 'text-gray-400 hover:text-white'
          )}
        >
          Agents
        </button>
      </div>

      {/* Content */}
      <nav className="flex-1 overflow-y-auto p-2">
        {sidebarView === 'channels' && (
          <div className="space-y-1">
            <h2 className="px-2 py-1 text-xs font-semibold text-gray-400 uppercase">
              Channels
            </h2>
            {channels.length === 0 ? (
              <p className="px-2 py-1 text-sm text-gray-500">No channels</p>
            ) : (
              <ul className="space-y-0.5">
                {channels.map((channel) => {
                  const isActive = location.pathname === `/channels/${channel.id}`;
                  const unread = unreadByChannel[channel.id] || 0;

                  return (
                    <li key={channel.id}>
                      <Link
                        to={`/channels/${channel.id}`}
                        className={clsx(
                          'w-full px-2 py-1 rounded flex items-center gap-2',
                          isActive
                            ? 'bg-sidebar-active text-white'
                            : 'text-gray-300 hover:bg-sidebar-hover'
                        )}
                      >
                        <span className="text-gray-500">#</span>
                        <span className="flex-1 truncate">{channel.name}</span>
                        {unread > 0 && (
                          <span className="w-5 h-5 bg-blue-600 rounded-full text-xs flex items-center justify-center">
                            {unread}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Quick access to department channels */}
            <h2 className="px-2 py-1 mt-4 text-xs font-semibold text-gray-400 uppercase">
              Departments
            </h2>
            <ul className="space-y-0.5">
              {['general', 'research', 'dev', 'marketing'].map((dept) => (
                <li key={dept}>
                  <Link
                    to={`/channels/${dept}`}
                    className={clsx(
                      'w-full px-2 py-1 rounded flex items-center gap-2',
                      location.pathname === `/channels/${dept}`
                        ? 'bg-sidebar-active text-white'
                        : 'text-gray-300 hover:bg-sidebar-hover'
                    )}
                  >
                    <span className="text-gray-500">#</span>
                    {dept}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {sidebarView === 'tasks' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between px-2 py-1">
              <h2 className="text-xs font-semibold text-gray-400 uppercase">
                Active Tasks
              </h2>
              <button
                onClick={() => navigate('/tasks')}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                View All
              </button>
            </div>

            {tasks.length === 0 ? (
              <p className="px-2 py-1 text-sm text-gray-500">No active tasks</p>
            ) : (
              <ul className="space-y-1">
                {tasks.slice(0, 10).map((task) => (
                  <li key={task.taskId}>
                    <button
                      onClick={() => {
                        setSelectedTask(task.taskId);
                        navigate(`/tasks/${task.taskId}`);
                      }}
                      className={clsx(
                        'w-full px-2 py-2 rounded text-left',
                        location.pathname === `/tasks/${task.taskId}`
                          ? 'bg-sidebar-active'
                          : 'hover:bg-sidebar-hover'
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={clsx(
                            'w-2 h-2 rounded-full',
                            stateColors[task.state]
                          )}
                        />
                        <span className="text-xs text-gray-400 uppercase">
                          {task.state}
                        </span>
                      </div>
                      <p className="text-sm truncate">{task.title}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Pending reviews section */}
            {pendingReviewCount > 0 && (
              <>
                <h2 className="px-2 py-1 mt-4 text-xs font-semibold text-gray-400 uppercase">
                  Pending Reviews ({pendingReviewCount})
                </h2>
                <ul className="space-y-1">
                  {pendingReviews?.slice(0, 5).map((review) => (
                    <li key={review.id}>
                      <button
                        onClick={() => {
                          setSelectedTask(review.taskId);
                          navigate(`/tasks/${review.taskId}`);
                        }}
                        className="w-full px-2 py-2 rounded text-left hover:bg-sidebar-hover"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-purple-500" />
                          <span className="text-sm text-purple-300">
                            Review needed
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 truncate mt-1">
                          Task: {review.taskId.slice(0, 12)}...
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {sidebarView === 'agents' && (
          <div className="space-y-1">
            <h2 className="px-2 py-1 text-xs font-semibold text-gray-400 uppercase">
              Agents ({onlineAgentCount} online)
            </h2>

            {agents.length === 0 ? (
              <p className="px-2 py-1 text-sm text-gray-500">No agents</p>
            ) : (
              <ul className="space-y-0.5">
                {agents.map((agent) => (
                  <li key={agent.agentId}>
                    <Link
                      to={`/agents/${agent.agentId}`}
                      className={clsx(
                        'w-full px-2 py-1 rounded flex items-center gap-2',
                        location.pathname === `/agents/${agent.agentId}`
                          ? 'bg-sidebar-active text-white'
                          : 'text-gray-300 hover:bg-sidebar-hover'
                      )}
                    >
                      <span
                        className={clsx(
                          'w-2 h-2 rounded-full',
                          statusColors[agent.status]
                        )}
                      />
                      <span className="flex-1 truncate">{agent.name}</span>
                      <span className="text-xs text-gray-500 capitalize">
                        {agent.role}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center">
            <span className="text-sm font-medium">O</span>
          </div>
          <div>
            <p className="text-sm font-medium">Organization</p>
            <p className="text-xs text-gray-400">
              {onlineAgentCount} agent{onlineAgentCount !== 1 ? 's' : ''} online
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
