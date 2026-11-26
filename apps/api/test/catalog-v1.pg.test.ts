import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { runMigrations, hashToken, createArgon2Hash } from '@vaarg/persistence';
import { AppModule } from '../src/app.module.js';
import { DatabaseClient } from '../src/infra/database-client.js';
import { ValkeyClient } from '../src/infra/valkey-client.js';
import { ApiExceptionFilter } from '../src/common/exception.filter.js';

// FL03 /v1/catalog HTTP behavior on an isolated PostgreSQL 18 instance.
// Synthetic fixtures only; no real provider traffic. NOT_RUN without
// FL03_API_TEST_URL pointing at a dedicated local test database.
const url = process.env.FL03_API_TEST_URL;
if (url) { const parsed = new URL(url); if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/vaarg_fl03_test') throw new Error('Dedicated local PG test DB required'); }
(url ? describe : describe.skip)('v1 catalog HTTP on isolated PG18', () => {
  const storeA = randomUUID();
  const storeB = randomUUID();
  const merchant = randomUUID();
  const generation = randomUUID();
  const role = `fl03_${randomUUID().replaceAll('-', '')}`;
  const token = 'x'.repeat(43);
  const hosts = ['fl03-a.example', 'fl03-b.example'] as const;
  let admin: Pool; let app: NestFastifyApplication;
  const saved = { ...process.env };
  const hash = (parts: string[]) => createHash('sha256').update(parts.join('\u0000')).digest('hex');
  const market = (storeId: string) => [storeId, 'FR', 'FR'];

  async function seedProduct(storeId: string, n: number, over: Partial<{ type: string; available: boolean; price: string }> = {}) {
    const gid = `gid://shopify/Product/${n}`;
    const handle = `item-${n}`;
    const title = n === 1 ? 'Alpha Ring' : n === 2 ? 'Beta Chain' : 'Gamma Bangle';
    const type = over.type ?? (n === 1 ? 'Rings' : 'Chains');
    await admin.query(
      `INSERT INTO catalog_products(store_id,country,language,product_gid,handle,title,title_normalized,description,description_normalized,product_type,vendor,tags,options,available_for_sale,published_at,provider_updated_at,generation,visible)
       VALUES($1,'FR','FR',$2,$3,$4,$5,'Desc','desc',$6,'VAARG',$7,$8,$9,now(),now(),$10,true)`,
      [...market(storeId), gid, handle, title, title.toLowerCase(), type, [`gift${n}`], JSON.stringify(n === 1 ? [{ name: 'Size', values: ['M', 'L'] }] : []), over.available ?? true, generation],
    );
    await admin.query(
      `INSERT INTO catalog_variants(store_id,country,language,variant_gid,product_gid,position,title,sku,selected_options,available_for_sale,currently_not_in_stock,quantity_available,price_amount,currency,generation,visible)
       VALUES($1,'FR','FR','gid://shopify/ProductVariant/${n}1',$2,0,'Default','SKU-${n}','[]'::jsonb,$3,false,$4,$5,'EUR',$6,true)`,
      [...market(storeId), gid, over.available ?? true, over.available === false ? null : 3, over.price ?? (n === 1 ? '49.90' : n === 2 ? '25.00' : '120.00'), generation],
    );
    if (n === 1) {
      await admin.query(
        `INSERT INTO catalog_variants(store_id,country,language,variant_gid,product_gid,position,title,sku,selected_options,available_for_sale,currently_not_in_stock,quantity_available,price_amount,currency,generation,visible)
         VALUES($1,'FR','FR','gid://shopify/ProductVariant/${n}2',$2,1,'Large',NULL,'[{"name":"Size","value":"L"}]'::jsonb,false,false,NULL,'59.00','EUR',$3,true)`,
        [...market(storeId), gid, generation],
      );
      await admin.query(
        `INSERT INTO catalog_product_media(store_id,country,language,product_gid,media_id,media_type,ordinal,url,alt,generation)
         VALUES($1,'FR','FR',$2,'m-1','IMAGE',0,'https://cdn.example.com/a.png','Front',$3)`,
        [...market(storeId), gid, generation],
      );
      for (const [name, value] of [['Size', 'M'], ['Size', 'L']] as const) {
        await admin.query(
          `INSERT INTO catalog_product_attributes(store_id,country,language,product_gid,source,name,value,value_type,generation)
           VALUES($1,'FR','FR',$2,'option',$3,$4,NULL,$5) ON CONFLICT DO NOTHING`,
          [...market(storeId), gid, name, value, generation],
        );
      }
      await admin.query(
        `INSERT INTO catalog_product_attributes(store_id,country,language,product_gid,source,name,value,value_type,generation)
         VALUES($1,'FR','FR',$2,'metafield','custom.engraving','configurable','single_line_text_field',$3) ON CONFLICT DO NOTHING`,
        [...market(storeId), gid, generation],
      );
    }
    const titleN = title.toLowerCase();
    const bodyN = `desc ${type} vaarg gift${n}`;
    await admin.query(
      `INSERT INTO catalog_search_documents(store_id,country,language,product_gid,handle,title_normalized,body_normalized,tags_normalized,content_hash,generation,visible)
       VALUES($1,'FR','FR',$2,$3,$4,$5,$6,$7,$8,true)`,
      [...market(storeId), gid, handle, titleN, bodyN, [`gift${n}`], hash([titleN, bodyN, `gift${n}`, type, 'VAARG']), generation],
    );
    return { gid, handle, title };
  }

  beforeAll(async () => {
    if (!url) throw new Error('Test URL required');
    await runMigrations(url);
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE ROLE ${role} LOGIN INHERIT PASSWORD 'synthetic_test_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query(`GRANT vaarg_app TO ${role}`);
    for (const storeId of [storeA, storeB]) await admin.query('INSERT INTO stores(store_id,slug,name) VALUES($1,$2,$3)', [storeId, `fl03-${storeId}`, 'Synthetic']);
    for (const storeId of [storeA, storeB]) await admin.query("INSERT INTO catalog_imports(store_id,country,language,generation,phase,completed_at) VALUES($1,'FR','FR',$2,'complete',now())", [storeId, generation]);
    const a1 = await seedProduct(storeA, 1);
    await seedProduct(storeA, 2);
    await seedProduct(storeB, 3, { price: '10.00' });
    await admin.query(
      `INSERT INTO catalog_collections(store_id,country,language,collection_gid,handle,title,title_normalized,description,generation,visible)
       VALUES($1,'FR','FR','gid://shopify/Collection/9','gifts','Gifts','gifts','Ideas',$2,true)`,
      [...market(storeA), generation],
    );
    for (const productGid of [a1.gid, 'gid://shopify/Product/2']) {
      await admin.query(
        `INSERT INTO catalog_collection_members(store_id,country,language,collection_gid,product_gid,generation)
         VALUES($1,'FR','FR','gid://shopify/Collection/9',$2,$3) ON CONFLICT DO NOTHING`,
        [...market(storeA), productGid, generation],
      );
    }
    await admin.query('INSERT INTO merchant_users(merchant_user_id,store_id,email,password_hash) VALUES($1,$2,$3,$4)', [merchant, storeA, `${merchant}@synthetic.test`, await createArgon2Hash('SyntheticPassword!2026')]);
    await admin.query("INSERT INTO store_memberships(store_id,merchant_user_id,role) VALUES($1,$2,'owner')", [storeA, merchant]);
    await admin.query("INSERT INTO merchant_sessions(store_id,merchant_user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [storeA, merchant, hashToken(token)]);
    const runtimeUrl = new URL(url); runtimeUrl.username = role; runtimeUrl.password = 'synthetic_test_password';
    process.env.DATABASE_URL = runtimeUrl.toString();
    process.env.VALKEY_URL = 'redis://127.0.0.1:56380/15';
    process.env.NODE_ENV = 'test';
    process.env.SHOPIFY_FL03_TEST_TOKEN = 'synthetic-only';
    process.env.STOREFRONT_BINDINGS_JSON = JSON.stringify([
      { host: hosts[0], storeId: storeA, country: 'FR', language: 'FR', currency: 'EUR', shopifyDomain: 'fl03-a.myshopify.com', tokenEnv: 'SHOPIFY_FL03_TEST_TOKEN' },
      { host: hosts[1], storeId: storeB, country: 'FR', language: 'FR', currency: 'EUR', shopifyDomain: 'fl03-b.myshopify.com', tokenEnv: 'SHOPIFY_FL03_TEST_TOKEN' },
    ]);
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false }), { logger: false, abortOnError: false });
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 30000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (app) { await app.get(ValkeyClient).close(); await app.get(DatabaseClient).close(); await app.close(); }
    if (admin) { await admin.query('DELETE FROM stores WHERE store_id=ANY($1::uuid[])', [[storeA, storeB]]); await admin.query(`DROP ROLE IF EXISTS ${role}`); await admin.end(); }
    for (const key of ['DATABASE_URL', 'VALKEY_URL', 'NODE_ENV', 'SHOPIFY_FL03_TEST_TOKEN', 'STOREFRONT_BINDINGS_JSON']) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }, 30000);

  it('lists curated products with deterministic sort, filters and bounded cursor pagination', async () => {
    const server = app.getHttpAdapter().getInstance();
    const first = await server.inject({ method: 'GET', url: '/v1/catalog/products?limit=1', headers: { host: hosts[0] } });
    expect(first.statusCode).toBe(200);
    const page = first.json();
    expect(page.status).toBe('FRESH');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ handle: 'item-1', priceMin: { amount: '49.90', currencyCode: 'EUR' }, provenance: { source: 'shopify' } });
    const second = await server.inject({ method: 'GET', url: `/v1/catalog/products?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`, headers: { host: hosts[0] } });
    expect(second.json().items[0].handle).toBe('item-2');
    const filtered = await server.inject({ method: 'GET', url: '/v1/catalog/products?productType=Rings&available=true', headers: { host: hosts[0] } });
    expect(filtered.json().items.map((item: { handle: string }) => item.handle)).toEqual(['item-1']);
    const attribute = await server.inject({ method: 'GET', url: '/v1/catalog/products?attribute=' + encodeURIComponent('Size:M'), headers: { host: hosts[0] } });
    expect(attribute.json().items.map((item: { handle: string }) => item.handle)).toEqual(['item-1']);
    const price = await server.inject({ method: 'GET', url: '/v1/catalog/products?priceMin=30&priceMax=60&currency=EUR&sort=price-asc', headers: { host: hosts[0] } });
    expect(price.json().items.map((item: { handle: string }) => item.handle)).toEqual(['item-1']);
    const badCurrency = await server.inject({ method: 'GET', url: '/v1/catalog/products?currency=USD', headers: { host: hosts[0] } });
    expect(badCurrency.statusCode).toBe(400);
    const crossStore = await server.inject({ method: 'GET', url: '/v1/catalog/products', headers: { host: hosts[1] } });
    expect(crossStore.json().items.map((item: { handle: string }) => item.handle)).toEqual(['item-3']);
    const unknownHost = await server.inject({ method: 'GET', url: '/v1/catalog/products', headers: { host: 'unknown.example' } });
    expect(unknownHost.statusCode).toBe(404);
  });

  it('returns product detail by handle and stable reference with variants, media and attributes', async () => {
    const server = app.getHttpAdapter().getInstance();
    const byHandle = await server.inject({ method: 'GET', url: '/v1/catalog/products/item-1', headers: { host: hosts[0] } });
    expect(byHandle.statusCode).toBe(200);
    const detail = byHandle.json();
    expect(detail.summary.handle).toBe('item-1');
    expect(detail.variants).toHaveLength(2);
    expect(detail.variants[0].price.amount).toBe('49.90');
    expect(detail.options).toEqual([{ name: 'Size', values: ['M', 'L'] }]);
    expect(detail.attributes.some((attribute: { name: string }) => attribute.name === 'custom.engraving')).toBe(true);
    expect(detail.mediaCount).toEqual({ image: 1, video: 0, externalVideo: 0, model3d: 0 });
    const byId = await server.inject({ method: 'GET', url: '/v1/catalog/products/1', headers: { host: hosts[0] } });
    expect(byId.json().summary.id).toBe('gid://shopify/Product/1');
    expect((await server.inject({ method: 'GET', url: '/v1/catalog/products/missing', headers: { host: hosts[0] } })).statusCode).toBe(404);
    const variant = await server.inject({ method: 'GET', url: `/v1/catalog/variants/${encodeURIComponent('gid://shopify/ProductVariant/11')}`, headers: { host: hosts[0] } });
    expect(variant.statusCode).toBe(200);
    expect(variant.json().product.handle).toBe('item-1');
    expect(variant.json().variant.sku).toBe('SKU-1');
  });

  it('serves collections, collection products, filters, search, related and deterministic comparison', async () => {
    const server = app.getHttpAdapter().getInstance();
    const collections = await server.inject({ method: 'GET', url: '/v1/catalog/collections', headers: { host: hosts[0] } });
    expect(collections.json().items[0]).toMatchObject({ handle: 'gifts', productCount: 2 });
    const collection = await server.inject({ method: 'GET', url: '/v1/catalog/collections/gifts', headers: { host: hosts[0] } });
    expect(collection.json().provenance.shopifyId).toBe('gid://shopify/Collection/9');
    const collectionProducts = await server.inject({ method: 'GET', url: '/v1/catalog/collections/gifts/products', headers: { host: hosts[0] } });
    expect(collectionProducts.json().items.map((item: { handle: string }) => item.handle)).toEqual(['item-1', 'item-2']);
    const filters = await server.inject({ method: 'GET', url: '/v1/catalog/filters', headers: { host: hosts[0] } });
    expect(filters.json().productTypes.map((entry: { value: string }) => entry.value)).toEqual(['Chains', 'Rings']);
    expect(filters.json().options).toEqual([{ name: 'Size', values: [{ value: 'L', count: 1 }, { value: 'M', count: 1 }] }]);
    expect(filters.json().attributes).toEqual([{ name: 'custom.engraving', values: [{ value: 'configurable', count: 1 }] }]);
    expect(filters.json().priceRange).toEqual({ min: '25.00', max: '59.00' });
    const search = await server.inject({ method: 'GET', url: '/v1/catalog/search?q=' + encodeURIComponent('alpha ring'), headers: { host: hosts[0] } });
    expect(search.json().items.map((item: { handle: string }) => item.handle)).toEqual(['item-1']);
    const related = await server.inject({ method: 'GET', url: '/v1/catalog/products/item-1/related', headers: { host: hosts[0] } });
    expect(related.json().items[0]).toMatchObject({ relation: 'collection', provenance: 'gid://shopify/Collection/9' });
    const compare = await server.inject({ method: 'GET', url: '/v1/catalog/compare?ids=' + encodeURIComponent('item-1,item-2'), headers: { host: hosts[0] } });
    const comparison = compare.json();
    expect(comparison.products.map((entry: { ref: string }) => entry.ref)).toEqual(['gid://shopify/Product/1', 'gid://shopify/Product/2']);
    expect(comparison.rows[0].label).toBe('Availability');
    expect(comparison.rows.map((row: { label: string }) => row.label)).toContain('Size');
    const status = await server.inject({ method: 'GET', url: '/v1/catalog/status', headers: { host: hosts[0] } });
    expect(status.json()).toMatchObject({ status: 'FRESH', generation });
  });

  it('returns UNKNOWN compatibility without inference and enforces CSRF on cookie sync mutations', async () => {
    const server = app.getHttpAdapter().getInstance();
    const compatible = await server.inject({ method: 'GET', url: '/v1/catalog/products/item-1/compatible-options', headers: { host: hosts[0] } });
    expect(compatible.json().compatibility).toBe('UNKNOWN');
    expect(compatible.json().personalization[0]).toMatchObject({ namespace: 'custom', key: 'engraving', value: 'configurable' });
    const cookieMutation = await server.inject({ method: 'POST', url: '/v1/catalog/sync', headers: { host: hosts[0], cookie: `vaarg_merchant_session=${token}` }, payload: {} });
    expect(cookieMutation.statusCode).toBe(403);
    const bearerMutation = await server.inject({ method: 'POST', url: '/v1/catalog/sync', headers: { host: hosts[0], authorization: `Bearer ${token}` }, payload: {} });
    expect(bearerMutation.statusCode).toBe(200);
    expect(bearerMutation.json().status).toBe('STARTED_OR_RESUMED');
    const anonymous = await server.inject({ method: 'POST', url: '/v1/catalog/sync', headers: { host: hosts[0] }, payload: {} });
    expect(anonymous.statusCode).toBe(401);
    // Restore the completed snapshot: the sweep above restarted a new generation.
    await admin.query("UPDATE catalog_imports SET phase='complete',completed_at=now(),lease_token=NULL,lease_until=NULL WHERE store_id=$1 AND country='FR' AND language='FR'", [storeA]);
    await admin.query('UPDATE catalog_products SET visible=false,generation=$2 WHERE store_id=$1 AND generation<>$2', [storeA, generation]);
    await admin.query('UPDATE catalog_variants SET visible=false,generation=$2 WHERE store_id=$1 AND generation<>$2', [storeA, generation]);
    await admin.query('UPDATE catalog_collections SET visible=false,generation=$2 WHERE store_id=$1 AND generation<>$2', [storeA, generation]);
    await admin.query('UPDATE catalog_search_documents SET visible=false,generation=$2 WHERE store_id=$1 AND generation<>$2', [storeA, generation]);
  });
});
