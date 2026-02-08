import { readFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import type { ClutchMessage } from '@clutch/protocol';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..');
import { generateTaskId } from '@clutch/protocol';
import { parse } from 'yaml';
import { z } from 'zod';

import { logger } from '../logger.js';
import { pubsub, taskQueue } from '../queue/index.js';
import { taskRepository } from '../repositories/index.js';

import { agentRegistry } from './agent-registry.js';

// Protocol-compliant output types
const workflowOutputTypeSchema = z.enum([
  'task.progress',
  'task.result',
  'chat.message',
  'tool.result',
]);

// Schema for workflows.yaml - updated for Clutch Protocol
const workflowStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  agent: z.string(), // Agent role/name to assign
  action: z.string(), // Action to perform
  domain: z.enum(['research', 'code', 'code_review', 'planning', 'review', 'ops', 'security', 'marketing']).optional(),
  output_type: workflowOutputTypeSchema.optional().default('task.result'),
  requires_review: z.boolean().optional(),
  reviewer: z.string().optional(),
  timeout_sec: z.number().optional().default(300),
  next: z.object({
    approved: z.string(),
    rejected: z.string(),
  }).optional(),
});

const workflowSchema = z.object({
  name: z.string(),
  description: z.string(),
  trigger: z.string(),
  domain: z.enum(['research', 'code', 'code_review', 'planning', 'review', 'ops', 'security', 'marketing']).optional(),
  steps: z.array(workflowStepSchema),
});

const reviewPolicySchema = z.object({
  auto_approve: z.boolean(),
  max_rework_cycles: z.number().optional(),
  escalate_after: z.number().optional(),
  conditions: z.array(z.record(z.number())).optional(),
});

const workflowsConfigSchema = z.object({
  workflows: z.array(workflowSchema),
  states: z.array(z.object({
    name: z.string(),
    description: z.string(),
  })),
  review_policies: z.record(reviewPolicySchema),
});

export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type WorkflowsConfig = z.infer<typeof workflowsConfigSchema>;

export interface WorkflowExecution {
  workflowId: string;
  workflowName: string;
  currentStepId: string;
  taskId: string;
  runId: string;
  threadId: string;
  reworkCount: number;
  startedAt: Date;
}

export class WorkflowEngine {
  private config: WorkflowsConfig | null = null;
  private executions: Map<string, WorkflowExecution> = new Map();

  async loadConfig(configPath: string = resolve(PROJECT_ROOT, 'config/workflows.yaml')): Promise<void> {
    try {
      const content = await readFile(configPath, 'utf-8');
      const parsed = parse(content);
      this.config = workflowsConfigSchema.parse(parsed);
      logger.info({ workflows: this.config.workflows.length }, 'Workflows loaded');
    } catch (error) {
      logger.error({ error, configPath }, 'Failed to load workflows config');
      throw error;
    }
  }

  getWorkflow(name: string): Workflow | undefined {
    return this.config?.workflows.find((w) => w.name === name);
  }

  getWorkflowStep(workflowName: string, stepId: string): WorkflowStep | undefined {
    const workflow = this.getWorkflow(workflowName);
    return workflow?.steps.find((s) => s.id === stepId);
  }

  listWorkflows(): Workflow[] {
    return this.config?.workflows || [];
  }

  getReviewPolicy(name: string = 'default'): z.infer<typeof reviewPolicySchema> | undefined {
    return this.config?.review_policies[name];
  }

  /**
   * Start a workflow execution for a task
   */
  async startWorkflow(
    workflowName: string,
    taskId: string,
    runId: string,
    threadId: string
  ): Promise<WorkflowExecution | undefined> {
    const workflow = this.getWorkflow(workflowName);
    if (!workflow || workflow.steps.length === 0) {
      logger.error({ workflowName }, 'Workflow not found or has no steps');
      return undefined;
    }

    const firstStep = workflow.steps[0]!;
    const execution: WorkflowExecution = {
      workflowId: workflowName,
      workflowName: workflow.name,
      currentStepId: firstStep.id,
      taskId,
      runId,
      threadId,
      reworkCount: 0,
      startedAt: new Date(),
    };

    this.executions.set(taskId, execution);

    // Update task with workflow info
    await taskRepository.update(taskId, {
      workflowId: workflowName,
      workflowStepId: firstStep.id,
    });

    logger.info({ workflowName, taskId, runId, stepId: firstStep.id }, 'Workflow started');

    // Dispatch first step
    await this.executeStep(execution, firstStep);

    return execution;
  }

