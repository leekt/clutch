import { eq, desc, isNull, and } from 'drizzle-orm';
import { db, messages, type Message, type NewMessage } from '../db/index.js';

export const messageRepository = {
  async findAll(): Promise<Message[]> {
    return db.select().from(messages).orderBy(desc(messages.createdAt));
  },

  async findById(id: string): Promise<Message | undefined> {
    const [message] = await db.select().from(messages).where(eq(messages.id, id));
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

  async findByTask(taskId: string): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.taskId, taskId))
      .orderBy(desc(messages.createdAt));
  },

  async findBySender(senderId: string): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.senderId, senderId))
      .orderBy(desc(messages.createdAt));
  },

  async findRootMessages(channelId: string): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(and(eq(messages.channelId, channelId), isNull(messages.threadId)))
      .orderBy(desc(messages.createdAt));
  },

  async findThreadReplies(threadId: string): Promise<Message[]> {
    return db
      .select()
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(messages.createdAt);
  },

  async create(data: NewMessage): Promise<Message> {
    const result = await db.insert(messages).values(data).returning();
    return result[0]!;
  },

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(messages).where(eq(messages.id, id)).returning();
    return result.length > 0;
  },
};
