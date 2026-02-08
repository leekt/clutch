import { EventEmitter } from 'events';

import pino from 'pino';

import type { ProgressUpdate, TaskDispatch, TaskResult } from '../types.js';

export type { ProgressUpdate, TaskDispatch, TaskResult };

/**
 * Agent context provided to each task execution
 */
export interface AgentContext {
  agentId: string;
  taskId: string;
  runId: string;
  threadId: string;
  parentTaskId?: string;

  // Working memory content (loaded from WORKING.md)
  workingMemory?: string;

  // Long-term memory (loaded from MEMORY.md)
  longTermMemory?: string;

  // Agent personality and strengths
  personality?: {
    style?: 'analytical' | 'creative' | 'systematic' | 'pragmatic';
    communication?: 'concise' | 'verbose' | 'formal' | 'casual';
    decision_making?: 'data-driven' | 'intuitive' | 'consensus-seeking' | 'decisive';
  };
  strengths?: string[];
  operatingRules?: string[];

  // Constraints
  constraints?: {
    maxTokens?: number;
    maxRuntimeSec?: number;
    maxCost?: number;
  };

  // Progress reporting
  reportProgress: (progress: number, message?: string) => void;

  // Emit tool call for auditing
  emitToolCall: (tool: string, input: unknown, output: unknown) => void;
}

/**
 * Agent execution result
 */
export interface ExecutionResult {
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
  // For PM agent: subtasks to create
  subtasks?: Array<{
    title: string;
    description: string;
    assignTo?: string; // agent:research, agent:developer, etc.
    requires?: string[];
    prefers?: string[];
    priority?: 'high' | 'medium' | 'low';
  }>;
  // Memory updates
  memoryUpdates?: {
    workingNotes?: string;
    domainKnowledge?: Array<{
      topic: string;
      content: string;
    }>;
  };
  usage: {
    tokens: number;
    cost: number;
  };
}

/**
 * Base agent executor interface
 *
 * Each agent type (PM, Research, Marketing, Developer) extends this
 */
export abstract class BaseAgent extends EventEmitter {
  protected agentId: string;
  protected name: string;
  protected role: string;
  protected logger: pino.Logger;

  // Track current task for health checks
  protected currentTaskId?: string;
  protected startTime?: number;

  constructor(agentId: string, name: string, role: string) {
    super();
    this.agentId = agentId;
    this.name = name;
    this.role = role;
    this.logger = pino({ name: `agent-${name}` });
  }

  /**
   * Execute a task
   */
  async execute(dispatch: TaskDispatch, context: Partial<AgentContext> = {}): Promise<TaskResult> {
    this.currentTaskId = dispatch.taskId;
    this.startTime = Date.now();

    const fullContext: AgentContext = {
      agentId: this.agentId,
      taskId: dispatch.taskId,
      runId: dispatch.runId,
      threadId: dispatch.threadId,
      parentTaskId: dispatch.parentTaskId,
      constraints: dispatch.constraints,
      ...context,
      reportProgress: (progress, message) => {
        this.emit('progress', {
          taskId: dispatch.taskId,
          progress,
          message,
        } as ProgressUpdate);
      },
      emitToolCall: (tool, input, output) => {
        this.emit('tool_call', {
          taskId: dispatch.taskId,
          tool,
          input,
          output,
          timestamp: new Date().toISOString(),
        });
      },
    };

    try {
      this.logger.info({
        taskId: dispatch.taskId,
        action: dispatch.action,
      }, 'Starting task execution');

      fullContext.reportProgress(0, 'Starting task');

      const result = await this.executeTask(dispatch, fullContext);

      fullContext.reportProgress(100, 'Task complete');

      const runtime = Date.now() - this.startTime;

      this.logger.info({
        taskId: dispatch.taskId,
        success: result.success,
        runtime,
      }, 'Task execution complete');

      return {
        taskId: dispatch.taskId,
        success: result.success,
        output: result.output,
        error: result.error,
        artifacts: result.artifacts,
        usage: {
          tokens: result.usage.tokens,
          cost: result.usage.cost,
          runtime,
        },
      };
    } catch (error) {
      const runtime = Date.now() - (this.startTime || Date.now());

      this.logger.error({
        error,
        taskId: dispatch.taskId,
      }, 'Task execution failed');

      return {
        taskId: dispatch.taskId,
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: (error as Error).message,
          retryable: true,
        },
        usage: {
          tokens: 0,
          cost: 0,
          runtime,
        },
      };
    } finally {
      this.currentTaskId = undefined;
      this.startTime = undefined;
    }
  }

  /**
   * Implement this method in each agent type
   */
  protected abstract executeTask(
    dispatch: TaskDispatch,
    context: AgentContext
  ): Promise<ExecutionResult>;

  /**
   * Health check
   */
  getHealth(): { healthy: boolean; currentTask?: string; runtime?: number } {
    return {
      healthy: true,
      currentTask: this.currentTaskId,
      runtime: this.startTime ? Date.now() - this.startTime : undefined,
    };
  }

  /**
   * Get agent capabilities (overridden by each agent type)
   */
  abstract getCapabilities(): Array<{ id: string; version?: string; tags?: string[] }>;

  /**
   * Get available actions for this agent
   */
  abstract getAvailableActions(): string[];
}

/**
 * Agent events
 */
export interface AgentEvents {
  'progress': (update: ProgressUpdate) => void;
  'tool_call': (call: {
    taskId: string;
    tool: string;
    input: unknown;
    output: unknown;
    timestamp: string;
  }) => void;
}
