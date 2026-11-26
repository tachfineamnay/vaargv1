import type { AppEnv } from '@vaarg/shared';
import { parseAppEnv } from '@vaarg/shared';

export interface ApiConfiguration {
  app: AppEnv;
  database: {
    url: string;
    readinessTimeoutMs: number;
  };
  valkey: {
    url: string;
    readinessTimeoutMs: number;
    keyPrefix: string;
  };
}

export function loadApiConfiguration(env: NodeJS.ProcessEnv = process.env): ApiConfiguration {
  const databaseUrl = env.DATABASE_URL;
  const valkeyUrl = env.VALKEY_URL;

  return {
    app: parseAppEnv({
      NODE_ENV: env.NODE_ENV,
      HOST: env.HOST,
      PORT: env.PORT,
      LOG_LEVEL: env.LOG_LEVEL,
    }),
    database: {
      url: requireEnv(databaseUrl, 'DATABASE_URL'),
      readinessTimeoutMs: readTimeout(env.DATABASE_READINESS_TIMEOUT_MS, 1500),
    },
    valkey: {
      url: requireEnv(valkeyUrl, 'VALKEY_URL'),
      readinessTimeoutMs: readTimeout(env.VALKEY_READINESS_TIMEOUT_MS, 1000),
      keyPrefix: env.VALKEY_KEY_PREFIX ?? 'vaarg:',
    },
  };
}

function requireEnv(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readTimeout(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
