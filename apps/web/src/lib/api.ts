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
  list: () =>
    request<{ agents: Agent[] }>('/api/agents').then((r) => r.agents),

  get: (id: string) =>
    request<{ agent: Agent }>(`/api/agents/${id}`).then((r) => r.agent),

  create: (data: {
    name: string;
    role: string;
    description?: string;
    image?: string;
    permissions: Agent['permissions'];
    budget: Agent['budget'];
    personality?: Agent['personality'];
    strengths?: string[];
    operatingRules?: string[];
    runtime?: {
      type: 'in-process' | 'http' | 'subprocess';
      url?: string;
      authToken?: string;
      authTokenSecret?: string;
      timeoutMs?: number;
      healthPath?: string;
      command?: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      envSecrets?: Record<string, string>;
      protocol?: 'stdio' | 'http';
    };
  }) =>
    request<{ agent: Agent }>('/api/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then((r) => r.agent),

  update: (id: string, data: Partial<Agent>) =>
    request<{ agent: Agent }>(`/api/agents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }).then((r) => r.agent),

  delete: (id: string) =>
    request<void>(`/api/agents/${id}`, { method: 'DELETE' }),

  getByRole: (role: string) =>
    request<{ agents: Agent[] }>(`/api/agents?role=${role}`).then((r) => r.agents),
};

// Secrets API
export const secrets = {
  create: (data: { name?: string; value: string }) =>
    request<{ secretId: string }>('/api/secrets', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then((r) => r.secretId),
};

export const oauth = {
  codex: {
    start: (data: {
      clientId?: string;
      authUrl?: string;
      tokenUrl?: string;
      scope?: string;
      redirectUrl?: string;
    }) =>
      request<{ state: string; authUrl: string; redirectUrl: string }>('/api/oauth/codex/start', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    status: (state: string) =>
      request<{ status: 'pending' | 'received' | 'exchanged' | 'error' }>(
        `/api/oauth/codex/status?state=${encodeURIComponent(state)}`,
      ),
    finish: (data: { state: string; code?: string; redirectUrl?: string }) =>
      request<{ secretId: string }>('/api/oauth/codex/finish', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
};

export const settings = {
  get: () =>
    request<{ settings: { workerRootDir?: string; claudeWorkerPath?: string; codexWorkerPath?: string } }>(
      '/api/settings',
    ).then((r) => r.settings),
  update: (data: { workerRootDir?: string; claudeWorkerPath?: string; codexWorkerPath?: string }) =>
    request<{ settings: { workerRootDir?: string; claudeWorkerPath?: string; codexWorkerPath?: string } }>(
      '/api/settings',
      {
        method: 'PUT',
        body: JSON.stringify(data),
      },
    ).then((r) => r.settings),
};


// Tasks API
export const tasks = {
  list: () =>
    request<{ tasks: Task[] }>('/api/tasks').then((r) => r.tasks),

  get: (id: string) =>
    request<{ task: Task }>(`/api/tasks/${id}`).then((r) => r.task),

  create: (data: {
    title: string;
    description?: string;
    runId?: string;
    parentTaskId?: string;
    workflowId?: string;
  }) =>
    request<{ task: Task }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then((r) => r.task),

  update: (id: string, data: Partial<Task>) =>
    request<{ task: Task }>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }).then((r) => r.task),

  updateState: (id: string, state: Task['state']) =>
    request<{ task: Task }>(`/api/tasks/${id}/state`, {
      method: 'PATCH',
      body: JSON.stringify({ state }),
    }).then((r) => r.task),

  assign: (id: string, agentId: string) =>
    request<{ task: Task }>(`/api/tasks/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify({ agentId }),
    }).then((r) => r.task),

  getByState: (state: Task['state']) =>
    request<{ tasks: Task[] }>(`/api/tasks?state=${state}`).then((r) => r.tasks),

  getByRun: (runId: string) =>
    request<{ tasks: Task[] }>(`/api/runs/${runId}/tasks`).then((r) => r.tasks),
};

// Channels API
export const channels = {
  list: () =>
    request<{ channels: Channel[] }>('/api/channels').then((r) => r.channels),

  get: (id: string) =>
    request<{ channel: Channel }>(`/api/channels/${id}`).then((r) => r.channel),

  create: (data: { name: string; type: Channel['type']; description?: string }) =>
    request<{ channel: Channel }>('/api/channels', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then((r) => r.channel),

  delete: (id: string) =>
    request<void>(`/api/channels/${id}`, { method: 'DELETE' }),

  findOrCreateDM: async (agentId: string): Promise<Channel> => {
    const dmName = `dm:user:${agentId}`;
    // Try to find existing DM channel first
    try {
      return await channels.get(dmName);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
    }
    // Create new DM channel
    return await channels.create({ name: dmName, type: 'dm', description: `DM with ${agentId.replace('agent:', '')}` });
  },
};

// Messages API
export const messages = {
  list: (channelId: string) =>
    request<{ messages: Message[] }>(`/api/channels/${channelId}/messages`).then((r) => r.messages),

  get: (id: string) =>
    request<{ message: Message }>(`/api/messages/${id}`).then((r) => r.message),

  getByTask: (taskId: string) =>
    request<{ messages: Message[] }>(`/api/tasks/${taskId}/messages`).then((r) => r.messages),

  getByRun: (runId: string) =>
    request<{ messages: Message[] }>(`/api/runs/${runId}/messages`).then((r) => r.messages),

  getByThread: (threadId: string) =>
    request<{ messages: Message[] }>(`/api/threads/${threadId}`).then((r) => r.messages),

  sendChat: (channelId: string, content: string) =>
    request<{ message: Message }>(`/api/channels/${channelId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }).then((r) => r.message),
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
  list: () =>
    request<{ reviews: Review[] }>('/api/reviews').then((r) => r.reviews),

  get: (id: string) =>
    request<{ review: Review }>(`/api/reviews/${id}`).then((r) => r.review),

  getByTask: (taskId: string) =>
    request<{ reviews: Review[] }>(`/api/tasks/${taskId}/reviews`).then((r) => r.reviews),

  getPending: () =>
    request<{ reviews: Review[] }>('/api/reviews?status=pending').then((r) => r.reviews),

  approve: (id: string, comments?: string) =>
    request<{ review: Review }>(`/api/reviews/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ comments }),
    }).then((r) => r.review),

  reject: (id: string, comments: string) =>
    request<{ review: Review }>(`/api/reviews/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ comments }),
    }).then((r) => r.review),
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
  secrets,
  oauth,
  settings,
  bus,
};

export { ApiError };
