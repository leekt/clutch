import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { taskRepository, auditRepository } from '../repositories/index.js';
import { isValidTransition, VALID_TRANSITIONS } from '../services/task-state-machine.js';
import { pubsub } from '../queue/index.js';

const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  workflowId: z.string().optional(),
  workflowStepId: z.string().optional(),
  assigneeId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateTaskSchema = taskSchema.partial();

const taskStateSchema = z.enum(['created', 'assigned', 'running', 'review', 'rework', 'done']);

export async function taskRoutes(app: FastifyInstance) {
  // List all tasks
  app.get('/api/tasks', async (request, reply) => {
    const query = request.query as { state?: string; assigneeId?: string };

    let tasks;
    if (query.state) {
      const stateResult = taskStateSchema.safeParse(query.state);
      if (!stateResult.success) {
        return reply.status(400).send({ error: 'Invalid state filter' });
      }
      tasks = await taskRepository.findByState(stateResult.data);
    } else if (query.assigneeId) {
      tasks = await taskRepository.findByAssignee(query.assigneeId);
    } else {
      tasks = await taskRepository.findAll();
    }

    return reply.send({ tasks });
  });

  // Get task by ID
  app.get<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const task = await taskRepository.findById(request.params.id);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    return reply.send({ task });
  });

  // Get subtasks
  app.get<{ Params: { id: string } }>('/api/tasks/:id/subtasks', async (request, reply) => {
    const subtasks = await taskRepository.findSubtasks(request.params.id);
    return reply.send({ subtasks });
  });

  // Create task
  app.post('/api/tasks', async (request, reply) => {
    const result = taskSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid task data', details: result.error.issues });
    }

    const task = await taskRepository.create(result.data);

    await auditRepository.logAction('task.created', 'task', task.id, {
      details: { title: task.title },
    });

    await pubsub.publishTaskUpdate(task.id, 'created', task);

    return reply.status(201).send({ task });
  });

  // Update task
  app.put<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const result = updateTaskSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid task data', details: result.error.issues });
    }

    const task = await taskRepository.update(request.params.id, result.data);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    await auditRepository.logAction('task.updated', 'task', task.id, {
      details: result.data,
    });

    await pubsub.publishTaskUpdate(task.id, 'updated', task);

    return reply.send({ task });
  });

  // Update task state (with state machine validation)
  app.patch<{ Params: { id: string } }>('/api/tasks/:id/state', async (request, reply) => {
    const stateChangeSchema = z.object({
      state: taskStateSchema,
      agentId: z.string().uuid().optional(),
    });

    const result = stateChangeSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid state change', details: result.error.issues });
    }

    const currentTask = await taskRepository.findById(request.params.id);
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
          validTransitions: VALID_TRANSITIONS[currentTask.state],
        },
      });
    }

    const task = await taskRepository.updateState(request.params.id, result.data.state);

    await auditRepository.logAction('task.state_changed', 'task', task!.id, {
      agentId: result.data.agentId,
      details: { from: currentTask.state, to: result.data.state },
    });

    await pubsub.publishTaskUpdate(task!.id, 'state_changed', task);

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

    const task = await taskRepository.assign(request.params.id, result.data.assigneeId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    await auditRepository.logAction('task.assigned', 'task', task.id, {
      agentId: result.data.assigneeId,
      details: { assigneeId: result.data.assigneeId },
    });

    await pubsub.publishTaskUpdate(task.id, 'assigned', task);

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
