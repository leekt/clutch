import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { channelRepository, auditRepository } from '../repositories/index.js';

const channelSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['task', 'department', 'dm']),
  description: z.string().optional(),
  taskId: z.string().uuid().optional(),
});

const updateChannelSchema = channelSchema.partial();

export async function channelRoutes(app: FastifyInstance) {
  // List all channels
  app.get('/api/channels', async (request, reply) => {
    const query = request.query as { type?: string };

    let channels;
    if (query.type === 'task' || query.type === 'department' || query.type === 'dm') {
      channels = await channelRepository.findByType(query.type);
    } else {
      channels = await channelRepository.findAll();
    }

    return reply.send({ channels });
  });

  // Get channel by ID or name
  app.get<{ Params: { id: string } }>('/api/channels/:id', async (request, reply) => {
    const id = request.params.id;

    // Try UUID lookup first (skip if clearly not a UUID)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let channel = isUUID ? await channelRepository.findById(id) : undefined;

    // Fall back to name lookup
    if (!channel) {
      channel = await channelRepository.findByName(id);
    }
    if (!channel) {
      return reply.status(404).send({ error: 'Channel not found' });
    }
    return reply.send({ channel });
  });

  // Create channel
  app.post('/api/channels', async (request, reply) => {
    const result = channelSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid channel data', details: result.error.issues });
    }

    const channel = await channelRepository.create(result.data);

    await auditRepository.logAction('channel.created', 'channel', channel.id, {
      details: { name: channel.name, type: channel.type },
    });

    return reply.status(201).send({ channel });
  });

  // Update channel
  app.put<{ Params: { id: string } }>('/api/channels/:id', async (request, reply) => {
    const result = updateChannelSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid channel data', details: result.error.issues });
    }

    const channel = await channelRepository.update(request.params.id, result.data);
    if (!channel) {
      return reply.status(404).send({ error: 'Channel not found' });
    }

    await auditRepository.logAction('channel.updated', 'channel', channel.id, {
      details: result.data,
    });

    return reply.send({ channel });
  });

  // Delete channel
  app.delete<{ Params: { id: string } }>('/api/channels/:id', async (request, reply) => {
    const deleted = await channelRepository.delete(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'Channel not found' });
    }

    await auditRepository.logAction('channel.deleted', 'channel', request.params.id);

    return reply.status(204).send();
  });
}
