import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { oauthService } from '../services/oauth.js';

const startSchema = z.object({
  authUrl: z.string().optional(),
  tokenUrl: z.string().optional(),
  scope: z.string().optional(),
  redirectUrl: z.string().optional(),
});

const finishSchema = z.object({
  state: z.string(),
  code: z.string().optional(),
  redirectUrl: z.string().optional(),
});

export async function oauthRoutes(app: FastifyInstance) {
  app.post('/api/oauth/codex/start', async (request, reply) => {
    const result = startSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid OAuth request', details: result.error.issues });
    }

    try {
      const { state, authUrl, redirectUrl } = oauthService.startCodexOAuth(result.data);
      return reply.send({ state, authUrl, redirectUrl });
    } catch (error) {
      return reply.status(500).send({ error: (error as Error).message });
    }
  });

  app.get('/api/oauth/codex/status', async (request, reply) => {
    const state = (request.query as { state?: string }).state;
    if (!state) {
      return reply.status(400).send({ error: 'state is required' });
    }
    return reply.send({ status: oauthService.getStatus(state) });
  });

  app.post('/api/oauth/codex/finish', async (request, reply) => {
    const result = finishSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid OAuth finish', details: result.error.issues });
    }

    let code = result.data.code;
    if (!code && result.data.redirectUrl) {
      try {
        const parsed = new URL(result.data.redirectUrl);
        code = parsed.searchParams.get('code') ?? undefined;
      } catch {
        return reply.status(400).send({ error: 'Invalid redirect URL' });
      }
    }

    try {
      const { secretId } = await oauthService.exchangeCodex(
        result.data.state,
        code,
        result.data.redirectUrl
      );
      return reply.send({ secretId });
    } catch (error) {
      return reply.status(500).send({ error: (error as Error).message });
    }
  });
}
