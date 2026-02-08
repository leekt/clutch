import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { settingsStore } from '../services/settings-store.js';

const settingsSchema = z.object({
  workerRootDir: z.string().optional(),
  claudeWorkerPath: z.string().optional(),
  codexWorkerPath: z.string().optional(),
});

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async (_request, reply) => {
    const settings = await settingsStore.read();
    return reply.send({ settings });
  });

  app.put('/api/settings', async (request, reply) => {
    const result = settingsSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid settings', details: result.error.issues });
    }

    const settings = await settingsStore.write(result.data);
    return reply.send({ settings });
  });
}
