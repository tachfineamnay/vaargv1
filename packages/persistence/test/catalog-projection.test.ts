import { describe, expect, it, vi } from 'vitest';
import type { PoolClient, QueryResult } from 'pg';
import { applyCatalogPage, catalogContentHash, normalizeText, reconcileCatalogGeneration } from '../src/commerce/catalog-projection.js';
import { decodeCursor, encodeCursor, parseCatalogProductRef, parseCatalogCollectionRef } from '../src/commerce/catalog-read.js';
import type { Collection, Product } from '../src/commerce/shopify.js';

const product: Product = {
  id: 'gid://shopify/Product/1',
  handle: 'synthetic-ring',
  title: 'Synthetic Ring',
  description: 'A synthetic product description.',
  productType: 'Jewelry',
  vendor: 'VAARG',
  tags: ['Gift', ' gold '],
  updatedAt: '2026-01-01T00:00:00Z',
  publishedAt: '2025-12-24T00:00:00Z',
  availableForSale: true,
  options: [{ id: 'opt-1', name: 'Size', optionValues: [{ id: 'v-1', name: 'M' }, { id: 'v-2', name: 'L' }] }],
  metafields: [{ namespace: 'custom', key: 'engraving', type: 'single_line_text_field', value: 'configurable' }],
  variants: {
    nodes: [
      { id: 'gid://shopify/ProductVariant/1', title: 'M', availableForSale: true, price: { amount: '49.90', currencyCode: 'EUR' }, selectedOptions: [{ name: 'Size', value: 'M' }], sku: 'RING-M', position: 1, compareAtPrice: { amount: '59.00', currencyCode: 'EUR' }, quantityAvailable: 5, currentlyNotInStock: false },
      { id: 'gid://shopify/ProductVariant/2', title: 'L', availableForSale: false, price: { amount: '49.90', currencyCode: 'EUR' }, selectedOptions: [{ name: 'Size', value: 'L' }] },
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
  images: { nodes: [{ id: 'img-1', url: 'https://cdn.example.com/a.png', altText: 'Front' }], pageInfo: { hasNextPage: false, endCursor: null } },
  media: {
    nodes: [
      { __typename: 'MediaImage', id: 'm-1', mediaContentType: 'IMAGE', alt: 'Front', previewImage: { id: 'img-1', url: 'https://cdn.example.com/a.png', altText: 'Front' }, image: { id: 'img-1', url: 'https://cdn.example.com/a.png', altText: 'Front' } },
      { __typename: 'Video', id: 'm-2', mediaContentType: 'VIDEO', alt: null, previewImage: null, sources: [{ url: 'https://cdn.example.com/v.mp4', mimeType: 'video/mp4', format: 'mp4' }] },
      { __typename: 'ExternalVideo', id: 'm-3', mediaContentType: 'EXTERNAL_VIDEO', alt: null, previewImage: null, originUrl: 'https://www.youtube.com/embed/x' },
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
};

const collection: Collection = {
  id: 'gid://shopify/Collection/7',
  handle: 'gifts',
  title: 'Gifts',
  description: 'Gift ideas',
  updatedAt: '2026-01-01T00:00:00Z',
  image: null,
  products: { nodes: [{ id: 'gid://shopify/Product/1' }], pageInfo: { hasNextPage: false, endCursor: null } },
};

/** Records SQL calls; COMMIT succeeds so the scoped transaction completes. */
function fakeClient() {
  const calls: { sql: string; values: unknown[] | undefined }[] = [];
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]): Promise<QueryResult> => {
      calls.push({ sql, values });
      if (sql === 'COMMIT') return { command: 'COMMIT', rows: [], rowCount: 0 } as QueryResult;
      if (/FROM catalog_products p\b/.test(sql) && sql.includes('JOIN catalog_products p ON')) return { command: 'SELECT', rows: [{ product_gid: 'gid://shopify/Product/1' }], rowCount: 1 } as unknown as QueryResult;
      return { command: 'INSERT', rows: [], rowCount: 1 } as unknown as QueryResult;
    }),
  };
  return { client: client as unknown as PoolClient, calls };
}

