import type { EventStore, MessageFilter, QueryOptions } from '@clutch/core';
import type { ClutchMessage, MessageType } from '@clutch/protocol';

import { pubsub } from '../queue/index.js';
import { messageRepository } from '../repositories/index.js';

/**
 * PostgreSQL-backed EventStore implementation
 *
 * Stores ClutchMessages in the messages table with full indexing support.
 */
export class PostgresEventStore implements EventStore {
  private subscribers: Set<{
    filter: MessageFilter;
    callback: (msg: ClutchMessage) => void;
  }> = new Set();

  /**
   * Convert database message to ClutchMessage format
   */
  private toClutchMessage(dbMsg: Awaited<ReturnType<typeof messageRepository.findByMessageId>>): ClutchMessage | null {
    if (!dbMsg) return null;

    return {
      v: dbMsg.version as 'clutch/0.1',
      id: dbMsg.messageId,
      ts: dbMsg.createdAt.toISOString(),
      thread_id: dbMsg.threadId,
      run_id: dbMsg.runId,
      task_id: dbMsg.taskId,
      parent_task_id: dbMsg.parentTaskId,
      trace: dbMsg.traceId && dbMsg.spanId ? {
        trace_id: dbMsg.traceId,
        span_id: dbMsg.spanId,
      } : undefined,
      from: { agent_id: dbMsg.fromAgentId },
      to: (dbMsg.toAgentIds as string[]).map(id => ({ agent_id: id })),
      type: dbMsg.type as MessageType,
      domain: dbMsg.domain ?? undefined,
      payload_type: dbMsg.payloadType ?? undefined,
      schema_ref: dbMsg.schemaRef ?? undefined,
      payload: dbMsg.payload,
      requires: dbMsg.requires as string[] ?? [],
      prefers: dbMsg.prefers as string[] ?? [],
      attachments: (dbMsg.attachments as Array<{
        kind: 'artifact_ref' | 'inline' | 'url';
        ref?: string;
        content?: unknown;
        url?: string;
        mimeType?: string;
      }>)?.map(a => ({
        kind: a.kind,
        ref: a.ref,
        content: a.content,
        url: a.url,
        mime_type: a.mimeType,
      })),
      idempotency_key: dbMsg.idempotencyKey ?? undefined,
      attempt: dbMsg.attempt ?? 1,
      meta: {
        ...(dbMsg.meta as Record<string, unknown> ?? {}),
        cost: dbMsg.cost,
        runtime: dbMsg.runtime,
        tokens: dbMsg.tokens,
      },
    } as ClutchMessage;
  }

  async append(message: ClutchMessage): Promise<ClutchMessage> {
    // Check for duplicate
    const existing = await messageRepository.findByMessageId(message.id);
    if (existing) {
      return this.toClutchMessage(existing)!;
    }

    // Insert into database
    await messageRepository.create({
      messageId: message.id,
      version: message.v,
      threadId: message.thread_id,
      runId: message.run_id,
      taskId: message.task_id,
      parentTaskId: message.parent_task_id ?? null,
      traceId: message.trace?.trace_id ?? null,
      spanId: message.trace?.span_id ?? null,
      fromAgentId: message.from.agent_id,
      toAgentIds: message.to.map(r => r.agent_id),
      type: message.type as MessageType,
      domain: message.domain ?? null,
      payloadType: message.payload_type ?? null,
      schemaRef: message.schema_ref ?? null,
      payload: message.payload,
      requires: message.requires ?? [],
      prefers: message.prefers ?? [],
      attachments: (message.attachments ?? []).map(a => ({
        kind: a.kind,
        ref: a.ref,
        content: a.content,
        url: a.url,
        mimeType: a.mime_type,
      })),
      idempotencyKey: message.idempotency_key ?? null,
      attempt: message.attempt ?? 1,
      meta: message.meta ?? {},
      channelId: null,
      cost: ((message.meta as Record<string, unknown>)?.cost as string) ?? '0',
      runtime: ((message.meta as Record<string, unknown>)?.runtime as number) ?? 0,
      tokens: ((message.meta as Record<string, unknown>)?.tokens as number) ?? 0,
    });

    // Notify subscribers
    this.notifySubscribers(message);

    // Publish to Redis for cross-process subscribers
    await pubsub.publishMessageUpdate(message.id, 'appended', message);

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
    const msg = await messageRepository.findByMessageId(id);
    return this.toClutchMessage(msg);
  }

  async exists(id: string): Promise<boolean> {
    return messageRepository.exists(id);
  }

  async isDuplicate(runId: string, messageId: string): Promise<boolean> {
    const msg = await messageRepository.findByIdempotencyKey(messageId, runId);
    return !!msg;
  }

  async getByRunId(runId: string, options?: QueryOptions): Promise<ClutchMessage[]> {
    const messages = await messageRepository.findByRunId(runId);
    return this.applyOptions(
      messages.map(m => this.toClutchMessage(m)!).filter(Boolean),
      options
    );
  }

  async getByThreadId(threadId: string, options?: QueryOptions): Promise<ClutchMessage[]> {
    const messages = await messageRepository.findByThreadId(threadId);
    return this.applyOptions(
      messages.map(m => this.toClutchMessage(m)!).filter(Boolean),
      options
    );
  }

  async getByTaskId(taskId: string, options?: QueryOptions): Promise<ClutchMessage[]> {
    const messages = await messageRepository.findByTaskId(taskId);
    return this.applyOptions(
      messages.map(m => this.toClutchMessage(m)!).filter(Boolean),
      options
    );
  }

  async getByAgentId(agentId: string, options?: QueryOptions): Promise<ClutchMessage[]> {
    const messages = await messageRepository.findByAgent(agentId);
    return this.applyOptions(
      messages.map(m => this.toClutchMessage(m)!).filter(Boolean),
      options
    );
  }

  async getByType(type: string, options?: QueryOptions): Promise<ClutchMessage[]> {
    const messages = await messageRepository.findByType(type as MessageType);
    return this.applyOptions(
      messages.map(m => this.toClutchMessage(m)!).filter(Boolean),
      options
    );
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
    // For simplicity, get all and filter
    // In production, this should be a database count query
    if (!filter) {
      const messages = await messageRepository.findAll(1000);
      return messages.length;
    }

    let messages: ClutchMessage[] = [];

    if (filter.runId) {
      messages = await this.getByRunId(filter.runId);
    } else if (filter.threadId) {
      messages = await this.getByThreadId(filter.threadId);
    } else if (filter.taskId) {
      messages = await this.getByTaskId(filter.taskId);
    } else if (filter.agentId) {
      messages = await this.getByAgentId(filter.agentId);
    } else {
      const dbMessages = await messageRepository.findAll(1000);
      messages = dbMessages.map(m => this.toClutchMessage(m)!).filter(Boolean);
    }

    // Apply additional filters
    if (filter.types && filter.types.length > 0) {
      messages = messages.filter(m => filter.types!.includes(m.type));
    }
    if (filter.domains && filter.domains.length > 0) {
      messages = messages.filter(m => m.domain && filter.domains!.includes(m.domain));
    }

    return messages.length;
  }

  // Helper methods

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
}

// Singleton instance
export const pgEventStore = new PostgresEventStore();
