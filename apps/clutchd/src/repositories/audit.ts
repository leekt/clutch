import { eq, desc, and, gte, lte } from 'drizzle-orm';
import { db, auditLogs, type AuditLog, type NewAuditLog } from '../db/index.js';

export const auditRepository = {
  async findAll(limit = 100): Promise<AuditLog[]> {
    return db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  },

  async findById(id: string): Promise<AuditLog | undefined> {
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.id, id));
    return log;
  },

  async findByEntity(entityType: string, entityId: string): Promise<AuditLog[]> {
    return db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)))
      .orderBy(desc(auditLogs.createdAt));
  },

  async findByAgent(agentId: string): Promise<AuditLog[]> {
    return db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.agentId, agentId))
      .orderBy(desc(auditLogs.createdAt));
  },

  async findByRunId(runId: string): Promise<AuditLog[]> {
    return db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.runId, runId))
      .orderBy(auditLogs.createdAt);
  },

  async findByTaskId(taskId: string): Promise<AuditLog[]> {
    return db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.taskId, taskId))
      .orderBy(auditLogs.createdAt);
  },

  async findByAction(action: string): Promise<AuditLog[]> {
    return db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, action))
      .orderBy(desc(auditLogs.createdAt));
  },

  async findByDateRange(startDate: Date, endDate: Date): Promise<AuditLog[]> {
    return db
      .select()
      .from(auditLogs)
      .where(and(gte(auditLogs.createdAt, startDate), lte(auditLogs.createdAt, endDate)))
      .orderBy(desc(auditLogs.createdAt));
  },

  async create(data: NewAuditLog): Promise<AuditLog> {
    const result = await db.insert(auditLogs).values(data).returning();
    return result[0]!;
  },

  // Helper to log common actions
  async logAction(
    action: string,
    entityType: string,
    entityId: string,
    options?: {
      agentId?: string;
      userId?: string;
      runId?: string;
      taskId?: string;
      details?: Record<string, unknown>;
      cost?: string;
      runtime?: number;
      tokens?: number;
    }
  ): Promise<AuditLog> {
    return this.create({
      action,
      entityType,
      entityId,
      agentId: options?.agentId,
      userId: options?.userId,
      runId: options?.runId,
      taskId: options?.taskId,
      details: options?.details ?? {},
      cost: options?.cost,
      runtime: options?.runtime,
      tokens: options?.tokens,
    });
  },
};
