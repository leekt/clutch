import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { messageBus } from '../services/index.js';
import { auditRepository } from '../repositories/index.js';

const createRunSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  requires: z.array(z.string()).optional(),
  prefers: z.array(z.string()).optional(),
  fromAgent: z.string().optional(),
});

export async function runRoutes(app: FastifyInstance) {
  // Create a new run
  app.post('/api/runs', async (request, reply) => {
    const result = createRunSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid run data', details: result.error.issues });
    }

    const { runId, taskId, threadId, message } = await messageBus.createRun(result.data);

    await auditRepository.logAction('run.created', 'run', runId, {
      runId,
      taskId,
      details: { title: result.data.title },
    });

    return reply.status(201).send({
      runId,
      taskId,
      threadId,
      message,
    });
  });

  // Get all messages for a run
  app.get<{ Params: { runId: string } }>('/api/runs/:runId', async (request, reply) => {
    const messages = await messageBus.getByRunId(request.params.runId);

    return reply.send({
      runId: request.params.runId,
      messageCount: messages.length,
      messages,
    });
  });

  // Get messages for a run (alias route)
  app.get<{ Params: { runId: string } }>('/api/runs/:runId/messages', async (request, reply) => {
    const messages = await messageBus.getByRunId(request.params.runId);

    return reply.send({
      runId: request.params.runId,
      messages,
    });
  });

  // Replay a run (stream messages in order)
  app.get<{ Params: { runId: string } }>('/api/runs/:runId/replay', async (request, reply) => {
    const messages: unknown[] = [];

    for await (const msg of messageBus.replayRun(request.params.runId)) {
      messages.push(msg);
    }

    return reply.send({
      runId: request.params.runId,
      messageCount: messages.length,
      messages,
    });
  });

  // Get messages by thread
  app.get<{ Params: { threadId: string } }>('/api/threads/:threadId', async (request, reply) => {
    const messages = await messageBus.getByThreadId(request.params.threadId);

    return reply.send({
      threadId: request.params.threadId,
      messages,
    });
  });

  // Publish a message to the bus
  app.post('/api/bus/publish', async (request, reply) => {
    const messageSchema = z.object({
      thread_id: z.string(),
      run_id: z.string(),
      task_id: z.string(),
      parent_task_id: z.string().nullable().optional(),
      from: z.object({ agent_id: z.string() }),
      to: z.array(z.object({ agent_id: z.string() })),
      type: z.string(),
      domain: z.string().optional(),
      payload_type: z.string().optional(),
      payload: z.unknown(),
      requires: z.array(z.string()).optional(),
      prefers: z.array(z.string()).optional(),
      attachments: z.array(z.unknown()).optional(),
      idempotency_key: z.string().optional(),
      meta: z.record(z.unknown()).optional(),
    });

    const result = messageSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid message', details: result.error.issues });
    }

    const message = await messageBus.publish(result.data as Parameters<typeof messageBus.publish>[0]);

    return reply.status(201).send({ message });
  });

  // Get agent registry status
  app.get('/api/bus/agents', async (_request, reply) => {
    const registry = messageBus.getAgentRegistry();
    const agents = await registry.list();

    return reply.send({
      count: agents.length,
      agents: agents.map((a) => ({
        id: a.agent_id,
        name: a.display.name,
        capabilities: a.capabilities,
      })),
    });
  });

  // Refresh agent registry
  app.post('/api/bus/agents/refresh', async (_request, reply) => {
    await messageBus.refreshAgents();

    return reply.send({ success: true, message: 'Agent registry refreshed' });
  });
}
