import { STORE_ID_SCHEMA, storeContextSchema, type StoreContext } from '@vaarg/shared';

export interface SiteConfig {
  name: string;
  tagline: string;
  defaultStoreId: string;
}

export const SITE_CONFIG: SiteConfig = {
  name: 'VAARG̈',
  tagline: 'Adaptive commerce, orchestrated.',
  defaultStoreId: 'demo',
};

export function resolveStoreContext(storeId: string | undefined): StoreContext {
  const safe = STORE_ID_SCHEMA.parse(storeId ?? SITE_CONFIG.defaultStoreId);
  return storeContextSchema.parse({ storeId: safe });
}

export interface NavigationItem {
  label: string;
  href: string;
}

export const NAVIGATION: NavigationItem[] = [
  { label: 'Collections', href: '/collections' },
  { label: 'Atelier', href: '/atelier' },
  { label: 'Journal', href: '/journal' },
];
