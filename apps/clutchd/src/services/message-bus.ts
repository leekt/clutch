import type { AgentRegistry, EventStore, MessageFilter } from '@clutch/core';
import { InMemoryAgentRegistry, MessageRouter } from '@clutch/core';
import type { AgentCard, AgentCardInput, ClutchMessage, ClutchMessageInput } from '@clutch/protocol';
import { createMessage, generateRunId, generateTaskId, generateThreadId, PROTOCOL_VERSION } from '@clutch/protocol';

import { logger } from '../logger.js';
import { pubsub } from '../queue/index.js';
import { agentRepository, taskRepository } from '../repositories/index.js';

import { agentMemoryService } from './agent-memory.js';
import { agentSessionService } from './agent-session.js';
import { PostgresEventStore } from './pg-event-store.js';

// Message types that are allowed without a task_id (system messages only)
const SYSTEM_MESSAGE_TYPES = [
  'agent.register',
  'agent.heartbeat',
  'agent.update',
  'routing.decision',
  'routing.failure',
  'chat.system',
];

/**
 * Message Bus - Central hub for all ClutchMessage handling
 *
 * Responsibilities:
 * - Accept incoming messages (from API, agents, webhooks)
 * - Store messages in EventStore (PostgreSQL-backed)
 * - Route messages to appropriate agents
 * - Emit real-time events via pub/sub
 */
export class MessageBus {
  private eventStore: EventStore;
  private agentRegistry: AgentRegistry;
  private router: MessageRouter;
  private started = false;

  constructor() {
    // Use PostgreSQL-backed event store for persistence
    this.eventStore = new PostgresEventStore();
    // Agent registry is still in-memory (loaded from DB on start)
    this.agentRegistry = new InMemoryAgentRegistry();
    this.router = new MessageRouter(this.eventStore, this.agentRegistry);
  }

  /**
   * Start the message bus
   */
  async start(): Promise<void> {
    if (this.started) return;

    logger.info('Starting message bus...');

    // Load agents from database into registry
    await this.loadAgents();

    this.started = true;
    logger.info('Message bus started');
  }

  /**
   * Stop the message bus
   */
  async stop(): Promise<void> {
    this.started = false;
    logger.info('Message bus stopped');
  }

  /**
   * Convert database agent to AgentCard format (includes AgentSpec fields)
   */
  private toAgentCard(agent: Awaited<ReturnType<typeof agentRepository.findAll>>[0]): AgentCardInput {
    const capabilities = (agent.capabilities as Array<{
      id: string;
      version?: string;
      tags?: string[];
    }>) ?? [];

    return {
      agent_id: agent.agentId,
      display: {
        name: agent.name,
        desc: agent.description ?? undefined,
      },
      endpoints: {},
      capabilities: capabilities.map((cap) => ({
        id: cap.id,
        version: cap.version,
        tags: cap.tags,
      })),
      limits: {
        max_concurrency: agent.maxConcurrency ?? 1,
        max_runtime_sec: agent.budget?.maxRuntime ?? 300,
        max_tokens: agent.budget?.maxTokens,
        max_cost: agent.budget?.maxCost,
      },
      security: {
        sandbox: agent.trustLevel === 'sandbox',
        network: 'egress-restricted',
        secret_scopes: agent.secrets as string[] ?? [],
      },
      // AgentSpec fields (Organization OS)
      personality: agent.personality ?? undefined,
      strengths: agent.strengths ?? undefined,
      operating_rules: agent.operatingRules ?? undefined,
      preferred_collaborators: agent.preferredCollaborators ?? undefined,
      memory: agent.memoryConfig ?? undefined,
    };
  }

  /**
   * Load agents from database into the in-memory registry
   */
  private async loadAgents(): Promise<void> {
    const agents = await agentRepository.findAll();

    for (const agent of agents) {
      const card = this.toAgentCard(agent);
      await this.agentRegistry.register({
        v: PROTOCOL_VERSION,
        ...card,
      } as AgentCard);

      // Register a delivery handler for this agent
      this.router.registerHandler(agent.agentId, async (message: ClutchMessage) => {
        await this.handleAgentDelivery(message, agent.agentId);
      });
    }

    logger.info({ count: agents.length }, 'Loaded agents into registry');
  }

