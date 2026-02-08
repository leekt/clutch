import {
  createRuntime,
  type AgentContext,
  type AgentRuntime,
  type RuntimeConfig,
  type TaskDispatch,
  type TaskResult,
} from '@clutch/agents';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { logger } from '../logger.js';
import { pubsub } from '../queue/index.js';
import { agentRepository } from '../repositories/index.js';

import { agentMemoryService } from './agent-memory.js';
import { secretStore } from './secret-store.js';

/**
 * Agent Executor Service
 *
 * Bridges the control plane with agent runtimes.
 * Uses the AgentRuntime abstraction to support in-process, HTTP, and subprocess agents.
 */
export class AgentExecutorService {
  private runtimes: Map<string, AgentRuntime> = new Map();
  private initialized = false;
  private projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

  private normalizeRuntimeConfig(config: RuntimeConfig): RuntimeConfig {
    if (config.type !== 'subprocess') {
      return config;
    }

    if (!config.cwd) {
      return { ...config, cwd: this.projectRoot };
    }

    return config;
  }

  private async resolveRuntimeSecrets(config: RuntimeConfig): Promise<RuntimeConfig> {
    if (config.type === 'http') {
      const httpConfig = config as RuntimeConfig & { authTokenSecret?: string };
      if (httpConfig.authTokenSecret) {
        const token = await secretStore.getSecret(httpConfig.authTokenSecret);
        return { ...config, authToken: token };
      }
      return config;
    }

    if (config.type === 'subprocess') {
      const subConfig = config as RuntimeConfig & { envSecrets?: Record<string, string> };
      if (subConfig.envSecrets && Object.keys(subConfig.envSecrets).length > 0) {
        const secretEnv = await secretStore.resolveEnvSecrets(subConfig.envSecrets);
        return {
          ...config,
          env: { ...(config.env ?? {}), ...secretEnv },
        };
      }
    }

    return config;
  }

  /**
   * Initialize the executor service.
   * Loads all agents from the database and creates runtimes for each.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const agents = await agentRepository.findAll();

    for (const agent of agents) {
      try {
        const runtimeConfig: RuntimeConfig = (agent.runtime as RuntimeConfig) ?? { type: 'in-process' };
        const normalized = this.normalizeRuntimeConfig(runtimeConfig);
        const resolved = await this.resolveRuntimeSecrets(normalized);
        const runtime = createRuntime(agent.name, resolved);

        // Wire up event forwarding
        runtime.onProgress?.((update) => {
          this.handleProgress(agent.name, update);
        });

        runtime.onToolCall?.((call) => {
          this.handleToolCall(agent.name, call);
        });

        await runtime.initialize();
        this.runtimes.set(agent.name, runtime);
      } catch (error) {
        logger.warn({ agentName: agent.name, error }, 'Failed to initialize runtime (agent will be unavailable)');
      }
    }

    this.initialized = true;
    logger.info({ runtimeCount: this.runtimes.size }, 'Agent executor initialized');
  }

  /**
   * Ensure a runtime exists for an agent, creating it on-demand if needed.
   */
  private async ensureRuntime(agentName: string, runtimeConfig?: unknown): Promise<AgentRuntime | undefined> {
    let runtime = this.runtimes.get(agentName);
    if (runtime) return runtime;

    // Try to create on-demand
    try {
      const config: RuntimeConfig = (runtimeConfig as RuntimeConfig) ?? { type: 'in-process' };
      const normalized = this.normalizeRuntimeConfig(config);
      const resolved = await this.resolveRuntimeSecrets(normalized);
      runtime = createRuntime(agentName, resolved);

      runtime.onProgress?.((update) => {
        this.handleProgress(agentName, update);
      });
      runtime.onToolCall?.((call) => {
        this.handleToolCall(agentName, call);
      });

      await runtime.initialize();
      this.runtimes.set(agentName, runtime);
      return runtime;
    } catch (error) {
      logger.error({ agentName, error }, 'Failed to create runtime on-demand');
      return undefined;
    }
  }

