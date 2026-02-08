import type {
  ClutchMessage,
  AgentCard,
} from '@clutch/protocol';
import {
  createMessage,
  generateMessageId,
  RoutingDecisionPayload,
} from '@clutch/protocol';
import type { EventStore } from './store.js';
import type { AgentRegistry, AgentMatch } from './registry.js';

/**
 * Router - Message routing with capability matching
 *
 * Routes messages to appropriate agents based on capability requirements.
 */
export interface Router {
  /**
   * Route a message to an appropriate agent
   * Returns the selected agent and emits a routing.decision event
   */
  route(message: ClutchMessage): Promise<RoutingResult>;

  /**
   * Deliver a message to a specific agent
   */
  deliver(message: ClutchMessage, agentId: string): Promise<DeliveryResult>;

  /**
   * Broadcast a message to multiple agents
   */
  broadcast(message: ClutchMessage, agentIds: string[]): Promise<DeliveryResult[]>;
}

/**
 * Routing result
 */
export interface RoutingResult {
  success: boolean;
  selectedAgent?: AgentCard;
  candidates: AgentMatch[];
  reason: string;
  decisionMessage?: ClutchMessage;
}

/**
 * Delivery result
 */
export interface DeliveryResult {
  success: boolean;
  messageId: string;
  agentId: string;
  error?: string;
  retryable?: boolean;
}

/**
 * Router configuration
 */
export interface RouterConfig {
  /**
   * Maximum retry attempts
   */
  maxRetries: number;

  /**
   * Retry delay in ms
   */
  retryDelay: number;

  /**
   * Deduplication window in ms
   */
  dedupeWindow: number;
}

const DEFAULT_CONFIG: RouterConfig = {
  maxRetries: 3,
  retryDelay: 1000,
  dedupeWindow: 60000,
};

/**
 * Message router implementation
 */
export class MessageRouter implements Router {
  private config: RouterConfig;
  private deliveryHandlers: Map<string, DeliveryHandler> = new Map();
  private recentDeliveries: Map<string, number> = new Map();

  constructor(
    private eventStore: EventStore,
    private registry: AgentRegistry,
    config: Partial<RouterConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Cleanup old dedup entries periodically
    setInterval(() => this.cleanupDedup(), this.config.dedupeWindow);
  }

  /**
   * Register a delivery handler for an agent
   */
  registerHandler(agentId: string, handler: DeliveryHandler): void {
    this.deliveryHandlers.set(agentId, handler);
  }

  /**
   * Unregister a delivery handler
   */
  unregisterHandler(agentId: string): void {
    this.deliveryHandlers.delete(agentId);
  }

  /**
   * Get a delivery handler for an agent
   */
  getHandler(agentId: string): DeliveryHandler | undefined {
    return this.deliveryHandlers.get(agentId);
  }

  async route(message: ClutchMessage): Promise<RoutingResult> {
    // Extract routing requirements
    const requires = message.requires ?? [];
    const prefers = message.prefers ?? [];

    // Find matching agents
    const candidates = await this.registry.findByCapabilities(requires, prefers);

    // Apply hard filters
    const eligibleCandidates = await this.applyHardFilters(candidates, message);

    if (eligibleCandidates.length === 0) {
      // No agents available - emit failure event
      const failureMessage = createMessage({
        thread_id: message.thread_id,
        run_id: message.run_id,
        task_id: message.task_id,
        parent_task_id: message.parent_task_id,
        from: { agent_id: 'agent:router' },
        to: [message.from],
        type: 'routing.failure',
        payload: {
          original_message_id: message.id,
          requires,
          prefers,
          reason: 'No eligible agents found',
        },
      });
      await this.eventStore.append(failureMessage);

      return {
        success: false,
        candidates: [],
        reason: 'No eligible agents found',
        decisionMessage: failureMessage,
      };
    }

    // Select best agent
    const selected = eligibleCandidates[0]!;

    // Build decision payload
    const decisionPayload: RoutingDecisionPayload = {
      selected: selected.agent.agent_id,
      candidates: eligibleCandidates.map(c => c.agent.agent_id),
      reason: this.buildReason(selected, requires, prefers),
      scores: Object.fromEntries(
        eligibleCandidates.map(c => [c.agent.agent_id, c.score])
      ),
    };

    // Emit routing decision event
    const decisionMessage = createMessage({
      thread_id: message.thread_id,
      run_id: message.run_id,
      task_id: message.task_id,
      parent_task_id: message.parent_task_id,
      from: { agent_id: 'agent:router' },
      to: [{ agent_id: selected.agent.agent_id }],
      type: 'routing.decision',
      payload: decisionPayload,
    });
    await this.eventStore.append(decisionMessage);

    return {
      success: true,
      selectedAgent: selected.agent,
      candidates: eligibleCandidates,
      reason: decisionPayload.reason,
      decisionMessage,
    };
  }

