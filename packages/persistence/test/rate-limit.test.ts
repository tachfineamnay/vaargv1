import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { createShopifyRateLimiter } from '../src/commerce/rate-limit.js';
const url = process.env.P02B_VALKEY_TEST_URL;
if (url) { const parsed = new URL(url); if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/15') throw new Error('Dedicated local Valkey test DB required'); }
(url ? describe : describe.skip)('shared Shopify pacing', () => {
  const redis = new Redis(url ?? 'redis://127.0.0.1:1/15', { lazyConnect: true, maxRetriesPerRequest: 0 });
  const store = randomUUID();
  afterAll(async () => { await redis.quit(); });
  it('serializes starts across separate limiter instances', async () => {
    const first = createShopifyRateLimiter(redis, store, 150);
    const second = createShopifyRateLimiter(redis, store, 150);
    const begin = Date.now();
    await Promise.all([first.acquire(), second.acquire()]);
    expect(Date.now() - begin).toBeGreaterThanOrEqual(120);
  });
  it('fails closed on cancellation', async () => {
    const limiter = createShopifyRateLimiter(redis, store, 500);
    await limiter.acquire();
    const abort = new AbortController();
    abort.abort();
    await expect(limiter.acquire(abort.signal)).rejects.toThrow('CANCELLED');
  });
  it('shares provider cooldown between limiter instances', async () => {
    const id = randomUUID();
    const first = createShopifyRateLimiter(redis, id, 150);
    const second = createShopifyRateLimiter(redis, id, 150);
    await first.defer!(200);
    const start = Date.now();
    await second.acquire();
    expect(Date.now() - start).toBeGreaterThanOrEqual(160);
  });
});
