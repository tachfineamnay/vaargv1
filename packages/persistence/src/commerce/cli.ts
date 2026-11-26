/** Server-only CLI: one durable import page per invocation; no provider data or secrets logged. */
import { Pool } from 'pg';
import { createShopifyCommerce } from './shopify.js';
import { importCatalogPage, readCatalogSnapshot, startCatalogSweep } from './import.js';

async function main(): Promise<void> {
  const { DATABASE_URL, CATALOG_STORE_ID, SHOPIFY_DOMAIN, SHOPIFY_STOREFRONT_TOKEN, SHOPIFY_COUNTRY, SHOPIFY_LANGUAGE, CATALOG_ACTION = 'step' } = process.env;
  if (!DATABASE_URL || !CATALOG_STORE_ID || !SHOPIFY_DOMAIN || !SHOPIFY_STOREFRONT_TOKEN || !SHOPIFY_COUNTRY || !SHOPIFY_LANGUAGE) {
    process.stdout.write(`${JSON.stringify({ status: 'NOT_CONFIGURED' })}\n`);
    process.exitCode = 2;
    return;
  }
  const shop = createShopifyCommerce({ domain: SHOPIFY_DOMAIN, token: SHOPIFY_STOREFRONT_TOKEN, apiVersion: '2026-10' });
  if (shop.status !== 'READY') throw new Error('NOT_CONFIGURED');
  const input = { storeId: CATALOG_STORE_ID, country: SHOPIFY_COUNTRY, language: SHOPIFY_LANGUAGE };
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
  try {
    if (CATALOG_ACTION === 'start') { await startCatalogSweep(pool, input); process.stdout.write(`${JSON.stringify({ status: 'STARTED_OR_RESUMED' })}\n`); }
    else if (CATALOG_ACTION === 'step') { const state = await importCatalogPage(pool, shop.port, input); process.stdout.write(`${JSON.stringify({ status: state.phase, completedAt: state.completed_at })}\n`); }
    else if (CATALOG_ACTION === 'status') { const state = await readCatalogSnapshot(pool, input, 3600000); process.stdout.write(`${JSON.stringify({ status: state.freshness, completedAt: state.completedAt })}\n`); }
    else throw new Error('INVALID_ACTION');
  } finally { await pool.end(); }
}
main().catch(() => { console.error('CATALOG_OPERATION_FAILED'); process.exitCode = 1; });
