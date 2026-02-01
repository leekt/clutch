import type { ClutchMessage } from '@clutch/protocol';

/**
 * Event Store Interface
 *
 * Append-only event store for ClutchMessages.
 * All messages are immutable once stored.
 */
export interface EventStore {
  /**
   * Append a message to the store
   * Returns the stored message (may have server-generated fields)
   */
  append(message: ClutchMessage): Promise<ClutchMessage>;

  /**
   * Append multiple messages atomically
   */
  appendBatch(messages: ClutchMessage[]): Promise<ClutchMessage[]>;

  /**
   * Get a message by ID
   */
  get(id: string): Promise<ClutchMessage | null>;

  /**
   * Check if a message exists (for deduplication)
   */
  exists(id: string): Promise<boolean>;

  /**
   * Check for duplicate by run_id + msg.id (scoped deduplication)
   */
  isDuplicate(runId: string, messageId: string): Promise<boolean>;

  /**
   * Query messages by run_id
   */
  getByRunId(runId: string, options?: QueryOptions): Promise<ClutchMessage[]>;

  /**
   * Query messages by thread_id
   */
  getByThreadId(threadId: string, options?: QueryOptions): Promise<ClutchMessage[]>;

  /**
   * Query messages by task_id
   */
  getByTaskId(taskId: string, options?: QueryOptions): Promise<ClutchMessage[]>;

  /**
   * Query messages by agent_id (from.agent_id)
   */
  getByAgentId(agentId: string, options?: QueryOptions): Promise<ClutchMessage[]>;

  /**
   * Query messages by type
   */
  getByType(type: string, options?: QueryOptions): Promise<ClutchMessage[]>;

  /**
   * Replay all messages for a run (for debugging/recovery)
   */
  replayRun(runId: string): AsyncIterable<ClutchMessage>;

  /**
   * Subscribe to new messages (real-time)
   */
  subscribe(filter: MessageFilter): AsyncIterable<ClutchMessage>;

  /**
   * Get message count
   */
  count(filter?: MessageFilter): Promise<number>;
}

/**
 * Query options for listing messages
 */
export interface QueryOptions {
  limit?: number;
  offset?: number;
  before?: Date;
  after?: Date;
  types?: string[];
  order?: 'asc' | 'desc';
}

/**
 * Filter for subscribing to messages
 */
export interface MessageFilter {
  runId?: string;
  threadId?: string;
  taskId?: string;
  agentId?: string;
  types?: string[];
  domains?: string[];
}

/**
 * In-memory event store implementation (for development/testing)
 */
export class InMemoryEventStore implements EventStore {
  private messages: Map<string, ClutchMessage> = new Map();
  private byRunId: Map<string, Set<string>> = new Map();
  private byThreadId: Map<string, Set<string>> = new Map();
  private byTaskId: Map<string, Set<string>> = new Map();
  private byAgentId: Map<string, Set<string>> = new Map();
  private subscribers: Set<{
    filter: MessageFilter;
    callback: (msg: ClutchMessage) => void;
  }> = new Set();

  async append(message: ClutchMessage): Promise<ClutchMessage> {
    // Check for duplicate
    if (this.messages.has(message.id)) {
      return this.messages.get(message.id)!;
    }

    // Store message
    this.messages.set(message.id, message);

    // Index by run_id
    if (!this.byRunId.has(message.run_id)) {
      this.byRunId.set(message.run_id, new Set());
    }
    this.byRunId.get(message.run_id)!.add(message.id);

    // Index by thread_id
    if (!this.byThreadId.has(message.thread_id)) {
      this.byThreadId.set(message.thread_id, new Set());
    }
    this.byThreadId.get(message.thread_id)!.add(message.id);

    // Index by task_id
    if (!this.byTaskId.has(message.task_id)) {
      this.byTaskId.set(message.task_id, new Set());
    }
    this.byTaskId.get(message.task_id)!.add(message.id);

    // Index by agent_id
    const agentId = message.from.agent_id;
    if (!this.byAgentId.has(agentId)) {
      this.byAgentId.set(agentId, new Set());
    }
    this.byAgentId.get(agentId)!.add(message.id);

    // Notify subscribers
    this.notifySubscribers(message);

    return message;
  }

  async appendBatch(messages: ClutchMessage[]): Promise<ClutchMessage[]> {
    const results: ClutchMessage[] = [];
    for (const msg of messages) {
      results.push(await this.append(msg));
    }
    return results;
  }

  async get(id: string): Promise<ClutchMessage | null> {
    return this.messages.get(id) ?? null;
  }

  async exists(id: string): Promise<boolean> {
    return this.messages.has(id);
  }

  async isDuplicate(runId: string, messageId: string): Promise<boolean> {
    const runMessages = this.byRunId.get(runId);
    if (!runMessages) return false;
    return runMessages.has(messageId);
  }

