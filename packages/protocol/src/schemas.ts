import { z } from 'zod';

/**
 * Schema Registry - Payload type definitions
 *
 * Defines the structure of `payload` for each `payload_type`.
 * Validation is workflow-scoped, not global.
 */

// Research domain schemas

export const ResearchQueryV1 = z.object({
  query: z.string(),
  scope: z.array(z.string()).optional(),
  max_sources: z.number().int().positive().optional(),
  include_citations: z.boolean().default(true),
});

export type ResearchQueryV1 = z.infer<typeof ResearchQueryV1>;

export const ResearchSummaryV1 = z.object({
  title: z.string(),
  findings: z.array(z.string()),
  citations: z.array(z.string()),
  confidence: z.number().min(0).max(1).optional(),
  methodology: z.string().optional(),
});

export type ResearchSummaryV1 = z.infer<typeof ResearchSummaryV1>;

export const ResearchSourcesV1 = z.object({
  sources: z.array(z.object({
    url: z.string().url(),
    title: z.string(),
    snippet: z.string().optional(),
    relevance_score: z.number().min(0).max(1),
  })),
  total_found: z.number().int().nonnegative(),
});

export type ResearchSourcesV1 = z.infer<typeof ResearchSourcesV1>;

// Code domain schemas

export const CodeOutputV1 = z.object({
  files: z.array(z.object({
    path: z.string(),
    content: z.string(),
    language: z.string(),
    action: z.enum(['create', 'modify', 'delete']),
  })),
  summary: z.string(),
  tests_passed: z.boolean().optional(),
  lint_passed: z.boolean().optional(),
});

export type CodeOutputV1 = z.infer<typeof CodeOutputV1>;

export const CodeReviewV1 = z.object({
  findings: z.array(z.object({
    file: z.string(),
    line: z.number().int().positive().optional(),
    severity: z.enum(['critical', 'major', 'minor', 'suggestion']),
    category: z.enum(['bug', 'security', 'performance', 'style', 'logic']),
    message: z.string(),
    suggestion: z.string().optional(),
  })),
  overall_assessment: z.enum(['approve', 'request_changes', 'comment']),
  summary: z.string(),
  patch_ref: z.string().optional(),
});

export type CodeReviewV1 = z.infer<typeof CodeReviewV1>;

// Review domain schemas

export const ReviewFeedbackV1 = z.object({
  decision: z.enum(['approved', 'rejected', 'needs_revision']),
  comments: z.string(),
  blocking_issues: z.array(z.string()),
  suggestions: z.array(z.string()).optional(),
  score: z.number().min(0).max(10).optional(),
});

export type ReviewFeedbackV1 = z.infer<typeof ReviewFeedbackV1>;

// Planning domain schemas

export const PlanOutlineV1 = z.object({
  title: z.string(),
  objective: z.string(),
  steps: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    agent: z.string().optional(),
    depends_on: z.array(z.string()).optional(),
    estimated_duration: z.string().optional(),
  })),
  success_criteria: z.array(z.string()),
  risks: z.array(z.object({
    description: z.string(),
    mitigation: z.string().optional(),
  })).optional(),
});

export type PlanOutlineV1 = z.infer<typeof PlanOutlineV1>;

// Schema registry

export const PAYLOAD_SCHEMAS = {
  // Research
  'research.query.v1': ResearchQueryV1,
  'research.summary.v1': ResearchSummaryV1,
  'research.sources.v1': ResearchSourcesV1,

  // Code
  'code.output.v1': CodeOutputV1,
  'code.review.v1': CodeReviewV1,

  // Review
  'review.feedback.v1': ReviewFeedbackV1,

  // Planning
  'plan.outline.v1': PlanOutlineV1,
} as const;

export type PayloadType = keyof typeof PAYLOAD_SCHEMAS;

/**
 * Get schema for a payload type
 */
export function getPayloadSchema(payloadType: string): z.ZodType | undefined {
  return PAYLOAD_SCHEMAS[payloadType as PayloadType];
}

/**
 * Validate payload against its schema
 */
export function validatePayload<T extends PayloadType>(
  payloadType: T,
  payload: unknown
): z.infer<typeof PAYLOAD_SCHEMAS[T]> {
  const schema = PAYLOAD_SCHEMAS[payloadType];
  if (!schema) {
    throw new Error(`Unknown payload type: ${payloadType}`);
  }
  return schema.parse(payload);
}

/**
 * Safe payload validation
 */
export function safeValidatePayload<T extends PayloadType>(
  payloadType: T,
  payload: unknown
): z.SafeParseReturnType<unknown, z.infer<typeof PAYLOAD_SCHEMAS[T]>> {
  const schema = PAYLOAD_SCHEMAS[payloadType];
  if (!schema) {
    return {
      success: false,
      error: new z.ZodError([{
        code: 'custom',
        path: ['payload_type'],
        message: `Unknown payload type: ${payloadType}`,
      }]),
    };
  }
  return schema.safeParse(payload);
}

/**
 * Check if a payload type is registered
 */
export function isKnownPayloadType(payloadType: string): payloadType is PayloadType {
  return payloadType in PAYLOAD_SCHEMAS;
}

/**
 * List all registered payload types
 */
export function listPayloadTypes(): PayloadType[] {
  return Object.keys(PAYLOAD_SCHEMAS) as PayloadType[];
}

/**
 * Workflow validation rule
 */
export const WorkflowValidationRule = z.object({
  type: z.string(),
  payload_type: z.string(),
  required: z.array(z.string()),
});

export type WorkflowValidationRule = z.infer<typeof WorkflowValidationRule>;

/**
 * Workflow step expectation
 */
export const WorkflowStepExpectation = z.object({
  step_id: z.string(),
  expects: WorkflowValidationRule,
});

export type WorkflowStepExpectation = z.infer<typeof WorkflowStepExpectation>;
