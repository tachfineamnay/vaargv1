import { renderToString } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The pages resolve the storefront host from request headers; tests supply a
// fixed loopback-free host through the same seam production uses.
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'synthetic.example' }),
}));

import HomePage from '../src/app/page';
import { CompareProvider } from '../src/components/CompareProvider';
import { SITE_CONFIG } from '../src/lib/site';
import {
  collectionsFixture,
  errorBody,
  productListFixture,
  startStubApi,
  type StubApi,
} from './support/stub-api';

let collectionsMode: 'ok' | 'fail' = 'ok';
let productsMode: 'ok' | 'empty' | 'fail' = 'ok';

async function renderHome(): Promise<string> {
  return renderToString(<CompareProvider>{await HomePage()}</CompareProvider>);
}

describe('home composition (FL04)', () => {
  let stub: StubApi;

  beforeAll(async () => {
    stub = await startStubApi((request, response) => {
      const json = (status: number, payload: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      };
      if (request.path.startsWith('/v1/catalog/collections')) {
        if (collectionsMode === 'fail') json(500, errorBody('internal', 'collections down'));
        else json(200, collectionsFixture());
        return;
      }
      if (request.path.startsWith('/v1/catalog/products')) {
        if (productsMode === 'fail') json(503, errorBody('unavailable', 'Catalog provider is not configured'));
        else if (productsMode === 'empty') json(200, productListFixture({ items: [] }));
        else json(200, productListFixture());
        return;
      }
      json(404, errorBody('not_found', 'Unknown route'));
    });
    vi.stubEnv('API_BASE_URL', stub.url);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await stub.close();
  });

  beforeEach(() => {
    collectionsMode = 'ok';
    productsMode = 'ok';
    stub.requests.length = 0;
  });

  it('renders hero, categories, featured products, editorial and the boundary', async () => {
    const html = await renderHome();
    expect(html).toContain('data-section="hero"');
    expect(html).toContain(SITE_CONFIG.name);
    expect(html).toContain('data-testid="category-tile"');
    expect(html).toContain('data-section="featured-selection"');
    expect(html).toContain('data-testid="product-card"');
    expect(html).toContain('data-testid="editorial-entry"');
    expect(html).toContain('data-testid="adaptive-boundary"');
    expect(html).not.toContain('data-section="state-error"');
    expect(html).not.toContain('data-section="state-empty"');
    // Catalog reads happened against the tenant host.
    expect(stub.requests.every((record) => record.host === 'synthetic.example')).toBe(true);
    expect(stub.requests.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps fulfilled sections when one fetch fails (per-section honesty)', async () => {
    collectionsMode = 'fail';
    const html = await renderHome();
    expect(html).toContain('data-section="state-error"');
    expect(html).toContain('collections down');
    expect(html).toContain('data-section="featured-selection"');
    expect(html).toContain('data-testid="editorial-entry"');
  });

  it('maps an empty catalog to an explicit empty state', async () => {
    productsMode = 'empty';
    const html = await renderHome();
    expect(html).toContain('data-section="state-empty"');
    expect(html).toContain('data-testid="category-tile"');
    expect(html).not.toContain('data-section="state-error"');
  });

  it('surfaces not_configured honestly when the provider is missing', async () => {
    productsMode = 'fail';
    const html = await renderHome();
    expect(html).toContain('data-section="state-error"');
    expect(html).toContain('not configured');
  });
});
