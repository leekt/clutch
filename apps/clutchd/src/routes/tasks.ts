import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { taskRepository, auditRepository } from '../repositories/index.js';
import { isValidTransition, VALID_TRANSITIONS } from '../services/task-state-machine.js';
import { pubsub } from '../queue/index.js';
import { generateTaskId, generateRunId } from '@clutch/protocol';

const taskStateSchema = z.enum(['created', 'assigned', 'running', 'review', 'rework', 'done', 'cancelled', 'failed']);

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
    let task = await taskRepository.findById(request.params.id);
    if (!task) {
      task = await taskRepository.findByTaskId(request.params.id);
    }
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

    // Find by UUID or taskId
    let task = await taskRepository.findById(request.params.id);
    if (!task) {
      task = await taskRepository.findByTaskId(request.params.id);
    }
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

    // Find by UUID or taskId
    let currentTask = await taskRepository.findById(request.params.id);
    if (!currentTask) {
      currentTask = await taskRepository.findByTaskId(request.params.id);
    }
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

    // Find by UUID or taskId
    let currentTask = await taskRepository.findById(request.params.id);
    if (!currentTask) {
      currentTask = await taskRepository.findByTaskId(request.params.id);
    }
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

    // Find by UUID or taskId
    let currentTask = await taskRepository.findById(request.params.id);
    if (!currentTask) {
      currentTask = await taskRepository.findByTaskId(request.params.id);
    }
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

    // Find by UUID or taskId
    let currentTask = await taskRepository.findById(request.params.id);
    if (!currentTask) {
      currentTask = await taskRepository.findByTaskId(request.params.id);
    }
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
}
