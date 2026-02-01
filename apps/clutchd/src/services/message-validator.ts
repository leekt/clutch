import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';

export interface MessagePayload {
  type: 'PLAN' | 'PROPOSAL' | 'EXEC_REPORT' | 'REVIEW' | 'BLOCKER';
  summary: string;
  body: string;
  artifacts: Array<{ path: string; hash: string }>;
  citations: string[];
  cost?: string;
  runtime?: number;
  tokens?: number;
}

export interface ValidationError {
  field: string;
  message: string;
}

export class MessageValidationError extends Error {
  constructor(public errors: ValidationError[]) {
    super(`Message validation failed: ${errors.map((e) => e.message).join(', ')}`);
    this.name = 'MessageValidationError';
  }
}

const TYPE_REQUIREMENTS: Record<string, { requiresArtifacts: boolean; requiresCitations: boolean }> = {
  PLAN: { requiresArtifacts: false, requiresCitations: false },
  PROPOSAL: { requiresArtifacts: false, requiresCitations: true },
  EXEC_REPORT: { requiresArtifacts: true, requiresCitations: false },
  REVIEW: { requiresArtifacts: false, requiresCitations: false },
  BLOCKER: { requiresArtifacts: false, requiresCitations: false },
};

export function validateMessage(message: MessagePayload): void {
  const errors: ValidationError[] = [];

  // Required fields
  if (!message.summary || message.summary.trim().length === 0) {
    errors.push({ field: 'summary', message: 'Summary is required' });
  }

  if (!message.body || message.body.trim().length === 0) {
    errors.push({ field: 'body', message: 'Body is required' });
  }

  // Summary length check (should be a brief summary)
  if (message.summary && message.summary.length > 500) {
    errors.push({ field: 'summary', message: 'Summary should be under 500 characters' });
  }

  // Type-specific requirements
  const requirements = TYPE_REQUIREMENTS[message.type];
  if (requirements) {
    if (requirements.requiresArtifacts && (!message.artifacts || message.artifacts.length === 0)) {
      errors.push({ field: 'artifacts', message: `${message.type} messages require at least one artifact` });
    }

    if (requirements.requiresCitations && (!message.citations || message.citations.length === 0)) {
      errors.push({ field: 'citations', message: `${message.type} messages require at least one citation` });
    }
  }

  // Artifact validation
  for (const artifact of message.artifacts || []) {
    if (!artifact.path || artifact.path.trim().length === 0) {
      errors.push({ field: 'artifacts', message: 'Artifact path is required' });
    }
    if (!artifact.hash || artifact.hash.trim().length === 0) {
      errors.push({ field: 'artifacts', message: 'Artifact hash is required' });
    }
    // Validate hash format (SHA-256)
    if (artifact.hash && !/^[a-f0-9]{64}$/i.test(artifact.hash)) {
      errors.push({ field: 'artifacts', message: `Invalid hash format for ${artifact.path}: expected SHA-256` });
    }
  }

  // Cost validation (if provided)
  if (message.cost !== undefined) {
    const cost = parseFloat(message.cost);
    if (isNaN(cost) || cost < 0) {
      errors.push({ field: 'cost', message: 'Cost must be a non-negative number' });
    }
  }

  // Runtime validation (if provided)
  if (message.runtime !== undefined && (message.runtime < 0 || !Number.isInteger(message.runtime))) {
    errors.push({ field: 'runtime', message: 'Runtime must be a non-negative integer (milliseconds)' });
  }

  // Tokens validation (if provided)
  if (message.tokens !== undefined && (message.tokens < 0 || !Number.isInteger(message.tokens))) {
    errors.push({ field: 'tokens', message: 'Tokens must be a non-negative integer' });
  }

  if (errors.length > 0) {
    throw new MessageValidationError(errors);
  }
}

export function computeArtifactHash(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function verifyArtifactHash(
  artifactPath: string,
  expectedHash: string,
  artifactsDir: string = 'artifacts'
): Promise<boolean> {
  try {
    const fullPath = join(artifactsDir, artifactPath);
    const content = await readFile(fullPath);
    const actualHash = computeArtifactHash(content);
    return actualHash.toLowerCase() === expectedHash.toLowerCase();
  } catch {
    return false;
  }
}
