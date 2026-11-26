import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { importCatalogPage, startCatalogSweep, readCatalogSnapshot } from '../src/commerce/import.js';
import type { CommercePort, Product } from '../src/commerce/shopify.js';

const url = process.env.P02_TEST_DATABASE_URL;
if (url) { const parsed = new URL(url); if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/vaarg_p02_test') throw new Error('A dedicated local test database is required'); }
const run = url && new URL(url).pathname === '/vaarg_p02_test' ? describe : describe.skip;
run('catalog projection on isolated PostgreSQL', () => {
  let admin: Pool;
  let app: Pool;
  const a = randomUUID();
  const b = randomUUID();
  const input = { storeId: a, country: 'FR', language: 'FR' };
  const product: Product = { id: 'gid://shopify/Product/1', handle: 'synthetic', title: 'Synthetic', description: '', productType: '', vendor: '', tags: [], updatedAt: '2026-01-01T00:00:00Z', availableForSale: false, variants: { nodes: [{ id: 'gid://shopify/ProductVariant/1', title: 'Synthetic', availableForSale: false, price: { amount: '1.00', currencyCode: 'EUR' }, selectedOptions: [] }], pageInfo: { hasNextPage: false, endCursor: null } }, images: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, media: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } };
  beforeAll(async () => {
    if (!url) throw new Error('isolated test URL required');
    admin = new Pool({ connectionString: url });
    await admin.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='vaarg_app') THEN CREATE ROLE vaarg_app LOGIN PASSWORD 'synthetic-test-only' NOSUPERUSER NOBYPASSRLS; END IF; END $$");
    await admin.query('CREATE TABLE IF NOT EXISTS stores(store_id uuid PRIMARY KEY)');
    await admin.query('INSERT INTO stores(store_id) VALUES ($1),($2)', [a, b]);
    const existing = await admin.query("SELECT to_regclass('public.catalog_imports') AS name");
    if (!existing.rows[0].name) await admin.query(await readFile('migrations/0002_catalog.sql', 'utf8'));
    const appUrl = new URL(url); appUrl.username = 'vaarg_app'; appUrl.password = 'synthetic-test-only';
    app = new Pool({ connectionString: appUrl.toString() });
  });
  afterAll(async () => { await app?.end(); await admin?.end(); });
  it('commits cursors, resumes failed pages, reconciles absence and enforces RLS', async () => {
    let fail = true;
    const products = vi.fn<CommercePort['products']>(async (_ctx, cursor) => {
      if (cursor === null) return { items: [product], nextCursor: 'page-2' };
      if (fail) throw new Error('simulated interruption');
      return { items: [product], nextCursor: null };
    });
    const collections = vi.fn<CommercePort['collections']>(async () => ({ items: [], nextCursor: null }));
    const port: CommercePort = { products, collections };
    await expect(startCatalogSweep(admin, input)).rejects.toThrow('UNSAFE_DATABASE_ROLE');
    await startCatalogSweep(app, input);
    expect((await importCatalogPage(app, port, input)).cursor).toBe('page-2');
    expect((await readCatalogSnapshot(app, input, 60000)).freshness).toBe('IN_PROGRESS');
    expect((await readCatalogSnapshot(app, { ...input, storeId: b }, 60000)).freshness).toBe('NOT_SYNCED');
    await expect(importCatalogPage(app, port, input)).rejects.toThrow('simulated interruption');
    fail = false;
    expect((await importCatalogPage(app, port, input)).phase).toBe('collections');
    expect((await importCatalogPage(app, port, input)).phase).toBe('complete');
    expect((await importCatalogPage(app, port, input)).phase).toBe('complete');
    expect((await readCatalogSnapshot(app, input, 60000)).freshness).toBe('FRESH');
    const before = await admin.query('SELECT visible, payload FROM catalog_projection WHERE store_id=$1', [a]);
    expect(before.rows).toHaveLength(1);
    expect(before.rows[0].payload.variants.nodes[0].availableForSale).toBe(false);
    const other = await app.connect();
    try { await other.query('BEGIN'); await other.query("SELECT set_config('app.store_id',$1,true)", [b]); expect((await other.query('SELECT * FROM catalog_projection WHERE store_id=$1', [a])).rowCount).toBe(0); await other.query('ROLLBACK'); } finally { other.release(); }
    products.mockImplementation(async () => ({ items: [], nextCursor: null }));
    await startCatalogSweep(app, input);
    await importCatalogPage(app, port, input);
    expect((await admin.query('SELECT visible FROM catalog_projection WHERE store_id=$1', [a])).rows[0].visible).toBe(true);
    await importCatalogPage(app, port, input);
    expect((await admin.query('SELECT visible FROM catalog_projection WHERE store_id=$1', [a])).rows[0].visible).toBe(false);
  });
});
