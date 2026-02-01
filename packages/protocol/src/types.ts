import { z } from 'zod';

// Protocol version
export const PROTOCOL_VERSION = 'clutch/0.1';

// ID prefixes
export const ID_PREFIXES = {
  message: 'msg_',
  thread: 'thr_',
  run: 'run_',
  task: 'task_',
  agent: 'agent:',
  group: 'group:',
  artifact: 'artifact:',
  schema: 'schema://',
  skill: 'skill:',
  tool: 'tool:',
  mcp: 'mcp:',
} as const;

// Message types - Task lifecycle
export const TaskMessageType = z.enum([
  'task.request',
  'task.accept',
  'task.progress',
  'task.result',
  'task.error',
  'task.cancel',
  'task.timeout',
]);

// Message types - Conversation
export const ChatMessageType = z.enum([
  'chat.message',
  'chat.system',
]);

// Message types - Tooling / MCP
export const ToolMessageType = z.enum([
  'tool.call',
  'tool.result',
  'tool.error',
]);

// Message types - Agent lifecycle
export const AgentMessageType = z.enum([
  'agent.register',
  'agent.heartbeat',
  'agent.update',
]);

// Message types - Routing (internal)
export const RoutingMessageType = z.enum([
  'routing.decision',
  'routing.failure',
]);

// All message types
export const MessageType = z.enum([
  // Task
  'task.request',
  'task.accept',
  'task.progress',
  'task.result',
  'task.error',
  'task.cancel',
  'task.timeout',
  // Chat
  'chat.message',
  'chat.system',
  // Tool
  'tool.call',
  'tool.result',
  'tool.error',
  // Agent
  'agent.register',
  'agent.heartbeat',
  'agent.update',
  // Routing
  'routing.decision',
  'routing.failure',
]);

export type MessageType = z.infer<typeof MessageType>;

// Domains
export const Domain = z.enum([
  'research',
  'code',
  'code_review',
  'planning',
  'review',
  'ops',
  'security',
  'marketing',
]);

export type Domain = z.infer<typeof Domain>;

// Trust levels
export const TrustLevel = z.enum(['sandbox', 'prod']);
export type TrustLevel = z.infer<typeof TrustLevel>;

// Cost hints
export const CostHint = z.enum(['low', 'medium', 'high']);
export type CostHint = z.infer<typeof CostHint>;

// Network access levels
export const NetworkAccess = z.enum(['none', 'egress-restricted', 'egress-allowed']);
export type NetworkAccess = z.infer<typeof NetworkAccess>;

// Trace context
export const TraceContext = z.object({
  trace_id: z.string(),
  span_id: z.string(),
});

export type TraceContext = z.infer<typeof TraceContext>;

// Agent identity
export const AgentIdentity = z.object({
  agent_id: z.string().startsWith('agent:'),
  role: z.string().optional(),
});

export type AgentIdentity = z.infer<typeof AgentIdentity>;

// Recipient
export const Recipient = z.object({
  agent_id: z.string(), // Can be agent: or group:
});

export type Recipient = z.infer<typeof Recipient>;

// Attachment
export const Attachment = z.object({
  kind: z.enum(['artifact_ref', 'inline', 'url']),
  ref: z.string().optional(),
  content: z.unknown().optional(),
  url: z.string().url().optional(),
  mime_type: z.string().optional(),
});

export type Attachment = z.infer<typeof Attachment>;

// Security - Auth
export const AuthInfo = z.object({
  scheme: z.string(), // e.g., 'ed25519'
  kid: z.string(),    // Key ID
  sig: z.string(),    // Signature
});

export type AuthInfo = z.infer<typeof AuthInfo>;

// Security - Policy
export const SecurityPolicy = z.object({
  sandbox: z.boolean(),
  tool_allowlist: z.array(z.string()).optional(),
  network: NetworkAccess.optional(),
});

export type SecurityPolicy = z.infer<typeof SecurityPolicy>;

// Security envelope
export const Security = z.object({
  auth: AuthInfo.optional(),
  policy: SecurityPolicy.optional(),
});

export type Security = z.infer<typeof Security>;

// Error payload
export const ErrorPayload = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.unknown()).optional(),
});

export type ErrorPayload = z.infer<typeof ErrorPayload>;

// Routing decision payload
export const RoutingDecisionPayload = z.object({
  selected: z.string(),
  candidates: z.array(z.string()),
  reason: z.string(),
  scores: z.record(z.number()).optional(),
});

export type RoutingDecisionPayload = z.infer<typeof RoutingDecisionPayload>;

// ID generators
export function generateId(prefix: keyof typeof ID_PREFIXES): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${ID_PREFIXES[prefix]}${timestamp}${random}`;
}

export function generateMessageId(): string {
  return generateId('message');
}

export function generateThreadId(): string {
  return generateId('thread');
}

export function generateRunId(): string {
  return generateId('run');
}

export function generateTaskId(): string {
  return generateId('task');
}
