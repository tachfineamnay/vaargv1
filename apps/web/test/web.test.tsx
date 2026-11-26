import { renderToString } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteHeader } from '../src/components/SiteHeader';
import { ApiStatusPanel } from '../src/components/ApiStatusPanel';
import { CompareProvider } from '../src/components/CompareProvider';
import { CompareToggle } from '../src/components/CompareToggle';
import { CompareTray } from '../src/components/CompareTray';
import { PreferencesPanel } from '../src/components/PreferencesPanel';
import { SessionProvider } from '../src/components/SessionProvider';
import { POST as sessionPost, GET as sessionGet, DELETE as sessionDelete } from '../src/app/api/session/route';
import { POST as rotatePost } from '../src/app/api/session/rotate/route';
import { POST as consentPost, GET as consentGet } from '../src/app/api/consent/route';
import { NAVIGATION, resolveStoreContext, SITE_CONFIG } from '../src/lib/site';
import type { ApiStatus } from '../src/lib/api-client';
import { startStubApi, type StubApi } from './support/stub-api';

describe('web entrypoint — layout and navigation', () => {
  it('renders the accessible header with primary navigation', () => {
    const html = renderToString(<SiteHeader />);
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain(SITE_CONFIG.name);
    for (const item of NAVIGATION) {
      expect(html).toContain(item.label);
    }
  });

  it('resolves store context safely from input', () => {
    expect(resolveStoreContext('demo').storeId).toBe('demo');
    expect(resolveStoreContext('store_two').storeId).toBe('store_two');
    expect(() => resolveStoreContext('../../etc')).toThrow();
  });
});

describe('web entrypoint — API connectivity failure states', () => {
  const connected: ApiStatus = {
    state: 'connected',
    health: {
      status: 'ok',
      service: 'api',
      version: '1.0.0',
      uptimeSeconds: 1,
      timestamp: new Date().toISOString(),
    },
    readiness: {
      status: 'ready',
      service: 'api',
      version: '1.0.0',
      checks: [{ name: 'database', status: 'ready', required: true }],
      timestamp: new Date().toISOString(),
    },
    version: { service: 'api', version: '1.0.0', node: process.version, env: 'test' },
  };

  it('renders a connected state with readiness detail', () => {
    const html = renderToString(<ApiStatusPanel status={connected} />);
    expect(html).toContain('data-state="connected"');
    expect(html).toContain('Connected to VAARG API');
    expect(html).toContain('Readiness:');
  });

  it('renders an unreachable failure state with the error', () => {
    const html = renderToString(
      <ApiStatusPanel status={{ state: 'unreachable', error: 'API unreachable' }} />,
    );
    expect(html).toContain('data-state="unreachable"');
    expect(html).toContain('unreachable');
    expect(html).toContain('API unreachable');
  });

  it('renders an invalid-response failure state', () => {
    const html = renderToString(
      <ApiStatusPanel
        status={{ state: 'invalid_response', error: 'failed contract validation' }}
      />,
    );
    expect(html).toContain('data-state="invalid_response"');
    expect(html).toContain('contract validation');
  });
});

