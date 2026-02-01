import type {
  AgentCard,
  AgentStatus,
} from '@clutch/protocol';
import {
  createMessage,
  generateTaskId,
  generateRunId,
  generateThreadId,
  hasAllCapabilities,
} from '@clutch/protocol';
import type { EventStore } from './store.js';

/**
 * Agent Registry
 *
 * Manages agent registration, status tracking, and capability discovery.
 */
export interface AgentRegistry {
  /**
   * Register an agent
   */
  register(card: AgentCard): Promise<void>;

  /**
   * Update an agent's card
   */
  update(agentId: string, updates: Partial<AgentCard>): Promise<void>;

  /**
   * Remove an agent
   */
  unregister(agentId: string): Promise<void>;

  /**
   * Get an agent by ID
   */
  get(agentId: string): Promise<AgentCard | null>;

  /**
   * List all agents
   */
  list(): Promise<AgentCard[]>;

  /**
   * Update agent status
   */
  setStatus(agentId: string, status: AgentStatus): Promise<void>;

  /**
   * Get agent status
   */
  getStatus(agentId: string): Promise<AgentStatus | null>;

  /**
   * Record heartbeat
   */
  heartbeat(agentId: string, metrics?: AgentMetrics): Promise<void>;

  /**
   * Find agents with specific capabilities
   */
  findByCapabilities(requires: string[], prefers?: string[]): Promise<AgentMatch[]>;

  /**
   * Find agents by capability ID
   */
  findByCapabilityId(capabilityId: string): Promise<AgentCard[]>;

  /**
   * Check if agent is available (online and under concurrency limit)
   */
  isAvailable(agentId: string): Promise<boolean>;

  /**
   * Get agent load (current tasks / max concurrency)
   */
  getLoad(agentId: string): Promise<number>;

  /**
   * Increment active task count
   */
  incrementTasks(agentId: string): Promise<void>;

  /**
   * Decrement active task count
   */
  decrementTasks(agentId: string): Promise<void>;
}

/**
 * Agent metrics for heartbeat
 */
export interface AgentMetrics {
  tasks_completed?: number;
  tasks_failed?: number;
  avg_runtime_ms?: number;
  total_cost?: number;
}

/**
 * Agent match result with scoring
 */
export interface AgentMatch {
  agent: AgentCard;
  score: number;
  matchedCapabilities: string[];
  status: AgentStatus;
  load: number;
}

/**
 * Agent runtime state
 */
interface AgentState {
  status: AgentStatus;
  lastHeartbeat: Date;
  currentTasks: number;
  metrics: AgentMetrics;
}

/**
 * In-memory agent registry implementation
 */
export class InMemoryAgentRegistry implements AgentRegistry {
  private agents: Map<string, AgentCard> = new Map();
  private states: Map<string, AgentState> = new Map();
  private eventStore?: EventStore;

  constructor(eventStore?: EventStore) {
    this.eventStore = eventStore;
  }

  async register(card: AgentCard): Promise<void> {
    this.agents.set(card.agent_id, card);
    this.states.set(card.agent_id, {
      status: 'online',
      lastHeartbeat: new Date(),
      currentTasks: 0,
      metrics: {},
    });

    // Emit registration event
    if (this.eventStore) {
      const message = createMessage({
        thread_id: generateThreadId(),
        run_id: generateRunId(),
        task_id: generateTaskId(),
        parent_task_id: null,
        from: { agent_id: card.agent_id },
        to: [{ agent_id: 'agent:registry' }],
        type: 'agent.register',
        payload: { card, status: 'online' },
      });
      await this.eventStore.append(message);
    }
  }

  async update(agentId: string, updates: Partial<AgentCard>): Promise<void> {
    const card = this.agents.get(agentId);
    if (!card) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const updated = { ...card, ...updates };
    this.agents.set(agentId, updated);

    // Emit update event
    if (this.eventStore) {
      const message = createMessage({
        thread_id: generateThreadId(),
        run_id: generateRunId(),
        task_id: generateTaskId(),
        parent_task_id: null,
        from: { agent_id: agentId },
        to: [{ agent_id: 'agent:registry' }],
        type: 'agent.update',
        payload: updates,
      });
      await this.eventStore.append(message);
    }
  }

  async unregister(agentId: string): Promise<void> {
    this.agents.delete(agentId);
    this.states.delete(agentId);
  }

