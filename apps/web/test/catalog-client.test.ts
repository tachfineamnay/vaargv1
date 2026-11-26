import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCatalog } from '../src/lib/api-client.js';
import { buildQueryString, createCatalogClient } from '../src/lib/catalog';
import { startStubApi, type StubApi } from './support/stub-api';

afterEach(() => vi.unstubAllGlobals());

describe('catalog API client', () => {
  it('forwards the storefront host and validates the catalog response', async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ status: 'NOT_SYNCED', completedAt: null, items: [], nextCursor: null }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    expect((await fetchCatalog('synthetic.example', 'products')).status).toBe('NOT_SYNCED');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ headers: { accept: 'application/json', host: 'synthetic.example' } });
  });
  it('rejects invalid responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'invented' }), { status: 200 })));
    await expect(fetchCatalog('synthetic.example', 'products')).rejects.toThrow();
  });
});

describe('createCatalogClient (FL04)', () => {
  let stub: StubApi;

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

  it('sends the storefront host explicitly on every upstream request', async () => {
    const client = createCatalogClient('synthetic.example');
    const list = await client.listProducts({ q: 'linen' });
    expect(list.status).toBe('FRESH');
    expect(list.items[0]?.handle).toBe('linen-shirt');
    const record = stub.requests.at(-1);
    expect(record?.host).toBe('synthetic.example'); // node:http Host header — the tenant authority
    expect(record?.path).toContain('/v1/catalog/products?');
    expect(record?.path).toContain('q=linen');
    expect(record?.origin).toBeNull(); // catalog reads are not CSRF-checked
  });

  it('serializes query params deterministically (sorted, encoded)', () => {
    expect(buildQueryString({ q: 'linen', attribute: 'Size:M', limit: 5 })).toBe(
      '?q=linen&attribute=Size%3AM&limit=5',
    );
    expect(buildQueryString({})).toBe('');
    expect(buildQueryString({ q: undefined, vendor: '' })).toBe('');
  });

  it('parses the product detail freshness envelope', async () => {
    const client = createCatalogClient('synthetic.example');
    const detail = await client.getProduct('linen-shirt');
    expect(detail.status).toBe('FRESH');
    expect(detail.generation).toBe('33333333-3333-4333-8333-333333333333');
    expect(detail.completedAt).toBe('2026-11-20T12:00:00.000Z');
    expect(detail.variants).toHaveLength(1);
  });

  it('rejects invalid references before any request', () => {
    const client = createCatalogClient('synthetic.example');
    expect(() => client.getProduct('')).toThrowError(/Invalid catalog reference/);
    expect(() => client.getProduct('x'.repeat(301))).toThrowError(/Invalid catalog reference/);
  });

  it('compareProducts requires at least two ids client-side', async () => {
    const client = createCatalogClient('synthetic.example');
    expect(() => client.compareProducts(['only-one'])).toThrowError(/At least two products/);
    expect(stub.requests).toHaveLength(0);
  });

  it('compareProducts dedupes and caps at four ids', async () => {
    const client = createCatalogClient('synthetic.example');
    const ids = ['a', 'a', 'b', 'c', 'd', 'e'];
    const comparison = await client.compareProducts(ids);
    expect(comparison.rows).toHaveLength(2);
    const record = stub.requests.at(-1);
    expect(record?.path).toBe('/v1/catalog/compare?ids=a%2Cb%2Cc%2Cd');
  });
});

describe('createCatalogClient — error taxonomy', () => {
  let stub: StubApi;

  beforeAll(async () => {
    stub = await startStubApi((request, response) => {
      const json = (status: number, payload: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      };
      if (request.path.includes('unknown-store')) {
        json(404, { error: { kind: 'not_found', message: 'Unknown storefront', requestId: 'r1' } });
        return;
      }
      if (request.path.includes('missing-product')) {
        json(404, { error: { kind: 'not_found', message: 'Product not found', requestId: 'r2' } });
        return;
      }
      if (request.path.includes('unconfigured')) {
        json(503, { error: { kind: 'unavailable', message: 'Catalog provider is not configured', requestId: 'r3' } });
        return;
      }
      if (request.path.includes('malformed')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{not-json');
        return;
      }
      if (request.path.includes('wrong-shape')) {
        json(200, { status: 'FRESH', completedAt: null, items: 'nope', nextCursor: null });
        return;
      }
      json(500, { error: { kind: 'internal', message: 'Boom', requestId: 'r4' } });
    });
    vi.stubEnv('API_BASE_URL', stub.url);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await stub.close();
  });

  it('maps message-first, body-kind and status fallbacks into the taxonomy', async () => {
    const client = createCatalogClient('synthetic.example');
    await expect(client.getProduct('unknown-store')).rejects.toMatchObject({ kind: 'unknown_storefront' });
    await expect(client.getProduct('missing-product')).rejects.toMatchObject({ kind: 'not_found' });
    await expect(client.getProduct('unconfigured')).rejects.toMatchObject({ kind: 'not_configured' });
    await expect(client.getProduct('anything')).rejects.toMatchObject({ kind: 'internal', requestId: 'r4' });
  });

  it('rejects malformed and contract-invalid payloads as invalid_response', async () => {
    const client = createCatalogClient('synthetic.example');
    await expect(client.getProduct('malformed')).rejects.toMatchObject({ kind: 'invalid_response' });
    await expect(client.getProduct('wrong-shape')).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});
