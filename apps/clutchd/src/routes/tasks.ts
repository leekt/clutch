import { generateTaskId, generateRunId } from '@clutch/protocol';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { pubsub } from '../queue/index.js';
import { taskRepository, auditRepository } from '../repositories/index.js';
import { messageBus } from '../services/message-bus.js';
import { isValidTransition, VALID_TRANSITIONS } from '../services/task-state-machine.js';
import { workflowEngine } from '../services/workflow-engine.js';

const taskStateSchema = z.enum(['created', 'assigned', 'running', 'review', 'rework', 'done', 'cancelled', 'failed']);

/**
 * Helper to find a task by UUID or taskId
 */
async function findTask(id: string) {
  return await taskRepository.findById(id) ?? await taskRepository.findByTaskId(id);
}

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),

  // Task hierarchy
  runId: z.string().optional(), // Will be generated if not provided
  parentTaskId: z.string().optional(),

  // Workflow
  workflowId: z.string().optional(),
  workflowStepId: z.string().optional(),

  // Assignment
  assigneeId: z.string().uuid().optional(),

  // Channel
  channelId: z.string().uuid().optional(),

  // Constraints
  constraints: z.object({
    maxTokens: z.number().optional(),
    maxRuntimeSec: z.number().optional(),
    maxCost: z.number().optional(),
  }).optional(),

  // Metadata
  metadata: z.record(z.unknown()).optional(),
});

const updateTaskSchema = createTaskSchema.partial();

