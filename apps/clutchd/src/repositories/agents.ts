import { eq } from 'drizzle-orm';
import { db, agents, type Agent, type NewAgent } from '../db/index.js';

export const agentRepository = {
  async findAll(): Promise<Agent[]> {
    return db.select().from(agents);
  },

  async findById(id: string): Promise<Agent | undefined> {
    const [agent] = await db.select().from(agents).where(eq(agents.id, id));
    return agent;
  },

  async findByName(name: string): Promise<Agent | undefined> {
    const [agent] = await db.select().from(agents).where(eq(agents.name, name));
    return agent;
  },

  async create(data: NewAgent): Promise<Agent> {
    const result = await db.insert(agents).values(data).returning();
    return result[0]!;
  },

  async update(id: string, data: Partial<NewAgent>): Promise<Agent | undefined> {
    const [agent] = await db
      .update(agents)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning();
    return agent;
  },

  async updateStatus(id: string, status: Agent['status']): Promise<Agent | undefined> {
    return this.update(id, { status });
  },

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(agents).where(eq(agents.id, id)).returning();
    return result.length > 0;
  },
};
