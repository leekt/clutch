import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { taskQueue, pubsub } from '../queue/index.js';
import { messageBus } from '../services/index.js';
import { taskRepository, agentRepository, auditRepository } from '../repositories/index.js';

// Progress update schema
const progressUpdateSchema = z.object({
  taskId: z.string(),
  agentId: z.string(),
  progress: z.number().min(0).max(100),
  message: z.string().optional(),
  artifacts: z.array(z.object({
    path: z.string(),
    hash: z.string(),
  })).optional(),
});

// Task result schema
const taskResultSchema = z.object({
  taskId: z.string(),
  agentId: z.string(),
  success: z.boolean(),
  output: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }).optional(),
  artifacts: z.array(z.object({
    path: z.string(),
    hash: z.string(),
    mimeType: z.string().optional(),
  })).optional(),
  usage: z.object({
    cost: z.number(),
    runtime: z.number(),
    tokens: z.number(),
  }),
});

// Heartbeat schema
const heartbeatSchema = z.object({
  agentId: z.string(),
  status: z.enum(['healthy', 'busy', 'error']),
  currentTask: z.string().optional(),
  memoryUsageMb: z.number().optional(),
  cpuPercent: z.number().optional(),
});

export async function agentCallbackRoutes(app: FastifyInstance) {
  /**
   * Agent progress callback
   * Called by agents to report progress on a task
   */
  app.post('/api/agent/callback/progress', async (request, reply) => {
    const result = progressUpdateSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid progress update', details: result.error.issues });
    }

    const { taskId, agentId, progress, message, artifacts } = result.data;

    // Verify agent exists
    const agent = await agentRepository.findByAgentId(agentId);
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    // Verify task exists and is assigned to this agent
    const task = await taskRepository.findByTaskId(taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    // Publish progress message
    await messageBus.publish({
      thread_id: `thr_${task.runId}`,
      run_id: task.runId,
      task_id: taskId,
      parent_task_id: task.parentTaskId,
      from: { agent_id: agentId },
      to: [{ agent_id: 'agent:router' }],
      type: 'task.progress',
      payload: {
        progress,
        message,
        artifacts,
      },
    });

    // Publish real-time update
    await pubsub.publishTaskUpdate(taskId, 'progress', {
      agentId,
      progress,
      message,
    });

    return reply.send({ success: true });
  });

  /**
   * Agent result callback
   * Called by agents when they complete a task
   */
  app.post('/api/agent/callback/result', async (request, reply) => {
    const result = taskResultSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid task result', details: result.error.issues });
    }

    const data = result.data;

    // Verify agent exists
    const agent = await agentRepository.findByAgentId(data.agentId);
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    // Verify task exists
    const task = await taskRepository.findByTaskId(data.taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    // Submit result to queue for processing
    await taskQueue.submitResult({
      taskId: data.taskId,
      agentId: data.agentId,
      success: data.success,
      error: data.error?.message,
      cost: data.usage.cost,
      runtime: data.usage.runtime,
      tokens: data.usage.tokens,
      timestamp: new Date().toISOString(),
    });

    // Log audit
    await auditRepository.logAction(
      data.success ? 'task.completed' : 'task.failed',
      'task',
      data.taskId,
      {
        agentId: data.agentId,
        taskId: data.taskId,
        cost: String(data.usage.cost),
        runtime: data.usage.runtime,
        tokens: data.usage.tokens,
        details: {
          success: data.success,
          error: data.error,
        },
      }
    );

    return reply.send({ success: true, received: new Date().toISOString() });
  });

  /**
   * Agent heartbeat
   * Called by agents periodically to report health
   */
  app.post('/api/agent/callback/heartbeat', async (request, reply) => {
    const result = heartbeatSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid heartbeat', details: result.error.issues });
    }

    const { agentId, status, currentTask, memoryUsageMb, cpuPercent } = result.data;

    // Verify agent exists
    const agent = await agentRepository.findByAgentId(agentId);
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    // Update agent last heartbeat
    await agentRepository.update(agent.id, {
      lastHeartbeat: new Date(),
      status: status === 'error' ? 'offline' : status === 'busy' ? 'busy' : 'available',
    });

    // Publish status update
    await pubsub.publishAgentStatus(agentId, status, {
      currentTask,
      memoryUsageMb,
      cpuPercent,
    });

    return reply.send({ success: true, timestamp: new Date().toISOString() });
  });

  /**
   * Agent registration callback
   * Called by agents when they start up
   */
  app.post('/api/agent/callback/register', async (request, reply) => {
    const registerSchema = z.object({
      agentId: z.string(),
      capabilities: z.array(z.object({
        id: z.string(),
        version: z.string().optional(),
        tags: z.array(z.string()).optional(),
      })).optional(),
      tools: z.array(z.string()).optional(),
    });

    const result = registerSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid registration', details: result.error.issues });
    }

    const { agentId, capabilities, tools } = result.data;

    // Verify agent exists in database
    const agent = await agentRepository.findByAgentId(agentId);
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found in registry' });
    }

    // Update agent with runtime info
    // Map capabilities to ensure version has a default value
    const mappedCapabilities = capabilities?.map(cap => ({
      id: cap.id,
      version: cap.version ?? '1.0.0',
      tags: cap.tags,
    })) ?? agent.capabilities;

    await agentRepository.update(agent.id, {
      status: 'available',
      lastHeartbeat: new Date(),
      capabilities: mappedCapabilities,
      tools: tools ?? agent.tools,
    });

    // Publish registration event
    await messageBus.publish({
      thread_id: `thr_system`,
      run_id: `run_system`,
      task_id: `task_registration_${agentId}`,
      parent_task_id: null,
      from: { agent_id: agentId },
      to: [{ agent_id: 'agent:router' }],
      type: 'agent.register',
      payload: {
        agentId,
        capabilities,
        tools,
        registeredAt: new Date().toISOString(),
      },
    });

    await auditRepository.logAction('agent.registered', 'agent', agentId, {
      agentId,
      details: { capabilities, tools },
    });

    // Refresh agent registry
    await messageBus.refreshAgents();

    return reply.send({
      success: true,
      agent: {
        id: agent.agentId,
        name: agent.name,
        role: agent.role,
        permissions: agent.permissions,
        budget: agent.budget,
      },
    });
  });

  /**
   * Agent deregistration callback
   * Called by agents when they shut down
   */
  app.post('/api/agent/callback/deregister', async (request, reply) => {
    const deregisterSchema = z.object({
      agentId: z.string(),
      reason: z.string().optional(),
    });

    const result = deregisterSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid deregistration', details: result.error.issues });
    }

    const { agentId, reason } = result.data;

    // Update agent status
    const agent = await agentRepository.findByAgentId(agentId);
    if (agent) {
      await agentRepository.update(agent.id, {
        status: 'offline',
      });
    }

    // Publish deregistration event
    await messageBus.publish({
      thread_id: `thr_system`,
      run_id: `run_system`,
      task_id: `task_deregistration_${agentId}`,
      parent_task_id: null,
      from: { agent_id: agentId },
      to: [{ agent_id: 'agent:router' }],
      type: 'agent.update',
      payload: {
        agentId,
        status: 'offline',
        reason,
        deregisteredAt: new Date().toISOString(),
      },
    });

    await auditRepository.logAction('agent.deregistered', 'agent', agentId, {
      agentId,
      details: { reason },
    });

    // Refresh agent registry
    await messageBus.refreshAgents();

    return reply.send({ success: true });
  });
}