  /**
   * Handle delivery to an agent (Organization OS enhanced)
   *
   * This method:
   * 1. Wakes the agent if asleep
   * 2. Initializes working memory for task.request
   * 3. Creates/updates task record
   * 4. Dispatches to agent container (Phase 3)
   */
  private async handleAgentDelivery(message: ClutchMessage, agentId: string): Promise<void> {
    const log = logger.child({ messageId: message.id, agentId, type: message.type });

    // 1. Wake the agent if needed (Organization OS)
    const isAwake = agentSessionService.isAwake(agentId);
    if (!isAwake) {
      try {
        const wakeReason = message.type === 'task.request' ? 'task_assignment' : 'human_request';
        await agentSessionService.wakeAgent(agentId, wakeReason, {
          taskId: message.task_id,
        });
        log.info('Agent woken for message delivery');
      } catch (error) {
        log.error({ error }, 'Failed to wake agent');
        // Continue anyway - agent might be in a transitional state
      }
    }

    // 2. Handle task.request - create task and initialize memory
    if (message.type === 'task.request') {
      const payload = message.payload as { title?: string; description?: string; context?: string };
      const agent = await agentRepository.findByAgentId(agentId);

      if (agent) {
        // Create task record
        await taskRepository.create({
          taskId: message.task_id,
          runId: message.run_id,
          parentTaskId: message.parent_task_id ?? null,
          title: payload.title ?? 'Untitled Task',
          description: payload.description ?? null,
          state: 'assigned',
          assigneeId: agent.id,
          startedAt: new Date(),
        });

        // Initialize working memory (Organization OS)
        try {
          await agentMemoryService.initializeWorkingMemory(
            agentId,
            message.task_id,
            payload.title ?? 'Untitled Task',
            payload.context ?? payload.description ?? 'No context provided'
          );
          log.info('Working memory initialized');
        } catch (error) {
          log.error({ error }, 'Failed to initialize working memory');
        }
      }
    }

    // 3. Handle task.result - archive memory and potentially sleep agent
    if (message.type === 'task.result') {
      try {
        // Archive working memory
        await agentMemoryService.archiveWorkingMemory(agentId);

        // Add to daily log
        const payload = message.payload as { summary?: string };
        await agentMemoryService.addToDailyLog(agentId, {
          taskId: message.task_id,
          title: payload.summary ?? 'Task completed',
          status: 'completed',
        });

        log.info('Working memory archived');

        // Consider putting agent to sleep (if no other active tasks)
        // This is handled by the caller/worker service
      } catch (error) {
        log.error({ error }, 'Failed to archive working memory');
      }
    }

    // 4. Log delivery (actual container dispatch happens in agent-worker.ts)
    log.info('Message delivered to agent');

    // 5. Emit real-time event
    await pubsub.publishMessageUpdate(message.id, 'delivered', { messageId: message.id, agentId });
  }

  /**
   * Publish a message to the bus
   *
   * Organization OS: Enforces task-centric collaboration
   * - All non-system messages must have a task_id
   * - Messages without task_id will have one auto-generated for new runs
   */
  async publish(input: ClutchMessageInput): Promise<ClutchMessage> {
    // Task-Centric Enforcement (Organization OS)
    // Non-system messages must reference a task
    const isSystemMessage = SYSTEM_MESSAGE_TYPES.includes(input.type);
    if (!isSystemMessage && !input.task_id) {
      // Auto-generate task_id for new task requests
      if (input.type === 'task.request' && !input.run_id) {
        // This is a new run - IDs will be auto-generated
        logger.debug('Auto-generating IDs for new run');
      } else if (!input.run_id) {
        // Non-task-request without run context - reject
        throw new Error('Task-centric violation: non-system messages must have a task_id or be part of a run');
      }
    }

    // Create the message with auto-generated fields
    const message = createMessage(input);

    // Check for duplicates
    if (message.idempotency_key) {
      const isDup = await this.eventStore.isDuplicate(message.run_id, message.id);
      if (isDup) {
        const existing = await this.eventStore.get(message.id);
        if (existing) {
          logger.debug({ messageId: message.id }, 'Duplicate message detected');
          return existing;
        }
      }
    }

    // Store in event store (PostgresEventStore handles database persistence)
    const stored = await this.eventStore.append(message);

    // Route the message (async, don't await)
    this.routeMessage(stored).catch((err) => {
      logger.error({ err, messageId: stored.id }, 'Failed to route message');
    });

    // Emit real-time event
    await pubsub.publishMessageUpdate(stored.id, 'created', stored);

    logger.debug({ messageId: stored.id, type: stored.type, taskId: stored.task_id }, 'Message published');

    return stored;
  }