  /**
   * Execute a workflow step by dispatching to an agent
   */
  async executeStep(execution: WorkflowExecution, step: WorkflowStep): Promise<void> {
    // Find agent by role name
    const agent = await agentRegistry.getAgentByName(step.agent);
    if (!agent) {
      logger.error({ step: step.id, agentName: step.agent }, 'Agent not found for workflow step');

      // Publish workflow error
      await pubsub.publishTaskUpdate(execution.taskId, 'workflow_error', {
        stepId: step.id,
        error: `Agent not found: ${step.agent}`,
      });
      return;
    }

    // Check if agent is available
    const status = agentRegistry.getStatus(agent.id);
    if (status !== 'available') {
      logger.warn({ agentId: agent.id, status }, 'Agent not available, queuing task');
    }

    // Assign task to agent
    await taskRepository.assign(execution.taskId, agent.id);

    // Create sub-task ID for this step
    const stepTaskId = generateTaskId();

    // Dispatch to task queue with protocol-compliant payload
    await taskQueue.dispatch({
      taskId: execution.taskId,
      agentId: agent.id,
      workflowId: execution.workflowId,
      workflowStepId: step.id,
      action: step.action,
      expectedOutputType: step.output_type,
      input: {
        runId: execution.runId,
        threadId: execution.threadId,
        stepTaskId,
        domain: step.domain,
        timeoutSec: step.timeout_sec,
        requiresReview: step.requires_review,
        reviewer: step.reviewer,
      },
    });

    // Mark agent as busy
    await agentRegistry.markBusy(agent.id);

    // Publish step started event
    await pubsub.publishTaskUpdate(execution.taskId, 'step_started', {
      stepId: step.id,
      stepName: step.name,
      agentId: agent.id,
      stepTaskId,
    });

    logger.info({
      taskId: execution.taskId,
      agentId: agent.id,
      stepId: step.id,
      action: step.action,
    }, 'Workflow step dispatched');
  }

  /**
   * Handle step completion and advance the workflow
   */
  async handleStepComplete(
    taskId: string,
    message: ClutchMessage
  ): Promise<void> {
    const execution = this.executions.get(taskId);
    if (!execution) {
      logger.warn({ taskId }, 'No workflow execution found for task');
      return;
    }

    const currentStep = this.getWorkflowStep(execution.workflowId, execution.currentStepId);
    if (!currentStep) {
      logger.warn({ taskId, stepId: execution.currentStepId }, 'Current workflow step not found');
      return;
    }

    // Validate output type
    if (currentStep.output_type && message.type !== currentStep.output_type) {
      logger.warn({
        taskId,
        expected: currentStep.output_type,
        received: message.type,
      }, 'Unexpected message type for workflow step');
    }

    // If step requires review, wait for review decision
    if (currentStep.requires_review) {
      await taskRepository.updateState(taskId, 'review');
      await pubsub.publishTaskUpdate(taskId, 'awaiting_review', {
        stepId: currentStep.id,
        reviewer: currentStep.reviewer,
        messageId: message.id,
      });

      logger.info({
        taskId,
        stepId: currentStep.id,
        reviewer: currentStep.reviewer,
      }, 'Step complete, awaiting review');
      return;
    }

    // Auto-advance if no review required
    await this.advanceWorkflow(taskId, 'approved');
  }

