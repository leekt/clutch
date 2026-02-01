import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('3001'),
  DATABASE_URL: z.string().default('postgres://clutch:clutch@localhost:5432/clutch'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
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
};
