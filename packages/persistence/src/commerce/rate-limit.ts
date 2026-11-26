import { z } from 'zod';

export interface RateLimitClient { eval(script: string, numberOfKeys: number, ...args: (string | number)[]): Promise<unknown> }
export interface ShopifyRateLimiter { acquire(signal?: AbortSignal): Promise<void>; defer?(milliseconds: number): Promise<void> }
const CLAIM = `if redis.call('SET',KEYS[1],'1','PX',ARGV[1],'NX') then return 0 end local ttl=redis.call('PTTL',KEYS[1]); if ttl<1 then return 1 end return ttl`;

/** One cross-process start permit per store and interval. Valkey failure is fatal. */
export function createShopifyRateLimiter(client: RateLimitClient, storeId: string, intervalMs = 250): ShopifyRateLimiter {
  const id = z.uuid().parse(storeId);
  const interval = z.number().int().min(50).max(60000).parse(intervalMs);
  const key = `vaarg:{${id}}:shopify:request-pacing`;
  return { async defer(milliseconds) {
    const wait = z.number().int().min(1).max(86400000).parse(milliseconds);
    await client.eval("local ttl=redis.call('PTTL',KEYS[1]); if ttl<tonumber(ARGV[1]) then redis.call('SET',KEYS[1],'1','PX',ARGV[1]) end; return 1", 1, key, wait);
  }, async acquire(signal) {
    const deadline = Date.now() + 30000;
    while (true) {
      if (signal?.aborted) throw new Error('CANCELLED');
      const wait = z.number().int().nonnegative().parse(await client.eval(CLAIM, 1, key, interval));
      if (wait === 0) return;
      if (Date.now() + wait > deadline) throw new Error('RATE_LIMIT_WAIT_EXCEEDED');
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, wait);
        const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('CANCELLED')); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
  } };
}
