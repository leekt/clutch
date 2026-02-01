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

  async findByAgentId(agentId: string): Promise<Agent | undefined> {
    const [agent] = await db.select().from(agents).where(eq(agents.agentId, agentId));
    return agent;
  },

  async findByName(name: string): Promise<Agent | undefined> {
    const [agent] = await db.select().from(agents).where(eq(agents.name, name));
    return agent;
  },

  async findByRole(role: Agent['role']): Promise<Agent[]> {
    return db.select().from(agents).where(eq(agents.role, role));
  },

  async findByStatus(status: NonNullable<Agent['status']>): Promise<Agent[]> {
    return db.select().from(agents).where(eq(agents.status, status));
  },

  async findAvailable(): Promise<Agent[]> {
    return db.select().from(agents).where(eq(agents.status, 'available'));
  },

  async create(data: NewAgent): Promise<Agent> {
    const result = await db.insert(agents).values(data).returning();
    return result[0]!;
  },

  async upsert(data: NewAgent): Promise<Agent> {
    // Try to find existing agent
    const existing = await this.findByAgentId(data.agentId);
    if (existing) {
      return (await this.update(existing.id, data))!;
    }
    return this.create(data);
  },

  async update(id: string, data: Partial<NewAgent>): Promise<Agent | undefined> {
    const [agent] = await db
      .update(agents)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(agents.id, id))
      .returning();
    return agent;
  },

  async updateByAgentId(agentId: string, data: Partial<NewAgent>): Promise<Agent | undefined> {
    const [agent] = await db
      .update(agents)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(agents.agentId, agentId))
      .returning();
    return agent;
  },

  async updateStatus(agentId: string, status: Agent['status']): Promise<Agent | undefined> {
    return this.updateByAgentId(agentId, { status });
  },

  async heartbeat(agentId: string): Promise<Agent | undefined> {
    return this.updateByAgentId(agentId, {
      lastHeartbeat: new Date(),
      status: 'available',
    });
  },

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(agents).where(eq(agents.id, id)).returning();
    return result.length > 0;
  },

  async deleteByAgentId(agentId: string): Promise<boolean> {
    const result = await db.delete(agents).where(eq(agents.agentId, agentId)).returning();
    return result.length > 0;
  },
};
