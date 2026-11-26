import { z } from 'zod';

export const PORT_SCHEMA = z.number().int().positive().max(65535);

export const PORT_ENV_SCHEMA = z
  .string()
  .min(1)
  .regex(/^\d+$/, 'PORT must be an integer')
  .transform((raw) => Number.parseInt(raw, 10))
  .pipe(PORT_SCHEMA);

export const hostSchema = z.string().min(1).default('0.0.0.0');

export type AppEnv = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
};

export const APP_ENV_SCHEMA = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: hostSchema,
  PORT: PORT_ENV_SCHEMA.default(3000),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
});

export type AppEnvInput = z.input<typeof APP_ENV_SCHEMA>;

export function parseAppEnv(raw: unknown): AppEnv {
  const parsed = APP_ENV_SCHEMA.parse(raw);
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
  };
}

export function isAppEnv(raw: unknown): raw is AppEnvInput {
  return APP_ENV_SCHEMA.safeParse(raw).success;
}
