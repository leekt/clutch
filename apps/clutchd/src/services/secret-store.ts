import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { config } from '../config.js';
import { logger } from '../logger.js';

interface StoredSecret {
  id: string;
  name?: string;
  iv: string;
  tag: string;
  data: string;
  createdAt: string;
}

function getKey(): Buffer {
  const raw = config.secretKey;
  if (!raw) {
    throw new Error('CLUTCH_SECRET_KEY is required to use the secrets store');
  }

  const hexKey = /^[0-9a-fA-F]{64}$/;
  if (hexKey.test(raw)) {
    return Buffer.from(raw, 'hex');
  }

  return Buffer.from(raw, 'base64');
}

function ensureKeyLength(key: Buffer): Buffer {
  if (key.length === 32) return key;
  throw new Error('CLUTCH_SECRET_KEY must be 32 bytes (base64 or hex-encoded)');
}

class SecretStore {
  private legacySecretsDir: string;

  constructor() {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const projectRoot = resolve(__dirname, '..', '..', '..');
    this.legacySecretsDir = resolve(projectRoot, 'workspace', '.secrets');
  }

  private async ensureDir(): Promise<string> {
    const dir = path.resolve(config.secretsDir);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  private getSecretPath(id: string): string {
    return path.resolve(config.secretsDir, `${id}.json`);
  }

  private getLegacySecretPath(id: string): string {
    return path.resolve(this.legacySecretsDir, `${id}.json`);
  }

  async createSecret(value: string, name?: string): Promise<string> {
    const key = ensureKeyLength(getKey());
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);

    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    const id = `secret_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
    const record: StoredSecret = {
      id,
      name,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: encrypted.toString('base64'),
      createdAt: new Date().toISOString(),
    };

    const dir = await this.ensureDir();
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(record, null, 2), 'utf8');
    logger.info({ id, name }, 'Secret stored');

    return id;
  }

  async getSecret(id: string): Promise<string> {
    const key = ensureKeyLength(getKey());
    let raw: string;
    try {
      raw = await fs.readFile(this.getSecretPath(id), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      raw = await fs.readFile(this.getLegacySecretPath(id), 'utf8');
      logger.warn({ id }, 'Secret read from legacy secrets directory');
    }
    const record = JSON.parse(raw) as StoredSecret;

    const iv = Buffer.from(record.iv, 'base64');
    const tag = Buffer.from(record.tag, 'base64');
    const encrypted = Buffer.from(record.data, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }

  async resolveEnvSecrets(envSecrets?: Record<string, string>): Promise<Record<string, string>> {
    if (!envSecrets) return {};
    const entries = await Promise.all(
      Object.entries(envSecrets).map(async ([key, secretId]) => [key, await this.getSecret(secretId)] as const)
    );
    return Object.fromEntries(entries);
  }
}

export const secretStore = new SecretStore();
