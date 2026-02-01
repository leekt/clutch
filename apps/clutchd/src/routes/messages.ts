import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { messageRepository, auditRepository, channelRepository } from '../repositories/index.js';
import { validateMessage, MessageValidationError } from '../services/message-validator.js';
import { pubsub } from '../queue/index.js';

const messageSchema = z.object({
  type: z.enum(['PLAN', 'PROPOSAL', 'EXEC_REPORT', 'REVIEW', 'BLOCKER']),
  senderId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  threadId: z.string().uuid().optional(),
  summary: z.string().min(1),
  body: z.string().min(1),
  artifacts: z.array(z.object({
    path: z.string(),
    hash: z.string(),
  })).default([]),
  citations: z.array(z.string()).default([]),
  cost: z.string().optional(),
  runtime: z.number().optional(),
  tokens: z.number().optional(),
});

export async function messageRoutes(app: FastifyInstance) {
  // List messages in a channel
  app.get<{ Params: { channelId: string } }>('/api/channels/:channelId/messages', async (request, reply) => {
    const query = request.query as { threadId?: string };

    let messages;
    if (query.threadId) {
      messages = await messageRepository.findThreadReplies(query.threadId);
    } else {
      messages = await messageRepository.findByChannel(request.params.channelId);
    }

    return reply.send({ messages });
  });

  // Get message by ID
  app.get<{ Params: { id: string } }>('/api/messages/:id', async (request, reply) => {
    const message = await messageRepository.findById(request.params.id);
    if (!message) {
      return reply.status(404).send({ error: 'Message not found' });
    }
    return reply.send({ message });
  });

  // Get thread replies
  app.get<{ Params: { id: string } }>('/api/messages/:id/replies', async (request, reply) => {
    const replies = await messageRepository.findThreadReplies(request.params.id);
    return reply.send({ replies });
  });

  // Create message in channel
  app.post<{ Params: { channelId: string } }>('/api/channels/:channelId/messages', async (request, reply) => {
    // Validate channel exists
    const channel = await channelRepository.findById(request.params.channelId);
    if (!channel) {
      return reply.status(404).send({ error: 'Channel not found' });
    }

    const result = messageSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid message data', details: result.error.issues });
    }

    // Validate message protocol requirements
    try {
      validateMessage(result.data);
    } catch (error) {
      if (error instanceof MessageValidationError) {
        return reply.status(400).send({ error: 'Message protocol violation', details: error.errors });
      }
      throw error;
    }

    const message = await messageRepository.create({
      ...result.data,
      channelId: request.params.channelId,
    });

    await auditRepository.logAction('message.created', 'message', message.id, {
      agentId: result.data.senderId,
      details: { type: message.type, channelId: request.params.channelId },
      cost: result.data.cost,
      runtime: result.data.runtime,
      tokens: result.data.tokens,
    });

    await pubsub.publishMessageUpdate(message.id, 'created', message);

    return reply.status(201).send({ message });
  });

  // Delete message
  app.delete<{ Params: { id: string } }>('/api/messages/:id', async (request, reply) => {
    const deleted = await messageRepository.delete(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'Message not found' });
    }

    await auditRepository.logAction('message.deleted', 'message', request.params.id);

    return reply.status(204).send();
  });
}
