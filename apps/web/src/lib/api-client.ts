import {
  livenessSchema,
  readinessSchema,
  versionSchema,
  catalogHttpQuerySchema,
  catalogResponseSchema,
  type CatalogResponse,
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

/** Server-side catalog read; the API resolves the supplied public host. */
export async function fetchCatalog(host: string, kind: 'products' | 'collections', options: { handle?: string; query?: Record<string, string> } = {}): Promise<CatalogResponse> {
  if (!/^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(host)) throw new Error('Invalid storefront host');
  if (options.handle && !/^[a-z0-9][a-z0-9-]{0,254}$/.test(options.handle)) throw new Error('Invalid catalog handle');
  catalogHttpQuerySchema.parse(options.query ?? {});
  const query = new URLSearchParams(options.query).toString();
  const response = await fetch(`${resolveApiBase()}/catalog/${kind}${options.handle ? `/${encodeURIComponent(options.handle)}` : ''}${query ? `?${query}` : ''}`, {
    signal: AbortSignal.timeout(4000),
    headers: { accept: 'application/json', host },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Catalog API responded with HTTP ${response.status}`);
  return catalogResponseSchema.parse(await response.json());
}

function resolveApiBase(): string {
  const base = process.env.API_BASE_URL ?? (process.env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:4111');
  if (!base) throw new Error('API_BASE_URL is required');
  return base.replace(/\/+$/, '');
}

async function fetchJson<T>(path: string, allowUnready = false): Promise<T> {
  const response = await fetch(`${resolveApiBase()}${path}`, {
    signal: AbortSignal.timeout(4000),
    headers: { accept: 'application/json' },
  });
  if (!response.ok && !(allowUnready && response.status === 503)) {
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
      fetchJson<unknown>('/health/ready', true),
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