  /**
   * Advance the workflow based on review decision
   */
  async advanceWorkflow(
    taskId: string,
    decision: 'approved' | 'rejected'
  ): Promise<WorkflowStep | 'done' | undefined> {
    const execution = this.executions.get(taskId);
    if (!execution) {
      logger.warn({ taskId }, 'No workflow execution found for task');
      return undefined;
    }

    const currentStep = this.getWorkflowStep(execution.workflowId, execution.currentStepId);
    if (!currentStep || !currentStep.next) {
      logger.warn({ taskId, stepId: execution.currentStepId }, 'Current step has no next steps');
      return undefined;
    }

    const nextStepId = currentStep.next[decision];

    // Check for terminal state
    if (nextStepId === 'done') {
      this.executions.delete(taskId);
      await taskRepository.updateState(taskId, 'done');

      await pubsub.publishTaskUpdate(taskId, 'workflow_complete', {
        workflowId: execution.workflowId,
        runId: execution.runId,
        decision,
      });

      logger.info({ taskId, workflowId: execution.workflowId }, 'Workflow completed');
      return 'done';
    }

    // Track rework cycles
    if (decision === 'rejected') {
      execution.reworkCount++;
      const policy = this.getReviewPolicy();

      if (policy?.max_rework_cycles && execution.reworkCount >= policy.max_rework_cycles) {
        logger.warn({ taskId, reworkCount: execution.reworkCount }, 'Max rework cycles exceeded');

        await pubsub.publishTaskUpdate(taskId, 'max_rework_exceeded', {
          workflowId: execution.workflowId,
          reworkCount: execution.reworkCount,
          maxCycles: policy.max_rework_cycles,
        });

        // Could escalate or handle differently
        if (policy.escalate_after && execution.reworkCount >= policy.escalate_after) {
          await this.escalateTask(taskId, execution);
        }
      }
    }

    // Get next step
    const nextStep = this.getWorkflowStep(execution.workflowId, nextStepId);
    if (!nextStep) {
      logger.error({ taskId, nextStepId }, 'Next workflow step not found');
      return undefined;
    }

    // Update execution state
    execution.currentStepId = nextStepId;

    // Update task
    await taskRepository.update(taskId, {
      workflowStepId: nextStepId,
      state: decision === 'rejected' ? 'rework' : 'assigned',
    });

    await pubsub.publishTaskUpdate(taskId, 'workflow_advanced', {
      workflowId: execution.workflowId,
      fromStep: currentStep.id,
      toStep: nextStepId,
      decision,
    });

    logger.info({ taskId, stepId: nextStepId, decision }, 'Workflow advanced');

    // Execute next step
    await this.executeStep(execution, nextStep);

    return nextStep;
  }

  /**
   * Escalate a task when max rework cycles exceeded
   */
  private async escalateTask(taskId: string, execution: WorkflowExecution): Promise<void> {
    await taskRepository.setError(taskId, {
      code: 'ESCALATED',
      message: `Task escalated after ${execution.reworkCount} rework cycles`,
      retryable: true, // Can be manually retried
    });

    await pubsub.publishTaskUpdate(taskId, 'escalated', {
      workflowId: execution.workflowId,
      reworkCount: execution.reworkCount,
      reason: 'max_rework_cycles_exceeded',
    });

    logger.warn({ taskId, workflowId: execution.workflowId }, 'Task escalated');
  }

  /**
   * Cancel a workflow execution
   */
  async cancelWorkflow(taskId: string, reason?: string): Promise<boolean> {
    const execution = this.executions.get(taskId);
    if (!execution) {
      return false;
    }

    this.executions.delete(taskId);

    await taskRepository.updateState(taskId, 'cancelled');

    await pubsub.publishTaskUpdate(taskId, 'workflow_cancelled', {
      workflowId: execution.workflowId,
      currentStepId: execution.currentStepId,
      reason,
    });

    logger.info({ taskId, workflowId: execution.workflowId, reason }, 'Workflow cancelled');

    return true;
  }

  getExecution(taskId: string): WorkflowExecution | undefined {
    return this.executions.get(taskId);
  }

  /**
   * Check if a task should be auto-approved based on cost/runtime policies
   */
  shouldAutoApprove(cost: number, runtime: number): boolean {
    const policy = this.getReviewPolicy('fast_track');
    if (!policy || !policy.auto_approve) {
      return false;
    }

    if (policy.conditions) {
      for (const condition of policy.conditions) {
        if (condition.cost_under !== undefined && cost >= condition.cost_under) {
          return false;
        }
        if (condition.runtime_under !== undefined && runtime >= condition.runtime_under) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Get all active workflow executions
   */
  getActiveExecutions(): WorkflowExecution[] {
    return Array.from(this.executions.values());
  }

  /**
   * Restore workflow executions from database on startup
   */
  async restoreExecutions(): Promise<void> {
    // Find all tasks with active workflows
    const activeTasks = await taskRepository.findByStates(['assigned', 'running', 'review', 'rework']);

    for (const task of activeTasks) {
      if (task.workflowId && task.workflowStepId && task.runId) {
        const workflow = this.getWorkflow(task.workflowId);
        if (workflow) {
          const execution: WorkflowExecution = {
            workflowId: task.workflowId,
            workflowName: workflow.name,
            currentStepId: task.workflowStepId,
            taskId: task.taskId,
            runId: task.runId,
            threadId: task.runId, // Fallback, should track separately
            reworkCount: 0, // TODO: Track in database
            startedAt: task.startedAt ?? new Date(),
          };
          this.executions.set(task.taskId, execution);
        }
      }
    }

    logger.info({ count: this.executions.size }, 'Restored workflow executions');
  }
}

export const workflowEngine = new WorkflowEngine();
