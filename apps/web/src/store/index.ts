import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Agent, Task, Channel, Message, Review } from '../types';

interface AppState {
  // Current selections
  selectedChannelId: string | null;
  selectedTaskId: string | null;
  selectedAgentId: string | null;

  // View state
  sidebarView: 'channels' | 'agents' | 'tasks';
  rightPanelOpen: boolean;
  rightPanelView: 'task-details' | 'agent-details' | 'thread' | null;

  // Cached data (for optimistic updates)
  agents: Record<string, Agent>;
  tasks: Record<string, Task>;
  channels: Record<string, Channel>;
  messages: Record<string, Message>;
  reviews: Record<string, Review>;

  // Unread counts
  unreadByChannel: Record<string, number>;

  // Actions
  setSelectedChannel: (channelId: string | null) => void;
  setSelectedTask: (taskId: string | null) => void;
  setSelectedAgent: (agentId: string | null) => void;
  setSidebarView: (view: 'channels' | 'agents' | 'tasks') => void;
  setRightPanel: (open: boolean, view?: 'task-details' | 'agent-details' | 'thread' | null) => void;

  // Data updates
  updateAgent: (agent: Agent) => void;
  removeAgent: (agentId: string) => void;
  updateTask: (task: Task) => void;
  updateChannel: (channel: Channel) => void;
  addMessage: (message: Message) => void;
  updateReview: (review: Review) => void;

  // Bulk updates
  setAgents: (agents: Agent[]) => void;
  setTasks: (tasks: Task[]) => void;
  setChannels: (channels: Channel[]) => void;
  setMessages: (channelId: string, messages: Message[]) => void;

  // Unread management
  incrementUnread: (channelId: string) => void;
  clearUnread: (channelId: string) => void;

  // Reset
  reset: () => void;
}

const initialState = {
  selectedChannelId: null,
  selectedTaskId: null,
  selectedAgentId: null,
  sidebarView: 'channels' as const,
  rightPanelOpen: false,
  rightPanelView: null,
  agents: {},
  tasks: {},
  channels: {},
  messages: {},
  reviews: {},
  unreadByChannel: {},
};

export const useStore = create<AppState>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // Selection actions
      setSelectedChannel: (channelId) => {
        set({ selectedChannelId: channelId });
        if (channelId) {
          get().clearUnread(channelId);
        }
      },

      setSelectedTask: (taskId) => {
        set({
          selectedTaskId: taskId,
          rightPanelOpen: taskId !== null,
          rightPanelView: taskId ? 'task-details' : null,
        });
      },

      setSelectedAgent: (agentId) => {
        set({
          selectedAgentId: agentId,
          rightPanelOpen: agentId !== null,
          rightPanelView: agentId ? 'agent-details' : null,
        });
      },

      setSidebarView: (view) => set({ sidebarView: view }),

      setRightPanel: (open, view = null) =>
        set({
          rightPanelOpen: open,
          rightPanelView: view,
        }),

      // Data updates
      updateAgent: (agent) =>
        set((state) => ({
          agents: { ...state.agents, [agent.agentId]: agent },
        })),

      removeAgent: (agentId) =>
        set((state) => {
          const { [agentId]: _, ...rest } = state.agents;
          return { agents: rest };
        }),

      updateTask: (task) =>
        set((state) => ({
          tasks: { ...state.tasks, [task.taskId]: task },
        })),

      updateChannel: (channel) =>
        set((state) => ({
          channels: { ...state.channels, [channel.id]: channel },
        })),

      addMessage: (message) =>
        set((state) => {
          const newMessages = { ...state.messages, [message.messageId]: message };

          // Increment unread if not viewing this channel
          const channelId = message.taskId; // Messages grouped by task
          if (channelId && channelId !== state.selectedChannelId) {
            return {
              messages: newMessages,
              unreadByChannel: {
                ...state.unreadByChannel,
                [channelId]: (state.unreadByChannel[channelId] || 0) + 1,
              },
            };
          }

          return { messages: newMessages };
        }),

      updateReview: (review) =>
        set((state) => ({
          reviews: { ...state.reviews, [review.id]: review },
        })),

      // Bulk updates
      setAgents: (agents) =>
        set({
          agents: agents.reduce(
            (acc, agent) => ({ ...acc, [agent.agentId]: agent }),
            {}
          ),
        }),

      setTasks: (tasks) =>
        set({
          tasks: tasks.reduce(
            (acc, task) => ({ ...acc, [task.taskId]: task }),
            {}
          ),
        }),

      setChannels: (channels) =>
        set({
          channels: channels.reduce(
            (acc, channel) => ({ ...acc, [channel.id]: channel }),
            {}
          ),
        }),

      setMessages: (_channelId, messages) =>
        set((state) => ({
          messages: {
            ...state.messages,
            ...messages.reduce(
              (acc, msg) => ({ ...acc, [msg.messageId]: msg }),
              {}
            ),
          },
        })),

      // Unread management
      incrementUnread: (channelId) =>
        set((state) => ({
          unreadByChannel: {
            ...state.unreadByChannel,
            [channelId]: (state.unreadByChannel[channelId] || 0) + 1,
          },
        })),

      clearUnread: (channelId) =>
        set((state) => ({
          unreadByChannel: {
            ...state.unreadByChannel,
            [channelId]: 0,
          },
        })),

      // Reset
      reset: () => set(initialState),
    }),
    { name: 'clutch-store' }
  )
);

// Selectors
export const selectAgentsList = (state: AppState) =>
  Object.values(state.agents).sort((a, b) => a.name.localeCompare(b.name));

export const selectTasksList = (state: AppState) =>
  Object.values(state.tasks).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

export const selectChannelsList = (state: AppState) =>
  Object.values(state.channels).sort((a, b) => a.name.localeCompare(b.name));

export const selectActiveTasksList = (state: AppState) =>
  Object.values(state.tasks)
    .filter((t) => !['done', 'cancelled', 'failed'].includes(t.state))
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

export const selectPendingReviews = (state: AppState) =>
  Object.values(state.reviews).filter((r) => r.status === 'pending');

export const selectOnlineAgents = (state: AppState) =>
  Object.values(state.agents).filter((a) => a.status !== 'offline');

export const selectBusyAgents = (state: AppState) =>
  Object.values(state.agents).filter((a) => a.status === 'busy');
