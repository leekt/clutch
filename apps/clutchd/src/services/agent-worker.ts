import { logger } from '../logger.js';
import { taskQueue, pubsub, type TaskDispatchPayload, type TaskResultPayload } from '../queue/index.js';
import { taskRepository, agentRepository } from '../repositories/index.js';

import { agentExecutor } from './agent-executor.js';
import { agentMemoryService } from './agent-memory.js';
import { agentRegistry } from './agent-registry.js';
import { agentSessionService } from './agent-session.js';
import { budgetService } from './budget-service.js';
import { messageBus } from './message-bus.js';
import { workflowEngine } from './workflow-engine.js';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Worker state
interface WorkerState {
  running: boolean;
  activeWorkers: number;
  processedTasks: number;
  failedTasks: number;
}

/**
 * Agent Worker Service
 *
 * Consumes tasks from the queue and dispatches them to agent containers.
 * Handles results and integrates with the MessageBus.
 */
export class AgentWorker {
  private state: WorkerState = {
    running: false,
    activeWorkers: 0,
    processedTasks: 0,
    failedTasks: 0,
  };
  private workerCount: number;
  private workerPromises: Promise<void>[] = [];

  constructor(workerCount: number = 3) {
    this.workerCount = workerCount;
  }

  /**
   * Start the worker service
   */
  async start(): Promise<void> {
    if (this.state.running) {
      logger.warn('Agent worker already running');
      return;
    }

    // Initialize the agent executor
    await agentExecutor.initialize();

    this.state.running = true;
    logger.info({ workerCount: this.workerCount }, 'Starting agent worker service');

    // Start worker loops
    for (let i = 0; i < this.workerCount; i++) {
      this.workerPromises.push(this.runWorker(i));
    }

    // Start result processor
    this.workerPromises.push(this.processResults());

    logger.info('Agent worker service started');
  }

  /**
   * Stop the worker service
   */
  async stop(): Promise<void> {
    if (!this.state.running) {
      return;
    }

    this.state.running = false;
    logger.info('Stopping agent worker service');

    // Wait for all workers to finish current tasks
    await Promise.all(this.workerPromises);
    this.workerPromises = [];

    logger.info({
      processedTasks: this.state.processedTasks,
      failedTasks: this.state.failedTasks,
    }, 'Agent worker service stopped');
  }

  /**
   * Get worker status
   */
  getStatus(): WorkerState {
    return { ...this.state };
  }

  /**
   * Main worker loop - processes tasks from the queue
   */
  private async runWorker(workerId: number): Promise<void> {
    logger.debug({ workerId }, 'Worker started');

    while (this.state.running) {
      try {
        // Get next task with timeout
        const task = await this.getNextTaskWithTimeout(5000);
        if (!task) continue;

        this.state.activeWorkers++;
        logger.info({ workerId, taskId: task.taskId }, 'Processing task');

        try {
          await this.processTask(task);
          this.state.processedTasks++;
        } catch (error) {
          this.state.failedTasks++;
          logger.error({ error, workerId, taskId: task.taskId }, 'Task processing failed');

          // Report failure
          await this.reportTaskFailure(task, error as Error);
        } finally {
          this.state.activeWorkers--;
        }
      } catch (error) {
        if (this.state.running) {
          logger.error({ error, workerId }, 'Worker error');
          // Brief pause before retrying
          await sleep(1000);
        }
      }
    }

    logger.debug({ workerId }, 'Worker stopped');
  }