  async getByRunId(runId: string, options?: QueryOptions): Promise<ClutchMessage[]> {
    const ids = this.byRunId.get(runId);
    if (!ids) return [];
    return this.getMessagesByIds(ids, options);
  }

  async getByThreadId(threadId: string, options?: QueryOptions): Promise<ClutchMessage[]> {
    const ids = this.byThreadId.get(threadId);
    if (!ids) return [];
    return this.getMessagesByIds(ids, options);
  }

  async getByTaskId(taskId: string, options?: QueryOptions): Promise<ClutchMessage[]> {
    const ids = this.byTaskId.get(taskId);
    if (!ids) return [];
    return this.getMessagesByIds(ids, options);
  }

  async getByAgentId(agentId: string, options?: QueryOptions): Promise<ClutchMessage[]> {
    const ids = this.byAgentId.get(agentId);
    if (!ids) return [];
    return this.getMessagesByIds(ids, options);
  }

  async getByType(type: string, options?: QueryOptions): Promise<ClutchMessage[]> {
    const messages = Array.from(this.messages.values()).filter(m => m.type === type);
    return this.applyOptions(messages, options);
  }

  async *replayRun(runId: string): AsyncIterable<ClutchMessage> {
    const messages = await this.getByRunId(runId, { order: 'asc' });
    for (const msg of messages) {
      yield msg;
    }
  }

  async *subscribe(filter: MessageFilter): AsyncIterable<ClutchMessage> {
    const queue: ClutchMessage[] = [];
    let resolve: (() => void) | null = null;

    const subscription = {
      filter,
      callback: (msg: ClutchMessage) => {
        queue.push(msg);
        if (resolve) {
          resolve();
          resolve = null;
        }
      },
    };

    this.subscribers.add(subscription);

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          await new Promise<void>(r => { resolve = r; });
        }
      }
    } finally {
      this.subscribers.delete(subscription);
    }
  }

  async count(filter?: MessageFilter): Promise<number> {
    if (!filter) {
      return this.messages.size;
    }

    let messages = Array.from(this.messages.values());

    if (filter.runId) {
      const ids = this.byRunId.get(filter.runId);
      if (!ids) return 0;
      messages = messages.filter(m => ids.has(m.id));
    }

    if (filter.threadId) {
      messages = messages.filter(m => m.thread_id === filter.threadId);
    }

    if (filter.taskId) {
      messages = messages.filter(m => m.task_id === filter.taskId);
    }

    if (filter.agentId) {
      messages = messages.filter(m => m.from.agent_id === filter.agentId);
    }

    if (filter.types && filter.types.length > 0) {
      messages = messages.filter(m => filter.types!.includes(m.type));
    }

    if (filter.domains && filter.domains.length > 0) {
      messages = messages.filter(m => m.domain && filter.domains!.includes(m.domain));
    }

    return messages.length;
  }

  // Helper methods

  private getMessagesByIds(ids: Set<string>, options?: QueryOptions): ClutchMessage[] {
    const messages = Array.from(ids)
      .map(id => this.messages.get(id)!)
      .filter(Boolean);
    return this.applyOptions(messages, options);
  }

  private applyOptions(messages: ClutchMessage[], options?: QueryOptions): ClutchMessage[] {
    let result = [...messages];

    // Filter by time
    if (options?.before) {
      result = result.filter(m => new Date(m.ts) < options.before!);
    }
    if (options?.after) {
      result = result.filter(m => new Date(m.ts) > options.after!);
    }

    // Filter by types
    if (options?.types && options.types.length > 0) {
      result = result.filter(m => options.types!.includes(m.type));
    }

    // Sort
    result.sort((a, b) => {
      const order = options?.order === 'desc' ? -1 : 1;
      return order * (new Date(a.ts).getTime() - new Date(b.ts).getTime());
    });

    // Pagination
    if (options?.offset) {
      result = result.slice(options.offset);
    }
    if (options?.limit) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  private notifySubscribers(message: ClutchMessage): void {
    for (const sub of this.subscribers) {
      if (this.matchesFilter(message, sub.filter)) {
        sub.callback(message);
      }
    }
  }

  private matchesFilter(message: ClutchMessage, filter: MessageFilter): boolean {
    if (filter.runId && message.run_id !== filter.runId) return false;
    if (filter.threadId && message.thread_id !== filter.threadId) return false;
    if (filter.taskId && message.task_id !== filter.taskId) return false;
    if (filter.agentId && message.from.agent_id !== filter.agentId) return false;
    if (filter.types && filter.types.length > 0 && !filter.types.includes(message.type)) return false;
    if (filter.domains && filter.domains.length > 0 && (!message.domain || !filter.domains.includes(message.domain))) return false;
    return true;
  }

  // For testing
  clear(): void {
    this.messages.clear();
    this.byRunId.clear();
    this.byThreadId.clear();
    this.byTaskId.clear();
    this.byAgentId.clear();
  }
}
