import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { runMigrations, hashToken, createArgon2Hash, verifyCatalogDelegation } from '@vaarg/persistence';
import { AppModule } from '../src/app.module.js';
import { DatabaseClient } from '../src/infra/database-client.js';
import { ValkeyClient } from '../src/infra/valkey-client.js';
import { ApiExceptionFilter } from '../src/common/exception.filter.js';
const url = process.env.P02B_API_TEST_URL;
if (url) { const parsed = new URL(url); if (!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname) || parsed.pathname !== '/vaarg_p02a_test') throw new Error('Dedicated local PG test DB required'); }
(url ? describe : describe.skip)('catalog HTTP on isolated PG18', () => {
  const ids = [randomUUID(), randomUUID()] as const;
  const merchant = randomUUID(); const role = `p02b_${randomUUID().replaceAll('-', '')}`; const token = 'x'.repeat(43);
  let admin: Pool; let app: NestFastifyApplication;
  const saved = { ...process.env };
  const hosts = ['synthetic-a.example', 'synthetic-b.example'] as const;
  const fixture = (n: string) => ({ id:`gid://shopify/Product/${n}`, handle:`item-${n}`, title:`Item ${n}`, description:'Synthetic', productType:'', vendor:'', tags:[], updatedAt:'2026-01-01T00:00:00Z', availableForSale:true, variants:{ nodes:[{id:`gid://shopify/ProductVariant/${n}`,title:'Default',availableForSale:true,price:{amount:'10.00',currencyCode:'EUR'},selectedOptions:[]}],pageInfo:{hasNextPage:false,endCursor:null}}, images:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}, media:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}} });
  beforeAll(async () => {
    if (!url) throw new Error('Test URL required');
    await runMigrations(url);
    admin = new Pool({ connectionString:url });
    await admin.query(`CREATE ROLE ${role} LOGIN INHERIT PASSWORD 'synthetic_test_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query(`GRANT vaarg_app TO ${role}`);
    for (let i=0;i<2;i++) {
      const id=ids[i]!; const generation=randomUUID();
      await admin.query('INSERT INTO stores(store_id,slug,name) VALUES($1,$2,$3)',[id,`p02b-${id}`,'Synthetic']);
      await admin.query("INSERT INTO catalog_imports(store_id,country,language,generation,phase,completed_at) VALUES($1,'FR','FR',$2,'complete',now())",[id,generation]);
      const products = i===0 ? [fixture('1'),fixture('2')] : [fixture('3')];
      for (const product of products) await admin.query("INSERT INTO catalog_projection(store_id,country,language,kind,shopify_id,payload,seen_generation) VALUES($1,'FR','FR','product',$2,$3,$4)",[id,product.id,JSON.stringify(product),generation]);
    }
    await admin.query('INSERT INTO merchant_users(merchant_user_id,store_id,email,password_hash) VALUES($1,$2,$3,$4)',[merchant,ids[0],`${merchant}@synthetic.test`,await createArgon2Hash('SyntheticPassword!2026')]);
    await admin.query("INSERT INTO store_memberships(store_id,merchant_user_id,role) VALUES($1,$2,'owner')",[ids[0],merchant]);
    await admin.query("INSERT INTO merchant_sessions(store_id,merchant_user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[ids[0],merchant,hashToken(token)]);
    const runtimeUrl = new URL(url); runtimeUrl.username=role; runtimeUrl.password='synthetic_test_password';
    process.env.DATABASE_URL=runtimeUrl.toString(); process.env.VALKEY_URL='redis://127.0.0.1:56380/15'; process.env.NODE_ENV='test'; process.env.SHOPIFY_P02B_TEST_TOKEN='synthetic-only'; process.env.CATALOG_JOB_SIGNING_SECRET='synthetic-signing-secret-at-least-32-bytes';
    process.env.STOREFRONT_BINDINGS_JSON=JSON.stringify(ids.map((storeId,i)=>({host:hosts[i],storeId,country:'FR',language:'FR',currency:'EUR',shopifyDomain:`synthetic-${i}.myshopify.com`,tokenEnv:'SHOPIFY_P02B_TEST_TOKEN'})));
    app = await NestFactory.create<NestFastifyApplication>(AppModule,new FastifyAdapter({logger:false}),{logger:false,abortOnError:false});
    app.useGlobalFilters(new ApiExceptionFilter()); await app.init(); await app.getHttpAdapter().getInstance().ready();
  },30000);
  afterAll(async () => {
    vi.unstubAllGlobals();
    if (app) { await app.get(ValkeyClient).close(); await app.get(DatabaseClient).close(); await app.close(); }
    if (admin) { await admin.query('DELETE FROM stores WHERE store_id=ANY($1::uuid[])',[ids]); await admin.query(`DROP ROLE IF EXISTS ${role}`); await admin.end(); }
    for (const key of ['DATABASE_URL','VALKEY_URL','NODE_ENV','SHOPIFY_P02B_TEST_TOKEN','STOREFRONT_BINDINGS_JSON','CATALOG_JOB_SIGNING_SECRET']) { if (saved[key] === undefined) delete process.env[key]; else process.env[key]=saved[key]; }
  },30000);
  it('returns validated filtered pages and rejects cross-store overrides', async () => {
    const server=app.getHttpAdapter().getInstance();
    const first=await server.inject({method:'GET',url:'/catalog/products?limit=1',headers:{host:hosts[0]}});
    expect(first.statusCode).toBe(200); const page=first.json(); expect(page.status).toBe('FRESH'); expect(page.items).toHaveLength(1); expect(page.nextCursor).toBeTruthy();
    const second=await server.inject({method:'GET',url:`/catalog/products?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`,headers:{host:hosts[0]}});
    expect(second.json().items[0].data.id).not.toBe(page.items[0].data.id);
    const other=await server.inject({method:'GET',url:'/catalog/products',headers:{host:hosts[1]}});
    expect(other.json().items.map((x:{data:{id:string}})=>x.data.id)).toEqual(['gid://shopify/Product/3']);
    expect((await server.inject({method:'GET',url:`/catalog/products?storeId=${ids[1]}`,headers:{host:hosts[0]}})).statusCode).toBe(400);
    expect((await server.inject({method:'GET',url:'/catalog/products',headers:{host:'unknown.example'}})).statusCode).toBe(404);
    expect((await server.inject({method:'GET',url:'/catalog/products/item-1',headers:{host:hosts[0]}})).json().items[0].data.handle).toBe('item-1');
  });
  it('protects status and sync against missing and cross-store sessions', async () => {
    const server=app.getHttpAdapter().getInstance();
    expect((await server.inject({method:'POST',url:'/catalog/merchant/session',headers:{host:hosts[0],origin:'https://evil.example'},payload:{email:`${merchant}@synthetic.test`,password:'SyntheticPassword!2026'}})).statusCode).toBe(403);
    const login=await server.inject({method:'POST',url:'/catalog/merchant/session',headers:{host:hosts[0],origin:`https://${hosts[0]}`},payload:{email:`${merchant}@synthetic.test`,password:'SyntheticPassword!2026'}});
    expect(login.statusCode).toBe(201);
    const newToken=login.json().token;
    expect(newToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await server.inject({method:'GET',url:'/catalog/sync',headers:{host:hosts[0],authorization:`Bearer ${newToken}`}})).statusCode).toBe(200);
    const delegated=await server.inject({method:'POST',url:'/catalog/sync/delegation',headers:{host:hosts[0],authorization:`Bearer ${newToken}`},payload:{action:'step'}});
    expect(delegated.statusCode).toBe(201);
    const ticket=delegated.json();
    expect(verifyCatalogDelegation(ticket.ticket,process.env.CATALOG_JOB_SIGNING_SECRET!)).toMatchObject({storeId:ids[0],merchantUserId:merchant,jobId:ticket.jobId,action:'step'});
    expect(ticket.ticket).not.toContain(newToken);
    expect((await server.inject({method:'POST',url:'/catalog/merchant/logout',headers:{host:hosts[0],authorization:`Bearer ${newToken}`}})).statusCode).toBe(201);
    expect((await server.inject({method:'GET',url:'/catalog/sync',headers:{host:hosts[0],authorization:`Bearer ${newToken}`}})).statusCode).toBe(401);
    expect((await server.inject({method:'GET',url:'/catalog/sync',headers:{host:hosts[0]}})).statusCode).toBe(401);
    expect((await server.inject({method:'GET',url:'/catalog/sync',headers:{host:hosts[1],authorization:`Bearer ${token}`}})).statusCode).toBe(401);
    expect((await server.inject({method:'GET',url:'/catalog/sync',headers:{host:hosts[0],authorization:`Bearer ${token}`}})).statusCode).toBe(200);
    expect((await server.inject({method:'POST',url:'/catalog/sync',headers:{host:hosts[0],authorization:`Bearer ${token}`}})).statusCode).toBe(201);
    const fetcher=vi.fn(async () => new Response(JSON.stringify({data:{localization:{country:{currency:{isoCode:'EUR'}}},products:{nodes:[fixture('1')],pageInfo:{hasNextPage:false,endCursor:null}}},extensions:{context:{country:'FR',language:'FR'}}}), {headers:{'x-shopify-api-version':'2026-10'}}));
    vi.stubGlobal('fetch',fetcher);
    const step=await server.inject({method:'POST',url:'/catalog/sync/step',headers:{host:hosts[0],authorization:`Bearer ${token}`}});
    expect(step.statusCode).toBe(201);
    expect(step.json().status).toBe('collections');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await admin.query("UPDATE store_memberships SET status='revoked' WHERE store_id=$1 AND merchant_user_id=$2",[ids[0],merchant]);
    expect((await server.inject({method:'POST',url:'/catalog/sync/step',headers:{host:hosts[0],authorization:`Bearer ${token}`}})).statusCode).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (let i=0;i<4;i++) expect((await server.inject({method:'POST',url:'/catalog/merchant/session',headers:{host:hosts[0],origin:`https://${hosts[0]}`},payload:{email:`${merchant}@synthetic.test`,password:'WrongPassword!2026'}})).statusCode).toBe(401);
    expect((await server.inject({method:'POST',url:'/catalog/merchant/session',headers:{host:hosts[0],origin:`https://${hosts[0]}`},payload:{email:`${merchant}@synthetic.test`,password:'WrongPassword!2026'}})).statusCode).toBe(429);
  });
});
