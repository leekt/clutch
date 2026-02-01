import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { messageRepository, auditRepository, channelRepository } from '../repositories/index.js';
import { pubsub } from '../queue/index.js';
import { generateMessageId, generateThreadId, generateRunId, generateTaskId } from '@clutch/protocol';

// Input schema for creating messages (API level)
const createMessageSchema = z.object({
  // Type system
  type: z.enum([
    'task.request', 'task.accept', 'task.progress', 'task.result', 'task.error', 'task.cancel', 'task.timeout',
    'chat.message', 'chat.system',
    'tool.call', 'tool.result', 'tool.error',
    'agent.register', 'agent.heartbeat', 'agent.update',
    'routing.decision', 'routing.failure',
  ]),
  domain: z.enum(['research', 'code', 'code_review', 'planning', 'review', 'ops', 'security', 'marketing']).optional(),
  payloadType: z.string().optional(),

  // Addressing
  fromAgentId: z.string(),
  toAgentIds: z.array(z.string()).min(1),

  // Task hierarchy (optional - will be generated if not provided)
  threadId: z.string().optional(),
  runId: z.string().optional(),
  taskId: z.string().optional(),
  parentTaskId: z.string().optional(),

  // Content
  payload: z.unknown(),

  // Capability routing
  requires: z.array(z.string()).optional(),
  prefers: z.array(z.string()).optional(),

  // Attachments
  attachments: z.array(z.object({
    kind: z.enum(['artifact_ref', 'inline', 'url']),
    ref: z.string().optional(),
    content: z.unknown().optional(),
    url: z.string().optional(),
    mimeType: z.string().optional(),
  })).optional(),

  // Delivery
  idempotencyKey: z.string().optional(),

  // Metadata
  meta: z.record(z.unknown()).optional(),

  // Cost tracking
  cost: z.string().optional(),
  runtime: z.number().optional(),
  tokens: z.number().optional(),
});

export async function messageRoutes(app: FastifyInstance) {
  // List messages in a channel
  app.get<{ Params: { channelId: string } }>('/api/channels/:channelId/messages', async (request, reply) => {
    const query = request.query as { threadId?: string; limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 50;

    let messages;
    if (query.threadId) {
      messages = await messageRepository.findByThreadId(query.threadId);
    } else {
      messages = await messageRepository.findByChannel(request.params.channelId, limit);
    }

    return reply.send({ messages });
  });

  // List messages by run
  app.get<{ Params: { runId: string } }>('/api/runs/:runId/messages', async (request, reply) => {
    const messages = await messageRepository.findByRunId(request.params.runId);
    return reply.send({ messages });
  });

  // List messages by task
  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId/messages', async (request, reply) => {
    const messages = await messageRepository.findByTaskId(request.params.taskId);
    return reply.send({ messages });
  });

  // Get message by ID
  app.get<{ Params: { id: string } }>('/api/messages/:id', async (request, reply) => {
    // Try by UUID first, then by messageId
    let message = await messageRepository.findById(request.params.id);
    if (!message) {
      message = await messageRepository.findByMessageId(request.params.id);
    }
    if (!message) {
      return reply.status(404).send({ error: 'Message not found' });
    }
    return reply.send({ message });
  });

  // Get thread messages
  app.get<{ Params: { threadId: string } }>('/api/threads/:threadId/messages', async (request, reply) => {
    const messages = await messageRepository.findByThreadId(request.params.threadId);
    return reply.send({ messages });
  });

  // Create message in channel
  app.post<{ Params: { channelId: string } }>('/api/channels/:channelId/messages', async (request, reply) => {
    // Validate channel exists
    const channel = await channelRepository.findById(request.params.channelId);
    if (!channel) {
      return reply.status(404).send({ error: 'Channel not found' });
    }

    const result = createMessageSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid message data', details: result.error.issues });
    }

    const data = result.data;

    // Generate IDs if not provided
    const messageId = generateMessageId();
    const threadId = data.threadId ?? generateThreadId();
    const runId = data.runId ?? generateRunId();
    const taskId = data.taskId ?? generateTaskId();

    // Check for duplicate (idempotency)
    if (data.idempotencyKey) {
      const existing = await messageRepository.findByIdempotencyKey(data.idempotencyKey, runId);
      if (existing) {
        return reply.send({ message: existing, duplicate: true });
      }
    }

    // Create the database record
    const message = await messageRepository.create({
      messageId,
      version: 'clutch/0.1',
      threadId,
      runId,
      taskId,
      parentTaskId: data.parentTaskId ?? null,
      fromAgentId: data.fromAgentId,
      toAgentIds: data.toAgentIds,
      type: data.type,
      domain: data.domain ?? null,
      payloadType: data.payloadType ?? null,
      payload: data.payload,
      requires: data.requires ?? [],
      prefers: data.prefers ?? [],
      attachments: data.attachments ?? [],
      idempotencyKey: data.idempotencyKey ?? null,
      meta: data.meta ?? {},
      channelId: request.params.channelId,
      cost: data.cost ?? '0',
      runtime: data.runtime ?? 0,
      tokens: data.tokens ?? 0,
    });

    await auditRepository.logAction('message.created', 'message', messageId, {
      agentId: data.fromAgentId,
      runId,
      taskId,
      details: { type: message.type, channelId: request.params.channelId },
      cost: data.cost,
      runtime: data.runtime,
      tokens: data.tokens,
    });

    await pubsub.publishMessageUpdate(messageId, 'created', message);

    return reply.status(201).send({ message });
  });

  // Create message directly (without channel)
  app.post('/api/messages', async (request, reply) => {
    const result = createMessageSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid message data', details: result.error.issues });
    }

    const data = result.data;

    // Generate IDs if not provided
    const messageId = generateMessageId();
    const threadId = data.threadId ?? generateThreadId();
    const runId = data.runId ?? generateRunId();
    const taskId = data.taskId ?? generateTaskId();

    // Check for duplicate (idempotency)
    if (data.idempotencyKey) {
      const existing = await messageRepository.findByIdempotencyKey(data.idempotencyKey, runId);
      if (existing) {
        return reply.send({ message: existing, duplicate: true });
      }
    }

    // Create the database record
    const message = await messageRepository.create({
      messageId,
      version: 'clutch/0.1',
      threadId,
      runId,
      taskId,
      parentTaskId: data.parentTaskId ?? null,
      fromAgentId: data.fromAgentId,
      toAgentIds: data.toAgentIds,
      type: data.type,
      domain: data.domain ?? null,
      payloadType: data.payloadType ?? null,
      payload: data.payload,
      requires: data.requires ?? [],
      prefers: data.prefers ?? [],
      attachments: data.attachments ?? [],
      idempotencyKey: data.idempotencyKey ?? null,
      meta: data.meta ?? {},
      channelId: null,
      cost: data.cost ?? '0',
      runtime: data.runtime ?? 0,
      tokens: data.tokens ?? 0,
    });

    await auditRepository.logAction('message.created', 'message', messageId, {
      agentId: data.fromAgentId,
      runId,
      taskId,
      details: { type: message.type },
      cost: data.cost,
      runtime: data.runtime,
      tokens: data.tokens,
    });

    await pubsub.publishMessageUpdate(messageId, 'created', message);

    return reply.status(201).send({ message });
  });

  // Delete message (should rarely be used - event store is append-only)
  app.delete<{ Params: { id: string } }>('/api/messages/:id', async (request, reply) => {
    const deleted = await messageRepository.delete(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'Message not found' });
    }

    await auditRepository.logAction('message.deleted', 'message', request.params.id);

    return reply.status(204).send();
  });
}
