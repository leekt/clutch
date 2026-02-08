import { eq, isNull, and, desc, inArray } from 'drizzle-orm';
import { db, tasks, type Task, type NewTask } from '../db/index.js';

export type TaskState = Task['state'];

export const taskRepository = {
  async findAll(limit = 100): Promise<Task[]> {
    return db.select().from(tasks).orderBy(desc(tasks.createdAt)).limit(limit);
  },

  async findById(id: string): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    return task;
  },

  async findByTaskId(taskId: string): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.taskId, taskId));
    return task;
  },

  async findByRunId(runId: string): Promise<Task[]> {
    return db.select().from(tasks).where(eq(tasks.runId, runId)).orderBy(tasks.createdAt);
  },

  async findByState(state: TaskState): Promise<Task[]> {
    return db.select().from(tasks).where(eq(tasks.state, state));
  },

  async findByStates(states: TaskState[]): Promise<Task[]> {
    if (states.length === 0) return [];
    return db.select().from(tasks).where(inArray(tasks.state, states));
  },

  async findByAssignee(assigneeId: string): Promise<Task[]> {
    return db.select().from(tasks).where(eq(tasks.assigneeId, assigneeId));
  },

  async findRootTasks(runId?: string): Promise<Task[]> {
    if (runId) {
      return db
        .select()
        .from(tasks)
        .where(and(eq(tasks.runId, runId), isNull(tasks.parentTaskId)));
    }
    return db.select().from(tasks).where(isNull(tasks.parentTaskId));
  },

  async findSubtasks(parentTaskId: string): Promise<Task[]> {
    return db.select().from(tasks).where(eq(tasks.parentTaskId, parentTaskId));
  },

  async findByWorkflow(workflowId: string): Promise<Task[]> {
    return db.select().from(tasks).where(eq(tasks.workflowId, workflowId));
  },

  async create(data: NewTask): Promise<Task> {
    const result = await db.insert(tasks).values(data).returning();
    return result[0]!;
  },

  async update(id: string, data: Partial<NewTask>): Promise<Task | undefined> {
    const [task] = await db
      .update(tasks)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    return task;
  },

  async updateByTaskId(taskId: string, data: Partial<NewTask>): Promise<Task | undefined> {
    const [task] = await db
      .update(tasks)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(tasks.taskId, taskId))
      .returning();
    return task;
  },

  async updateState(taskId: string, state: TaskState): Promise<Task | undefined> {
    const updates: Partial<NewTask> = { state };

    if (state === 'running') {
      updates.startedAt = new Date();
    }

    if (state === 'done' || state === 'cancelled' || state === 'failed') {
      updates.completedAt = new Date();
    }

    return this.updateByTaskId(taskId, updates);
  },

  async assign(taskId: string, assigneeId: string): Promise<Task | undefined> {
    return this.updateByTaskId(taskId, { assigneeId, state: 'assigned' });
  },

  async setOutput(taskId: string, output: unknown): Promise<Task | undefined> {
    return this.updateByTaskId(taskId, { output, state: 'done', completedAt: new Date() });
  },

  async setError(
    taskId: string,
    error: { code: string; message: string; retryable: boolean }
  ): Promise<Task | undefined> {
    return this.updateByTaskId(taskId, { error, state: 'failed', completedAt: new Date() });
  },

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(tasks).where(eq(tasks.id, id)).returning();
    return result.length > 0;
  },

  async deleteByRunId(runId: string): Promise<number> {
    const result = await db.delete(tasks).where(eq(tasks.runId, runId)).returning();
    return result.length;
  },
};
