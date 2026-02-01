import { eq } from 'drizzle-orm';
import { db, channels, type Channel, type NewChannel } from '../db/index.js';

export const channelRepository = {
  async findAll(): Promise<Channel[]> {
    return db.select().from(channels);
  },

  async findById(id: string): Promise<Channel | undefined> {
    const [channel] = await db.select().from(channels).where(eq(channels.id, id));
    return channel;
  },

  async findByName(name: string): Promise<Channel | undefined> {
    const [channel] = await db.select().from(channels).where(eq(channels.name, name));
    return channel;
  },

  async findByTaskId(taskId: string): Promise<Channel | undefined> {
    const [channel] = await db.select().from(channels).where(eq(channels.taskId, taskId));
    return channel;
  },

  async findByType(type: Channel['type']): Promise<Channel[]> {
    return db.select().from(channels).where(eq(channels.type, type));
  },

  async create(data: NewChannel): Promise<Channel> {
    const result = await db.insert(channels).values(data).returning();
    return result[0]!;
  },

  async update(id: string, data: Partial<NewChannel>): Promise<Channel | undefined> {
    const [channel] = await db
      .update(channels)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(channels.id, id))
      .returning();
    return channel;
  },

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(channels).where(eq(channels.id, id)).returning();
    return result.length > 0;
  },
};
