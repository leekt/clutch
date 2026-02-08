import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { artifactStore } from '../services/index.js';
import { auditRepository } from '../repositories/index.js';

const storeArtifactSchema = z.object({
  content: z.string(), // Base64 encoded content
  path: z.string(),
  mimeType: z.string().optional(),
  messageId: z.string().optional(),
  taskId: z.string().optional(),
  agentId: z.string().optional(),
});

export async function artifactRoutes(app: FastifyInstance) {
  // Store a new artifact
  app.post('/api/artifacts', async (request, reply) => {
    const result = storeArtifactSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid artifact data', details: result.error.issues });
    }

    const { content, path, mimeType, messageId, taskId, agentId } = result.data;

    // Decode base64 content
    const buffer = Buffer.from(content, 'base64');

    const artifact = await artifactStore.store(buffer, {
      path,
      mimeType,
      messageId,
      taskId,
      agentId,
    });

    await auditRepository.logAction('artifact.stored', 'artifact', artifact.artifactId, {
      taskId: taskId,
      details: { artifactId: artifact.artifactId, path, size: artifact.size, hash: artifact.hash },
    });

    return reply.status(201).send({
      artifactId: artifact.artifactId,
      hash: artifact.hash,
      size: artifact.size,
      path: artifact.path,
      mimeType: artifact.mimeType,
    });
  });

  // Get artifact content by ID
  app.get<{ Params: { artifactId: string } }>('/api/artifacts/:artifactId', async (request, reply) => {
    const content = await artifactStore.get(request.params.artifactId);
    if (!content) {
      return reply.status(404).send({ error: 'Artifact not found' });
    }

    const metadata = await artifactStore.getMetadata(request.params.artifactId);
    if (!metadata) {
      return reply.status(404).send({ error: 'Artifact metadata not found' });
    }

    reply.header('Content-Type', metadata.mimeType);
    reply.header('Content-Disposition', `attachment; filename="${metadata.path.split('/').pop()}"`);
    reply.header('X-Artifact-Hash', metadata.hash);

    return reply.send(content);
  });

  // Get artifact metadata
  app.get<{ Params: { artifactId: string } }>('/api/artifacts/:artifactId/metadata', async (request, reply) => {
    const metadata = await artifactStore.getMetadata(request.params.artifactId);
    if (!metadata) {
      return reply.status(404).send({ error: 'Artifact not found' });
    }

    return reply.send({
      artifactId: metadata.artifactId,
      hash: metadata.hash,
      size: metadata.size,
      path: metadata.path,
      mimeType: metadata.mimeType,
      createdAt: metadata.createdAt,
      messageId: metadata.messageId,
      taskId: metadata.taskId,
      agentId: metadata.agentId,
    });
  });

  // Verify artifact integrity
  app.get<{ Params: { artifactId: string } }>('/api/artifacts/:artifactId/verify', async (request, reply) => {
    const isValid = await artifactStore.verify(request.params.artifactId);

    return reply.send({
      artifactId: request.params.artifactId,
      valid: isValid,
    });
  });

  // Get artifact by hash
  app.get<{ Params: { hash: string } }>('/api/artifacts/hash/:hash', async (request, reply) => {
    const content = await artifactStore.getByHash(request.params.hash);
    if (!content) {
      return reply.status(404).send({ error: 'Artifact not found' });
    }

    reply.header('Content-Type', 'application/octet-stream');
    reply.header('X-Artifact-Hash', request.params.hash);

    return reply.send(content);
  });

  // Check if artifact exists by hash
  app.head<{ Params: { hash: string } }>('/api/artifacts/hash/:hash', async (request, reply) => {
    const exists = await artifactStore.exists(request.params.hash);
    if (!exists) {
      return reply.status(404).send();
    }

    return reply.status(200).send();
  });

  // List artifacts by task
  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId/artifacts', async (request, reply) => {
    const artifacts = await artifactStore.listByTask(request.params.taskId);

    return reply.send({
      taskId: request.params.taskId,
      count: artifacts.length,
      artifacts: artifacts.map((a) => ({
        artifactId: a.artifactId,
        hash: a.hash,
        size: a.size,
        path: a.path,
        mimeType: a.mimeType,
        createdAt: a.createdAt,
      })),
    });
  });

  // List artifacts by message
  app.get<{ Params: { messageId: string } }>('/api/messages/:messageId/artifacts', async (request, reply) => {
    const artifacts = await artifactStore.listByMessage(request.params.messageId);

    return reply.send({
      messageId: request.params.messageId,
      count: artifacts.length,
      artifacts: artifacts.map((a) => ({
        artifactId: a.artifactId,
        hash: a.hash,
        size: a.size,
        path: a.path,
        mimeType: a.mimeType,
        createdAt: a.createdAt,
      })),
    });
  });

  // Delete artifact
  app.delete<{ Params: { artifactId: string } }>('/api/artifacts/:artifactId', async (request, reply) => {
    const deleted = await artifactStore.delete(request.params.artifactId);
    if (!deleted) {
      return reply.status(404).send({ error: 'Artifact not found' });
    }

    await auditRepository.logAction('artifact.deleted', 'artifact', request.params.artifactId, {
      details: { artifactId: request.params.artifactId },
    });

    return reply.status(204).send();
  });
}
