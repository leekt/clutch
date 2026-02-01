import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  pgEnum,
  uuid,
  decimal,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const agentRoleEnum = pgEnum('agent_role', ['pm', 'research', 'marketing', 'developer', 'qa']);
export const taskStateEnum = pgEnum('task_state', ['created', 'assigned', 'running', 'review', 'rework', 'done']);
export const messageTypeEnum = pgEnum('message_type', ['PLAN', 'PROPOSAL', 'EXEC_REPORT', 'REVIEW', 'BLOCKER']);
export const channelTypeEnum = pgEnum('channel_type', ['task', 'department']);
export const reviewStatusEnum = pgEnum('review_status', ['pending', 'approved', 'rejected']);

// Agents table
export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  role: agentRoleEnum('role').notNull(),
  description: text('description'),
  image: text('image').notNull(),
  permissions: jsonb('permissions').$type<{
    file: boolean;
    shell: boolean;
    git: boolean;
    browser: boolean;
  }>().notNull(),
  budget: jsonb('budget').$type<{
    maxTokens?: number;
    maxCost?: number;
    maxRuntime?: number;
  }>().notNull(),
  secrets: jsonb('secrets').$type<string[]>().default([]),
  status: text('status').$type<'available' | 'busy' | 'offline'>().default('offline'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Tasks table (defined before channels to avoid circular reference)
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  state: taskStateEnum('state').default('created').notNull(),
  workflowId: text('workflow_id'),
  workflowStepId: text('workflow_step_id'),
  assigneeId: uuid('assignee_id'),
  parentId: uuid('parent_id'),
  channelId: uuid('channel_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

// Channels table
export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: channelTypeEnum('type').notNull(),
  description: text('description'),
  taskId: uuid('task_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Messages table
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: messageTypeEnum('type').notNull(),
  channelId: uuid('channel_id').notNull(),
  senderId: uuid('sender_id').notNull(),
  taskId: uuid('task_id'),
  threadId: uuid('thread_id'),
  summary: text('summary').notNull(),
  body: text('body').notNull(),
  artifacts: jsonb('artifacts').$type<Array<{ path: string; hash: string }>>().default([]),
  citations: jsonb('citations').$type<string[]>().default([]),
  cost: decimal('cost', { precision: 10, scale: 4 }).default('0'),
  runtime: integer('runtime').default(0), // milliseconds
  tokens: integer('tokens').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Reviews table
export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull(),
  messageId: uuid('message_id').notNull(),
  reviewerId: uuid('reviewer_id').notNull(),
  status: reviewStatusEnum('status').default('pending').notNull(),
  comments: text('comments'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Audit logs table
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(), // 'task', 'message', 'agent', etc.
  entityId: uuid('entity_id').notNull(),
  agentId: uuid('agent_id'),
  userId: text('user_id'), // for human actions
  details: jsonb('details').$type<Record<string, unknown>>().default({}),
  cost: decimal('cost', { precision: 10, scale: 4 }),
  runtime: integer('runtime'),
  tokens: integer('tokens'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relations
export const agentsRelations = relations(agents, ({ many }) => ({
  tasks: many(tasks),
  messages: many(messages),
  reviews: many(reviews),
}));

export const channelsRelations = relations(channels, ({ one, many }) => ({
  task: one(tasks, {
    fields: [channels.taskId],
    references: [tasks.id],
  }),
  messages: many(messages),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  assignee: one(agents, {
    fields: [tasks.assigneeId],
    references: [agents.id],
  }),
  channel: one(channels, {
    fields: [tasks.channelId],
    references: [channels.id],
  }),
  parent: one(tasks, {
    fields: [tasks.parentId],
    references: [tasks.id],
    relationName: 'subtasks',
  }),
  subtasks: many(tasks, { relationName: 'subtasks' }),
  messages: many(messages),
  reviews: many(reviews),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  channel: one(channels, {
    fields: [messages.channelId],
    references: [channels.id],
  }),
  sender: one(agents, {
    fields: [messages.senderId],
    references: [agents.id],
  }),
  task: one(tasks, {
    fields: [messages.taskId],
    references: [tasks.id],
  }),
  thread: one(messages, {
    fields: [messages.threadId],
    references: [messages.id],
    relationName: 'replies',
  }),
  replies: many(messages, { relationName: 'replies' }),
  reviews: many(reviews),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  task: one(tasks, {
    fields: [reviews.taskId],
    references: [tasks.id],
  }),
  message: one(messages, {
    fields: [reviews.messageId],
    references: [messages.id],
  }),
  reviewer: one(agents, {
    fields: [reviews.reviewerId],
    references: [agents.id],
  }),
}));

// Type exports
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