export async function taskRoutes(app: FastifyInstance) {
  // List all tasks
  app.get('/api/tasks', async (request, reply) => {
    const query = request.query as { state?: string; assigneeId?: string; runId?: string; limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 100;

    let tasks;
    if (query.runId) {
      tasks = await taskRepository.findByRunId(query.runId);
    } else if (query.state) {
      const stateResult = taskStateSchema.safeParse(query.state);
      if (!stateResult.success) {
        return reply.status(400).send({ error: 'Invalid state filter' });
      }
      tasks = await taskRepository.findByState(stateResult.data);
    } else if (query.assigneeId) {
      tasks = await taskRepository.findByAssignee(query.assigneeId);
    } else {
      tasks = await taskRepository.findAll(limit);
    }

    return reply.send({ tasks });
  });

  // Get task by ID (supports UUID or taskId)
  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const task = await findTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    return reply.send({ task });
  });

  // Get subtasks
  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId/subtasks', async (request, reply) => {
    const subtasks = await taskRepository.findSubtasks(request.params.taskId);
    return reply.send({ subtasks });
  });

  // Get tasks by run
  app.get<{ Params: { runId: string } }>('/api/runs/:runId/tasks', async (request, reply) => {
    const tasks = await taskRepository.findByRunId(request.params.runId);
    return reply.send({ tasks });
  });

  // Create task
  app.post('/api/tasks', async (request, reply) => {
    const result = createTaskSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid task data', details: result.error.issues });
    }

    const data = result.data;
    const taskId = generateTaskId();
    const runId = data.runId ?? generateRunId();

    const task = await taskRepository.create({
      taskId,
      runId,
      parentTaskId: data.parentTaskId ?? null,
      title: data.title,
      description: data.description ?? null,
      workflowId: data.workflowId ?? null,
      workflowStepId: data.workflowStepId ?? null,
      assigneeId: data.assigneeId ?? null,
      channelId: data.channelId ?? null,
      constraints: data.constraints ?? {},
      metadata: data.metadata ?? {},
    });

    await auditRepository.logAction('task.created', 'task', taskId, {
      runId,
      taskId,
      details: { title: task.title },
    });

    await pubsub.publishTaskUpdate(taskId, 'created', task);

    return reply.status(201).send({ task });
  });

  // Update task
  app.put<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const result = updateTaskSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid task data', details: result.error.issues });
    }

    const task = await findTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    const updated = await taskRepository.update(task.id, result.data);

    await auditRepository.logAction('task.updated', 'task', task.taskId, {
      runId: task.runId,
      taskId: task.taskId,
      details: result.data,
    });

    await pubsub.publishTaskUpdate(task.taskId, 'updated', updated);

    return reply.send({ task: updated });
  });

  // Update task state (with state machine validation)
  app.patch<{ Params: { id: string } }>('/api/tasks/:id/state', async (request, reply) => {
    const stateChangeSchema = z.object({
      state: taskStateSchema,
      agentId: z.string().optional(),
    });

    const result = stateChangeSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid state change', details: result.error.issues });
    }

    const currentTask = await findTask(request.params.id);
    if (!currentTask) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    // Validate state transition
    if (!isValidTransition(currentTask.state, result.data.state)) {
      return reply.status(400).send({
        error: 'Invalid state transition',
        details: {
          currentState: currentTask.state,
          requestedState: result.data.state,
          validTransitions: VALID_TRANSITIONS[currentTask.state] ?? [],
        },
      });
    }

    const task = await taskRepository.updateState(currentTask.taskId, result.data.state);

    await auditRepository.logAction('task.state_changed', 'task', currentTask.taskId, {
      agentId: result.data.agentId,
      runId: currentTask.runId,
      taskId: currentTask.taskId,
      details: { from: currentTask.state, to: result.data.state },
    });

    await pubsub.publishTaskUpdate(currentTask.taskId, 'state_changed', task);

    return reply.send({ task });
  });

  // Assign task to agent
  app.patch<{ Params: { id: string } }>('/api/tasks/:id/assign', async (request, reply) => {
    const assignSchema = z.object({
      assigneeId: z.string().uuid(),
    });

    const result = assignSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid assignment', details: result.error.issues });
    }

    const currentTask = await findTask(request.params.id);
    if (!currentTask) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    const task = await taskRepository.assign(currentTask.taskId, result.data.assigneeId);

    await auditRepository.logAction('task.assigned', 'task', currentTask.taskId, {
      agentId: result.data.assigneeId,
      runId: currentTask.runId,
      taskId: currentTask.taskId,
      details: { assigneeId: result.data.assigneeId },
    });

    await pubsub.publishTaskUpdate(currentTask.taskId, 'assigned', task);

    return reply.send({ task });
  });

  // Set task output (complete successfully)
  app.patch<{ Params: { id: string } }>('/api/tasks/:id/complete', async (request, reply) => {
    const completeSchema = z.object({
      output: z.unknown(),
      agentId: z.string().optional(),
    });

    const result = completeSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid completion data', details: result.error.issues });
    }

    const currentTask = await findTask(request.params.id);
    if (!currentTask) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    const task = await taskRepository.setOutput(currentTask.taskId, result.data.output);

    await auditRepository.logAction('task.completed', 'task', currentTask.taskId, {
      agentId: result.data.agentId,
      runId: currentTask.runId,
      taskId: currentTask.taskId,
    });

    await pubsub.publishTaskUpdate(currentTask.taskId, 'completed', task);

    return reply.send({ task });
  });

  // Set task error (fail)
  app.patch<{ Params: { id: string } }>('/api/tasks/:id/fail', async (request, reply) => {
    const failSchema = z.object({
      error: z.object({
        code: z.string(),
        message: z.string(),
        retryable: z.boolean().default(false),
      }),
      agentId: z.string().optional(),
    });

    const result = failSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid error data', details: result.error.issues });
    }

    const currentTask = await findTask(request.params.id);
    if (!currentTask) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    const task = await taskRepository.setError(currentTask.taskId, result.data.error);

    await auditRepository.logAction('task.failed', 'task', currentTask.taskId, {
      agentId: result.data.agentId,
      runId: currentTask.runId,
      taskId: currentTask.taskId,
      details: { error: result.data.error },
    });

    await pubsub.publishTaskUpdate(currentTask.taskId, 'failed', task);

    return reply.send({ task });
  });

  // Delete task
  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const deleted = await taskRepository.delete(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    await auditRepository.logAction('task.deleted', 'task', request.params.id);

    return reply.status(204).send();
  });

  // ============== Workflow Endpoints ==============

  // Start a workflow for a task
  app.post<{ Params: { id: string } }>('/api/tasks/:id/workflow', async (request, reply) => {
    const workflowSchema = z.object({
      workflowName: z.string(),
    });

    const result = workflowSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid workflow data', details: result.error.issues });
    }

    const task = await findTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    // Start workflow
    const execution = await workflowEngine.startWorkflow(
      result.data.workflowName,
      task.taskId,
      task.runId,
      task.runId // Use runId as threadId for simplicity
    );

    if (!execution) {
      return reply.status(400).send({ error: 'Failed to start workflow' });
    }

    await auditRepository.logAction('workflow.started', 'task', task.taskId, {
      runId: task.runId,
      taskId: task.taskId,
      details: { workflowName: result.data.workflowName },
    });

    return reply.send({ execution });
  });

  // Advance workflow (approve/reject)
  app.post<{ Params: { id: string } }>('/api/tasks/:id/workflow/advance', async (request, reply) => {
    const advanceSchema = z.object({
      decision: z.enum(['approved', 'rejected']),
      comments: z.string().optional(),
    });

    const result = advanceSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid decision', details: result.error.issues });
    }

    const task = await findTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    const nextStep = await workflowEngine.advanceWorkflow(task.taskId, result.data.decision);

    await auditRepository.logAction('workflow.advanced', 'task', task.taskId, {
      runId: task.runId,
      taskId: task.taskId,
      details: { decision: result.data.decision, comments: result.data.comments },
    });

    return reply.send({ nextStep: nextStep === 'done' ? 'done' : nextStep?.id });
  });

  // Cancel workflow
  app.delete<{ Params: { id: string } }>('/api/tasks/:id/workflow', async (request, reply) => {
    const task = await findTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    const cancelled = await workflowEngine.cancelWorkflow(task.taskId, 'User cancelled');

    if (!cancelled) {
      return reply.status(400).send({ error: 'No active workflow for this task' });
    }

    return reply.send({ success: true });
  });

  // ============== Run/E2E Endpoints ==============

  // Create a new run (E2E task flow)
  app.post('/api/runs', async (request, reply) => {
    const runSchema = z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      workflowName: z.string().optional(), // Optional: auto-start a workflow
      requires: z.array(z.string()).optional(),
      prefers: z.array(z.string()).optional(),
    });

    const result = runSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid run data', details: result.error.issues });
    }

    const data = result.data;

    // Create run through message bus
    const run = await messageBus.createRun({
      title: data.title,
      description: data.description,
      requires: data.requires,
      prefers: data.prefers,
    });

    await auditRepository.logAction('run.created', 'run', run.runId, {
      runId: run.runId,
      taskId: run.taskId,
      details: { title: data.title },
    });

    // Auto-start workflow if specified
    if (data.workflowName) {
      await workflowEngine.startWorkflow(
        data.workflowName,
        run.taskId,
        run.runId,
        run.threadId
      );
    }

    return reply.status(201).send({
      runId: run.runId,
      taskId: run.taskId,
      threadId: run.threadId,
      messageId: run.message.id,
    });
  });

  // Get run status with all tasks
  app.get<{ Params: { runId: string } }>('/api/runs/:runId', async (request, reply) => {
    const tasks = await taskRepository.findByRunId(request.params.runId);
    const messages = await messageBus.getByRunId(request.params.runId);

    if (tasks.length === 0 && messages.length === 0) {
      return reply.status(404).send({ error: 'Run not found' });
    }

    // Calculate run status
    const taskStates = tasks.map(t => t.state);
    const allDone = taskStates.every(s => s === 'done');
    const anyFailed = taskStates.some(s => s === 'failed');
    const anyRunning = taskStates.some(s => ['running', 'assigned', 'review', 'rework'].includes(s));

    let status = 'created';
    if (allDone) status = 'completed';
    else if (anyFailed) status = 'failed';
    else if (anyRunning) status = 'running';

    return reply.send({
      runId: request.params.runId,
      status,
      tasks,
      messageCount: messages.length,
      summary: {
        total: tasks.length,
        completed: taskStates.filter(s => s === 'done').length,
        failed: taskStates.filter(s => s === 'failed').length,
        running: taskStates.filter(s => ['running', 'assigned'].includes(s)).length,
        pending: taskStates.filter(s => s === 'created').length,
      },
    });
  });

  // List available workflows
  app.get('/api/workflows', async (_request, reply) => {
    const workflows = workflowEngine.listWorkflows();
    return reply.send({ workflows });
  });

  // Get workflow execution status
  app.get<{ Params: { id: string } }>('/api/tasks/:id/workflow/status', async (request, reply) => {
    const task = await findTask(request.params.id);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    const execution = workflowEngine.getExecution(task.taskId);
    if (!execution) {
      return reply.status(404).send({ error: 'No active workflow for this task' });
    }

    const workflow = workflowEngine.getWorkflow(execution.workflowId);
    const currentStep = workflow?.steps.find(s => s.id === execution.currentStepId);

    return reply.send({
      execution,
      workflow: workflow ? { name: workflow.name, description: workflow.description } : null,
      currentStep,
    });
  });
}
