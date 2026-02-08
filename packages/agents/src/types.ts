/**
 * Task dispatch payload sent to agents
 */
export interface TaskDispatch {
  taskId: string;
  runId: string;
  threadId: string;
  parentTaskId?: string;
  action: string;
  input: Record<string, unknown>;
  constraints?: {
    maxTokens?: number;
    maxRuntimeSec?: number;
    maxCost?: number;
  };
  attachments?: Array<{
    kind: 'artifact_ref' | 'inline' | 'url';
    ref?: string;
    content?: unknown;
    url?: string;
    mimeType?: string;
  }>;
}

/**
 * Task result from agent execution
 */
export interface TaskResult {
  taskId: string;
  success: boolean;
  output?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  artifacts?: Array<{
    path: string;
    hash: string;
    mimeType?: string;
  }>;
  usage: {
    cost: number;
    runtime: number;
    tokens: number;
  };
}

/**
 * Progress update during task execution
 */
export interface ProgressUpdate {
  taskId: string;
  progress: number; // 0-100
  message?: string;
  artifacts?: Array<{
    path: string;
    hash: string;
  }>;
}

/**
 * Agent role types
 */
export type AgentRole = 'pm' | 'research' | 'marketing' | 'developer' | 'qa';

/**
 * Agent personality configuration
 */
export interface AgentPersonality {
  style?: 'analytical' | 'creative' | 'systematic' | 'pragmatic';
  communication?: 'concise' | 'verbose' | 'formal' | 'casual';
  decision_making?: 'data-driven' | 'intuitive' | 'consensus-seeking' | 'decisive';
}
