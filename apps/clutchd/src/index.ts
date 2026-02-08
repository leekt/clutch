import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket, { type SocketStream } from '@fastify/websocket';
import { config } from './config.js';
import { logger } from './logger.js';
import { correlationMiddleware, correlationStorage } from './middleware/index.js';
import { registerRoutes } from './routes/index.js';
import { agentRegistry, workflowEngine, messageBus, agentExecutor } from './services/index.js';
import { oauthService } from './services/oauth.js';
import { redis, pubsub, CHANNELS, closeQueue } from './queue/index.js';

const app = Fastify({
  logger: false,
  genReqId: () => crypto.randomUUID(),
});

// Register CORS
await app.register(cors, {
  origin: config.corsOrigin,
});

// Register WebSocket
await app.register(websocket);

// Correlation ID middleware
app.addHook('onRequest', correlationMiddleware);

// Wrap request handling in correlation storage context
app.addHook('preHandler', async (request, _reply) => {
  return new Promise((resolve) => {
    correlationStorage.run(request.correlationId, () => {
      resolve();
    });
  });
});

// Request logging
app.addHook('onResponse', async (request, reply) => {
  logger.info({
    correlationId: request.correlationId,
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
    responseTime: reply.elapsedTime,
  }, 'Request completed');
});

// Health check
app.get('/health', async () => {
  const redisStatus = redis.status === 'ready' ? 'ok' : 'degraded';
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      redis: redisStatus,
    },
  };
});

// WebSocket connections for real-time updates
const wsClients = new Set<SocketStream>();

app.get('/ws', { websocket: true }, (socket: SocketStream) => {
  wsClients.add(socket);
  logger.info({ clientCount: wsClients.size }, 'WebSocket client connected');

  socket.on('data', (message: Buffer) => {
    try {
      const data = JSON.parse(message.toString());
      logger.debug({ data }, 'WebSocket message received');

      // Handle client subscriptions or other messages
      if (data.type === 'subscribe') {
        // Could track channel subscriptions per client
      }
    } catch {
      logger.warn('Invalid WebSocket message format');
    }
  });

  socket.on('close', () => {
    wsClients.delete(socket);
    logger.info({ clientCount: wsClients.size }, 'WebSocket client disconnected');
  });

  socket.on('error', (err: Error) => {
    logger.error({ err }, 'WebSocket error');
    wsClients.delete(socket);
  });
});

// Map Redis channel names to WSEvent type fields
const CHANNEL_TO_TYPE: Record<string, string> = {
  [CHANNELS.TASK_UPDATES]: 'task_update',
  [CHANNELS.MESSAGE_UPDATES]: 'message_update',
  [CHANNELS.AGENT_STATUS]: 'agent_status',
};

// Broadcast to all WebSocket clients
function broadcast(data: unknown) {
  const message = JSON.stringify(data);
  for (const client of wsClients) {
    if (!client.destroyed) {
      client.write(message);
    }
  }
}

// Subscribe to Redis pub/sub and forward to WebSocket clients
async function setupPubSubForwarding() {
  const subscriber = pubsub.createSubscriber();

  await subscriber.subscribe(
    CHANNELS.TASK_UPDATES,
    CHANNELS.MESSAGE_UPDATES,
    CHANNELS.AGENT_STATUS
  );

  subscriber.on('message', (channel, message) => {
    try {
      const data = JSON.parse(message);
      const eventType = CHANNEL_TO_TYPE[channel];
      // Merge the event type into the data so the frontend gets { type, ...data }
      broadcast({ type: eventType, ...data });
    } catch (err) {
      logger.error({ err, channel }, 'Failed to parse pub/sub message');
    }
  });

  logger.info('Pub/sub forwarding to WebSocket established');
}

// Register all API routes
await registerRoutes(app);

// Initialize services
async function initializeServices() {
  try {
    // Connect to Redis
    await redis.connect();

    // Load agents into registry
    await agentRegistry.loadAll();

    // Load workflow configuration
    await workflowEngine.loadConfig();

    // Start message bus
    await messageBus.start();

    // Initialize agent executor (creates runtimes for all agents)
    await agentExecutor.initialize();

    logger.info('Services initialized');
  } catch (err) {
    logger.error({ err }, 'Failed to initialize services');
    throw err;
  }
}

// OAuth callback server (tracked for graceful shutdown)
let oauthCallbackServer: ReturnType<typeof Fastify> | undefined;

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down...');

  await messageBus.stop();
  await agentExecutor.shutdown();

  for (const client of wsClients) {
    client.destroy();
  }

  await oauthCallbackServer?.close().catch(() => undefined);
  await closeQueue();
  await app.close();

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
async function start() {
  try {
    await initializeServices();
    await setupPubSubForwarding();
    await app.listen({ port: config.port, host: '0.0.0.0' });
    logger.info(`clutchd running on http://0.0.0.0:${config.port}`);

    await startOAuthCallbackServer();
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

async function startOAuthCallbackServer() {
  const server = Fastify({ logger: false });
  server.get('/auth/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    if (query.state) {
      oauthService.recordCallback(query.state, query.code, query.error);
    }
    return reply
      .type('text/html')
      .send('<html><body><h3>Authentication complete. You can close this window.</h3></body></html>');
  });

  try {
    await server.listen({ port: 1455, host: '127.0.0.1' });
    oauthCallbackServer = server;
    logger.info('Codex OAuth callback server running on http://127.0.0.1:1455/auth/callback');
  } catch (error) {
    logger.warn({ error }, 'Codex OAuth callback server failed to start; continuing without local callback');
  }
}

start();
