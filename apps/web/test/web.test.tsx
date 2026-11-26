import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SiteHeader } from '../src/components/SiteHeader';
import { ApiStatusPanel } from '../src/components/ApiStatusPanel';
import { NAVIGATION, resolveStoreContext, SITE_CONFIG } from '../src/lib/site';
import type { ApiStatus } from '../src/lib/api-client';

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
