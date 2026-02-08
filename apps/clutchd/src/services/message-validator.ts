import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';

import type { ClutchMessage, ClutchMessageInput } from '@clutch/protocol';
import { createMessage, safeValidateMessage } from '@clutch/protocol';

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

/**
 * Validate a ClutchMessage using the protocol schema
 */
export function validateMessage(message: unknown): ClutchMessage {
  const result = safeValidateMessage(message);

  if (!result.success) {
    const errors: ValidationError[] = result.error.errors.map((err) => ({
      field: err.path.join('.'),
      message: err.message,
    }));
    throw new MessageValidationError(errors);
  }

  return result.data;
}

/**
 * Safely validate a message without throwing
 */
export function safeValidate(message: unknown): { success: true; data: ClutchMessage } | { success: false; errors: ValidationError[] } {
  const result = safeValidateMessage(message);

  if (!result.success) {
    return {
      success: false,
      errors: result.error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      })),
    };
  }

  return { success: true, data: result.data };
}

/**
 * Create a new ClutchMessage with auto-generated fields
 */
export function createClutchMessage(input: ClutchMessageInput): ClutchMessage {
  return createMessage(input);
}

/**
 * Compute SHA-256 hash for artifact content
 */
export function computeArtifactHash(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Verify an artifact's hash against stored content
 */
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

/**
 * Validate artifact attachments in a message
 */
export function validateAttachments(message: ClutchMessage): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!message.attachments) {
    return errors;
  }

  for (let i = 0; i < message.attachments.length; i++) {
    const attachment = message.attachments[i];
    if (!attachment) continue;

    if (attachment.kind === 'artifact_ref') {
      if (!attachment.ref) {
        errors.push({
          field: `attachments[${i}].ref`,
          message: 'Artifact reference is required for artifact_ref kind',
        });
      }
    }

    if (attachment.kind === 'url') {
      if (!attachment.url) {
        errors.push({
          field: `attachments[${i}].url`,
          message: 'URL is required for url kind',
        });
      }
    }
  }

  return errors;
}

/**
 * Check if a message type requires a result payload
 */
export function isResultType(type: string): boolean {
  return type === 'task.result' || type === 'tool.result';
}

/**
 * Check if a message type is an error type
 */
export function isErrorType(type: string): boolean {
  return type === 'task.error' || type === 'tool.error' || type === 'routing.failure';
}

/**
 * Extract cost metadata from message payload or meta
 */
export function extractCostMetadata(message: ClutchMessage): {
  cost?: number;
  runtime?: number;
  tokens?: number;
} {
  const meta = message.meta as Record<string, unknown> | undefined;
  const payload = message.payload as Record<string, unknown> | undefined;

  return {
    cost: (meta?.cost as number) ?? (payload?.cost as number),
    runtime: (meta?.runtime as number) ?? (payload?.runtime as number),
    tokens: (meta?.tokens as number) ?? (payload?.tokens as number),
  };
}

// Re-export protocol types and functions for convenience
export { type ClutchMessage, type ClutchMessageInput } from '@clutch/protocol';
export { createMessage, safeValidateMessage } from '@clutch/protocol';
