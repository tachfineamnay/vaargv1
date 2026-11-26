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

export interface CollectionTile {
  id: string;
  title: string;
  description: string;
}

export const COLLECTIONS: CollectionTile[] = [
  {
    id: 'seating',
    title: 'Seating',
    description: 'Sculpted lounges and statement chairs for the modern salon.',
  },
  {
    id: 'lighting',
    title: 'Lighting',
    description: 'Warm, layered illumination shaped for interiors with presence.',
  },
  {
    id: 'objects',
    title: 'Objects',
    description: 'Sculptural pieces that carry heritage and restraint.',
  },
];
