import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  APP_VERSION: z.string().default('0.0.0'),
  GIT_COMMIT: z.string().default('unknown'),

  VALKEY_URL: z.string().url().default('redis://localhost:6379'),

  DATABASE_URL: z.string().url().optional(),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  WORKER_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  WORKER_BACKOFF_MS: z.coerce.number().int().positive().default(5000),
});

export const config = EnvSchema.parse(process.env);