  /**
   * Process a single task
   */
  private async processTask(task: TaskDispatchPayload): Promise<void> {
    const startTime = Date.now();

    // Get agent info
    const agent = await agentRepository.findByAgentId(task.agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${task.agentId}`);
    }

    // Check budget (estimate small usage for initial check)
    const budgetCheck = await budgetService.checkBudget(task.agentId, 0.01, 1000, 60);
    if (!budgetCheck.allowed) {
      throw new Error(`Budget exceeded for agent ${task.agentId}: ${budgetCheck.violations.join(', ')}`);
    }

    // Update task state to running
    await taskRepository.updateState(task.taskId, 'running');
    await pubsub.publishTaskUpdate(task.taskId, 'running', { agentId: task.agentId });

    // Publish task.accept message
    await messageBus.publish({
      thread_id: task.input?.threadId as string ?? `thr_${task.taskId}`,
      run_id: task.input?.runId as string ?? `run_${task.taskId}`,
      task_id: task.taskId,
      parent_task_id: task.input?.parentTaskId as string ?? null,
      from: { agent_id: task.agentId },
      to: [{ agent_id: 'agent:router' }],
      type: 'task.accept',
      payload: {
        taskId: task.taskId,
        agentId: task.agentId,
        startedAt: new Date().toISOString(),
      },
    });

    // Wake the agent if needed (Organization OS)
    if (!agentSessionService.isAwake(task.agentId)) {
      await agentSessionService.wakeAgent(task.agentId, 'task_assignment', {
        taskId: task.taskId,
      });
    }

    // Initialize working memory for this task
    try {
      const taskTitle = task.input?.title as string || task.action || 'Task';
      const taskContext = task.input?.description as string || JSON.stringify(task.input || {});
      await agentMemoryService.initializeWorkingMemory(
        task.agentId,
        task.taskId,
        taskTitle,
        taskContext
      );
    } catch (error) {
      logger.warn({ error, taskId: task.taskId }, 'Failed to initialize working memory');
    }

    // Execute task using real agent implementation
    const agentResult = await agentExecutor.executeTask(task.agentId, {
      taskId: task.taskId,
      runId: task.input?.runId as string ?? `run_${task.taskId}`,
      threadId: task.input?.threadId as string ?? `thr_${task.taskId}`,
      parentTaskId: (task.input?.parentTaskId as string) || undefined,
      action: task.action || 'default',
      input: task.input ?? {},
      constraints: {
        maxTokens: agent.budget?.maxTokens ?? undefined,
        maxRuntimeSec: agent.budget?.maxRuntime ?? 300,
        maxCost: agent.budget?.maxCost ?? undefined,
      },
    });

    const runtime = Date.now() - startTime;

    // Archive working memory on completion
    try {
      await agentMemoryService.archiveWorkingMemory(task.agentId);
      // Map failed status to 'blocked' for daily log (as 'failed' isn't a valid status)
      const logStatus = agentResult.success ? 'completed' : 'blocked';
      await agentMemoryService.addToDailyLog(task.agentId, {
        taskId: task.taskId,
        title: task.input?.title as string || task.action || 'Task',
        status: logStatus,
        duration: `${runtime}ms`,
        cost: agentResult.usage.cost,
      });
    } catch (error) {
      logger.warn({ error, taskId: task.taskId }, 'Failed to archive working memory');
    }

    // Map agent result to expected format
    const result = {
      success: agentResult.success,
      output: agentResult.output,
      error: agentResult.error,
      tokens: agentResult.usage.tokens,
      cost: agentResult.usage.cost,
    };

    // Record usage
    await budgetService.recordUsage({
      agentId: task.agentId,
      taskId: task.taskId,
      tokens: result.tokens,
      cost: result.cost,
      runtime,
      timestamp: new Date(),
    });

    // Publish task result message
    const resultMessage = await messageBus.publish({
      thread_id: task.input?.threadId as string ?? `thr_${task.taskId}`,
      run_id: task.input?.runId as string ?? `run_${task.taskId}`,
      task_id: task.taskId,
      parent_task_id: task.input?.parentTaskId as string ?? null,
      from: { agent_id: task.agentId },
      to: [{ agent_id: 'agent:router' }],
      type: result.success ? 'task.result' : 'task.error',
      payload: result.success ? result.output : result.error,
      meta: {
        cost: result.cost,
        runtime,
        tokens: result.tokens,
      },
    });

    // Mark agent as available
    await agentRegistry.markAvailable(agent.id);

    // If part of a workflow, notify the workflow engine
    if (task.workflowId) {
      await workflowEngine.handleStepComplete(task.taskId, resultMessage);
    } else {
      // Direct task completion
      if (result.success) {
        await taskRepository.setOutput(task.taskId, result.output);
      } else {
        await taskRepository.setError(task.taskId, {
          code: result.error?.code ?? 'UNKNOWN',
          message: result.error?.message ?? 'Unknown error',
          retryable: result.error?.retryable ?? false,
        });
      }
    }

    await pubsub.publishTaskUpdate(task.taskId, 'completed', {
      success: result.success,
      runtime,
      cost: result.cost,
      tokens: result.tokens,
    });

    logger.info({
      taskId: task.taskId,
      agentId: task.agentId,
      success: result.success,
      runtime,
      cost: result.cost,
    }, 'Task processed');
  }

  /**
   * Report task failure
   */
  private async reportTaskFailure(task: TaskDispatchPayload, error: Error): Promise<void> {
    // Update task state
    await taskRepository.setError(task.taskId, {
      code: 'WORKER_ERROR',
      message: error.message,
      retryable: true,
    });

    // Publish error message
    await messageBus.publish({
      thread_id: task.input?.threadId as string ?? `thr_${task.taskId}`,
      run_id: task.input?.runId as string ?? `run_${task.taskId}`,
      task_id: task.taskId,
      parent_task_id: task.input?.parentTaskId as string ?? null,
      from: { agent_id: 'agent:worker' },
      to: [{ agent_id: 'agent:router' }],
      type: 'task.error',
      payload: {
        code: 'WORKER_ERROR',
        message: error.message,
        retryable: true,
      },
    });

    // Mark agent as available if it was busy
    const agent = await agentRepository.findByAgentId(task.agentId);
    if (agent) {
      await agentRegistry.markAvailable(agent.id);
    }

    await pubsub.publishTaskUpdate(task.taskId, 'failed', {
      error: error.message,
    });
  }

  /**
   * Process task results from the result queue
   */
  private async processResults(): Promise<void> {
    logger.debug('Result processor started');

    while (this.state.running) {
      try {
        const result = await this.getNextResultWithTimeout(5000);
        if (!result) continue;

        await this.handleTaskResult(result);
      } catch (error) {
        if (this.state.running) {
          logger.error({ error }, 'Result processor error');
          await sleep(1000);
        }
      }
    }

    logger.debug('Result processor stopped');
  }

  /**
   * Handle a task result from an agent
   */
  private async handleTaskResult(result: TaskResultPayload): Promise<void> {
    logger.info({
      taskId: result.taskId,
      agentId: result.agentId,
      success: result.success,
    }, 'Received task result');

    // Record usage
    await budgetService.recordUsage({
      agentId: result.agentId,
      taskId: result.taskId,
      tokens: result.tokens,
      cost: result.cost,
      runtime: result.runtime,
      timestamp: new Date(),
    });

    // Get task info
    const task = await taskRepository.findByTaskId(result.taskId);
    if (!task) {
      logger.warn({ taskId: result.taskId }, 'Task not found for result');
      return;
    }

    // Update task
    if (result.success) {
      await taskRepository.setOutput(result.taskId, { messageId: result.messageId });
    } else {
      await taskRepository.setError(result.taskId, {
        code: 'AGENT_ERROR',
        message: result.error || 'Unknown error',
        retryable: true,
      });
    }

    // Mark agent as available
    const agent = await agentRepository.findByAgentId(result.agentId);
    if (agent) {
      await agentRegistry.markAvailable(agent.id);
    }

    // Publish event
    await pubsub.publishTaskUpdate(result.taskId, result.success ? 'completed' : 'failed', {
      agentId: result.agentId,
      success: result.success,
      runtime: result.runtime,
      cost: result.cost,
    });
  }

  /**
   * Get next task with timeout
   */
  private async getNextTaskWithTimeout(timeoutMs: number): Promise<TaskDispatchPayload | null> {
    return Promise.race([
      taskQueue.getNextTask(),
      sleep(timeoutMs).then(() => null),
    ]);
  }

  /**
   * Get next result with timeout
   */
  private async getNextResultWithTimeout(timeoutMs: number): Promise<TaskResultPayload | null> {
    return Promise.race([
      taskQueue.getNextResult(),
      sleep(timeoutMs).then(() => null),
    ]);
  }
}

// Singleton instance
export const agentWorker = new AgentWorker();
