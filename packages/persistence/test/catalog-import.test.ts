import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { importCatalogPage, startCatalogSweep, readCatalogSnapshot, readCatalogProjection } from '../src/commerce/import.js';
import type { CommercePort, Product } from '../src/commerce/shopify.js';

const url = process.env.P02_TEST_DATABASE_URL;
if (url) { const parsed = new URL(url); if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/vaarg_p02_test') throw new Error('A dedicated local test database is required'); }
const run = url && new URL(url).pathname === '/vaarg_p02_test' ? describe : describe.skip;
run('catalog projection on isolated PostgreSQL', () => {
  let admin: Pool;
  let app: Pool;
  const role = `p02a_${randomUUID().replaceAll('-', '')}`;
  const a = randomUUID();
  const b = randomUUID();
  const input = { storeId: a, country: 'FR', language: 'FR' };
  const product: Product = { id: 'gid://shopify/Product/1', handle: 'synthetic', title: 'Synthetic', description: '', productType: '', vendor: '', tags: [], updatedAt: '2026-01-01T00:00:00Z', availableForSale: false, variants: { nodes: [{ id: 'gid://shopify/ProductVariant/1', title: 'Synthetic', availableForSale: false, price: { amount: '1.00', currencyCode: 'EUR' }, selectedOptions: [] }], pageInfo: { hasNextPage: false, endCursor: null } }, images: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, media: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } };
  beforeAll(async () => {
    if (!url) throw new Error('isolated test URL required');
    admin = new Pool({ connectionString: url });
    await admin.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='vaarg_app') THEN CREATE ROLE vaarg_app NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$");
    await admin.query('CREATE TABLE IF NOT EXISTS stores(store_id uuid PRIMARY KEY)');
    await admin.query('INSERT INTO stores(store_id) VALUES ($1),($2)', [a, b]);
    const existing = await admin.query("SELECT to_regclass('public.catalog_imports') AS name");
    if (!existing.rows[0].name) await admin.query(await readFile('migrations/0002_catalog.sql', 'utf8'));
    const lease = await admin.query("SELECT 1 FROM information_schema.columns WHERE table_name='catalog_imports' AND column_name='lease_token'");
    if (!lease.rowCount) await admin.query(await readFile('migrations/0008_catalog_import_lease.sql', 'utf8'));
    const receipts = await admin.query("SELECT to_regclass('public.catalog_job_receipts') AS name");
    if (!receipts.rows[0].name) await admin.query(await readFile('migrations/0009_catalog_job_receipts.sql', 'utf8'));
    await admin.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    const normalized = await admin.query("SELECT to_regclass('public.catalog_products') AS name");
    if (!normalized.rows[0].name) await admin.query(await readFile('migrations/0010_catalog_normalized.sql', 'utf8'));
    await admin.query(`CREATE ROLE ${role} LOGIN INHERIT PASSWORD 'synthetic_test_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query(`GRANT vaarg_app TO ${role}`);
    const appUrl = new URL(url); appUrl.username = role; appUrl.password = 'synthetic_test_password';
    app = new Pool({ connectionString: appUrl.toString() });
  });
  afterAll(async () => { await app?.end(); if (admin) { await admin.query(`DROP ROLE IF EXISTS ${role}`); await admin.end(); } });
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
    const normalizedProduct = await admin.query("SELECT handle,title,title_normalized,available_for_sale,visible,tags FROM catalog_products WHERE store_id=$1 AND country='FR' AND language='FR'", [a]);
    expect(normalizedProduct.rows).toHaveLength(1);
    expect(normalizedProduct.rows[0].handle).toBe('synthetic');
    expect(normalizedProduct.rows[0].title_normalized).toBe('synthetic');
    const normalizedVariant = await admin.query("SELECT variant_gid,price_amount::text AS price,currency,visible FROM catalog_variants WHERE store_id=$1", [a]);
    expect(normalizedVariant.rows).toHaveLength(1);
    expect(normalizedVariant.rows[0].price).toBe('1.000000');
    expect(normalizedVariant.rows[0].currency).toBe('EUR');
    const searchDoc = await admin.query("SELECT title_normalized,visible,content_hash FROM catalog_search_documents WHERE store_id=$1", [a]);
    expect(searchDoc.rows).toHaveLength(1);
    expect(searchDoc.rows[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
    const lexical = await app.query("SELECT product_gid FROM catalog_search_documents WHERE store_id=$1 AND country='FR' AND language='FR' AND visible=true AND (title_normalized % 'synth' OR title_normalized ILIKE '%synth%')", [a]);
    expect(lexical.rows).toHaveLength(1);
    await admin.query("UPDATE catalog_imports SET completed_at=now()-interval '2 hours' WHERE store_id=$1 AND country=$2 AND language=$3", [a, 'FR', 'FR']);
    expect((await readCatalogProjection(app, input, { kind:'product', limit:1, maxAgeMs:60000 })).status).toBe('STALE');
    await admin.query('UPDATE catalog_imports SET completed_at=now() WHERE store_id=$1 AND country=$2 AND language=$3', [a, 'FR', 'FR']);
    const listing = await readCatalogProjection(app, input, { kind: 'product', limit: 1, maxAgeMs: 60000 });
    expect(listing.status).toBe('FRESH');
    expect(listing.items[0]).toMatchObject({ kind: 'product', data: { id: product.id, availableForSale: false } });
    expect((await readCatalogProjection(app, { ...input, storeId: b }, { kind: 'product', limit: 1, maxAgeMs: 60000 })).status).toBe('NOT_SYNCED');
    expect((await readCatalogProjection(app, input, { kind: 'product', handle: 'synthetic', limit: 1, maxAgeMs: 0 })).items).toHaveLength(1);
    expect((await readCatalogProjection(app, input, { kind: 'product', available: true, limit: 1, maxAgeMs: 60000 })).items).toHaveLength(0);
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
  it('paginates products and filters collection membership within the same store', async () => {
    const storeId = randomUUID(), generation = randomUUID();
    await admin.query('INSERT INTO stores(store_id) VALUES($1)', [storeId]);
    await admin.query("INSERT INTO catalog_imports(store_id,country,language,generation,phase,completed_at) VALUES($1,'FR','FR',$2,'complete',now())", [storeId,generation]);
    const second = { ...product, id:'gid://shopify/Product/2', handle:'another', title:'Another' };
    const collection = { id:'gid://shopify/Collection/1', handle:'group', title:'Group', description:'Synthetic', updatedAt:'2026-01-01T00:00:00Z', image:null, products:{nodes:[{id:second.id}],pageInfo:{hasNextPage:false,endCursor:null}} };
    for (const [kind, item] of [['product',product],['product',second],['collection',collection]] as const) await admin.query("INSERT INTO catalog_projection(store_id,country,language,kind,shopify_id,payload,seen_generation) VALUES($1,'FR','FR',$2,$3,$4,$5)",[storeId,kind,item.id,JSON.stringify(item),generation]);
    const scopedInput={...input,storeId};
    const first=await readCatalogProjection(app, scopedInput, {kind:'product',limit:1,maxAgeMs:60000});
    expect(first.items).toHaveLength(1); expect(first.nextCursor).toBeTruthy();
    const next=await readCatalogProjection(app, scopedInput, {kind:'product',limit:1,maxAgeMs:60000,cursor:first.nextCursor!});
    expect(next.items[0]?.data.id).not.toBe(first.items[0]?.data.id);
    const filtered=await readCatalogProjection(app, scopedInput, {kind:'product',limit:5,maxAgeMs:60000,collectionId:collection.id});
    expect(filtered.items.map(item=>item.data.id)).toEqual([second.id]);
    expect((await readCatalogProjection(app, scopedInput, {kind:'collection',handle:'group',limit:1,maxAgeMs:60000})).items[0]?.data.id).toBe(collection.id);
  });
  it('releases database locks during provider calls and rejects concurrent claims', async () => {
    await startCatalogSweep(app, input);
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const port: CommercePort = {
      products: async () => { started(); await waiting; return { items: [product], nextCursor: null }; },
      collections: async () => ({ items: [], nextCursor: null }),
    };
    const first = importCatalogPage(app, port, input);
    await entered;
    const lock = await admin.connect();
    try {
      await lock.query('BEGIN');
      await lock.query('SELECT generation FROM catalog_imports WHERE store_id=$1 AND country=$2 AND language=$3 FOR UPDATE NOWAIT', [a, 'FR', 'FR']);
      await lock.query('ROLLBACK');
      await expect(importCatalogPage(app, port, input)).rejects.toThrow('IMPORT_BUSY');
    } finally { await lock.query('ROLLBACK'); lock.release(); release(); }
    expect((await first).phase).toBe('collections');
  });
  it('recovers an expired lease and rejects a late worker checkpoint', async () => {
    const immediate: CommercePort = { products: async () => ({ items: [product], nextCursor: null }), collections: async () => ({ items: [], nextCursor: null }) };
    await importCatalogPage(app, immediate, input);
    await startCatalogSweep(app, input);
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const late: CommercePort = { products: async () => { started(); await wait; return { items: [{ ...product, title: 'obsolete' }], nextCursor: null }; }, collections: immediate.collections };
    const first = importCatalogPage(app, late, input);
    const firstOutcome = expect(first).rejects.toThrow('IMPORT_LEASE_LOST');
    await entered;
    await admin.query("UPDATE catalog_imports SET lease_until=clock_timestamp()-interval '1 second' WHERE store_id=$1 AND country=$2 AND language=$3", [a, 'FR', 'FR']);
    expect((await importCatalogPage(app, immediate, input)).phase).toBe('collections');
    release();
    await firstOutcome;
    const persisted = await admin.query("SELECT payload->>'title' AS title FROM catalog_projection WHERE store_id=$1 AND kind='product'", [a]);
    expect(persisted.rows[0].title).toBe('Synthetic');
  });
  it('releases the lease without writing when a provider call is cancelled', async () => {
    const finish: CommercePort = { products: async () => ({ items: [product], nextCursor: null }), collections: async () => ({ items: [], nextCursor: null }) };
    await importCatalogPage(app, finish, input);
    await startCatalogSweep(app, input);
    const controller = new AbortController();
    const cancelled: CommercePort = { products: async () => { controller.abort(); return { items: [{ ...product, title: 'cancelled' }], nextCursor: null }; }, collections: finish.collections };
    await expect(importCatalogPage(app, cancelled, input, controller.signal)).rejects.toThrow('CANCELLED');
    expect((await importCatalogPage(app, finish, input)).phase).toBe('collections');
  });
  it('returns the original checkpoint when a durable job is replayed', async () => {
    const port: CommercePort = { products: vi.fn(async () => ({ items:[product],nextCursor:null })), collections: vi.fn(async () => ({ items:[],nextCursor:null })) };
    await importCatalogPage(app, port, input);
    await startCatalogSweep(app, input);
    const jobId = randomUUID();
    const first = await importCatalogPage(app, port, input, undefined, jobId);
    const replay = await importCatalogPage(app, port, input, undefined, jobId);
    expect(first.phase).toBe('collections');
    expect(replay.phase).toBe('collections');
    expect(port.products).toHaveBeenCalledTimes(1);
    expect(port.collections).toHaveBeenCalledTimes(1);
  });
  it('does not restart a completed sweep when the start job is replayed', async () => {
    const port: CommercePort = { products:async () => ({items:[product],nextCursor:null}), collections:async () => ({items:[],nextCursor:null}) };
    await importCatalogPage(app, port, input);
    const jobId=randomUUID();
    await startCatalogSweep(app, input, jobId);
    await importCatalogPage(app, port, input);
    expect((await importCatalogPage(app, port, input)).phase).toBe('complete');
    await startCatalogSweep(app, input, jobId);
    expect((await readCatalogProjection(app, input, {kind:'product',limit:1,maxAgeMs:60000})).status).toBe('FRESH');
    await expect(importCatalogPage(app, port, input, undefined, jobId)).rejects.toThrow('CATALOG_JOB_CONFLICT');
  });
});