  async get(agentId: string): Promise<AgentCard | null> {
    return this.agents.get(agentId) ?? null;
  }

  async list(): Promise<AgentCard[]> {
    return Array.from(this.agents.values());
  }

  async setStatus(agentId: string, status: AgentStatus): Promise<void> {
    const state = this.states.get(agentId);
    if (!state) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    state.status = status;
  }

  async getStatus(agentId: string): Promise<AgentStatus | null> {
    return this.states.get(agentId)?.status ?? null;
  }

  async heartbeat(agentId: string, metrics?: AgentMetrics): Promise<void> {
    const state = this.states.get(agentId);
    if (!state) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    state.lastHeartbeat = new Date();
    if (metrics) {
      state.metrics = { ...state.metrics, ...metrics };
    }

    // Emit heartbeat event
    if (this.eventStore) {
      const message = createMessage({
        thread_id: generateThreadId(),
        run_id: generateRunId(),
        task_id: generateTaskId(),
        parent_task_id: null,
        from: { agent_id: agentId },
        to: [{ agent_id: 'agent:registry' }],
        type: 'agent.heartbeat',
        payload: {
          status: state.status,
          current_tasks: state.currentTasks,
          metrics,
        },
      });
      await this.eventStore.append(message);
    }
  }

  async findByCapabilities(requires: string[], prefers: string[] = []): Promise<AgentMatch[]> {
    const matches: AgentMatch[] = [];

    for (const [agentId, card] of this.agents) {
      // Check required capabilities (AND semantics)
      if (!hasAllCapabilities(card, requires)) {
        continue;
      }

      const state = this.states.get(agentId);
      if (!state) continue;

      // Skip offline agents
      if (state.status === 'offline') continue;

      // Calculate score
      let score = 1.0;
      const matchedCapabilities = [...requires];

      // Bonus for preferred capabilities
      for (const pref of prefers) {
        const hasPreferred = card.capabilities.some(cap => {
          // Match by ID
          if (cap.id === pref) return true;
          // Match by tag
          if (cap.tags?.includes(pref)) return true;
          // Match by tool
          if (cap.tools?.includes(pref)) return true;
          return false;
        });

        if (hasPreferred) {
          score += 0.1;
          matchedCapabilities.push(pref);
        }
      }

      // Penalty for high load
      const load = state.currentTasks / card.limits.max_concurrency;
      score *= (1 - load * 0.5);

      // Bonus for recent success rate
      if (state.metrics.tasks_completed && state.metrics.tasks_failed !== undefined) {
        const total = state.metrics.tasks_completed + state.metrics.tasks_failed;
        if (total > 0) {
          const successRate = state.metrics.tasks_completed / total;
          score *= (0.5 + successRate * 0.5);
        }
      }

      matches.push({
        agent: card,
        score,
        matchedCapabilities,
        status: state.status,
        load,
      });
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    return matches;
  }

  async findByCapabilityId(capabilityId: string): Promise<AgentCard[]> {
    return Array.from(this.agents.values()).filter(card =>
      card.capabilities.some(cap => cap.id === capabilityId)
    );
  }

  async isAvailable(agentId: string): Promise<boolean> {
    const card = this.agents.get(agentId);
    const state = this.states.get(agentId);

    if (!card || !state) return false;
    if (state.status !== 'online') return false;
    if (state.currentTasks >= card.limits.max_concurrency) return false;

    return true;
  }

  async getLoad(agentId: string): Promise<number> {
    const card = this.agents.get(agentId);
    const state = this.states.get(agentId);

    if (!card || !state) return 1;

    return state.currentTasks / card.limits.max_concurrency;
  }

  async incrementTasks(agentId: string): Promise<void> {
    const state = this.states.get(agentId);
    if (!state) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    state.currentTasks++;

    // Auto-set to busy if at capacity
    const card = this.agents.get(agentId);
    if (card && state.currentTasks >= card.limits.max_concurrency) {
      state.status = 'busy';
    }
  }

  async decrementTasks(agentId: string): Promise<void> {
    const state = this.states.get(agentId);
    if (!state) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    state.currentTasks = Math.max(0, state.currentTasks - 1);

    // Auto-set back to online if was busy
    if (state.status === 'busy' && state.currentTasks < (this.agents.get(agentId)?.limits.max_concurrency ?? 1)) {
      state.status = 'online';
    }
  }

  // For testing
  clear(): void {
    this.agents.clear();
    this.states.clear();
  }
}
