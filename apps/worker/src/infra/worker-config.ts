import { parseAppEnv, type AppEnv } from '@vaarg/shared';

export interface WorkerConfiguration {
  app: AppEnv;
  database: {
    url: string;
    readinessTimeoutMs: number;
  };
  valkey: {
    url: string;
    readinessTimeoutMs: number;
    keyPrefix: string;
    pollIntervalMs: number;
  };
  hatchet: {
    url: string | undefined;
    token: string | undefined;
    enabled: boolean;
  };
}

export function loadWorkerConfiguration(env: NodeJS.ProcessEnv = process.env): WorkerConfiguration {
  return {
    app: parseAppEnv({
      NODE_ENV: env.NODE_ENV,
      HOST: env.HOST,
      PORT: env.PORT,
      LOG_LEVEL: env.LOG_LEVEL,
    }),
    database: {
      url: requireEnv(env.DATABASE_URL, 'DATABASE_URL'),
      readinessTimeoutMs: readPositiveInt(env.DATABASE_READINESS_TIMEOUT_MS, 1500),
    },
    valkey: {
      url: requireEnv(env.VALKEY_URL, 'VALKEY_URL'),
      readinessTimeoutMs: readPositiveInt(env.VALKEY_READINESS_TIMEOUT_MS, 1000),
      keyPrefix: env.VALKEY_KEY_PREFIX ?? 'vaarg:',
      pollIntervalMs: readPositiveInt(env.WORKER_POLL_INTERVAL_MS, 5000),
    },
    hatchet: {
      url: env.HATCHET_URL,
      token: env.HATCHET_TOKEN,
      enabled: env.HATCHET_ENABLED === 'true',
    },
  };
}

function requireEnv(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
