import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashToken, issueCatalogDelegation, runMigrations } from '@vaarg/persistence';
import { createWorkerRuntime, type WorkerRuntime } from '../src/worker-runtime.js';
const url=process.env.P02B_WORKER_TEST_URL;
if (url) { const parsed=new URL(url); if (!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname) || parsed.pathname !== '/vaarg_p02a_test') throw new Error('Dedicated local PG test DB required'); }
(url ? describe : describe.skip)('catalog worker integration on isolated PG18 and Valkey', () => {
  const storeId=randomUUID(), merchant=randomUUID(), sessionId=randomUUID(), role=`p02bw_${randomUUID().replaceAll('-', '')}`, secret='synthetic-signing-secret-at-least-32-bytes';
  let admin:Pool; let runtime:WorkerRuntime;
  beforeAll(async () => {
    if (!url) throw new Error('Test URL required');
    await runMigrations(url); admin=new Pool({connectionString:url});
    await admin.query(`CREATE ROLE ${role} LOGIN INHERIT PASSWORD 'synthetic_test_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query(`GRANT vaarg_app TO ${role}`);
    await admin.query('INSERT INTO stores(store_id,slug,name) VALUES($1,$2,$3)',[storeId,`p02bw-${storeId}`,'Synthetic']);
    await admin.query('INSERT INTO merchant_users(merchant_user_id,store_id,email,password_hash) VALUES($1,$2,$3,$4)',[merchant,storeId,`${merchant}@synthetic.test`,'synthetic']);
    await admin.query("INSERT INTO store_memberships(store_id,merchant_user_id,role) VALUES($1,$2,'owner')",[storeId,merchant]);
    await admin.query("INSERT INTO merchant_sessions(session_id,store_id,merchant_user_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",[sessionId,storeId,merchant,hashToken('synthetic-session')]);
    const appUrl=new URL(url); appUrl.username=role; appUrl.password='synthetic_test_password';
    const binding={host:'worker.synthetic.example',storeId,country:'FR',language:'FR',currency:'EUR',shopifyDomain:'synthetic.myshopify.com',tokenEnv:'SHOPIFY_WORKER_TEST'};
    runtime=await createWorkerRuntime({ NODE_ENV:'test', LOG_LEVEL:'silent', DATABASE_URL:appUrl.toString(), VALKEY_URL:'redis://127.0.0.1:56380/15', STOREFRONT_BINDINGS_JSON:JSON.stringify([binding]), SHOPIFY_WORKER_TEST:'synthetic-only', CATALOG_JOB_SIGNING_SECRET:secret });
  },30000);
  afterAll(async () => { vi.unstubAllGlobals(); await runtime?.shutdown(); if(admin) { await admin.query('DELETE FROM stores WHERE store_id=$1',[storeId]); await admin.query(`DROP ROLE IF EXISTS ${role}`); await admin.end(); } },30000);
  it('reauthorizes each operation and persists actual returned pages', async () => {
    const product={id:'gid://shopify/Product/worker',handle:'worker-item',title:'Synthetic',description:'',productType:'',vendor:'',tags:[],updatedAt:'2026-01-01T00:00:00Z',availableForSale:false,variants:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}},images:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}},media:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}};
    const fetcher=vi.fn(async (_url:string | URL | Request, init?:RequestInit) => {
      const body=JSON.parse(String(init?.body)) as {query:string};
      const data=body.query.includes('query Products') ? {localization:{country:{currency:{isoCode:'EUR'}}},products:{nodes:[product],pageInfo:{hasNextPage:false,endCursor:null}}} : {collections:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}};
      return new Response(JSON.stringify({data,extensions:{context:{country:'FR',language:'FR'}}}), {headers:{'x-shopify-api-version':'2026-10'}});
    });
    vi.stubGlobal('fetch',fetcher);
    const job=(action:'start' | 'step') => { const jobId=randomUUID(); return { jobId, attempt:1, payload:{ ticket:issueCatalogDelegation({host:'worker.synthetic.example',storeId,merchantUserId:merchant,sessionId,jobId,action,expiresAt:Date.now()+60000},secret) } }; };
    expect(runtime.runner.registeredJobs).toContain('catalog.import');
    const invalid=job('step');
    await expect(runtime.runner.run('catalog.import',{...invalid,payload:{ticket:`${invalid.payload.ticket}x`}})).rejects.toThrow('UNAUTHORIZED');
    expect(fetcher).not.toHaveBeenCalled();
    await runtime.runner.run('catalog.import',job('start'));
    const first=job('step');
    await runtime.runner.run('catalog.import',first);
    await runtime.runner.run('catalog.import',first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await runtime.runner.run('catalog.import',job('step'));
    const rows=await admin.query('SELECT payload FROM catalog_projection WHERE store_id=$1',[storeId]);
    expect(rows.rows[0].payload.id).toBe(product.id);
    expect((await admin.query('SELECT phase FROM catalog_imports WHERE store_id=$1',[storeId])).rows[0].phase).toBe('complete');
    await admin.query("UPDATE merchant_sessions SET status='revoked' WHERE session_id=$1",[sessionId]);
    await expect(runtime.runner.run('catalog.import',job('step'))).rejects.toThrow('UNAUTHORIZED');
    await admin.query("UPDATE merchant_sessions SET status='active' WHERE session_id=$1",[sessionId]);
    await admin.query("UPDATE store_memberships SET status='revoked' WHERE store_id=$1 AND merchant_user_id=$2",[storeId,merchant]);
    await expect(runtime.runner.run('catalog.import',job('step'))).rejects.toThrow('UNAUTHORIZED');
  },30000);
});
