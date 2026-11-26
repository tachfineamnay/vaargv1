import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { executeCatalogStep } from '../src/commerce/execution.js';
const binding = { host:'synthetic.example', storeId:'00000000-0000-4000-8000-000000000001', country:'FR', language:'FR', currency:'EUR', shopifyDomain:'synthetic.myshopify.com', tokenEnv:'SHOPIFY_SYNTHETIC' };
describe('authorized catalog execution boundary', () => {
  it('fails before database or provider access when server credentials are missing', async () => {
    const pool = { connect: vi.fn() } as unknown as Pool;
    const redis = { eval: vi.fn() };
    await expect(executeCatalogStep(pool, redis, binding, {}, 'step')).rejects.toThrow('NOT_CONFIGURED');
    expect(pool.connect).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });
});
