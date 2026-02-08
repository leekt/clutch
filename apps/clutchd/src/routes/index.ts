import { FastifyInstance } from 'fastify';
import { agentRoutes } from './agents.js';
import { taskRoutes } from './tasks.js';
import { channelRoutes } from './channels.js';
import { messageRoutes } from './messages.js';
import { reviewRoutes } from './reviews.js';
import { runRoutes } from './runs.js';
import { artifactRoutes } from './artifacts.js';
import { agentCallbackRoutes } from './agent-callbacks.js';
import { secretRoutes } from './secrets.js';
import { oauthRoutes } from './oauth.js';
import { settingsRoutes } from './settings.js';

export async function registerRoutes(app: FastifyInstance) {
  await agentRoutes(app);
  await taskRoutes(app);
  await channelRoutes(app);
  await messageRoutes(app);
  await reviewRoutes(app);
  await runRoutes(app);
  await artifactRoutes(app);
  await agentCallbackRoutes(app);
  await secretRoutes(app);
  await oauthRoutes(app);
  await settingsRoutes(app);
}
