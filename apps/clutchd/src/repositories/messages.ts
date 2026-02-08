import { eq, desc, and } from 'drizzle-orm';
import { db, messages, type Message, type NewMessage } from '../db/index.js';

export const messageRepository = {
  async findAll(limit = 100): Promise<Message[]> {
    return db.select().from(messages).orderBy(desc(messages.createdAt)).limit(limit);
  },

  async findById(id: string): Promise<Message | undefined> {
    const [message] = await db.select().from(messages).where(eq(messages.id, id));
    return message;
  },

  async findByMessageId(messageId: string): Promise<Message | undefined> {
    const [message] = await db.select().from(messages).where(eq(messages.messageId, messageId));
    return message;
  },

  async findByChannel(channelId: string, limit = 50): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.channelId, channelId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
  },

  async findByRunId(runId: string): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.runId, runId))
      .orderBy(messages.createdAt);
  },

  async findByTaskId(taskId: string): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.taskId, taskId))
      .orderBy(messages.createdAt);
  },

  async findByThreadId(threadId: string): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(messages.createdAt);
  },

  async findByAgent(agentId: string, limit = 50): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.fromAgentId, agentId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
  },

  async findByType(type: Message['type'], limit = 50): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.type, type))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
  },

  async findByIdempotencyKey(key: string, runId: string): Promise<Message | undefined> {
    const [message] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.idempotencyKey, key), eq(messages.runId, runId)));
    return message;
  },

  async create(data: NewMessage): Promise<Message> {
    const result = await db.insert(messages).values(data).returning();
    return result[0]!;
  },

  async exists(messageId: string): Promise<boolean> {
    const [message] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.messageId, messageId));
    return !!message;
  },

  async deleteByChannelId(channelId: string): Promise<number> {
    const result = await db.delete(messages).where(eq(messages.channelId, channelId)).returning();
    return result.length;
  },

  // Append-only: messages should not be deleted in production
  // This is only for development/testing
  async delete(id: string): Promise<boolean> {
    const result = await db.delete(messages).where(eq(messages.id, id)).returning();
    return result.length > 0;
  },

  async deleteByRunId(runId: string): Promise<number> {
    const result = await db.delete(messages).where(eq(messages.runId, runId)).returning();
    return result.length;
  },
};
