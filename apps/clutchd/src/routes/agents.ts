import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { agentRepository, auditRepository } from '../repositories/index.js';
import { secretStore } from '../services/secret-store.js';

/**
 * Helper to find an agent by UUID or agentId
 */
async function findAgent(id: string) {
  const agent = await agentRepository.findById(id);
  if (agent) return agent;

  const agentId = id.startsWith('agent:') ? id : `agent:${id}`;
  return await agentRepository.findByAgentId(agentId);
}

const createAgentSchema = z.object({
  // Identity
  name: z.string().min(1),
  role: z.enum(['pm', 'research', 'marketing', 'developer', 'qa']),
  description: z.string().optional(),
  version: z.string().optional(),

  // Runtime
  image: z.string().optional(),
  endpoints: z.object({
    a2a: z.string().optional(),
    clutch: z.string().optional(),
  }).optional(),

  // Capabilities
  capabilities: z.array(z.object({
    id: z.string(),
    version: z.string(),
    tags: z.array(z.string()).optional(),
  })).optional(),
  tools: z.array(z.string()).optional(),

  // Permissions
  permissions: z.object({
    file: z.boolean(),
    shell: z.boolean(),
    git: z.boolean(),
    browser: z.boolean(),
  }),

  // Budget
  budget: z.object({
    maxTokens: z.number().optional(),
    maxCost: z.number().optional(),
    maxRuntime: z.number().optional(),
  }),

  // Security
  trustLevel: z.enum(['sandbox', 'prod']).optional(),
  secrets: z.array(z.string()).optional(),

  // Limits
  maxConcurrency: z.number().optional(),

  // Organization OS: Personality
  personality: z.object({
    style: z.enum(['analytical', 'creative', 'systematic', 'pragmatic']).optional(),
    communication: z.enum(['concise', 'verbose', 'formal', 'casual']).optional(),
    decision_making: z.enum(['data-driven', 'intuitive', 'consensus-seeking', 'decisive']).optional(),
  }).optional(),

  // Organization OS: Strengths and rules
  strengths: z.array(z.string()).optional(),
  operatingRules: z.array(z.string()).optional(),
  preferredCollaborators: z.array(z.string()).optional(),

  // Runtime config
  runtime: z.object({
    type: z.enum(['in-process', 'http', 'subprocess']),
    url: z.string().optional(),
    authToken: z.string().optional(),
    authTokenSecret: z.string().optional(),
    timeoutMs: z.number().optional(),
    healthPath: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
    envSecrets: z.record(z.string()).optional(),
    protocol: z.enum(['stdio', 'http']).optional(),
  }).optional(),
});

const updateAgentSchema = createAgentSchema.partial();

export async function agentRoutes(app: FastifyInstance) {
  // List all agents
  app.get('/api/agents', async (request, reply) => {
    const query = request.query as { role?: string; status?: string };

    let agents;
    if (query.role) {
      const role = query.role as 'pm' | 'research' | 'marketing' | 'developer' | 'qa';
      agents = await agentRepository.findByRole(role);
    } else if (query.status) {
      const status = query.status as 'available' | 'busy' | 'offline';
      agents = await agentRepository.findByStatus(status);
    } else {
      agents = await agentRepository.findAll();
    }

    return reply.send({ agents });
  });

  // Get available agents
  app.get('/api/agents/available', async (_request, reply) => {
    const agents = await agentRepository.findAvailable();
    return reply.send({ agents });
  });

  // Get agent by ID or agentId
  app.get<{ Params: { id: string } }>('/api/agents/:id', async (request, reply) => {
    const agent = await findAgent(request.params.id);
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }
    return reply.send({ agent });
  });

  // Create agent
  app.post('/api/agents', async (request, reply) => {
    const result = createAgentSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid agent data', details: result.error.issues });
    }

    const data = result.data;
    let runtime = data.runtime;

    if (runtime?.authToken) {
      const secretId = await secretStore.createSecret(runtime.authToken, `${data.name}-runtime-token`);
      runtime = { ...runtime, authToken: undefined, authTokenSecret: secretId };
    }

    if (runtime?.env) {
      const envSecrets: Record<string, string> = runtime.envSecrets ?? {};
      const env: Record<string, string> = { ...runtime.env };
      for (const [key, value] of Object.entries(runtime.env)) {
        if (key.endsWith('_API_KEY') || key.endsWith('_TOKEN')) {
          const secretId = await secretStore.createSecret(value, `${data.name}-${key}`);
          envSecrets[key] = secretId;
          delete env[key];
        }
      }
      runtime = { ...runtime, env, envSecrets };
    }
    const agentId = `agent:${data.name}`;

    // Check if agent already exists
    const existing = await agentRepository.findByAgentId(agentId);
    if (existing) {
      return reply.status(409).send({ error: 'Agent already exists', agentId });
    }

    const agent = await agentRepository.create({
      agentId,
      name: data.name,
      role: data.role,
      description: data.description ?? null,
      version: data.version ?? '1.0.0',
      image: data.image ?? null,
      endpoints: data.endpoints ?? {},
      capabilities: data.capabilities ?? [],
      tools: data.tools ?? [],
      permissions: data.permissions,
      budget: data.budget,
      trustLevel: data.trustLevel ?? 'sandbox',
      secrets: data.secrets ?? [],
      maxConcurrency: data.maxConcurrency ?? 1,
      personality: data.personality ?? null,
      strengths: data.strengths ?? [],
      operatingRules: data.operatingRules ?? [],
      preferredCollaborators: data.preferredCollaborators ?? [],
      runtime: runtime ?? { type: 'in-process' },
    });

    await auditRepository.logAction('agent.created', 'agent', agentId, {
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

    const agent = await findAgent(request.params.id);
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    const updated = await agentRepository.update(agent.id, result.data);

    await auditRepository.logAction('agent.updated', 'agent', agent.agentId, {
      agentId: agent.agentId,
      details: result.data,
    });

    return reply.send({ agent: updated });
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

    const agent = await findAgent(request.params.id);
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    const updated = await agentRepository.updateStatus(agent.agentId, result.data.status);

    await auditRepository.logAction('agent.status_changed', 'agent', agent.agentId, {
      agentId: agent.agentId,
      details: { status: result.data.status },
    });

    return reply.send({ agent: updated });
  });

  // Agent heartbeat
  app.post<{ Params: { id: string } }>('/api/agents/:id/heartbeat', async (request, reply) => {
    const agent = await findAgent(request.params.id);
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    const updated = await agentRepository.heartbeat(agent.agentId);
    return reply.send({ agent: updated });
  });

  // Delete agent
  app.delete<{ Params: { id: string } }>('/api/agents/:id', async (request, reply) => {
    const agent = await findAgent(request.params.id);
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' });
    }

    await agentRepository.delete(agent.id);
    await auditRepository.logAction('agent.deleted', 'agent', agent.agentId);

    return reply.status(204).send();
  });
}
