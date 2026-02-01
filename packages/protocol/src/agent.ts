import { z } from 'zod';
import { PROTOCOL_VERSION, TrustLevel, CostHint, NetworkAccess } from './types.js';

/**
 * Agent display information
 */
export const AgentDisplay = z.object({
  name: z.string(),
  desc: z.string().optional(),
  avatar: z.string().url().optional(),
});

export type AgentDisplay = z.infer<typeof AgentDisplay>;

/**
 * Agent endpoint configuration
 */
export const AgentEndpoint = z.object({
  url: z.string().url(),
  auth: z.object({
    type: z.enum(['none', 'bearer', 'api_key']),
    header: z.string().optional(),
  }).optional(),
});

export type AgentEndpoint = z.infer<typeof AgentEndpoint>;

/**
 * Agent endpoints (multiple protocols supported)
 */
export const AgentEndpoints = z.object({
  clutch: AgentEndpoint.optional(),   // Native Clutch protocol
  a2a: AgentEndpoint.optional(),      // Google A2A protocol
  http: AgentEndpoint.optional(),     // Generic HTTP webhook
  websocket: AgentEndpoint.optional(), // WebSocket
});

export type AgentEndpoints = z.infer<typeof AgentEndpoints>;

/**
 * Capability definition
 *
 * Describes what an agent can do.
 */
export const Capability = z.object({
  id: z.string(),                            // e.g., skill:research, tool:mcp
  version: z.string().optional(),            // Semantic version
  tags: z.array(z.string()).optional(),      // Domain tags for matching
  tools: z.array(z.string()).optional(),     // Required MCP servers
  inputs: z.array(z.string()).optional(),    // Input types accepted
  outputs: z.array(z.string()).optional(),   // Output types produced
  trust_level: TrustLevel.optional(),        // sandbox or prod
  cost_hint: CostHint.optional(),            // low, medium, high
  servers: z.array(z.string()).optional(),   // For tool:mcp capabilities
});

export type Capability = z.infer<typeof Capability>;

/**
 * Agent resource limits
 */
export const AgentLimits = z.object({
  max_concurrency: z.number().int().positive(),  // Max concurrent tasks
  max_runtime_sec: z.number().int().positive(),  // Max runtime per task
  max_tokens: z.number().int().positive().optional(),
  max_cost: z.number().positive().optional(),
});

export type AgentLimits = z.infer<typeof AgentLimits>;

/**
 * Agent security configuration
 */
export const AgentSecurity = z.object({
  sandbox: z.boolean(),                      // Run in sandbox by default
  network: NetworkAccess,                    // Network access level
  tool_allowlist: z.array(z.string()).optional(),
  tool_denylist: z.array(z.string()).optional(),
  secret_scopes: z.array(z.string()).optional(), // Allowed secret scopes
});

export type AgentSecurity = z.infer<typeof AgentSecurity>;

/**
 * Agent status
 */
export const AgentStatus = z.enum(['online', 'offline', 'busy', 'degraded']);
export type AgentStatus = z.infer<typeof AgentStatus>;

/**
 * AgentCard - Agent capability advertisement
 *
 * Agents advertise what they can do via an AgentCard.
 * Used for routing, scheduling, and safety checks.
 */
export const AgentCard = z.object({
  // Protocol version
  v: z.literal(PROTOCOL_VERSION),

  // Identity
  agent_id: z.string().startsWith('agent:'),

  // Display
  display: AgentDisplay,

  // Endpoints
  endpoints: AgentEndpoints,

  // Capabilities
  capabilities: z.array(Capability),

  // Limits
  limits: AgentLimits,

  // Security
  security: AgentSecurity,

  // Metadata
  meta: z.record(z.unknown()).optional(),
});

export type AgentCard = z.infer<typeof AgentCard>;

/**
 * Partial AgentCard for registration input
 */
export const AgentCardInput = AgentCard.omit({ v: true }).extend({
  v: z.literal(PROTOCOL_VERSION).optional(),
});

export type AgentCardInput = z.infer<typeof AgentCardInput>;

/**
 * Create an AgentCard with defaults
 */
export function createAgentCard(input: AgentCardInput): AgentCard {
  return {
    v: PROTOCOL_VERSION,
    ...input,
  } as AgentCard;
}

/**
 * Validate an AgentCard
 */
export function validateAgentCard(card: unknown): AgentCard {
  return AgentCard.parse(card);
}

/**
 * Safe validation that returns a result object
 */
export function safeValidateAgentCard(card: unknown): z.SafeParseReturnType<unknown, AgentCard> {
  return AgentCard.safeParse(card);
}

/**
 * Agent registration message payload
 */
export const AgentRegisterPayload = z.object({
  card: AgentCard,
  status: AgentStatus.optional(),
});

export type AgentRegisterPayload = z.infer<typeof AgentRegisterPayload>;

/**
 * Agent heartbeat message payload
 */
export const AgentHeartbeatPayload = z.object({
  status: AgentStatus,
  current_tasks: z.number().int().nonnegative(),
  metrics: z.object({
    tasks_completed: z.number().int().nonnegative().optional(),
    tasks_failed: z.number().int().nonnegative().optional(),
    avg_runtime_ms: z.number().nonnegative().optional(),
    total_cost: z.number().nonnegative().optional(),
  }).optional(),
});

export type AgentHeartbeatPayload = z.infer<typeof AgentHeartbeatPayload>;

/**
 * Agent update message payload
 */
export const AgentUpdatePayload = z.object({
  capabilities: z.array(Capability).optional(),
  limits: AgentLimits.partial().optional(),
  status: AgentStatus.optional(),
});

export type AgentUpdatePayload = z.infer<typeof AgentUpdatePayload>;

// Capability matching utilities

/**
 * Check if an agent has a specific capability
 */
export function hasCapability(card: AgentCard, capabilityId: string): boolean {
  return card.capabilities.some(cap => cap.id === capabilityId);
}

/**
 * Check if an agent has all required capabilities
 */
export function hasAllCapabilities(card: AgentCard, requiredIds: string[]): boolean {
  return requiredIds.every(id => hasCapability(card, id));
}

/**
 * Get capabilities by prefix (e.g., 'skill:', 'tool:')
 */
export function getCapabilitiesByPrefix(card: AgentCard, prefix: string): Capability[] {
  return card.capabilities.filter(cap => cap.id.startsWith(prefix));
}

/**
 * Get capabilities matching any of the given tags
 */
export function getCapabilitiesByTags(card: AgentCard, tags: string[]): Capability[] {
  return card.capabilities.filter(cap =>
    cap.tags?.some(tag => tags.includes(tag))
  );
}

/**
 * Check if agent can handle the given tool
 */
export function canUseTool(card: AgentCard, toolId: string): boolean {
  // Check if tool is in allowlist (if specified)
  if (card.security.tool_allowlist && !card.security.tool_allowlist.includes(toolId)) {
    return false;
  }

  // Check if tool is in denylist
  if (card.security.tool_denylist?.includes(toolId)) {
    return false;
  }

  // Check if any capability provides this tool
  return card.capabilities.some(cap =>
    cap.tools?.includes(toolId) || cap.servers?.includes(toolId)
  );
}
