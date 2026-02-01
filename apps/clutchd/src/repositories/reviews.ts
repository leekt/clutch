import { eq, and } from 'drizzle-orm';
import { db, reviews, type Review, type NewReview } from '../db/index.js';

export type ReviewStatus = Review['status'];

export const reviewRepository = {
  async findAll(): Promise<Review[]> {
    return db.select().from(reviews);
  },

  async findById(id: string): Promise<Review | undefined> {
    const [review] = await db.select().from(reviews).where(eq(reviews.id, id));
    return review;
  },

  async findByTask(taskId: string): Promise<Review[]> {
    return db.select().from(reviews).where(eq(reviews.taskId, taskId));
  },

  async findByReviewer(reviewerId: string): Promise<Review[]> {
    return db.select().from(reviews).where(eq(reviews.reviewerId, reviewerId));
  },

  async findByStatus(status: ReviewStatus): Promise<Review[]> {
    return db.select().from(reviews).where(eq(reviews.status, status));
  },

  async findPendingForTask(taskId: string): Promise<Review[]> {
    return db
      .select()
      .from(reviews)
      .where(and(eq(reviews.taskId, taskId), eq(reviews.status, 'pending')));
  },

  async create(data: NewReview): Promise<Review> {
    const result = await db.insert(reviews).values(data).returning();
    return result[0]!;
  },

  async update(id: string, data: Partial<NewReview>): Promise<Review | undefined> {
    const [review] = await db
      .update(reviews)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(reviews.id, id))
      .returning();
    return review;
  },

  async approve(id: string, comments?: string): Promise<Review | undefined> {
    return this.update(id, { status: 'approved', comments });
  },

  async reject(id: string, comments: string): Promise<Review | undefined> {
    return this.update(id, { status: 'rejected', comments });
  },

  async delete(id: string): Promise<boolean> {
    const result = await db.delete(reviews).where(eq(reviews.id, id)).returning();
    return result.length > 0;
  },
};
