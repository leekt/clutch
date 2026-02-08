import {
  DeveloperAgent,
  MarketingAgent,
  PMAgent,
  ResearchAgent,
  type AgentContext,
  type BaseAgent,
  type TaskDispatch,
  type TaskResult,
} from '@clutch/agents';

import { logger } from '../logger.js';
import { pubsub } from '../queue/index.js';
import { agentRepository } from '../repositories/index.js';

import { agentMemoryService } from './agent-memory.js';

/**
 * Agent Executor Service
 *
 * Bridges the control plane with actual agent implementations.
 * Routes tasks to the appropriate agent based on role and handles
 * execution lifecycle including memory management.
 */
export class AgentExecutorService {
  private agents: Map<string, BaseAgent> = new Map();
  private initialized = false;

  constructor() {
    // Initialize agent instances
    this.agents.set('pm', new PMAgent('agent:pm'));
    this.agents.set('research', new ResearchAgent('agent:research'));
    this.agents.set('marketing', new MarketingAgent('agent:marketing'));
    this.agents.set('developer', new DeveloperAgent('agent:developer', {
      workspaceRoot: process.env.WORKSPACE_ROOT || process.cwd(),
      allowShell: process.env.ALLOW_SHELL === 'true',
      allowGit: process.env.ALLOW_GIT === 'true',
    }));
  }

  /**
   * Initialize the executor service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Set up event listeners for all agents
    for (const [role, agent] of this.agents) {
      agent.on('progress', (update) => {
        this.handleProgress(role, update);
      });

      agent.on('tool_call', (call) => {
        this.handleToolCall(role, call);
      });
    }

    this.initialized = true;
    logger.info({ agentCount: this.agents.size }, 'Agent executor initialized');
  }

  /**
   * Execute a task using the appropriate agent
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

    // Get the agent executor by role
    const agent = this.agents.get(agentRecord.role);
    if (!agent) {
      log.error({ role: agentRecord.role }, 'No executor for agent role');
      return {
        taskId: taskPayload.taskId,
        success: false,
        error: {
          code: 'NO_EXECUTOR',
          message: `No executor available for role: ${agentRecord.role}`,
          retryable: false,
        },
        usage: { cost: 0, runtime: 0, tokens: 0 },
      };
    }

    log.info({ role: agentRecord.role, action: taskPayload.action }, 'Starting agent execution');

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
      const result = await agent.execute(dispatch, context);

      const runtime = Date.now() - startTime;
      log.info({
        success: result.success,
        runtime,
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
      const runtime = Date.now() - startTime;
      log.error({ error, runtime }, 'Agent execution failed');

      return {
        taskId: taskPayload.taskId,
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: (error as Error).message,
          retryable: true,
        },
        usage: { cost: 0, runtime, tokens: 0 },
      };
    }
  }

  /**
   * Handle progress updates from agents
   */
  private handleProgress(
    role: string,
    update: { taskId: string; progress: number; message?: string }
  ): void {
    logger.debug({
      role,
      taskId: update.taskId,
      progress: update.progress,
      message: update.message,
    }, 'Agent progress');

    // Publish progress update
    pubsub.publishTaskUpdate(update.taskId, 'progress', {
      progress: update.progress,
      message: update.message,
    }).catch(err => {
      logger.error({ err, taskId: update.taskId }, 'Failed to publish progress');
    });
  }

  /**
   * Handle tool calls from agents (for auditing)
   */
  private handleToolCall(
    role: string,
    call: { taskId: string; tool: string; input: unknown; output: unknown; timestamp: string }
  ): void {
    logger.debug({
      role,
      taskId: call.taskId,
      tool: call.tool,
    }, 'Agent tool call');

    // Could store in audit log
    // For now, just publish as an event
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

    // Update working memory with notes
    if (memoryUpdates.workingNotes) {
      try {
        await agentMemoryService.addProgress(agentId, memoryUpdates.workingNotes);
      } catch (error) {
        logger.warn({ error, agentId }, 'Failed to update working memory');
      }
    }

    // Add domain knowledge to long-term memory
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

    // Import messageBus here to avoid circular dependency
    const { messageBus } = await import('./message-bus.js');

    for (const subtask of subtasks) {
      try {
        // Create a task.request message for each subtask
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
   * Get agent by role
   */
  getAgent(role: string): BaseAgent | undefined {
    return this.agents.get(role);
  }

  /**
   * Get all agent capabilities
   */
  getAllCapabilities(): Record<string, Array<{ id: string; version?: string; tags?: string[] }>> {
    const capabilities: Record<string, Array<{ id: string; version?: string; tags?: string[] }>> = {};
    for (const [role, agent] of this.agents) {
      capabilities[role] = agent.getCapabilities();
    }
    return capabilities;
  }

  /**
   * Get agent health
   */
  getAgentHealth(role: string): { healthy: boolean; currentTask?: string; runtime?: number } | undefined {
    const agent = this.agents.get(role);
    return agent?.getHealth();
  }
}

// Singleton instance
export const agentExecutor = new AgentExecutorService();
