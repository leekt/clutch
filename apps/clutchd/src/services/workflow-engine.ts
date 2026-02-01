import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import { logger } from '../logger.js';
import { taskRepository } from '../repositories/index.js';
import { agentRegistry } from './agent-registry.js';
import { taskQueue } from '../queue/index.js';

// Schema for workflows.yaml
const workflowStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  agent: z.string(),
  action: z.string(),
  output_type: z.enum(['PLAN', 'PROPOSAL', 'EXEC_REPORT', 'REVIEW', 'BLOCKER']),
  requires_review: z.boolean().optional(),
  reviewer: z.string().optional(),
  next: z.object({
    approved: z.string(),
    rejected: z.string(),
  }).optional(),
});

const workflowSchema = z.object({
  name: z.string(),
  description: z.string(),
  trigger: z.string(),
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
  reworkCount: number;
  startedAt: Date;
}

export class WorkflowEngine {
  private config: WorkflowsConfig | null = null;
  private executions: Map<string, WorkflowExecution> = new Map();

  async loadConfig(configPath: string = 'config/workflows.yaml'): Promise<void> {
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

  async startWorkflow(workflowName: string, taskId: string): Promise<WorkflowExecution | undefined> {
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
      reworkCount: 0,
      startedAt: new Date(),
    };

    this.executions.set(taskId, execution);

    // Update task with workflow info
    await taskRepository.update(taskId, {
      workflowId: workflowName,
      workflowStepId: firstStep.id,
    });

    logger.info({ workflowName, taskId, stepId: firstStep.id }, 'Workflow started');

    // Dispatch first step
    await this.executeStep(taskId, firstStep);

    return execution;
  }

  async executeStep(taskId: string, step: WorkflowStep): Promise<void> {
    // Find agent by role name
    const agent = await agentRegistry.getAgentByName(step.agent);
    if (!agent) {
      logger.error({ step: step.id, agentName: step.agent }, 'Agent not found for workflow step');
      return;
    }

    // Check if agent is available
    const status = agentRegistry.getStatus(agent.id);
    if (status !== 'available') {
      logger.warn({ agentId: agent.id, status }, 'Agent not available, queuing task');
    }

    // Assign task to agent
    await taskRepository.assign(taskId, agent.id);

    // Dispatch to task queue
    await taskQueue.dispatch({
      taskId,
      agentId: agent.id,
      action: step.action,
      expectedOutputType: step.output_type,
    });

    // Mark agent as busy
    await agentRegistry.markBusy(agent.id);

    logger.info({ taskId, agentId: agent.id, action: step.action }, 'Step dispatched');
  }

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
      logger.info({ taskId, workflowId: execution.workflowId }, 'Workflow completed');
      return 'done';
    }

    // Track rework cycles
    if (decision === 'rejected') {
      execution.reworkCount++;
      const policy = this.getReviewPolicy();
      if (policy?.max_rework_cycles && execution.reworkCount >= policy.max_rework_cycles) {
        logger.warn({ taskId, reworkCount: execution.reworkCount }, 'Max rework cycles exceeded');
        // Could escalate or handle differently
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

    logger.info({ taskId, stepId: nextStepId, decision }, 'Workflow advanced');

    // Execute next step
    await this.executeStep(taskId, nextStep);

    return nextStep;
  }

  getExecution(taskId: string): WorkflowExecution | undefined {
    return this.executions.get(taskId);
  }

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
}

export const workflowEngine = new WorkflowEngine();
