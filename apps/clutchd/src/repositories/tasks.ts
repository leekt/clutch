import { eq, isNull } from 'drizzle-orm';
import { db, tasks, type Task, type NewTask } from '../db/index.js';

export type TaskState = Task['state'];

export const taskRepository = {
  async findAll(): Promise<Task[]> {
    return db.select().from(tasks);
  },

  async findById(id: string): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
    return task;
  },

  async findByState(state: TaskState): Promise<Task[]> {
    return db.select().from(tasks).where(eq(tasks.state, state));
  },

  async findByAssignee(assigneeId: string): Promise<Task[]> {
    return db.select().from(tasks).where(eq(tasks.assigneeId, assigneeId));
  },

  async findRootTasks(): Promise<Task[]> {
    return db.select().from(tasks).where(isNull(tasks.parentId));
  },

  async findSubtasks(parentId: string): Promise<Task[]> {
    return db.select().from(tasks).where(eq(tasks.parentId, parentId));
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

  async updateState(id: string, state: TaskState): Promise<Task | undefined> {
    const updates: Partial<NewTask> = { state };
    if (state === 'done') {
      updates.completedAt = new Date();
    }
    return this.update(id, updates);
  },

  async assign(id: string, assigneeId: string): Promise<Task | undefined> {
    return this.update(id, { assigneeId, state: 'assigned' });
  },

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(tasks).where(eq(tasks.id, id)).returning();
    return result.length > 0;
  },
};
