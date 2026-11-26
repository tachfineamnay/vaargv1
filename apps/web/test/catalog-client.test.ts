import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCatalog } from '../src/lib/api-client.js';
afterEach(() => vi.unstubAllGlobals());
describe('catalog API client', () => {
  it('forwards the storefront host and validates the catalog response', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ status:'NOT_SYNCED', completedAt:null, items:[], nextCursor:null }), { status:200 }));
    vi.stubGlobal('fetch', fetcher);
    expect((await fetchCatalog('synthetic.example', 'products')).status).toBe('NOT_SYNCED');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ headers: { accept:'application/json', host:'synthetic.example' } });
  });
  it('rejects invalid responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status:'invented' }), { status:200 })));
    await expect(fetchCatalog('synthetic.example', 'products')).rejects.toThrow();
  });
});
