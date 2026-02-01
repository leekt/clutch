import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  pgEnum,
  uuid,
  decimal,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums aligned with Clutch Protocol

// Agent roles (extensible)
export const agentRoleEnum = pgEnum('agent_role', ['pm', 'research', 'marketing', 'developer', 'qa']);

// Task states (workflow lifecycle)
export const taskStateEnum = pgEnum('task_state', ['created', 'assigned', 'running', 'review', 'rework', 'done', 'cancelled', 'failed']);

// Message types from Clutch Protocol
export const messageTypeEnum = pgEnum('message_type', [
  // Task lifecycle
  'task.request',
  'task.accept',
  'task.progress',
  'task.result',
  'task.error',
  'task.cancel',
  'task.timeout',
  // Conversation
  'chat.message',
  'chat.system',
  // Tooling
  'tool.call',
  'tool.result',
  'tool.error',
  // Agent lifecycle
  'agent.register',
  'agent.heartbeat',
  'agent.update',
  // Routing
  'routing.decision',
  'routing.failure',
]);

// Domains from Clutch Protocol
export const domainEnum = pgEnum('domain', [
  'research',
  'code',
  'code_review',
  'planning',
  'review',
  'ops',
  'security',
  'marketing',
]);

// Channel types
export const channelTypeEnum = pgEnum('channel_type', ['task', 'department']);

// Review statuses
export const reviewStatusEnum = pgEnum('review_status', ['pending', 'approved', 'rejected']);

// Trust levels
export const trustLevelEnum = pgEnum('trust_level', ['sandbox', 'prod']);

// Agents table - represents AI workers with roles and capabilities
export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: text('agent_id').notNull().unique(), // agent:<name> format
  name: text('name').notNull(),
  role: agentRoleEnum('role').notNull(),
  description: text('description'),
  version: text('version').default('1.0.0'),
  image: text('image'), // Docker image

  // Endpoints
  endpoints: jsonb('endpoints').$type<{
    a2a?: string;
    clutch?: string;
  }>().default({}),

  // Capabilities (from AgentCard)
  capabilities: jsonb('capabilities').$type<Array<{
    id: string;
    version: string;
    tags?: string[];
  }>>().default([]),

  // Tools available to this agent
  tools: jsonb('tools').$type<string[]>().default([]),

  // Permissions
  permissions: jsonb('permissions').$type<{
    file: boolean;
    shell: boolean;
    git: boolean;
    browser: boolean;
  }>().notNull(),

  // Budget limits
  budget: jsonb('budget').$type<{
    maxTokens?: number;
    maxCost?: number;
    maxRuntime?: number;
  }>().notNull(),

  // Security
  trustLevel: trustLevelEnum('trust_level').default('sandbox'),
  secrets: jsonb('secrets').$type<string[]>().default([]),

  // Limits
  maxConcurrency: integer('max_concurrency').default(1),

  // Runtime state
  status: text('status').$type<'available' | 'busy' | 'offline'>().default('offline'),
  lastHeartbeat: timestamp('last_heartbeat'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Tasks table - units of work with hierarchy support
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: text('task_id').notNull().unique(), // task_<ulid> format

  // Task hierarchy (Clutch Protocol)
  runId: text('run_id').notNull(), // Top-level execution context
  parentTaskId: text('parent_task_id'), // Parent task for subtasks

  // Core fields
  title: text('title').notNull(),
  description: text('description'),

  // State machine
  state: taskStateEnum('state').default('created').notNull(),

  // Workflow tracking
  workflowId: text('workflow_id'),
  workflowStepId: text('workflow_step_id'),

  // Assignment
  assigneeId: uuid('assignee_id'),

  // Channel association
  channelId: uuid('channel_id'),

  // Constraints
  constraints: jsonb('constraints').$type<{
    maxTokens?: number;
    maxRuntimeSec?: number;
    maxCost?: number;
  }>().default({}),

  // Results
  output: jsonb('output').$type<unknown>(),
  error: jsonb('error').$type<{
    code: string;
    message: string;
    retryable: boolean;
  }>(),

  // Metadata
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
}, (table) => [
  index('tasks_run_id_idx').on(table.runId),
  index('tasks_parent_task_id_idx').on(table.parentTaskId),
  index('tasks_state_idx').on(table.state),
]);

