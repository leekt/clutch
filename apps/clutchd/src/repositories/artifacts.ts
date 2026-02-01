import { eq, desc } from 'drizzle-orm';
import { db, artifacts, type Artifact, type NewArtifact } from '../db/index.js';

export const artifactRepository = {
  async findAll(limit = 100): Promise<Artifact[]> {
    return db.select().from(artifacts).orderBy(desc(artifacts.createdAt)).limit(limit);
  },

  async findById(id: string): Promise<Artifact | undefined> {
    const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, id));
    return artifact;
  },

  async findByArtifactId(artifactId: string): Promise<Artifact | undefined> {
    const [artifact] = await db.select().from(artifacts).where(eq(artifacts.artifactId, artifactId));
    return artifact;
  },

  async findByHash(hash: string): Promise<Artifact | undefined> {
    const [artifact] = await db.select().from(artifacts).where(eq(artifacts.hash, hash));
    return artifact;
  },

  async findByTaskId(taskId: string): Promise<Artifact[]> {
    return db
      .select()
      .from(artifacts)
      .where(eq(artifacts.taskId, taskId))
      .orderBy(desc(artifacts.createdAt));
  },

  async findByMessageId(messageId: string): Promise<Artifact[]> {
    return db
      .select()
      .from(artifacts)
      .where(eq(artifacts.messageId, messageId))
      .orderBy(desc(artifacts.createdAt));
  },

  async findByAgentId(agentId: string): Promise<Artifact[]> {
    return db
      .select()
      .from(artifacts)
      .where(eq(artifacts.agentId, agentId))
      .orderBy(desc(artifacts.createdAt));
  },

  async create(data: NewArtifact): Promise<Artifact> {
    const result = await db.insert(artifacts).values(data).returning();
    return result[0]!;
  },

  async exists(hash: string): Promise<boolean> {
    const [artifact] = await db
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(eq(artifacts.hash, hash));
    return !!artifact;
  },

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(artifacts).where(eq(artifacts.id, id)).returning();
    return result.length > 0;
  },
};
