import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
dotenv.config({ path: resolve(PROJECT_ROOT, '.env') });

const envSchema = z.object({
  PORT: z.string().default('3001'),
  DATABASE_URL: z.string().default('postgres://clutch:clutch@localhost:5432/clutch'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLUTCH_SECRET_KEY: z.string().optional(),
  CLUTCH_SECRETS_DIR: z.string().default('workspace/.secrets'),
  CODEX_OAUTH_CLIENT_ID: z.string().optional(),
  CODEX_OAUTH_AUTH_URL: z.string().default('https://auth.openai.com/oauth/authorize'),
  CODEX_OAUTH_TOKEN_URL: z.string().default('https://auth.openai.com/oauth/token'),
  CODEX_OAUTH_REDIRECT_URL: z.string().default('http://127.0.0.1:1455/auth/callback'),
  CODEX_OAUTH_SCOPE: z.string().default('openid profile offline_access'),
});

const env = envSchema.parse(process.env);

export const config = {
  port: parseInt(env.PORT, 10),
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  corsOrigin: env.CORS_ORIGIN,
  logLevel: env.LOG_LEVEL,
  isDev: env.NODE_ENV === 'development',
  isProd: env.NODE_ENV === 'production',
  secretKey: env.CLUTCH_SECRET_KEY,
  secretsDir: env.CLUTCH_SECRETS_DIR,
  codexOauth: {
    clientId: env.CODEX_OAUTH_CLIENT_ID,
    authUrl: env.CODEX_OAUTH_AUTH_URL,
    tokenUrl: env.CODEX_OAUTH_TOKEN_URL,
    redirectUrl: env.CODEX_OAUTH_REDIRECT_URL,
    scope: env.CODEX_OAUTH_SCOPE,
  },
};
