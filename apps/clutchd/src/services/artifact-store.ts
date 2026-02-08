import { createHash } from 'crypto';
import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { artifactRepository } from '../repositories/index.js';
import { logger } from '../logger.js';
import type { Artifact } from '../db/schema.js';

/**
 * Content-addressed artifact storage
 *
 * Stores files by their SHA-256 hash, ensuring deduplication and immutability.
 */
export interface ArtifactStore {
  /**
   * Store content and return the artifact record
   */
  store(content: Buffer | string, options: StoreOptions): Promise<Artifact>;

  /**
   * Get content by artifact ID
   */
  get(artifactId: string): Promise<Buffer | null>;

  /**
   * Get content by hash
   */
  getByHash(hash: string): Promise<Buffer | null>;

  /**
   * Check if an artifact exists
   */
  exists(hash: string): Promise<boolean>;

  /**
   * Get artifact metadata
   */
  getMetadata(artifactId: string): Promise<Artifact | null>;

  /**
   * List artifacts for a task
   */
  listByTask(taskId: string): Promise<Artifact[]>;

  /**
   * List artifacts for a message
   */
  listByMessage(messageId: string): Promise<Artifact[]>;

  /**
   * Verify artifact integrity
   */
  verify(artifactId: string): Promise<boolean>;

  /**
   * Delete an artifact (marks as deleted, doesn't remove content if referenced)
   */
  delete(artifactId: string): Promise<boolean>;
}

export interface StoreOptions {
  path: string;           // Original file path/name
  mimeType?: string;      // MIME type
  messageId?: string;     // Associated message
  taskId?: string;        // Associated task
  agentId?: string;       // Agent that created it
}

/**
 * Generate artifact ID from hash
 */
function generateArtifactId(hash: string): string {
  return `artifact:${hash.substring(0, 16)}`;
}

/**
 * Compute SHA-256 hash of content
 */
export function computeHash(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * File-based artifact store implementation
 */
export class FileArtifactStore implements ArtifactStore {
  private baseDir: string;

  constructor(baseDir: string = 'artifacts') {
    this.baseDir = baseDir;
  }

  /**
   * Get storage path for a hash
   */
  private getStoragePath(hash: string): string {
    // Use first 2 chars for directory sharding
    const dir = hash.substring(0, 2);
    return join(this.baseDir, dir, hash);
  }

  async store(content: Buffer | string, options: StoreOptions): Promise<Artifact> {
    const buffer = typeof content === 'string' ? Buffer.from(content) : content;
    const hash = computeHash(buffer);

    // Check if already exists
    const existing = await artifactRepository.findByHash(hash);
    if (existing) {
      logger.debug({ hash, artifactId: existing.artifactId }, 'Artifact already exists');
      return existing;
    }

    // Create storage path
    const storagePath = this.getStoragePath(hash);
    const storageDir = dirname(storagePath);

    // Ensure directory exists
    await mkdir(storageDir, { recursive: true });

    // Write content
    await writeFile(storagePath, buffer);

    // Create database record
    const artifactId = generateArtifactId(hash);
    const artifact = await artifactRepository.create({
      artifactId,
      hash,
      path: options.path,
      mimeType: options.mimeType ?? this.guessMimeType(options.path),
      size: buffer.length,
      messageId: options.messageId ?? null,
      taskId: options.taskId ?? null,
      agentId: options.agentId ?? null,
      storagePath,
    });

    logger.info({
      artifactId,
      hash,
      size: buffer.length,
      path: options.path,
    }, 'Artifact stored');

    return artifact;
  }

  async get(artifactId: string): Promise<Buffer | null> {
    const artifact = await artifactRepository.findByArtifactId(artifactId);
    if (!artifact) return null;

    return this.getByHash(artifact.hash);
  }

  async getByHash(hash: string): Promise<Buffer | null> {
    const storagePath = this.getStoragePath(hash);

    try {
      return await readFile(storagePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async exists(hash: string): Promise<boolean> {
    return artifactRepository.exists(hash);
  }

  async getMetadata(artifactId: string): Promise<Artifact | null> {
    const artifact = await artifactRepository.findByArtifactId(artifactId);
    return artifact ?? null;
  }

  async listByTask(taskId: string): Promise<Artifact[]> {
    return artifactRepository.findByTaskId(taskId);
  }

  async listByMessage(messageId: string): Promise<Artifact[]> {
    return artifactRepository.findByMessageId(messageId);
  }

  async verify(artifactId: string): Promise<boolean> {
    const artifact = await artifactRepository.findByArtifactId(artifactId);
    if (!artifact) return false;

    const content = await this.getByHash(artifact.hash);
    if (!content) return false;

    const actualHash = computeHash(content);
    const isValid = actualHash === artifact.hash;

    if (!isValid) {
      logger.warn({
        artifactId,
        expectedHash: artifact.hash,
        actualHash,
      }, 'Artifact integrity check failed');
    }

    return isValid;
  }

  async delete(artifactId: string): Promise<boolean> {
    const artifact = await artifactRepository.findByArtifactId(artifactId);
    if (!artifact) return false;

    // Check if any other artifacts reference this hash
    const othersWithSameHash = await artifactRepository.findByHash(artifact.hash);
    if (!othersWithSameHash) {
      // Safe to delete the actual file
      try {
        await unlink(artifact.storagePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    }

    // Delete database record
    return artifactRepository.delete(artifact.id);
  }

  /**
   * Guess MIME type from file extension
   */
  private guessMimeType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();

    const mimeTypes: Record<string, string> = {
      // Text
      txt: 'text/plain',
      md: 'text/markdown',
      json: 'application/json',
      yaml: 'text/yaml',
      yml: 'text/yaml',
      xml: 'application/xml',
      html: 'text/html',
      css: 'text/css',
      csv: 'text/csv',

      // Code
      js: 'text/javascript',
      ts: 'text/typescript',
      jsx: 'text/javascript',
      tsx: 'text/typescript',
      py: 'text/x-python',
      rb: 'text/x-ruby',
      go: 'text/x-go',
      rs: 'text/x-rust',
      java: 'text/x-java',
      c: 'text/x-c',
      cpp: 'text/x-c++',
      h: 'text/x-c',
      hpp: 'text/x-c++',
      sh: 'text/x-shellscript',

      // Images
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',

      // Documents
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

      // Archives
      zip: 'application/zip',
      tar: 'application/x-tar',
      gz: 'application/gzip',

      // Other
      wasm: 'application/wasm',
    };

    return mimeTypes[ext ?? ''] ?? 'application/octet-stream';
  }
}

// Singleton instance
export const artifactStore = new FileArtifactStore('artifacts');
