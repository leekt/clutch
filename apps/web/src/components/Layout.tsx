import { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';
import { useAgents, useTasks, useChannels, queryKeys } from '../hooks/useQueries';
import { useWebSocket } from '../hooks/useWebSocket';
import { useStore } from '../store';
import type { WSEvent } from '../types';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const queryClient = useQueryClient();
  const { updateAgent, updateTask, addMessage } = useStore();

  // Load initial data
  const { isLoading: agentsLoading } = useAgents();
  const { isLoading: tasksLoading } = useTasks();
  const { isLoading: channelsLoading } = useChannels();

  // WebSocket for real-time updates
  const { connectionState } = useWebSocket({
    onMessage: (event: WSEvent) => {
      switch (event.type) {
        case 'agent_status':
          // Update agent status in store
          const agents = useStore.getState().agents;
          const agent = Object.values(agents).find(
            (a) => a.agentId === event.agentId
          );
          if (agent) {
            updateAgent({ ...agent, status: event.status });
          }
          break;

        case 'task_update':
          // Refetch task data
          const tasks = useStore.getState().tasks;
          const task = tasks[event.taskId];
          if (task && event.data) {
            updateTask({ ...task, ...event.data });
          }
          break;

        case 'message_update':
          // Handle new messages
          if (event.action === 'created' && event.data) {
            addMessage(event.data as any);
            // Invalidate channel messages query so ChannelView picks up the new message
            const channelId = (event.data as any).channelId;
            if (channelId) {
              queryClient.invalidateQueries({ queryKey: queryKeys.messages(channelId) });
            }
          }
          break;
      }
    },
  });

  const isLoading = agentsLoading || tasksLoading || channelsLoading;

  return (
    <>
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Connection status bar */}
        {connectionState !== 'connected' && (
          <div
            className={`px-4 py-1 text-xs text-center ${
              connectionState === 'connecting'
                ? 'bg-yellow-600'
                : connectionState === 'error'
                ? 'bg-red-600'
                : 'bg-gray-700'
            }`}
          >
            {connectionState === 'connecting'
              ? 'Connecting to server...'
              : connectionState === 'error'
              ? 'Connection error. Retrying...'
              : 'Disconnected'}
          </div>
        )}

        {/* Loading overlay */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-gray-400">Loading...</div>
          </div>
        ) : (
          children
        )}
      </main>
    </>
  );
}
