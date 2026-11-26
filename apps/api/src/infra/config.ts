import type { AppEnv, LogLevel } from '@vaarg/shared';
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
  hatchet: {
    url: string | undefined;
    token: string | undefined;
    enabled: boolean;
  };
}

export function loadApiConfiguration(env: NodeJS.ProcessEnv = process.env): ApiConfiguration {
  return {
    app: parseAppEnv({
      NODE_ENV: env.NODE_ENV,
      HOST: env.HOST,
      PORT: env.PORT,
      LOG_LEVEL: env.LOG_LEVEL,
    }),
    database: {
      url: requireUrl(env.DATABASE_URL, 'DATABASE_URL', ['postgres:', 'postgresql:']),
      readinessTimeoutMs: readPositiveInt(env.DATABASE_READINESS_TIMEOUT_MS, 1500),
    },
    valkey: {
      url: requireUrl(env.VALKEY_URL, 'VALKEY_URL', ['redis:', 'rediss:']),
      readinessTimeoutMs: readPositiveInt(env.VALKEY_READINESS_TIMEOUT_MS, 1000),
      keyPrefix: env.VALKEY_KEY_PREFIX ?? 'vaarg:',
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

function requireUrl(value: string | undefined, name: string, protocols: string[]): string {
  const raw = requireEnv(value, name);
  try {
    const url = new URL(raw);
    if (!protocols.includes(url.protocol) || !url.hostname) throw new Error();
  } catch {
    throw new Error(`Invalid ${name}`);
  }
  return raw;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('Invalid positive integer configuration');
  }
  return parsed;
}

export function logLevelOf(configuration: ApiConfiguration): LogLevel {
  return configuration.app.logLevel;
}
