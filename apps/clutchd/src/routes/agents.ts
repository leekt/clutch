import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { agentRepository } from '../repositories/index.js';
import { auditRepository } from '../repositories/index.js';

const agentSchema = z.object({
  name: z.string().min(1),
  role: z.enum(['pm', 'research', 'marketing', 'developer', 'qa']),
  description: z.string().optional(),
  image: z.string(),
  permissions: z.object({
    file: z.boolean(),
    shell: z.boolean(),
    git: z.boolean(),
    browser: z.boolean(),
  }),
  budget: z.object({
    maxTokens: z.number().optional(),
    maxCost: z.number().optional(),
    maxRuntime: z.number().optional(),
  }),
  secrets: z.array(z.string()).optional(),
});

const updateAgentSchema = agentSchema.partial();

export async function agentRoutes(app: FastifyInstance) {
  // List all agents
  app.get('/api/agents', async (_request, reply) => {
    const agents = await agentRepository.findAll();
    return reply.send({ agents });
  });

  // Get agent by ID
  app.get<{ Params: { id: string } }>('/api/agents/:id', async (request, reply) => {
    const agent = await agentRepository.findById(request.params.id);
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }
    return reply.send({ agent });
  });

  // Create agent
  app.post('/api/agents', async (request, reply) => {
    const result = agentSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid agent data', details: result.error.issues });
    }

    const agent = await agentRepository.create(result.data);

    await auditRepository.logAction('agent.created', 'agent', agent.id, {
      details: { name: agent.name, role: agent.role },
    });

    return reply.status(201).send({ agent });
  });

  // Update agent
  app.put<{ Params: { id: string } }>('/api/agents/:id', async (request, reply) => {
    const result = updateAgentSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid agent data', details: result.error.issues });
    }

    const agent = await agentRepository.update(request.params.id, result.data);
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    await auditRepository.logAction('agent.updated', 'agent', agent.id, {
      details: result.data,
    });

    return reply.send({ agent });
  });

  // Update agent status
  app.patch<{ Params: { id: string } }>('/api/agents/:id/status', async (request, reply) => {
    const statusSchema = z.object({
      status: z.enum(['available', 'busy', 'offline']),
    });

    const result = statusSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid status', details: result.error.issues });
    }

    const agent = await agentRepository.updateStatus(request.params.id, result.data.status);
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    await auditRepository.logAction('agent.status_changed', 'agent', agent.id, {
      agentId: agent.id,
      details: { status: result.data.status },
    });

    return reply.send({ agent });
  });

  // Delete agent
  app.delete<{ Params: { id: string } }>('/api/agents/:id', async (request, reply) => {
    const deleted = await agentRepository.delete(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    await auditRepository.logAction('agent.deleted', 'agent', request.params.id);

    return reply.status(204).send();
  });
}