  /**
   * Route message to appropriate agents (Organization OS enhanced)
   *
   * Routing considers:
   * 1. Required capabilities (hard filter)
   * 2. Agent strengths (soft preference)
   * 3. Agent availability (awake/asleep status)
   * 4. Preferred collaborators (if from another agent)
   */
  private async routeMessage(message: ClutchMessage): Promise<void> {
    // Only route task.request messages
    if (message.type !== 'task.request') {
      return;
    }

    const log = logger.child({ messageId: message.id, taskId: message.task_id });

    // Check for strength-based routing hints in payload
    const payload = message.payload as {
      preferred_strengths?: string[];
      require_awake?: boolean;
    };

    // Get agents that match capabilities
    const result = await this.router.route(message);

    if (!result.success) {
      log.warn({ reason: result.reason }, 'Capability-based routing failed');

      // Try strength-based fallback
      if (payload.preferred_strengths?.length) {
        const strengthMatch = await this.findAgentByStrengths(
          payload.preferred_strengths,
          payload.require_awake
        );

        if (strengthMatch) {
          log.info({ agentId: strengthMatch }, 'Found agent via strength matching');
          // Deliver directly via handler
          const handler = this.router.getHandler(strengthMatch);
          if (handler) {
            await handler(message);
            return;
          }
        }
      }

      // Emit routing.failure event
      await this.publish({
        thread_id: message.thread_id,
        run_id: message.run_id,
        task_id: message.task_id,
        parent_task_id: message.parent_task_id,
        from: { agent_id: 'agent:router' },
        to: [message.from],
        type: 'routing.failure',
        payload: {
          original_message_id: message.id,
          reason: result.reason,
        },
      });
    }
  }

  /**
   * Find an agent by strengths (Organization OS)
   */
  private async findAgentByStrengths(
    strengths: string[],
    requireAwake = false
  ): Promise<string | null> {
    // Query agents with any of the specified strengths
    const candidates = await agentRepository.findByAnyStrength(strengths);

    if (candidates.length === 0) {
      return null;
    }

    // Filter by awake status if required
    let filtered = candidates;
    if (requireAwake) {
      filtered = candidates.filter(a =>
        agentSessionService.isAwake(a.agentId)
      );
    }

    if (filtered.length === 0) {
      // No awake agents, pick any matching agent (will be woken)
      filtered = candidates;
    }

    // Score by number of matching strengths
    const scored = filtered.map(agent => {
      const matchCount = strengths.filter(s =>
        agent.strengths?.includes(s)
      ).length;
      return { agent, score: matchCount };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored[0]?.agent.agentId ?? null;
  }

  /**
   * Get messages by run ID
   */
  async getByRunId(runId: string): Promise<ClutchMessage[]> {
    return this.eventStore.getByRunId(runId);
  }

  /**
   * Get messages by task ID
   */
  async getByTaskId(taskId: string): Promise<ClutchMessage[]> {
    return this.eventStore.getByTaskId(taskId);
  }

  /**
   * Get messages by thread ID
   */
  async getByThreadId(threadId: string): Promise<ClutchMessage[]> {
    return this.eventStore.getByThreadId(threadId);
  }

  /**
   * Subscribe to messages
   */
  subscribe(filter: MessageFilter): AsyncIterable<ClutchMessage> {
    return this.eventStore.subscribe(filter);
  }

  /**
   * Replay all messages for a run
   */
  replayRun(runId: string): AsyncIterable<ClutchMessage> {
    return this.eventStore.replayRun(runId);
  }

  /**
   * Get agent registry (for capability matching)
   */
  getAgentRegistry(): AgentRegistry {
    return this.agentRegistry;
  }

  /**
   * Refresh agent registry from database
   */
  async refreshAgents(): Promise<void> {
    await this.loadAgents();
  }

  /**
   * Create a new run with a task request
   */
  async createRun(input: {
    title: string;
    description?: string;
    requires?: string[];
    prefers?: string[];
    fromAgent?: string;
  }): Promise<{ runId: string; taskId: string; threadId: string; message: ClutchMessage }> {
    const runId = generateRunId();
    const taskId = generateTaskId();
    const threadId = generateThreadId();

    const message = await this.publish({
      thread_id: threadId,
      run_id: runId,
      task_id: taskId,
      parent_task_id: null,
      from: { agent_id: input.fromAgent ?? 'agent:user' },
      to: [{ agent_id: 'agent:router' }],
      type: 'task.request',
      domain: 'planning',
      payload: {
        title: input.title,
        description: input.description,
      },
      requires: input.requires,
      prefers: input.prefers,
    });

    return { runId, taskId, threadId, message };
  }
}

// Singleton instance
export const messageBus = new MessageBus();
