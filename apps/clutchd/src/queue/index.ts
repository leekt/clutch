import Redis from 'ioredis';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('error', (err) => {
  logger.error({ err }, 'Redis error');
});

// Queue names
export const QUEUES = {
  TASK_DISPATCH: 'clutch:queue:task-dispatch',
  TASK_RESULTS: 'clutch:queue:task-results',
  AGENT_EVENTS: 'clutch:queue:agent-events',
} as const;

// Channel names for pub/sub
export const CHANNELS = {
  TASK_UPDATES: 'clutch:channel:task-updates',
  MESSAGE_UPDATES: 'clutch:channel:message-updates',
  AGENT_STATUS: 'clutch:channel:agent-status',
} as const;

export interface TaskDispatchPayload {
  taskId: string;
  agentId: string;
  workflowId?: string;
  workflowStepId?: string;
  action?: string;
  expectedOutputType?: string;
  input?: Record<string, unknown>;
  timestamp?: string;
}

export interface TaskResultPayload {
  taskId: string;
  agentId: string;
  success: boolean;
  messageId?: string;
  error?: string;
  cost: number;
  runtime: number;
  tokens: number;
  timestamp: string;
}

export interface AgentEventPayload {
  agentId: string;
  event: 'started' | 'stopped' | 'error' | 'heartbeat';
  details?: Record<string, unknown>;
  timestamp: string;
}

export const taskQueue = {
  async dispatch(payload: TaskDispatchPayload): Promise<void> {
    const fullPayload = {
      ...payload,
      timestamp: payload.timestamp || new Date().toISOString(),
    };
    await redis.lpush(QUEUES.TASK_DISPATCH, JSON.stringify(fullPayload));
    logger.debug({ taskId: payload.taskId }, 'Task dispatched to queue');
  },

  async getNextTask(): Promise<TaskDispatchPayload | null> {
    const result = await redis.brpop(QUEUES.TASK_DISPATCH, 0);
    if (result) {
      return JSON.parse(result[1]) as TaskDispatchPayload;
    }
    return null;
  },

  async submitResult(payload: TaskResultPayload): Promise<void> {
    await redis.lpush(QUEUES.TASK_RESULTS, JSON.stringify(payload));
    await redis.publish(CHANNELS.TASK_UPDATES, JSON.stringify({
      type: 'task_completed',
      ...payload,
    }));
  },

  async getNextResult(): Promise<TaskResultPayload | null> {
    const result = await redis.brpop(QUEUES.TASK_RESULTS, 0);
    if (result) {
      return JSON.parse(result[1]) as TaskResultPayload;
    }
    return null;
  },

  async getPendingCount(): Promise<number> {
    return redis.llen(QUEUES.TASK_DISPATCH);
  },
};

export const pubsub = {
  publisher: redis,

  createSubscriber(): Redis {
    return new Redis(config.redisUrl);
  },

  async publishTaskUpdate(taskId: string, action: string, data?: Record<string, unknown>): Promise<void> {
    await redis.publish(CHANNELS.TASK_UPDATES, JSON.stringify({
      taskId,
      action,
      data,
      timestamp: new Date().toISOString(),
    }));
  },

  async publishMessageUpdate(messageId: string, action: string, data?: Record<string, unknown>): Promise<void> {
    await redis.publish(CHANNELS.MESSAGE_UPDATES, JSON.stringify({
      messageId,
      action,
      data,
      timestamp: new Date().toISOString(),
    }));
  },

  async publishAgentStatus(agentId: string, status: string, details?: Record<string, unknown>): Promise<void> {
    await redis.publish(CHANNELS.AGENT_STATUS, JSON.stringify({
      agentId,
      status,
      details,
      timestamp: new Date().toISOString(),
    }));
  },
};

// Graceful shutdown
export async function closeQueue(): Promise<void> {
  await redis.quit();
  logger.info('Redis connection closed');
}
