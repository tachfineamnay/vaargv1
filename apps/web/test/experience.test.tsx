import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdaptiveComposition } from '@vaarg/shared';
import { adaptiveToSections } from '../src/lib/adaptive';
import { SectionRenderer } from '../src/components/SectionRenderer';
import { AdaptiveSectionBoundary } from '../src/components/AdaptiveSectionBoundary';
import { CompareProvider } from '../src/components/CompareProvider';
import {
  fetchExperienceComposition,
  ingestInteractions,
  lastAppliedRevision,
  setLastAppliedRevision,
} from '../src/lib/experience-client';

const sessionId = '00000000-0000-4000-8000-0000000000aa';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  setLastAppliedRevision(null);
  vi.unstubAllGlobals();
});

describe('FL05 experience client — EXP-03 browser stale rejection', () => {
  it('applies a fresh composition envelope and rejects an older one', async () => {
    setLastAppliedRevision({ sessionId, contextVersion: 5, experienceRevision: 2 });
    const stale: AdaptiveComposition = {
      sessionId,
      contextVersion: 4,
      experienceRevision: 9,
      mode: 'adaptive',
      adaptationReason: 'explicit_criteria',
      freshness: '2026-11-27T10:00:00.000Z',
      sections: [
        { id: 's1', component: 'SuggestionChips', chips: [{ label: 'Rings', href: '/collections/rings' }] },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, stale)));
    const result = await fetchExperienceComposition();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('conflict');
    // Rejected response must not regress the applied revision.
    expect(lastAppliedRevision()).toEqual({ sessionId, contextVersion: 5, experienceRevision: 2 });

    const fresh: AdaptiveComposition = { ...stale, contextVersion: 6, experienceRevision: 0 };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, fresh)));
    const applied = await fetchExperienceComposition();
    expect(applied.ok).toBe(true);
    expect(lastAppliedRevision()).toEqual({ sessionId, contextVersion: 6, experienceRevision: 0 });
  });

  it('rejects a foreign session envelope even with a higher version', async () => {
    setLastAppliedRevision({ sessionId, contextVersion: 1, experienceRevision: 1 });
    const foreign: AdaptiveComposition = {
      sessionId: '00000000-0000-4000-8000-0000000000bb',
      contextVersion: 99,
      experienceRevision: 99,
      mode: 'ssr',
      adaptationReason: 'initial',
      freshness: '2026-11-27T10:00:00.000Z',
      sections: [
        { id: 's1', component: 'SuggestionChips', chips: [{ label: 'Rings', href: '/collections/rings' }] },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, foreign)));
    const result = await fetchExperienceComposition();
    expect(result.ok).toBe(false);
  });

  it('uses keepalive for navigation-triggered interaction posts', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { accepted: 1, duplicates: 0, rejected: 0, contextVersion: 2, experienceRevision: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await ingestInteractions(
      [{ eventId: crypto.randomUUID(), type: 'search_submitted', query: 'ring' }],
      undefined,
      { keepalive: true },
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.keepalive).toBe(true);
  });
});

describe('FL05 adaptive section mapping (shared contract → section model)', () => {
  it('maps every registry component with stable ids and no invented props', () => {
    const sections = adaptiveToSections([
      {
        id: 'c-tiles',
        component: 'CategoryTile',
        collections: [
          {
            id: 'gid://shopify/Collection/1',
            handle: 'rings',
            title: 'Rings',
            description: '',
            image: null,
            updatedAt: '2026-11-27T10:00:00.000Z',
            productCount: 4,
            provenance: { source: 'shopify', shopifyId: 'c1', generation: 'g', observedAt: '2026-11-27T10:00:00.000Z' },
          },
        ],
      },
      {
        id: 'chips',
        component: 'SuggestionChips',
        chips: [{ label: 'Silver', href: '/search?q=silver' }],
      },
      {
        id: 'compare',
        component: 'ProductComparator',
        products: [
          {
            id: 'gid://shopify/Product/1',
            handle: 'a',
            title: 'A',
            productType: '',
            vendor: 'V',
            tags: [],
            availableForSale: true,
            priceMin: null,
            priceMax: null,
            image: null,
            updatedAt: '2026-11-27T10:00:00.000Z',
            provenance: {
              source: 'shopify',
              shopifyId: 'gid://shopify/Product/1',
              generation: '00000000-0000-4000-8000-000000000001',
              observedAt: '2026-11-27T10:00:00.000Z',
            },
          },
          {
            id: 'gid://shopify/Product/2',
            handle: 'b',
            title: 'B',
            productType: '',
            vendor: 'V',
            tags: [],
            availableForSale: true,
            priceMin: null,
            priceMax: null,
            image: null,
            updatedAt: '2026-11-27T10:00:00.000Z',
            provenance: {
              source: 'shopify',
              shopifyId: 'gid://shopify/Product/2',
              generation: '00000000-0000-4000-8000-000000000002',
              observedAt: '2026-11-27T10:00:00.000Z',
            },
          },
        ],
      },
    ]);
    expect(sections.map((entry) => entry.type)).toEqual([
      'collection-tiles',
      'suggestion-chips',
      'product-grid',
    ]);
    expect(sections[0]?.id).toBe('c-tiles:collections');
    expect(sections[2]?.type === 'product-grid' && sections[2].footerHref).toBe(
      '/compare?ids=gid://shopify/Product/1,gid://shopify/Product/2',
    );
    // Every mapped section renders through the registry without throwing
    // (product grids mount compare toggles, hence the provider).
    for (const section of sections) {
      const html = renderToString(
        <CompareProvider>
          <SectionRenderer section={section} />
        </CompareProvider>,
      );
      expect(html).toContain(`data-section-id="${section.id}"`);
    }
  });
});

describe('FL05 adaptive boundary (SSR-safe marker)', () => {
  it('renders the testable boundary marker without blocking content', () => {
    const html = renderToString(
      <CompareProvider>
        <AdaptiveSectionBoundary />
      </CompareProvider>,
    );
    expect(html).toContain('data-testid="adaptive-boundary"');
    expect(html).toContain('aria-label="Adaptive content boundary"');
    // No loading screen or error wall is server-rendered.
    expect(html).not.toContain('adaptive-actions');
  });
});
