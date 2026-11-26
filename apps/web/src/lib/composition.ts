import type { CatalogV1CollectionsResponse, CatalogV1Comparison, CatalogV1List, CatalogV1Related } from '@vaarg/shared';
import { emptyKindForStatus, type EmptyStateKind } from '../components/EmptyState';
import { toStorefrontError, type StorefrontError } from './errors';
import { EDITORIAL_ENTRIES, type EditorialEntry } from './editorial';
import { SITE_CONFIG } from './site';
import { t } from './i18n';

/**
 * Typed storefront section model (FL04). The home page composes sections from
 * configuration and verified catalog data; the registry in
 * `SectionRenderer` maps every type to exactly one component.
 */
export const SECTION_TYPES = [
  'hero',
  'category-tiles',
  'collection-grid',
  'product-grid',
  'featured-selection',
  'recommendations',
  'comparison',
  'editorial',
  'state-empty',
  'state-error',
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export type Section =
  | { id: string; type: 'hero'; title: string; subtitle: string }
  | { id: string; type: 'category-tiles'; collections: CatalogV1CollectionsResponse['items'] }
  | { id: string; type: 'collection-grid'; collections: CatalogV1CollectionsResponse['items'] }
  | {
      id: string;
      type: 'product-grid';
      title: string;
      products: CatalogV1List['items'];
      footerHref?: string | undefined;
      footerLabel?: string | undefined;
    }
  | {
      id: string;
      type: 'featured-selection';
      title: string;
      products: CatalogV1List['items'];
      footerHref?: string | undefined;
      footerLabel?: string | undefined;
    }
  | { id: string; type: 'recommendations'; items: CatalogV1Related['items'] }
  | { id: string; type: 'comparison'; comparison: CatalogV1Comparison; ids: string[] }
  | { id: string; type: 'editorial'; entries: EditorialEntry[] }
  | { id: string; type: 'state-empty'; kind: EmptyStateKind }
  | { id: string; type: 'state-error'; error: StorefrontError };

/**
 * Home composition (hero + commerce + editorial) from settled fetches:
 * fulfilled sections render data, rejected sections become honest error
 * states — one failed fetch never blanks the whole page.
 */
export function buildHomeSections(results: {
  collections: PromiseSettledResult<CatalogV1CollectionsResponse>;
  products: PromiseSettledResult<CatalogV1List>;
}): Section[] {
  const sections: Section[] = [{ id: 'hero', type: 'hero', title: SITE_CONFIG.name, subtitle: SITE_CONFIG.tagline }];
  sections.push(
    results.collections.status === 'fulfilled'
      ? { id: 'categories', type: 'category-tiles', collections: results.collections.value.items }
      : { id: 'categories', type: 'state-error', error: toStorefrontError(results.collections.reason) },
  );
  sections.push(
    results.products.status === 'fulfilled'
      ? results.products.value.items.length > 0
        ? {
            id: 'recent',
            type: 'featured-selection',
            title: t('home.recentTitle'),
            products: results.products.value.items,
            footerHref: '/products',
            footerLabel: t('common.viewAll'),
          }
        : { id: 'recent', type: 'state-empty', kind: emptyKindForStatus(results.products.value.status) }
      : { id: 'recent', type: 'state-error', error: toStorefrontError(results.products.reason) },
  );
  sections.push({ id: 'editorial', type: 'editorial', entries: EDITORIAL_ENTRIES });
  return sections;
}
