import { z } from 'zod';
import {
  PROTOCOL_VERSION,
  MessageType,
  Domain,
  TraceContext,
  AgentIdentity,
  Recipient,
  Attachment,
  Security,
  generateMessageId,
} from './types.js';

/**
 * ClutchMessage - The universal message envelope
 *
 * All communication in Clutch is wrapped in this envelope.
 * Inbound messages from any protocol (A2A, MCP, HTTP) are normalized into this format.
 */
export const ClutchMessage = z.object({
  // Protocol version
  v: z.literal(PROTOCOL_VERSION),

  // Core identifiers
  id: z.string(),                              // Unique message ID (for deduplication)
  ts: z.string().datetime(),                   // ISO 8601 timestamp

  // Task hierarchy
  thread_id: z.string(),                       // Conversational context (UI grouping)
  run_id: z.string(),                          // Top-level execution context
  task_id: z.string(),                         // Individual unit of work
  parent_task_id: z.string().nullable(),       // Parent task (enables task trees)

  // Distributed tracing
  trace: TraceContext.optional(),

  // Addressing
  from: AgentIdentity,                         // Sender identity
  to: z.array(Recipient),                      // Recipient(s)

  // Type system
  type: MessageType,                           // Message type (lifecycle event)
  domain: Domain.optional(),                   // Problem space
  payload_type: z.string().optional(),         // Structured contract ID (e.g., research.summary.v1)
  schema_ref: z.string().optional(),           // Canonical schema reference

  // Content
  payload: z.unknown(),                        // Type-specific content

  // Capability routing
  requires: z.array(z.string()).optional(),    // Required capabilities (AND semantics)
  prefers: z.array(z.string()).optional(),     // Preferred capabilities (weighted match)

  // Security
  security: Security.optional(),

  // Attachments
  attachments: z.array(Attachment).optional(),

  // Delivery
  idempotency_key: z.string().optional(),      // Client-provided dedup key
  attempt: z.number().int().positive().default(1), // Retry attempt number

  // Framework metadata
  meta: z.record(z.unknown()).optional(),
});

export type ClutchMessage = z.infer<typeof ClutchMessage>;

/**
 * Partial message for creation (without auto-generated fields)
 */
export const ClutchMessageInput = ClutchMessage.omit({
  v: true,
  id: true,
  ts: true,
  attempt: true,
}).extend({
  v: z.literal(PROTOCOL_VERSION).optional(),
  id: z.string().optional(),
  ts: z.string().datetime().optional(),
  attempt: z.number().int().positive().optional(),
});

export type ClutchMessageInput = z.infer<typeof ClutchMessageInput>;

/**
 * Create a new ClutchMessage with auto-generated fields
 */
export function createMessage(input: ClutchMessageInput): ClutchMessage {
  return {
    v: PROTOCOL_VERSION,
    id: input.id ?? generateMessageId(),
    ts: input.ts ?? new Date().toISOString(),
    attempt: input.attempt ?? 1,
    ...input,
    parent_task_id: input.parent_task_id ?? null,
  } as ClutchMessage;
}

/**
 * Validate a message against the schema
 */
export function validateMessage(message: unknown): ClutchMessage {
  return ClutchMessage.parse(message);
}

/**
 * Safe validation that returns a result object
 */
export function safeValidateMessage(message: unknown): z.SafeParseReturnType<unknown, ClutchMessage> {
  return ClutchMessage.safeParse(message);
}

// Type guards for specific message types
export function isTaskMessage(msg: ClutchMessage): boolean {
  return msg.type.startsWith('task.');
}

export function isChatMessage(msg: ClutchMessage): boolean {
  return msg.type.startsWith('chat.');
}

export function isToolMessage(msg: ClutchMessage): boolean {
  return msg.type.startsWith('tool.');
}

export function isAgentMessage(msg: ClutchMessage): boolean {
  return msg.type.startsWith('agent.');
}

export function isRoutingMessage(msg: ClutchMessage): boolean {
  return msg.type.startsWith('routing.');
}

export function isErrorMessage(msg: ClutchMessage): boolean {
  return msg.type === 'task.error' || msg.type === 'tool.error';
}

// Specific message type schemas for payload validation

export const TaskRequestPayload = z.object({
  title: z.string(),
  description: z.string().optional(),
  input: z.record(z.unknown()).optional(),
  constraints: z.object({
    max_tokens: z.number().optional(),
    max_runtime_sec: z.number().optional(),
    max_cost: z.number().optional(),
  }).optional(),
});

export type TaskRequestPayload = z.infer<typeof TaskRequestPayload>;

export const TaskProgressPayload = z.object({
  status: z.string(),
  progress: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
});

export type TaskProgressPayload = z.infer<typeof TaskProgressPayload>;

export const TaskResultPayload = z.object({
  success: z.boolean(),
  output: z.unknown(),
  summary: z.string().optional(),
});

export type TaskResultPayload = z.infer<typeof TaskResultPayload>;

export const ToolCallPayload = z.object({
  tool: z.string(),
  method: z.string().optional(),
  args: z.record(z.unknown()),
});

export type ToolCallPayload = z.infer<typeof ToolCallPayload>;

export const ToolResultPayload = z.object({
  tool: z.string(),
  success: z.boolean(),
  result: z.unknown(),
  error: z.string().optional(),
});

export type ToolResultPayload = z.infer<typeof ToolResultPayload>;
