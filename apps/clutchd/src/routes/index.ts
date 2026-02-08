import { FastifyInstance } from 'fastify';
import { agentRoutes } from './agents.js';
import { taskRoutes } from './tasks.js';
import { channelRoutes } from './channels.js';
import { messageRoutes } from './messages.js';
import { reviewRoutes } from './reviews.js';
import { runRoutes } from './runs.js';
import { artifactRoutes } from './artifacts.js';
import { agentCallbackRoutes } from './agent-callbacks.js';

export async function registerRoutes(app: FastifyInstance) {
  await agentRoutes(app);
  await taskRoutes(app);
  await channelRoutes(app);
  await messageRoutes(app);
  await reviewRoutes(app);
  await runRoutes(app);
  await artifactRoutes(app);
  await agentCallbackRoutes(app);
}