describe('session & consent BFF (FL04)', () => {
  let stub: StubApi;
  const host = 'synthetic.example';

  beforeAll(async () => {
    stub = await startStubApi();
    vi.stubEnv('API_BASE_URL', stub.url);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await stub.close();
  });

  beforeEach(() => {
    stub.requests.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('API_BASE_URL', stub.url);
  });

  function request(method: string, path: string, options: { origin?: string | null; cookie?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = { host, 'content-type': 'application/json', accept: 'application/json' };
    if (options.origin !== null) headers.origin = options.origin ?? `https://${host}`;
    if (options.cookie) headers.cookie = options.cookie;
    return new Request(`https://${host}${path}`, {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  }

  it('bootstraps a session with Host + constructed Origin upstream', async () => {
    const response = await sessionPost(request('POST', '/api/session', { body: {} }));
    expect(response.status).toBe(200);
    const envelope = (await response.json()) as { session: { sessionId: string } };
    expect(envelope.session.sessionId).toBe('11111111-1111-4111-8111-111111111111');
    const upstream = stub.requests.at(-1);
    expect(upstream?.method).toBe('POST');
    expect(upstream?.path).toBe('/v1/sessions');
    expect(upstream?.host).toBe(host); // explicit Host — the tenant authority
    expect(upstream?.origin).toBe(`https://${host}`); // CSRF origin the API validates
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((value) => value.startsWith('vaarg_visitor_session='))).toBe(true);
    expect(cookies.every((value) => value.includes('HttpOnly') && value.includes('Path=/'))).toBe(true);
  });

  it('rejects session bodies that fail the shared contract', async () => {
    const response = await sessionPost(request('POST', '/api/session', { body: { unexpected: true } }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe('bad_request');
    expect(stub.requests).toHaveLength(0);
  });

  it('rejects cross-origin session mutations before they reach the API', async () => {
    const response = await sessionPost(
      request('POST', '/api/session', { origin: 'https://evil.example', body: {} }),
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe('forbidden');
    expect(stub.requests).toHaveLength(0);
  });

  it('reads the current session and forwards only the visitor cookie', async () => {
    const response = await sessionGet(
      request('GET', '/api/session', { cookie: 'other=1; vaarg_visitor_session=abc123; more=y' }),
    );
    expect(response.status).toBe(200);
    const upstream = stub.requests.at(-1);
    expect(upstream?.path).toBe('/v1/sessions/current');
    expect(upstream?.cookie).toBe('vaarg_visitor_session=abc123');
  });

  it('surfaces 401 for an absent session cookie', async () => {
    const response = await sessionGet(request('GET', '/api/session'));
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe('unauthorized');
  });

  it('rotates and revokes sessions', async () => {
    const rotated = await rotatePost(request('POST', '/api/session/rotate'));
    expect(rotated.status).toBe(200);
    expect(rotated.headers.getSetCookie().some((value) => value.includes('rotated-token'))).toBe(true);
    expect(stub.requests.at(-1)?.path).toBe('/v1/sessions/rotate');

    const revoked = await sessionDelete(request('DELETE', '/api/session'));
    expect(revoked.status).toBe(200);
    expect(stub.requests.at(-1)?.method).toBe('DELETE');
  });

  it('constrains consent reads and updates (no customerId from the browser)', async () => {
    const read = await consentGet(request('GET', '/api/consent'));
    expect(read.status).toBe(200);
    const state = (await read.json()) as { customerId: string | null; consents: Record<string, unknown> };
    expect(state.customerId).toBeNull();
    expect(Object.keys(state.consents)).toHaveLength(5);

    const updated = await consentPost(
      request('POST', '/api/consent', { body: { purpose: 'analytics', granted: true } }),
    );
    expect(updated.status).toBe(200);
    const updatedState = (await updated.json()) as { consents: { analytics: boolean | null } };
    expect(updatedState.consents.analytics).toBe(true);
    expect(stub.requests.at(-1)?.origin).toBe(`https://${host}`);

    const smuggled = await consentPost(
      request('POST', '/api/consent', {
        body: { purpose: 'analytics', granted: true, customerId: '44444444-4444-4444-8444-444444444444' },
      }),
    );
    expect(smuggled.status).toBe(400);
    const countAfterSmuggle = stub.requests.filter((record) => record.path === '/v1/privacy/consents').length;
    expect(countAfterSmuggle).toBe(2); // read + valid update only — the smuggle never left the BFF
  });
});

describe('session & preferences SSR states', () => {
  it('renders the loading state with disabled consent controls', () => {
    const html = renderToString(
      <SessionProvider>
        <PreferencesPanel />
      </SessionProvider>,
    );
    expect(html).toContain('data-testid="session-view" data-view="loading"');
    expect(html).toContain('data-testid="consent-analytics"');
    expect(html).toContain('data-testid="consent-data_retention"');
    expect(html).not.toContain('data-testid="consent-error"');
    expect(html).not.toContain('Refresh session');
    expect(html).not.toContain('End session');
    expect(html).not.toContain('Create session');
    // Consent actions stay inert until a session is active.
    expect(html).toContain('disabled=""');
  });
});

describe('compare selection surfaces', () => {
  it('renders the tray and toggles from a seeded selection', () => {
    const html = renderToString(
      <CompareProvider initialIds={['gid://shopify/Product/1', 'gid://shopify/Product/2']}>
        <CompareTray />
        <CompareToggle id="gid://shopify/Product/1" />
        <CompareToggle id="gid://shopify/Product/9" />
      </CompareProvider>,
    );
    expect(html).toContain('data-testid="compare-tray"');
    expect(html).toContain('2 selected for comparison');
    expect(html).toContain('/compare?ids=gid%3A%2F%2Fshopify%2FProduct%2F1%2Cgid%3A%2F%2Fshopify%2FProduct%2F2');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('Remove from compare');
    expect(html).toContain('Add to compare');
  });

  it('hides the tray when nothing is selected', () => {
    const html = renderToString(
      <CompareProvider>
        <CompareTray />
      </CompareProvider>,
    );
    expect(html).not.toContain('data-testid="compare-tray"');
  });

  it('disables further additions at the four-product bound', () => {
    const html = renderToString(
      <CompareProvider
        initialIds={[
          'gid://shopify/Product/1',
          'gid://shopify/Product/2',
          'gid://shopify/Product/3',
          'gid://shopify/Product/4',
        ]}
      >
        <CompareToggle id="gid://shopify/Product/9" />
      </CompareProvider>,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('Comparison is full');
  });
});
