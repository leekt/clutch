import type { AgentContext, ProgressUpdate } from '../executor/base-agent.js';
import type { TaskDispatch, TaskResult } from '../types.js';

/**
 * Tool call event emitted during agent execution
 */
export interface ToolCallEvent {
  taskId: string;
  tool: string;
  input: unknown;
  output: unknown;
  timestamp: string;
}

/**
 * AgentRuntime abstracts how an agent is executed.
 *
 * Implementations:
 *   - InProcessRuntime  – wraps an existing BaseAgent subclass (zero behavior change)
 *   - HttpRuntime       – delegates to an external HTTP agent
 *   - SubprocessRuntime – spawns a child process per task
 */
export interface AgentRuntime {
  /** Discriminator for the runtime type */
  readonly type: string;

  /** One-time setup (connect, warm-up, etc.) */
  initialize(): Promise<void>;

  /** Run a task and return the result */
  execute(dispatch: TaskDispatch, context: Partial<AgentContext>): Promise<TaskResult>;

  /** Health check */
  getHealth(): Promise<{ healthy: boolean; details?: Record<string, unknown> }>;

  /** Graceful teardown */
  shutdown(): Promise<void>;

  /** Subscribe to progress updates during execution */
  onProgress?(cb: (update: ProgressUpdate) => void): void;

  /** Subscribe to tool call events during execution */
  onToolCall?(cb: (call: ToolCallEvent) => void): void;
}

/**
 * Runtime configuration – discriminated union on `type`.
 */
export type RuntimeConfig =
  | InProcessRuntimeConfig
  | HttpRuntimeConfig
  | SubprocessRuntimeConfig;

export interface InProcessRuntimeConfig {
  type: 'in-process';
  /** Override the class used (reserved for future plugin support) */
  className?: string;
}

export interface HttpRuntimeConfig {
  type: 'http';
  /** Base URL of the remote agent (e.g. http://localhost:4000) */
  url: string;
  /** Bearer token sent in Authorization header */
  authToken?: string;
  /** Request timeout in milliseconds (default 120_000) */
  timeoutMs?: number;
  /** Path for health endpoint (default /health) */
  healthPath?: string;
}

export interface SubprocessRuntimeConfig {
  type: 'subprocess';
  /** Command to spawn (e.g. "python", "node") */
  command: string;
  /** Arguments to the command */
  args?: string[];
  /** Working directory */
  cwd?: string;
  /** Extra environment variables */
  env?: Record<string, string>;
  /** Timeout in milliseconds (default 120_000) */
  timeoutMs?: number;
  /** Communication protocol: stdio (JSON over stdin/stdout) or http (spawn then POST) */
  protocol?: 'stdio' | 'http';
}