describe('catalog projection normalization', () => {
  it('normalizes text deterministically', () => {
    expect(normalizeText('  Café\u00a0 GRANDE  ')).toBe('café grande');
    expect(normalizeText('A\u0000B\t C')).toBe('a b c');
    expect(normalizeText('X')).toBe(normalizeText('X'));
  });

  it('hashes normalized content stably', () => {
    const a = catalogContentHash(['title', 'body', 'tag']);
    const b = catalogContentHash(['title', 'body', 'tag']);
    const c = catalogContentHash(['title', 'body ', 'tag']);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(c);
  });

  it('applies a product page to products, variants, media, attributes and search documents', async () => {
    const { client, calls } = fakeClient();
    await applyCatalogPage(client, { storeId: '00000000-0000-4000-8000-000000000001', country: 'FR', language: 'FR' }, 'products', '00000000-0000-4000-8000-00000000000a', [product]);
    const tables = calls.map((call) => /INSERT INTO (\w+)/.exec(call.sql)?.[1]).filter(Boolean);
    expect(tables).toContain('catalog_products');
    expect(tables).toContain('catalog_variants');
    expect(tables).toContain('catalog_product_media');
    expect(tables).toContain('catalog_product_attributes');
    expect(tables).toContain('catalog_search_documents');
    const variantInsert = calls.find((call) => call.sql.includes('INSERT INTO catalog_variants'));
    expect(variantInsert?.values).toContain('RING-M');
    expect(variantInsert?.values).toContain('49.900000');
    expect(variantInsert?.values).toContain('59.000000');
    const mediaTypes = calls.filter((call) => call.sql.includes('INSERT INTO catalog_product_media')).map((call) => call.values![5]);
    expect(mediaTypes).toEqual(['IMAGE', 'VIDEO', 'EXTERNAL_VIDEO']);
    const attributeValues = calls.filter((call) => call.sql.includes("INSERT INTO catalog_product_attributes")).map((call) => `${call.values![4]}`);
    expect(attributeValues).toContain('Size');
    expect(attributeValues).toContain('custom.engraving');
    const searchDoc = calls.find((call) => call.sql.includes('INSERT INTO catalog_search_documents'));
    expect(searchDoc?.values?.some((value) => value === 'synthetic ring')).toBe(true);
    expect(searchDoc?.values?.some((value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value))).toBe(true);
  });

  it('replaces membership only with products that exist in the market', async () => {
    const { client, calls } = fakeClient();
    await applyCatalogPage(client, { storeId: '00000000-0000-4000-8000-000000000001', country: 'FR', language: 'FR' }, 'collections', '00000000-0000-4000-8000-00000000000a', [collection]);
    const membership = calls.find((call) => call.sql.includes('INSERT INTO catalog_collection_members'));
    expect(membership).toBeTruthy();
    expect(membership?.sql).toContain('JOIN catalog_products');
    expect(membership?.values).toContain(JSON.stringify([{ id: 'gid://shopify/Product/1' }]));
    expect(calls.some((call) => call.sql.includes('DELETE FROM catalog_collection_members'))).toBe(true);
  });

  it('rejects invalid payloads instead of corrupting the projection', async () => {
    const { client } = fakeClient();
    await expect(applyCatalogPage(client, { storeId: '00000000-0000-4000-8000-000000000001', country: 'FR', language: 'FR' }, 'products', '00000000-0000-4000-8000-00000000000a', [{ id: 'not-a-gid' }])).rejects.toThrow();
  });

  it('reconciles only the current market and generation', async () => {
    const { client, calls } = fakeClient();
    const scope = { storeId: '00000000-0000-4000-8000-000000000001', country: 'FR', language: 'FR' };
    await reconcileCatalogGeneration(client, scope, '00000000-0000-4000-8000-00000000000a');
    const scopedUpdates = calls.filter((call) => call.sql.startsWith('UPDATE') && call.sql.includes('generation<>$4'));
    expect(scopedUpdates.map((call) => /UPDATE (\w+)/.exec(call.sql)?.[1])).toEqual(['catalog_products', 'catalog_variants', 'catalog_collections', 'catalog_search_documents']);
    for (const call of scopedUpdates) expect(call.values).toEqual([scope.storeId, 'FR', 'FR', '00000000-0000-4000-8000-00000000000a']);
    expect(calls.some((call) => call.sql.includes('DELETE FROM catalog_collection_members') && call.sql.includes('generation<>$4'))).toBe(true);
  });
});

describe('catalog read helpers', () => {
  it('round-trips bounded cursors', () => {
    const cursor = encodeCursor('Synthetic Ring', 'gid://shopify/Product/1', 1.5);
    expect(decodeCursor(cursor)).toEqual({ key: 'Synthetic Ring', gid: 'gid://shopify/Product/1', score: 1.5 });
    expect(decodeCursor(encodeCursor('a', 'gid://shopify/Product/2'))).toEqual({ key: 'a', gid: 'gid://shopify/Product/2', score: null });
  });

  it('rejects malformed cursors and oversized payloads', () => {
    expect(() => decodeCursor('not-json')).toThrow('INVALID_CURSOR');
    expect(() => decodeCursor(Buffer.from(JSON.stringify(['a', 'b', 'nope'])).toString('base64url'))).toThrow('INVALID_CURSOR');
    expect(() => decodeCursor(Buffer.from(JSON.stringify(['x'.repeat(401), 'g', null])).toString('base64url'))).toThrow('INVALID_CURSOR');
  });

  it('accepts stable gids and handles only', () => {
    expect(parseCatalogProductRef('gid://shopify/Product/123')).toEqual({ gid: 'gid://shopify/Product/123' });
    expect(parseCatalogProductRef('synthetic-ring')).toEqual({ handle: 'synthetic-ring' });
    expect(() => parseCatalogProductRef('Not A Handle')).toThrow('INVALID_PRODUCT_REF');
    expect(() => parseCatalogProductRef('gid://shopify/Product/abc')).toThrow('INVALID_PRODUCT_REF');
    expect(parseCatalogCollectionRef('gid://shopify/Collection/7')).toEqual({ gid: 'gid://shopify/Collection/7' });
    expect(parseCatalogCollectionRef('gifts')).toEqual({ handle: 'gifts' });
    expect(() => parseCatalogCollectionRef('../etc')).toThrow('INVALID_COLLECTION_REF');
  });
});