// Channels table - Slack-like workspaces
export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: channelTypeEnum('type').notNull(),
  description: text('description'),
  taskId: uuid('task_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Messages table - ClutchMessage storage (append-only event store)
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Protocol version
  version: text('version').default('clutch/0.1').notNull(),

  // Core identifiers
  messageId: text('message_id').notNull().unique(), // msg_<ulid> format

  // Task hierarchy
  threadId: text('thread_id').notNull(),
  runId: text('run_id').notNull(),
  taskId: text('task_id').notNull(),
  parentTaskId: text('parent_task_id'),

  // Distributed tracing
  traceId: text('trace_id'),
  spanId: text('span_id'),

  // Addressing
  fromAgentId: text('from_agent_id').notNull(),
  toAgentIds: jsonb('to_agent_ids').$type<string[]>().notNull(),

  // Type system
  type: messageTypeEnum('type').notNull(),
  domain: domainEnum('domain'),
  payloadType: text('payload_type'), // e.g., 'research.summary.v1'
  schemaRef: text('schema_ref'), // e.g., 'schema://clutch/research.summary.v1'

  // Content
  payload: jsonb('payload').$type<unknown>().notNull(),

  // Capability routing
  requires: jsonb('requires').$type<string[]>().default([]),
  prefers: jsonb('prefers').$type<string[]>().default([]),

  // Attachments
  attachments: jsonb('attachments').$type<Array<{
    kind: 'artifact_ref' | 'inline' | 'url';
    ref?: string;
    content?: unknown;
    url?: string;
    mimeType?: string;
  }>>().default([]),

  // Delivery
  idempotencyKey: text('idempotency_key'),
  attempt: integer('attempt').default(1),

  // Framework metadata
  meta: jsonb('meta').$type<Record<string, unknown>>().default({}),

  // Channel association (for UI grouping)
  channelId: uuid('channel_id'),

  // Cost tracking
  cost: decimal('cost', { precision: 10, scale: 4 }).default('0'),
  runtime: integer('runtime').default(0), // milliseconds
  tokens: integer('tokens').default(0),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('messages_thread_id_idx').on(table.threadId),
  index('messages_run_id_idx').on(table.runId),
  index('messages_task_id_idx').on(table.taskId),
  index('messages_from_agent_id_idx').on(table.fromAgentId),
  index('messages_type_idx').on(table.type),
  index('messages_idempotency_key_idx').on(table.idempotencyKey),
]);

// Reviews table - quality gates between agents
export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: text('task_id').notNull(),
  messageId: text('message_id').notNull(),
  reviewerId: text('reviewer_id').notNull(), // agent:<name>
  status: reviewStatusEnum('status').default('pending').notNull(),
  comments: text('comments'),

  // Review result payload
  feedback: jsonb('feedback').$type<{
    approved: boolean;
    score?: number;
    issues?: Array<{ type: string; message: string; severity: string }>;
    suggestions?: string[];
  }>(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Audit logs table - complete action history
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Action details
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(), // 'task', 'message', 'agent', etc.
  entityId: text('entity_id').notNull(),

  // Actor
  agentId: text('agent_id'),
  userId: text('user_id'), // for human actions

  // Context
  runId: text('run_id'),
  taskId: text('task_id'),

  // Details
  details: jsonb('details').$type<Record<string, unknown>>().default({}),

  // Cost tracking
  cost: decimal('cost', { precision: 10, scale: 4 }),
  runtime: integer('runtime'),
  tokens: integer('tokens'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('audit_logs_run_id_idx').on(table.runId),
  index('audit_logs_task_id_idx').on(table.taskId),
  index('audit_logs_agent_id_idx').on(table.agentId),
]);

// Artifacts table - content-addressed storage
export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  artifactId: text('artifact_id').notNull().unique(), // artifact:<hash>

  // Content hash (SHA-256)
  hash: text('hash').notNull().unique(),

  // Metadata
  path: text('path').notNull(),
  mimeType: text('mime_type'),
  size: integer('size').notNull(),

  // Association
  messageId: text('message_id'),
  taskId: text('task_id'),
  agentId: text('agent_id'),

  // Storage
  storagePath: text('storage_path').notNull(), // Local path in artifacts/

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('artifacts_hash_idx').on(table.hash),
  index('artifacts_task_id_idx').on(table.taskId),
]);

// Relations
export const agentsRelations = relations(agents, ({ many }) => ({
  tasks: many(tasks),
}));

export const channelsRelations = relations(channels, ({ many }) => ({
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
  reviews: many(reviews),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  channel: one(channels, {
    fields: [messages.channelId],
    references: [channels.id],
  }),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  task: one(tasks, {
    fields: [reviews.taskId],
    references: [tasks.taskId],
  }),
  message: one(messages, {
    fields: [reviews.messageId],
    references: [messages.messageId],
  }),
}));

export const artifactsRelations = relations(artifacts, ({ one }) => ({
  message: one(messages, {
    fields: [artifacts.messageId],
    references: [messages.messageId],
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
export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
