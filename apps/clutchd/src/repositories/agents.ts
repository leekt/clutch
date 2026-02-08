import { eq, sql } from 'drizzle-orm';
import { db, agents, type Agent, type NewAgent } from '../db/index.js';

// Lifecycle state type
type LifecycleState = 'asleep' | 'waking' | 'working' | 'sleeping';

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

  // === Organization OS: Lifecycle State ===

  async findByLifecycleState(state: LifecycleState): Promise<Agent[]> {
    return db.select().from(agents).where(eq(agents.lifecycleState, state));
  },

  async findAwake(): Promise<Agent[]> {
    return db.select().from(agents).where(eq(agents.lifecycleState, 'working'));
  },

  async findAsleep(): Promise<Agent[]> {
    return db.select().from(agents).where(eq(agents.lifecycleState, 'asleep'));
  },

  // === Organization OS: Strength-based queries ===

  async findByStrength(strength: string): Promise<Agent[]> {
    // Use JSONB containment to find agents with this strength
    return db.select().from(agents).where(
      sql`${agents.strengths} @> ${JSON.stringify([strength])}::jsonb`
    );
  },

  async findByAnyStrength(strengths: string[]): Promise<Agent[]> {
    if (strengths.length === 0) return [];
    // Find agents that have any of the specified strengths
    return db.select().from(agents).where(
      sql`${agents.strengths} ?| array[${sql.raw(strengths.map(s => `'${s}'`).join(','))}]`
    );
  },

  async findByAllStrengths(strengths: string[]): Promise<Agent[]> {
    if (strengths.length === 0) return this.findAll();
    // Find agents that have all specified strengths
    return db.select().from(agents).where(
      sql`${agents.strengths} @> ${JSON.stringify(strengths)}::jsonb`
    );
  },

  // === Organization OS: Preferred Collaborators ===

  async findPreferredCollaborators(agentId: string): Promise<Agent[]> {
    const agent = await this.findByAgentId(agentId);
    if (!agent?.preferredCollaborators?.length) return [];

    const collaboratorIds = agent.preferredCollaborators;
    const results: Agent[] = [];
    for (const id of collaboratorIds) {
      const collab = await this.findByAgentId(id);
      if (collab) results.push(collab);
    }
    return results;
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

  // === Organization OS: Wake/Sleep Lifecycle ===

  /**
   * Wake an agent for a task session
   */
  async wake(agentId: string, sessionId: string): Promise<Agent | undefined> {
    const [agent] = await db
      .update(agents)
      .set({
        lifecycleState: 'working',
        currentSessionId: sessionId,
        status: 'busy',
        lastWakeAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agents.agentId, agentId))
      .returning();
    return agent;
  },

  /**
   * Put an agent to sleep after task completion
   */
  async sleep(agentId: string): Promise<Agent | undefined> {
    const [agent] = await db
      .update(agents)
      .set({
        lifecycleState: 'asleep',
        currentSessionId: null,
        status: 'available',
        lastSleepAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agents.agentId, agentId))
      .returning();
    return agent;
  },

  /**
   * Check if an agent is currently awake
   */
  async isAwake(agentId: string): Promise<boolean> {
    const agent = await this.findByAgentId(agentId);
    return agent?.lifecycleState === 'working';
  },

  /**
   * Get the current session ID for an agent
   */
  async getCurrentSession(agentId: string): Promise<string | null> {
    const agent = await this.findByAgentId(agentId);
    return agent?.currentSessionId ?? null;
  },

  // === Organization OS: AgentSpec Updates ===

  async updatePersonality(
    agentId: string,
    personality: NonNullable<Agent['personality']>
  ): Promise<Agent | undefined> {
    return this.updateByAgentId(agentId, { personality });
  },

  async updateStrengths(agentId: string, strengths: string[]): Promise<Agent | undefined> {
    return this.updateByAgentId(agentId, { strengths });
  },

  async addStrength(agentId: string, strength: string): Promise<Agent | undefined> {
    const agent = await this.findByAgentId(agentId);
    if (!agent) return undefined;

    const strengths = [...(agent.strengths || [])];
    if (!strengths.includes(strength)) {
      strengths.push(strength);
    }
    return this.updateByAgentId(agentId, { strengths });
  },

  async updateOperatingRules(agentId: string, rules: string[]): Promise<Agent | undefined> {
    return this.updateByAgentId(agentId, { operatingRules: rules });
  },

  async updatePreferredCollaborators(
    agentId: string,
    collaborators: string[]
  ): Promise<Agent | undefined> {
    return this.updateByAgentId(agentId, { preferredCollaborators: collaborators });
  },

  async updateMemoryConfig(
    agentId: string,
    config: NonNullable<Agent['memoryConfig']>
  ): Promise<Agent | undefined> {
    return this.updateByAgentId(agentId, { memoryConfig: config });
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
