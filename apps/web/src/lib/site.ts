import { STORE_ID_SCHEMA, storeContextSchema, type StoreContext } from '@vaarg/shared';

export interface SiteConfig {
  name: string;
  tagline: string;
}

export const SITE_CONFIG: SiteConfig = {
  name: 'VAARG̈',
  tagline: 'Adaptive commerce, orchestrated.',
};

/**
 * Validate an explicitly supplied store id. There is no default-store
 * fallback: storefront identity is resolved server-side from the request
 * Host header, never inferred from a client-visible constant.
 */
export function resolveStoreContext(storeId: string): StoreContext {
  const safe = STORE_ID_SCHEMA.parse(storeId);
  return storeContextSchema.parse({ storeId: safe });
}

export interface NavigationItem {
  label: string;
  href: string;
}

/** Navigation only links to routes that exist in this app. */
export const NAVIGATION: NavigationItem[] = [
  { label: 'Collections', href: '/collections' },
  { label: 'Products', href: '/products' },
  { label: 'Search', href: '/search' },
  { label: 'Compare', href: '/compare' },
];
