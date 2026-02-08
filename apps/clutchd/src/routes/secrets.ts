import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { secretStore } from '../services/secret-store.js';

const createSecretSchema = z.object({
  name: z.string().optional(),
  value: z.string().min(1),
});

export async function secretRoutes(app: FastifyInstance) {
  app.post('/api/secrets', async (request, reply) => {
    const result = createSecretSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid secret payload', details: result.error.issues });
    }

    try {
      const secretId = await secretStore.createSecret(result.data.value, result.data.name);
      return reply.status(201).send({ secretId });
    } catch (error) {
      return reply.status(500).send({ error: (error as Error).message });
    }
  });
}
