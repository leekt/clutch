import type { AgentContext, ProgressUpdate } from '../executor/base-agent.js';
import type { BaseAgent } from '../executor/base-agent.js';
import type { TaskDispatch, TaskResult } from '../types.js';
import type { AgentRuntime, ToolCallEvent } from './types.js';

/**
 * InProcessRuntime wraps an existing BaseAgent subclass.
 *
 * This is the default runtime — zero behavior change from the previous
 * hardcoded approach. The BaseAgent's `execute()` method is called directly.
 */
export class InProcessRuntime implements AgentRuntime {
  readonly type = 'in-process';
  private progressCallbacks: Array<(update: ProgressUpdate) => void> = [];
  private toolCallCallbacks: Array<(call: ToolCallEvent) => void> = [];

  constructor(
    readonly agentName: string,
    private readonly agent: BaseAgent,
  ) {}

  async initialize(): Promise<void> {
    // Wire up event forwarding from BaseAgent to runtime callbacks
    this.agent.on('progress', (update: ProgressUpdate) => {
      for (const cb of this.progressCallbacks) cb(update);
    });
    this.agent.on('tool_call', (call: ToolCallEvent) => {
      for (const cb of this.toolCallCallbacks) cb(call);
    });
  }

  async execute(dispatch: TaskDispatch, context: Partial<AgentContext>): Promise<TaskResult> {
    return this.agent.execute(dispatch, context);
  }

  async getHealth(): Promise<{ healthy: boolean; details?: Record<string, unknown> }> {
    const h = this.agent.getHealth();
    return { healthy: h.healthy, details: { currentTask: h.currentTask, runtime: h.runtime } };
  }

  async shutdown(): Promise<void> {
    this.agent.removeAllListeners();
    this.progressCallbacks = [];
    this.toolCallCallbacks = [];
  }

  onProgress(cb: (update: ProgressUpdate) => void): void {
    this.progressCallbacks.push(cb);
  }

  onToolCall(cb: (call: ToolCallEvent) => void): void {
    this.toolCallCallbacks.push(cb);
  }
}
