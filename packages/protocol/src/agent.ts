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

// =============================================================================
// Agent Organization OS: AgentSpec Extensions
// =============================================================================

/**
 * Agent personality - How the agent behaves and communicates
 */
export const AgentPersonality = z.object({
  // Communication style
  style: z.enum(['analytical', 'creative', 'systematic', 'pragmatic']).optional(),
  communication: z.enum(['concise', 'verbose', 'formal', 'casual']).optional(),
  decision_making: z.enum(['data-driven', 'intuitive', 'consensus-seeking', 'decisive']).optional(),
});

export type AgentPersonality = z.infer<typeof AgentPersonality>;

/**
 * Agent strengths - What this agent excels at (more specific than capabilities)
 */
export const AgentStrength = z.string(); // e.g., "market_analysis", "source_verification"

/**
 * Operating rule - A behavioral constraint or guideline
 */
export const OperatingRule = z.string(); // e.g., "Always cite sources", "Escalate if blocked >1h"

/**
 * Memory configuration for an agent
 */
export const MemoryConfig = z.object({
  // Working memory limit (session-scoped)
  working_limit: z.string().optional(),  // e.g., "50KB"
  // How long to retain daily logs
  daily_retention: z.string().optional(), // e.g., "30d"
  // When to summarize into long-term memory
  long_term_summary: z.enum(['daily', 'weekly', 'on-demand']).optional(),
});

export type MemoryConfig = z.infer<typeof MemoryConfig>;

/**
 * AgentSpec - Extended agent specification for Organization OS
 *
 * Goes beyond capabilities to define personality, strengths, and behavior.
 */
export const AgentSpec = z.object({
  // Personality (how the agent behaves)
  personality: AgentPersonality.optional(),

  // Strengths (what the agent excels at)
  strengths: z.array(AgentStrength).optional(),

  // Operating rules (behavioral constraints)
  operating_rules: z.array(OperatingRule).optional(),

  // Preferred collaborators (who this agent works best with)
  preferred_collaborators: z.array(z.string().startsWith('agent:')).optional(),

  // Memory configuration
  memory: MemoryConfig.optional(),
});

export type AgentSpec = z.infer<typeof AgentSpec>;

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
 *
 * Extended with AgentSpec for Organization OS:
 * - personality: How the agent behaves
 * - strengths: What it excels at
 * - operating_rules: Behavioral constraints
 * - preferred_collaborators: Who it works best with
 * - memory: Memory configuration
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

  // === AgentSpec (Organization OS) ===

  // Personality (how the agent behaves)
  personality: AgentPersonality.optional(),

  // Strengths (what the agent excels at, beyond capabilities)
  strengths: z.array(AgentStrength).optional(),

  // Operating rules (behavioral constraints and guidelines)
  operating_rules: z.array(OperatingRule).optional(),

  // Preferred collaborators
  preferred_collaborators: z.array(z.string().startsWith('agent:')).optional(),

  // Memory configuration
  memory: MemoryConfig.optional(),

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

// =============================================================================
// Strength-based matching utilities (Organization OS)
// =============================================================================

/**
 * Check if an agent has a specific strength
 */
export function hasStrength(card: AgentCard, strength: string): boolean {
  return card.strengths?.includes(strength) ?? false;
}

/**
 * Check if an agent has all required strengths
 */
export function hasAllStrengths(card: AgentCard, requiredStrengths: string[]): boolean {
  if (!card.strengths) return requiredStrengths.length === 0;
  return requiredStrengths.every(s => card.strengths!.includes(s));
}

/**
 * Check if an agent has any of the given strengths
 */
export function hasAnyStrength(card: AgentCard, strengths: string[]): boolean {
  if (!card.strengths) return false;
  return strengths.some(s => card.strengths!.includes(s));
}

/**
 * Score an agent based on strength match
 * Returns a score from 0 to 1
 */
export function scoreStrengthMatch(card: AgentCard, desiredStrengths: string[]): number {
  if (!card.strengths || desiredStrengths.length === 0) return 0;

  const matchCount = desiredStrengths.filter(s => card.strengths!.includes(s)).length;
  return matchCount / desiredStrengths.length;
}

/**
 * Check if an agent is a preferred collaborator for another agent
 */
export function isPreferredCollaborator(card: AgentCard, collaboratorId: string): boolean {
  return card.preferred_collaborators?.includes(collaboratorId) ?? false;
}

/**
 * Get the AgentSpec portion of an AgentCard
 */
export function getAgentSpec(card: AgentCard): AgentSpec {
  return {
    personality: card.personality,
    strengths: card.strengths,
    operating_rules: card.operating_rules,
    preferred_collaborators: card.preferred_collaborators,
    memory: card.memory,
  };
}
