import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { reviewRepository, taskRepository, auditRepository } from '../repositories/index.js';
import { pubsub } from '../queue/index.js';

const reviewSchema = z.object({
  messageId: z.string(),
  reviewerId: z.string(),
  comments: z.string().optional(),
});

export async function reviewRoutes(app: FastifyInstance) {
  // List all reviews (with optional status filter)
  app.get('/api/reviews', async (request, reply) => {
    const query = request.query as { status?: string };

    let reviews;
    if (query.status === 'pending' || query.status === 'approved' || query.status === 'rejected') {
      reviews = await reviewRepository.findByStatus(query.status);
    } else {
      reviews = await reviewRepository.findAll();
    }

    return reply.send({ reviews });
  });

  // List reviews for a task
  app.get<{ Params: { taskId: string } }>('/api/tasks/:taskId/reviews', async (request, reply) => {
    const query = request.query as { status?: string };

    let reviews;
    if (query.status === 'pending') {
      reviews = await reviewRepository.findPendingForTask(request.params.taskId);
    } else {
      reviews = await reviewRepository.findByTaskId(request.params.taskId);
    }

    return reply.send({ reviews });
  });

  // Get review by ID
  app.get<{ Params: { id: string } }>('/api/reviews/:id', async (request, reply) => {
    const review = await reviewRepository.findById(request.params.id);
    if (!review) {
      return reply.status(404).send({ error: 'Review not found' });
    }
    return reply.send({ review });
  });

  // Create review for a task
  app.post<{ Params: { taskId: string } }>('/api/tasks/:taskId/reviews', async (request, reply) => {
    // Validate task exists (by taskId string)
    const task = await taskRepository.findByTaskId(request.params.taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    const result = reviewSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid review data', details: result.error.issues });
    }

    const review = await reviewRepository.create({
      ...result.data,
      taskId: request.params.taskId,
    });

    await auditRepository.logAction('review.created', 'review', review.id, {
      agentId: result.data.reviewerId,
      taskId: request.params.taskId,
      details: { taskId: request.params.taskId },
    });

    return reply.status(201).send({ review });
  });

  // Approve review
  app.post<{ Params: { taskId: string; reviewId: string } }>(
    '/api/tasks/:taskId/reviews/:reviewId/approve',
    async (request, reply) => {
      const body = request.body as { comments?: string; score?: number; suggestions?: string[] };

      const review = await reviewRepository.approve(
        request.params.reviewId,
        { score: body.score, suggestions: body.suggestions },
        body.comments
      );
      if (!review) {
        return reply.status(404).send({ error: 'Review not found' });
      }

      // Update task state to done if all reviews approved
      const pendingReviews = await reviewRepository.findPendingForTask(request.params.taskId);
      if (pendingReviews.length === 0) {
        const task = await taskRepository.updateState(request.params.taskId, 'done');
        if (task) {
          await pubsub.publishTaskUpdate(task.taskId, 'state_changed', task);
        }
      }

      await auditRepository.logAction('review.approved', 'review', review.id, {
        agentId: review.reviewerId,
        taskId: request.params.taskId,
        details: { taskId: request.params.taskId, comments: body.comments },
      });

      return reply.send({ review });
    }
  );

  // Reject review
  app.post<{ Params: { taskId: string; reviewId: string } }>(
    '/api/tasks/:taskId/reviews/:reviewId/reject',
    async (request, reply) => {
      const rejectSchema = z.object({
        comments: z.string().min(1, 'Rejection requires comments'),
        issues: z.array(z.object({
          type: z.string(),
          message: z.string(),
          severity: z.string(),
        })).optional(),
      });

      const result = rejectSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid rejection', details: result.error.issues });
      }

      const review = await reviewRepository.reject(
        request.params.reviewId,
        result.data.comments,
        result.data.issues
      );
      if (!review) {
        return reply.status(404).send({ error: 'Review not found' });
      }

      // Update task state to rework
      const task = await taskRepository.updateState(request.params.taskId, 'rework');
      if (task) {
        await pubsub.publishTaskUpdate(task.taskId, 'state_changed', task);
      }

      await auditRepository.logAction('review.rejected', 'review', review.id, {
        agentId: review.reviewerId,
        taskId: request.params.taskId,
        details: { taskId: request.params.taskId, comments: result.data.comments },
      });

      return reply.send({ review });
    }
  );

  // Delete review
  app.delete<{ Params: { id: string } }>('/api/reviews/:id', async (request, reply) => {
    const deleted = await reviewRepository.delete(request.params.id);
    if (!deleted) {
      return reply.status(404).send({ error: 'Review not found' });
    }

    await auditRepository.logAction('review.deleted', 'review', request.params.id);

    return reply.status(204).send();
  });
}