  async deliver(message: ClutchMessage, agentId: string): Promise<DeliveryResult> {
    // Check for duplicate (idempotency)
    const dedupeKey = message.idempotency_key ?? message.id;
    const dedupeLookup = `${message.run_id}:${dedupeKey}`;

    if (this.recentDeliveries.has(dedupeLookup)) {
      return {
        success: true,
        messageId: message.id,
        agentId,
        error: 'Duplicate delivery (idempotent)',
      };
    }

    // Check if agent exists
    const agent = await this.registry.get(agentId);
    if (!agent) {
      return {
        success: false,
        messageId: message.id,
        agentId,
        error: `Agent not found: ${agentId}`,
        retryable: false,
      };
    }

    // Check if agent is available
    const available = await this.registry.isAvailable(agentId);
    if (!available) {
      return {
        success: false,
        messageId: message.id,
        agentId,
        error: 'Agent not available',
        retryable: true,
      };
    }

    // Store message in event store
    await this.eventStore.append(message);

    // Mark as delivered for dedup
    this.recentDeliveries.set(dedupeLookup, Date.now());

    // Increment agent task count
    await this.registry.incrementTasks(agentId);

    // Deliver via handler if registered
    const handler = this.deliveryHandlers.get(agentId);
    if (handler) {
      try {
        await handler(message);
      } catch (error) {
        // Decrement on failure
        await this.registry.decrementTasks(agentId);

        return {
          success: false,
          messageId: message.id,
          agentId,
          error: error instanceof Error ? error.message : 'Delivery failed',
          retryable: true,
        };
      }
    }

    return {
      success: true,
      messageId: message.id,
      agentId,
    };
  }

  async broadcast(message: ClutchMessage, agentIds: string[]): Promise<DeliveryResult[]> {
    const results = await Promise.all(
      agentIds.map(agentId =>
        this.deliver(
          { ...message, id: generateMessageId() },
          agentId
        )
      )
    );
    return results;
  }

  private async applyHardFilters(
    candidates: AgentMatch[],
    message: ClutchMessage
  ): Promise<AgentMatch[]> {
    const eligible: AgentMatch[] = [];

    for (const candidate of candidates) {
      const agent = candidate.agent;
      const available = await this.registry.isAvailable(agent.agent_id);

      if (!available) continue;

      // Check security policy
      if (message.security?.policy) {
        // Check sandbox requirement
        if (message.security.policy.sandbox && !agent.security.sandbox) {
          continue;
        }

        // Check tool allowlist
        if (message.security.policy.tool_allowlist) {
          const agentTools = this.getAgentTools(agent);
          const hasAllTools = message.security.policy.tool_allowlist.every(
            tool => agentTools.includes(tool)
          );
          if (!hasAllTools) continue;
        }
      }

      eligible.push(candidate);
    }

    return eligible;
  }

  private getAgentTools(agent: AgentCard): string[] {
    const tools: string[] = [];
    for (const cap of agent.capabilities) {
      if (cap.tools) tools.push(...cap.tools);
      if (cap.servers) tools.push(...cap.servers);
    }
    return tools;
  }

  private buildReason(match: AgentMatch, requires: string[], prefers: string[]): string {
    const parts: string[] = [];

    if (requires.length > 0) {
      parts.push(`matched requires[${requires.join(', ')}]`);
    }

    const matchedPrefs = match.matchedCapabilities.filter(c => prefers.includes(c));
    if (matchedPrefs.length > 0) {
      parts.push(`matched prefers[${matchedPrefs.join(', ')}]`);
    }

    if (match.load < 0.5) {
      parts.push('lowest load');
    } else if (match.load < 0.8) {
      parts.push('moderate load');
    }

    return parts.join(', ') || 'best available';
  }

  private cleanupDedup(): void {
    const cutoff = Date.now() - this.config.dedupeWindow;
    for (const [key, timestamp] of this.recentDeliveries) {
      if (timestamp < cutoff) {
        this.recentDeliveries.delete(key);
      }
    }
  }
}

/**
 * Delivery handler function type
 */
export type DeliveryHandler = (message: ClutchMessage) => Promise<void>;

/**
 * Create a router instance
 */
export function createRouter(
  eventStore: EventStore,
  registry: AgentRegistry,
  config?: Partial<RouterConfig>
): MessageRouter {
  return new MessageRouter(eventStore, registry, config);
}
