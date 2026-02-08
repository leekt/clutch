// Clutch Protocol message types
export type MessageType =
  | 'task.request'
  | 'task.accept'
  | 'task.progress'
  | 'task.result'
  | 'task.error'
  | 'task.cancel'
  | 'task.timeout'
  | 'chat.message'
  | 'chat.system'
  | 'tool.call'
  | 'tool.result'
  | 'tool.error'
  | 'agent.register'
  | 'agent.heartbeat'
  | 'agent.update'
  | 'routing.decision'
  | 'routing.failure';

export type TaskState =
  | 'created'
  | 'assigned'
  | 'running'
  | 'review'
  | 'rework'
  | 'done'
  | 'cancelled'
  | 'failed';

export type AgentStatus = 'available' | 'busy' | 'offline';

export type AgentRole = 'pm' | 'research' | 'marketing' | 'developer' | 'qa';

// Agent lifecycle state (Organization OS)
export type AgentLifecycleState = 'asleep' | 'waking' | 'working' | 'sleeping';

// Agent personality styles (Organization OS)
export interface AgentPersonality {
  style?: 'analytical' | 'creative' | 'systematic' | 'pragmatic';
  communication?: 'concise' | 'verbose' | 'formal' | 'casual';
  decision_making?: 'data-driven' | 'intuitive' | 'consensus-seeking' | 'decisive';
}

// Agent memory config (Organization OS)
export interface AgentMemoryConfig {
  working_limit?: string;
  daily_retention?: string;
  long_term_summary?: 'daily' | 'weekly' | 'on-demand';
}

// Agent
export interface Agent {
  id: string;
  agentId: string;
  name: string;
  role: AgentRole;
  description?: string;
  status: AgentStatus;
  capabilities: Array<{
    id: string;
    version: string;
    tags?: string[];
  }>;
  permissions: {
    file: boolean;
    shell: boolean;
    git: boolean;
    browser: boolean;
  };
  budget: {
    maxTokens?: number;
    maxCost?: number;
    maxRuntime?: number;
  };
  lastHeartbeat?: string;
  createdAt: string;

  // Organization OS fields
  lifecycleState?: AgentLifecycleState;
  currentSessionId?: string;
  personality?: AgentPersonality;
  strengths?: string[];
  operatingRules?: string[];
  preferredCollaborators?: string[];
  memoryConfig?: AgentMemoryConfig;
  lastWakeAt?: string;
  lastSleepAt?: string;
}

// Daily Standup (Organization OS)
export interface StandupEntry {
  agentId: string;
  agentName: string;
  completed: string[];
  planned: string[];
  blockers: string[];
  status: 'collected' | 'skipped' | 'timeout';
}

export interface TeamStandup {
  standupId: string;
  date: string;
  startedAt: string;
  completedAt?: string;
  entries: StandupEntry[];
  summary?: string;
  escalations: string[];
}

// Agent Memory (Organization OS)
export interface WorkingMemory {
  taskId: string;
  title: string;
  startedAt: string;
  context: string;
  progress: string[];
  notes: string;
}

export interface DailyLog {
  date: string;
  agentId: string;
  completedTasks: Array<{
    taskId: string;
    title: string;
    duration?: string;
    cost?: number;
  }>;
  inProgressTasks: Array<{
    taskId: string;
    title: string;
  }>;
  blockers: string[];
  standupSummary?: string;
}

// Task
export interface Task {
  id: string;
  taskId: string;
  runId: string;
  parentTaskId?: string;
  title: string;
  description?: string;
  state: TaskState;
  workflowId?: string;
  workflowStepId?: string;
  assigneeId?: string;
  assignee?: Agent;
  output?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

// Channel
export interface Channel {
  id: string;
  name: string;
  type: 'task' | 'department';
  description?: string;
  taskId?: string;
  unreadCount?: number;
  createdAt: string;
}

// Message
export interface Message {
  id: string;
  messageId: string;
  version: string;
  threadId: string;
  runId: string;
  taskId: string;
  parentTaskId?: string;
  fromAgentId: string;
  toAgentIds: string[];
  type: MessageType;
  domain?: string;
  payloadType?: string;
  payload: unknown;
  attachments?: Array<{
    kind: 'artifact_ref' | 'inline' | 'url';
    ref?: string;
    content?: unknown;
    url?: string;
    mimeType?: string;
  }>;
  cost?: string;
  runtime?: number;
  tokens?: number;
  createdAt: string;
}

// Review
export interface Review {
  id: string;
  taskId: string;
  messageId: string;
  reviewerId: string;
  status: 'pending' | 'approved' | 'rejected';
  comments?: string;
  feedback?: {
    approved: boolean;
    score?: number;
    issues?: Array<{ type: string; message: string; severity: string }>;
    suggestions?: string[];
  };
  createdAt: string;
  updatedAt: string;
}

// Artifact
export interface Artifact {
  artifactId: string;
  hash: string;
  path: string;
  mimeType?: string;
  size: number;
  messageId?: string;
  taskId?: string;
  agentId?: string;
  createdAt: string;
}

// Run
export interface Run {
  runId: string;
  taskId: string;
  threadId: string;
  messageCount: number;
  messages: Message[];
}

// WebSocket event types
export interface WSTaskUpdate {
  type: 'task_update';
  taskId: string;
  action: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface WSMessageUpdate {
  type: 'message_update';
  messageId: string;
  action: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface WSAgentStatus {
  type: 'agent_status';
  agentId: string;
  status: AgentStatus;
  details?: Record<string, unknown>;
  timestamp: string;
}

export type WSEvent = WSTaskUpdate | WSMessageUpdate | WSAgentStatus;

// API response types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  details?: unknown;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}
