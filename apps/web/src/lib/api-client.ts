import {
  livenessSchema,
  readinessSchema,
  versionSchema,
  type Health,
  type Readiness,
  type Version,
} from '@vaarg/shared';

export type ApiConnectivityState = 'connected' | 'unreachable' | 'invalid_response';

export interface ApiStatus {
  state: ApiConnectivityState;
  health?: Health;
  readiness?: Readiness;
  version?: Version;
  error?: string;
}

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:4111';

function resolveApiBase(): string {
  return API_BASE_URL.replace(/\/+$/, '');
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${resolveApiBase()}${path}`, {
    signal: AbortSignal.timeout(4000),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`API ${path} responded with HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Typed API connectivity probe. Exercises the real API boundaries and returns
 * an honest state — including failure states — used by the landing page.
 */
export async function probeApiStatus(): Promise<ApiStatus> {
  try {
    const [healthRaw, readinessRaw, versionRaw] = await Promise.all([
      fetchJson<unknown>('/health/live'),
      fetchJson<unknown>('/health/ready'),
      fetchJson<unknown>('/version'),
    ]);

    const health = livenessSchema.safeParse(healthRaw);
    const readiness = readinessSchema.safeParse(readinessRaw);
    const version = versionSchema.safeParse(versionRaw);

    if (!health.success || !readiness.success || !version.success) {
      return {
        state: 'invalid_response',
        error: 'API returned a payload that failed shared contract validation',
      };
    }

    return {
      state: 'connected',
      health: health.data,
      readiness: readiness.data,
      version: version.data,
    };
  } catch (error) {
    return {
      state: 'unreachable',
      error: error instanceof Error ? error.message : 'API unreachable',
    };
  }
}
