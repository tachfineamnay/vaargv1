import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CollectionGrid } from '../src/components/CollectionGrid';
import { SiteHeader } from '../src/components/SiteHeader';
import { COLLECTIONS, NAVIGATION, resolveStoreContext, SITE_CONFIG } from '../src/lib/site';

describe('web entrypoint contracts', () => {
  it('renders the storefront header with primary navigation', () => {
    const html = renderToString(<SiteHeader />);
    expect(html).toContain(SITE_CONFIG.name);
    for (const item of NAVIGATION) {
      expect(html).toContain(item.label);
    }
  });

  it('renders collection tiles with real links', () => {
    const html = renderToString(<CollectionGrid />);
    expect(html).toContain('collection-grid');
    for (const collection of COLLECTIONS) {
      expect(html).toContain(collection.title);
      expect(html).toContain(`/collections/${collection.id}`);
    }
  });

  it('resolves store context safely from input', () => {
    expect(resolveStoreContext('demo').storeId).toBe('demo');
    expect(resolveStoreContext('store_two').storeId).toBe('store_two');
    expect(() => resolveStoreContext('../../etc')).toThrow();
  });

  it('keeps the collection set deterministic and non-empty', () => {
    expect(COLLECTIONS.length).toBeGreaterThan(0);
    const ids = COLLECTIONS.map((collection) => collection.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
