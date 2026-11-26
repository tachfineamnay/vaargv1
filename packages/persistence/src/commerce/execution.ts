import type { Pool } from 'pg';
import { z } from 'zod';
import { importCatalogPage, readCatalogSnapshot, startCatalogSweep } from './import.js';
import { createShopifyCommerce } from './shopify.js';
import { createShopifyRateLimiter, type RateLimitClient } from './rate-limit.js';
import { parseStorefrontBindings, type StorefrontBinding } from './store-config.js';

/** Trusted callers resolve a configured binding and authorize the operation first. */
export async function executeCatalogStep(pool: Pool, rateClient: RateLimitClient, rawBinding: StorefrontBinding, env: NodeJS.ProcessEnv, rawAction: 'start' | 'step' | 'status', signal?: AbortSignal, jobId?: string) {
  const binding = parseStorefrontBindings([rawBinding])[0]!;
  const action = z.enum(['start', 'step', 'status']).parse(rawAction);
  const token = env[binding.tokenEnv];
  if (!token) throw new Error('NOT_CONFIGURED');
  if (signal?.aborted) throw new Error('CANCELLED');
  const input = { storeId: binding.storeId, country: binding.country, language: binding.language };
  if (action === 'status') {
    const state = await readCatalogSnapshot(pool, input, 3600000);
    return { status: state.freshness, completedAt: state.completedAt };
  }
  if (action === 'start') {
    await startCatalogSweep(pool, input, jobId);
    return { status: 'STARTED_OR_RESUMED' as const, completedAt: null };
  }
  const shop = createShopifyCommerce({ domain: binding.shopifyDomain, token, apiVersion: '2026-10' }, { expectedCurrency: binding.currency, rateLimiter: createShopifyRateLimiter(rateClient, binding.storeId), ...(binding.metafields ? { metafields: binding.metafields } : {}) });
  if (shop.status !== 'READY') throw new Error('NOT_CONFIGURED');
  const state = await importCatalogPage(pool, shop.port, input, signal, jobId);
  return { status: state.phase, completedAt: state.completed_at };
}
