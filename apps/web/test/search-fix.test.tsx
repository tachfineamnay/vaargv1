import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'synthetic.example' }) }));
const forward = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/transport', () => ({ forwardRequest: forward }));
import SearchPage from '../src/app/search/page';
import { CompareProvider } from '../src/components/CompareProvider';
import { productListFixture } from './support/stub-api';

beforeEach(() => {
  forward.mockReset();
  forward.mockResolvedValue({ status: 200, body: JSON.stringify({
    status: 'DEGRADED_LEXICAL', catalogStatus: 'STALE', mode: 'hybrid', query: 'linen',
    items: productListFixture().items, nextCursor: null,
    provenance: { channels: ['fts','trigram'], embedding: null, rrfK: 60, candidatePool: 100 },
    completedAt: '2026-11-20T12:00:00.000Z', generatedAt: '2026-11-27T10:00:00.000Z',
  }) });
});
describe('FL05-FIX conventional SSR search', () => {
  it('invokes actual FL05 search and renders verified DTOs with honest degraded/bounded semantics', async () => {
    const page = await SearchPage({ searchParams: Promise.resolve({ q: 'linen', mode: 'hybrid', vendor: 'Synthetic', priceMax: '100', attribute: 'Size:M', cursor: 'legacy', c: 'old' }) });
    const html = renderToString(<CompareProvider>{page}</CompareProvider>);
    const request = forward.mock.calls[0]?.[0];
    expect(request.path).toContain('/v1/experience/catalog-search?');
    expect(request.host).toBe('synthetic.example');
    expect(request.path).toContain('mode=hybrid');
    expect(request.path).toContain('vendor=Synthetic');
    expect(request.path).toContain('priceMax=100');
    expect(request.path).toContain('attribute=Size%3AM');
    expect(request.path).not.toContain('cursor');
    expect(html).toContain('Semantic retrieval unavailable');
    expect(html).toContain('Top ranked matches');
    expect(html).toContain('method="get"');
    expect(html).toContain('name="vendor"');
    expect(html).not.toContain('data-testid="pagination"');
  });
  it('uses lexical mode by default without bootstrapping any visitor identity', async () => {
    await SearchPage({ searchParams: Promise.resolve({ q: 'linen' }) });
    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward.mock.calls[0]?.[0].path).toContain('mode=lexical');
    expect(forward.mock.calls[0]?.[0].visitorToken).toBeUndefined();
  });
});