  /**
   * Execute a task using the appropriate agent runtime.
   */
  async executeTask(
    agentId: string,
    taskPayload: {
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
    }
  ): Promise<TaskResult> {
    const log = logger.child({ taskId: taskPayload.taskId, agentId });

    // Get agent info from database
    const agentRecord = await agentRepository.findByAgentId(agentId);
    if (!agentRecord) {
      log.error('Agent not found');
      return {
        taskId: taskPayload.taskId,
        success: false,
        error: {
          code: 'AGENT_NOT_FOUND',
          message: `Agent not found: ${agentId}`,
          retryable: false,
        },
        usage: { cost: 0, runtime: 0, tokens: 0 },
      };
    }

    // Get or create the runtime
    const runtime = await this.ensureRuntime(agentRecord.name, agentRecord.runtime);
    if (!runtime) {
      log.error({ name: agentRecord.name }, 'No runtime for agent');
      return {
        taskId: taskPayload.taskId,
        success: false,
        error: {
          code: 'NO_RUNTIME',
          message: `No runtime available for agent: ${agentRecord.name}`,
          retryable: false,
        },
        usage: { cost: 0, runtime: 0, tokens: 0 },
      };
    }

    log.info({ name: agentRecord.name, runtimeType: runtime.type, action: taskPayload.action }, 'Starting agent execution');

    // Build task dispatch
    const dispatch: TaskDispatch = {
      taskId: taskPayload.taskId,
      runId: taskPayload.runId,
      threadId: taskPayload.threadId,
      parentTaskId: taskPayload.parentTaskId,
      action: taskPayload.action,
      input: taskPayload.input,
      constraints: taskPayload.constraints,
    };

    // Build agent context with personality and memory
    const context: Partial<AgentContext> = {
      personality: agentRecord.personality ?? undefined,
      strengths: agentRecord.strengths ?? undefined,
      operatingRules: agentRecord.operatingRules ?? undefined,
    };

    // Load working memory if available
    try {
      const workingMemory = await agentMemoryService.getWorkingMemory(agentId);
      if (workingMemory) {
        context.workingMemory = this.formatWorkingMemory(workingMemory);
      }
    } catch (error) {
      log.warn({ error }, 'Failed to load working memory');
    }

    // Load long-term memory
    try {
      const longTermMemory = await agentMemoryService.getLongTermMemory(agentId);
      if (longTermMemory) {
        context.longTermMemory = this.formatLongTermMemory(longTermMemory);
      }
    } catch (error) {
      log.warn({ error }, 'Failed to load long-term memory');
    }

    // Execute the task
    const startTime = Date.now();
    try {
      const result = await runtime.execute(dispatch, context);

      const elapsed = Date.now() - startTime;
      log.info({
        success: result.success,
        runtime: elapsed,
        tokens: result.usage.tokens,
        cost: result.usage.cost,
      }, 'Agent execution complete');

      // Handle memory updates from the result
      if (result.success && result.output) {
        await this.handleMemoryUpdates(agentId, taskPayload.taskId, result);
      }

      // Handle subtask creation (for PM agent)
      if (result.success && result.output && typeof result.output === 'object') {
        const output = result.output as Record<string, unknown>;
        if (output.subtasks && Array.isArray(output.subtasks)) {
          await this.handleSubtasks(taskPayload, output.subtasks);
        }
      }

      return result;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      log.error({ error, runtime: elapsed }, 'Agent execution failed');

      return {
        taskId: taskPayload.taskId,
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: (error as Error).message,
          retryable: true,
        },
        usage: { cost: 0, runtime: elapsed, tokens: 0 },
      };
    }
  }

  /**
   * Handle progress updates from runtimes
   */
  private handleProgress(
    agentName: string,
    update: { taskId: string; progress: number; message?: string }
  ): void {
    logger.debug({
      agentName,
      taskId: update.taskId,
      progress: update.progress,
      message: update.message,
    }, 'Agent progress');

    pubsub.publishTaskUpdate(update.taskId, 'progress', {
      progress: update.progress,
      message: update.message,
    }).catch(err => {
      logger.error({ err, taskId: update.taskId }, 'Failed to publish progress');
    });
  }

  /**
   * Handle tool calls from runtimes (for auditing)
   */
  private handleToolCall(
    agentName: string,
    call: { taskId: string; tool: string; input: unknown; output: unknown; timestamp: string }
  ): void {
    logger.debug({
      agentName,
      taskId: call.taskId,
      tool: call.tool,
    }, 'Agent tool call');

    pubsub.publishMessageUpdate(call.taskId, 'tool_call', {
      tool: call.tool,
      timestamp: call.timestamp,
    }).catch(err => {
      logger.error({ err }, 'Failed to publish tool call');
    });
  }

  /**
   * Format working memory for agent context
   */
  private formatWorkingMemory(memory: {
    taskId: string;
    title: string;
    startedAt: string;
    context: string;
    progress: string[];
    notes: string;
  }): string {
    return `# Current Task: ${memory.title}
Started: ${memory.startedAt}

## Context
${memory.context}

## Progress
${memory.progress.map((p, i) => `${i + 1}. ${p}`).join('\n')}

## Notes
${memory.notes}`;
  }

  /**
   * Format long-term memory for agent context
   */
  private formatLongTermMemory(memory: {
    agentId: string;
    lastUpdated: string;
    domainKnowledge: Record<string, string>;
    lessonsLearned: string[];
  }): string {
    const parts: string[] = ['# Long-Term Memory'];

    if (Object.keys(memory.domainKnowledge).length > 0) {
      parts.push('\n## Domain Knowledge');
      for (const [topic, content] of Object.entries(memory.domainKnowledge)) {
        parts.push(`\n### ${topic}\n${content}`);
      }
    }

    if (memory.lessonsLearned.length > 0) {
      parts.push('\n## Lessons Learned');
      memory.lessonsLearned.forEach((lesson, i) => {
        parts.push(`${i + 1}. ${lesson}`);
      });
    }

    return parts.join('\n');
  }

  /**
   * Handle memory updates from task results
   */
  private async handleMemoryUpdates(
    agentId: string,
    _taskId: string,
    result: TaskResult
  ): Promise<void> {
    const output = result.output as Record<string, unknown> | undefined;
    if (!output) return;

    const memoryUpdates = output.memoryUpdates as {
      workingNotes?: string;
      domainKnowledge?: Array<{ topic: string; content: string }>;
    } | undefined;

    if (!memoryUpdates) return;

    if (memoryUpdates.workingNotes) {
      try {
        await agentMemoryService.addProgress(agentId, memoryUpdates.workingNotes);
      } catch (error) {
        logger.warn({ error, agentId }, 'Failed to update working memory');
      }
    }

    if (memoryUpdates.domainKnowledge?.length) {
      for (const knowledge of memoryUpdates.domainKnowledge) {
        try {
          await agentMemoryService.addDomainKnowledge(
            agentId,
            knowledge.topic,
            knowledge.content
          );
        } catch (error) {
          logger.warn({ error, agentId, topic: knowledge.topic }, 'Failed to add domain knowledge');
        }
      }
    }
  }

  /**
   * Handle subtask creation from PM agent
   */
  private async handleSubtasks(
    parentTask: {
      taskId: string;
      runId: string;
      threadId: string;
    },
    subtasks: Array<{
      title: string;
      description: string;
      assignTo?: string;
      requires?: string[];
      prefers?: string[];
      priority?: 'high' | 'medium' | 'low';
    }>
  ): Promise<void> {
    logger.info({
      parentTaskId: parentTask.taskId,
      subtaskCount: subtasks.length,
    }, 'Creating subtasks from PM decomposition');

    const { messageBus } = await import('./message-bus.js');

    for (const subtask of subtasks) {
      try {
        await messageBus.publish({
          thread_id: parentTask.threadId,
          run_id: parentTask.runId,
          task_id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          parent_task_id: parentTask.taskId,
          from: { agent_id: 'agent:pm' },
          to: subtask.assignTo ? [{ agent_id: subtask.assignTo }] : [{ agent_id: 'agent:router' }],
          type: 'task.request',
          domain: 'planning',
          payload: {
            title: subtask.title,
            description: subtask.description,
            priority: subtask.priority || 'medium',
          },
          requires: subtask.requires,
          prefers: subtask.prefers,
        });

        logger.info({
          title: subtask.title,
          assignTo: subtask.assignTo,
        }, 'Subtask created');
      } catch (error) {
        logger.error({ error, title: subtask.title }, 'Failed to create subtask');
      }
    }
  }

  /**
   * Get runtime for an agent by name
   */
  getRuntime(agentName: string): AgentRuntime | undefined {
    return this.runtimes.get(agentName);
  }

  /**
   * Get agent health via its runtime
   */
  async getAgentHealth(agentName: string): Promise<{ healthy: boolean; details?: Record<string, unknown> } | undefined> {
    const runtime = this.runtimes.get(agentName);
    if (!runtime) return undefined;
    return runtime.getHealth();
  }

  /**
   * Gracefully shut down all runtimes
   */
  async shutdown(): Promise<void> {
    for (const [name, runtime] of this.runtimes) {
      try {
        await runtime.shutdown();
      } catch (error) {
        logger.warn({ agentName: name, error }, 'Error shutting down runtime');
      }
    }
    this.runtimes.clear();
    this.initialized = false;
  }
}

// Singleton instance
export const agentExecutor = new AgentExecutorService();
