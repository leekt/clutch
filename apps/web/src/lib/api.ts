import type {
  Agent,
  Task,
  Channel,
  Message,
  Review,
  Artifact,
  Run,
} from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new ApiError(
      errorBody.error || `HTTP ${response.status}`,
      response.status,
      errorBody.details
    );
  }

  return response.json();
}

// Agents API
export const agents = {
  list: () => request<Agent[]>('/api/agents'),

  get: (id: string) => request<Agent>(`/api/agents/${id}`),

  create: (data: {
    name: string;
    role: string;
    image?: string;
    permissions: Agent['permissions'];
    budget: Agent['budget'];
  }) =>
    request<Agent>('/api/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<Agent>) =>
    request<Agent>(`/api/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/api/agents/${id}`, { method: 'DELETE' }),

  getByRole: (role: string) => request<Agent[]>(`/api/agents/role/${role}`),
};

// Tasks API
export const tasks = {
  list: () => request<Task[]>('/api/tasks'),

  get: (id: string) => request<Task>(`/api/tasks/${id}`),

  create: (data: {
    title: string;
    description?: string;
    runId?: string;
    parentTaskId?: string;
    workflowId?: string;
  }) =>
    request<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<Task>) =>
    request<Task>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  updateState: (id: string, state: Task['state']) =>
    request<Task>(`/api/tasks/${id}/state`, {
      method: 'PATCH',
      body: JSON.stringify({ state }),
    }),

  assign: (id: string, agentId: string) =>
    request<Task>(`/api/tasks/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify({ agentId }),
    }),

  getByState: (state: Task['state']) =>
    request<Task[]>(`/api/tasks/state/${state}`),

  getByRun: (runId: string) => request<Task[]>(`/api/tasks/run/${runId}`),
};

// Channels API
export const channels = {
  list: () => request<Channel[]>('/api/channels'),

  get: (id: string) => request<Channel>(`/api/channels/${id}`),

  create: (data: { name: string; type: Channel['type']; description?: string }) =>
    request<Channel>('/api/channels', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/api/channels/${id}`, { method: 'DELETE' }),
};

// Messages API
export const messages = {
  list: (channelId: string) =>
    request<Message[]>(`/api/channels/${channelId}/messages`),

  get: (id: string) => request<Message>(`/api/messages/${id}`),

  getByTask: (taskId: string) =>
    request<Message[]>(`/api/tasks/${taskId}/messages`),

  getByRun: (runId: string) =>
    request<{ runId: string; messages: Message[] }>(`/api/runs/${runId}/messages`),

  getByThread: (threadId: string) =>
    request<{ threadId: string; messages: Message[] }>(`/api/threads/${threadId}`),
};

// Runs API
export const runs = {
  create: (data: {
    title: string;
    description?: string;
    requires?: string[];
    prefers?: string[];
  }) =>
    request<Run>('/api/runs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  get: (runId: string) =>
    request<Run>(`/api/runs/${runId}`),

  replay: (runId: string) =>
    request<Run>(`/api/runs/${runId}/replay`),
};

// Reviews API
export const reviews = {
  list: () => request<Review[]>('/api/reviews'),

  get: (id: string) => request<Review>(`/api/reviews/${id}`),

  getByTask: (taskId: string) =>
    request<Review[]>(`/api/reviews/task/${taskId}`),

  getPending: () => request<Review[]>('/api/reviews/pending'),

  approve: (id: string, comments?: string) =>
    request<Review>(`/api/reviews/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ comments }),
    }),

  reject: (id: string, comments: string) =>
    request<Review>(`/api/reviews/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ comments }),
    }),
};

// Artifacts API
export const artifacts = {
  get: (artifactId: string) =>
    request<Blob>(`/api/artifacts/${artifactId}`),

  getMetadata: (artifactId: string) =>
    request<Artifact>(`/api/artifacts/${artifactId}/metadata`),

  verify: (artifactId: string) =>
    request<{ artifactId: string; valid: boolean }>(`/api/artifacts/${artifactId}/verify`),

  listByTask: (taskId: string) =>
    request<{ taskId: string; count: number; artifacts: Artifact[] }>(
      `/api/tasks/${taskId}/artifacts`
    ),

  upload: async (
    content: string | ArrayBuffer,
    options: {
      path: string;
      mimeType?: string;
      taskId?: string;
      messageId?: string;
    }
  ) => {
    const base64 =
      typeof content === 'string'
        ? btoa(content)
        : btoa(String.fromCharCode(...new Uint8Array(content)));

    return request<Artifact>('/api/artifacts', {
      method: 'POST',
      body: JSON.stringify({
        content: base64,
        ...options,
      }),
    });
  },
};

// Message Bus API
export const bus = {
  publish: (message: {
    thread_id: string;
    run_id: string;
    task_id: string;
    parent_task_id?: string;
    from: { agent_id: string };
    to: Array<{ agent_id: string }>;
    type: string;
    domain?: string;
    payload: unknown;
    requires?: string[];
    prefers?: string[];
  }) =>
    request<{ message: Message }>('/api/bus/publish', {
      method: 'POST',
      body: JSON.stringify(message),
    }),

  getAgents: () =>
    request<{
      count: number;
      agents: Array<{
        id: string;
        name: string;
        capabilities: unknown[];
      }>;
    }>('/api/bus/agents'),

  refreshAgents: () =>
    request<{ success: boolean; message: string }>('/api/bus/agents/refresh', {
      method: 'POST',
    }),
};

export const api = {
  agents,
  tasks,
  channels,
  messages,
  runs,
  reviews,
  artifacts,
  bus,
};

export { ApiError };
