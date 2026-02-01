import { FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

export const correlationStorage = new AsyncLocalStorage<string>();

export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore();
}

export async function correlationMiddleware(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const correlationId =
    (request.headers['x-correlation-id'] as string) || randomUUID();
  request.correlationId = correlationId;
}

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}
