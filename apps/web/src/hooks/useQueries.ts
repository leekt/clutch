import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useStore } from '../store';
import type { Task } from '../types';

// Query keys
export const queryKeys = {
  agents: ['agents'] as const,
  agent: (id: string) => ['agents', id] as const,
  tasks: ['tasks'] as const,
  task: (id: string) => ['tasks', id] as const,
  tasksByState: (state: string) => ['tasks', 'state', state] as const,
  tasksByRun: (runId: string) => ['tasks', 'run', runId] as const,
  channels: ['channels'] as const,
  channel: (id: string) => ['channels', id] as const,
  messages: (channelId: string) => ['messages', channelId] as const,
  messagesByTask: (taskId: string) => ['messages', 'task', taskId] as const,
  messagesByRun: (runId: string) => ['messages', 'run', runId] as const,
  reviews: ['reviews'] as const,
  reviewsByTask: (taskId: string) => ['reviews', 'task', taskId] as const,
  pendingReviews: ['reviews', 'pending'] as const,
  artifacts: (taskId: string) => ['artifacts', 'task', taskId] as const,
  run: (runId: string) => ['runs', runId] as const,
};

// Agents hooks
export function useAgents() {
  const setAgents = useStore((s) => s.setAgents);

  return useQuery({
    queryKey: queryKeys.agents,
    queryFn: async () => {
      const agents = await api.agents.list();
      setAgents(agents);
      return agents;
    },
  });
}

export function useAgent(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.agent(id!),
    queryFn: () => api.agents.get(id!),
    enabled: !!id,
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  const updateAgent = useStore((s) => s.updateAgent);

  return useMutation({
    mutationFn: api.agents.create,
    onSuccess: (agent) => {
      updateAgent(agent);
      queryClient.invalidateQueries({ queryKey: queryKeys.agents });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.agents.delete(id),
    onSuccess: (_data, id) => {
      // Remove cached individual agent query so it doesn't get refetched after deletion
      queryClient.removeQueries({ queryKey: queryKeys.agent(id) });
      // Refetch the agents list (exact match to avoid refetching removed individual queries)
      queryClient.invalidateQueries({ queryKey: queryKeys.agents, exact: true });
    },
  });
}

// Tasks hooks
export function useTasks() {
  const setTasks = useStore((s) => s.setTasks);

  return useQuery({
    queryKey: queryKeys.tasks,
    queryFn: async () => {
      const tasks = await api.tasks.list();
      setTasks(tasks);
      return tasks;
    },
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.task(id!),
    queryFn: () => api.tasks.get(id!),
    enabled: !!id,
  });
}

export function useTasksByState(state: Task['state']) {
  return useQuery({
    queryKey: queryKeys.tasksByState(state),
    queryFn: () => api.tasks.getByState(state),
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  const updateTask = useStore((s) => s.updateTask);

  return useMutation({
    mutationFn: api.tasks.create,
    onSuccess: (task) => {
      updateTask(task);
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  const updateTask = useStore((s) => s.updateTask);

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Task> }) =>
      api.tasks.update(id, data),
    onSuccess: (task) => {
      updateTask(task);
      queryClient.invalidateQueries({ queryKey: queryKeys.task(task.taskId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    },
  });
}

export function useUpdateTaskState() {
  const queryClient = useQueryClient();
  const updateTask = useStore((s) => s.updateTask);

  return useMutation({
    mutationFn: ({ id, state }: { id: string; state: Task['state'] }) =>
      api.tasks.updateState(id, state),
    onSuccess: (task) => {
      updateTask(task);
      queryClient.invalidateQueries({ queryKey: queryKeys.task(task.taskId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    },
  });
}

export function useAssignTask() {
  const queryClient = useQueryClient();
  const updateTask = useStore((s) => s.updateTask);

  return useMutation({
    mutationFn: ({ taskId, agentId }: { taskId: string; agentId: string }) =>
      api.tasks.assign(taskId, agentId),
    onSuccess: (task) => {
      updateTask(task);
      queryClient.invalidateQueries({ queryKey: queryKeys.task(task.taskId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
    },
  });
}

// Channels hooks
export function useChannels() {
  const setChannels = useStore((s) => s.setChannels);

  return useQuery({
    queryKey: queryKeys.channels,
    queryFn: async () => {
      const channels = await api.channels.list();
      setChannels(channels);
      return channels;
    },
  });
}

export function useChannel(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.channel(id!),
    queryFn: () => api.channels.get(id!),
    enabled: !!id,
  });
}

export function useCreateChannel() {
  const queryClient = useQueryClient();
  const updateChannel = useStore((s) => s.updateChannel);

  return useMutation({
    mutationFn: api.channels.create,
    onSuccess: (channel) => {
      updateChannel(channel);
      queryClient.invalidateQueries({ queryKey: queryKeys.channels });
    },
  });
}

// Messages hooks
export function useMessages(channelId: string | undefined) {
  const setMessages = useStore((s) => s.setMessages);

  return useQuery({
    queryKey: queryKeys.messages(channelId!),
    queryFn: async () => {
      const messages = await api.messages.list(channelId!);
      setMessages(channelId!, messages);
      return messages;
    },
    enabled: !!channelId,
  });
}

export function useMessagesByTask(taskId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.messagesByTask(taskId!),
    queryFn: () => api.messages.getByTask(taskId!),
    enabled: !!taskId,
  });
}

export function useMessagesByRun(runId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.messagesByRun(runId!),
    queryFn: () => api.messages.getByRun(runId!),
    enabled: !!runId,
  });
}

// Runs hooks
export function useCreateRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.runs.create,
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
      queryClient.invalidateQueries({ queryKey: queryKeys.run(run.runId) });
    },
  });
}

export function useRun(runId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.run(runId!),
    queryFn: () => api.runs.get(runId!),
    enabled: !!runId,
  });
}

// Reviews hooks
export function useReviews() {
  return useQuery({
    queryKey: queryKeys.reviews,
    queryFn: api.reviews.list,
  });
}

export function useReviewsByTask(taskId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reviewsByTask(taskId!),
    queryFn: () => api.reviews.getByTask(taskId!),
    enabled: !!taskId,
  });
}

export function usePendingReviews() {
  return useQuery({
    queryKey: queryKeys.pendingReviews,
    queryFn: api.reviews.getPending,
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

export function useApproveReview() {
  const queryClient = useQueryClient();
  const updateReview = useStore((s) => s.updateReview);

  return useMutation({
    mutationFn: ({ id, comments }: { id: string; comments?: string }) =>
      api.reviews.approve(id, comments),
    onSuccess: (review) => {
      updateReview(review);
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
      queryClient.invalidateQueries({ queryKey: queryKeys.pendingReviews });
      queryClient.invalidateQueries({
        queryKey: queryKeys.reviewsByTask(review.taskId),
      });
    },
  });
}

export function useRejectReview() {
  const queryClient = useQueryClient();
  const updateReview = useStore((s) => s.updateReview);

  return useMutation({
    mutationFn: ({ id, comments }: { id: string; comments: string }) =>
      api.reviews.reject(id, comments),
    onSuccess: (review) => {
      updateReview(review);
      queryClient.invalidateQueries({ queryKey: queryKeys.reviews });
      queryClient.invalidateQueries({ queryKey: queryKeys.pendingReviews });
      queryClient.invalidateQueries({
        queryKey: queryKeys.reviewsByTask(review.taskId),
      });
    },
  });
}

// Artifacts hooks
export function useArtifactsByTask(taskId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.artifacts(taskId!),
    queryFn: () => api.artifacts.listByTask(taskId!),
    enabled: !!taskId,
  });
}
