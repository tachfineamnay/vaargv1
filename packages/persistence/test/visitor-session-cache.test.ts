import { describe, expect, it, vi } from 'vitest';
import {
  VisitorSessionCache,
  sessionCacheTtlSeconds,
  visitorSessionCacheKey,
} from '../src/sessions/visitor-session-cache.js';

const storeId = '00000000-0000-4000-8000-000000000001';
const otherStore = '00000000-0000-4000-8000-000000000002';
const sessionId = '00000000-0000-4000-8000-000000000003';
const tokenHash = 'a'.repeat(64);

const active = {
  sessionId,
  storeId,
  customerId: null,
  status: 'active',
  context: 'default',
  expiresAt: new Date(Date.now() + 60_000),
  createdAt: new Date(Date.now() - 1000),
};

function memoryClient() {
  const values = new Map<string, string>();
  const client = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, _mode: 'EX', _ttl: number) => {
      values.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      values.delete(key);
      return 1;
    }),
  };
  return { client, values };
}

describe('visitor session cache — derived Valkey state', () => {
  it('derives TTL from session expiry and refuses expired sessions', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(sessionCacheTtlSeconds(new Date('2026-01-01T00:01:00.000Z'), now)).toBe(60);
    expect(sessionCacheTtlSeconds(new Date('2026-01-01T00:00:00.000Z'), now)).toBeNull();
    expect(sessionCacheTtlSeconds(new Date('2025-12-31T23:59:59.000Z'), now)).toBeNull();
  });

  it('builds store-scoped keys from the hashed token, never the raw token', () => {
    expect(visitorSessionCacheKey(storeId, tokenHash)).toContain(storeId);
    expect(visitorSessionCacheKey(storeId, tokenHash)).toContain(tokenHash);
    expect(visitorSessionCacheKey(storeId, tokenHash)).not.toBe(
      visitorSessionCacheKey(otherStore, tokenHash),
    );
  });

  it('round-trips an active session with a TTL bounded by expiry', async () => {
    const { client, values } = memoryClient();
    const cache = new VisitorSessionCache(client);
    await cache.set(storeId, tokenHash, active);
    expect(client.set).toHaveBeenCalledWith(
      visitorSessionCacheKey(storeId, tokenHash),
      expect.any(String),
      'EX',
      expect.any(Number),
    );
    const ttl = client.set.mock.calls[0]![3] as number;
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
    const hit = await cache.get(storeId, tokenHash);
    expect(hit?.sessionId).toBe(sessionId);
    // A different store cannot read the entry (keys are store-scoped), and
    // the legitimate entry survives the foreign lookup untouched.
    expect(await cache.get(otherStore, tokenHash)).toBeNull();
    expect(values.has(visitorSessionCacheKey(storeId, tokenHash))).toBe(true);
    expect(visitorSessionCacheKey(otherStore, tokenHash)).not.toContain(storeId);
  });

  it('never serves revoked or expired entries and evicts them', async () => {
    const { client } = memoryClient();
    const cache = new VisitorSessionCache(client);
    await cache.set(storeId, tokenHash, { ...active, status: 'revoked' });
    expect(client.set).not.toHaveBeenCalled();

    await cache.set(storeId, tokenHash, { ...active, expiresAt: new Date(Date.now() - 1) });
    expect(client.set).not.toHaveBeenCalled();

    // Poisoned entry written out-of-band: expired payload must be evicted.
    await client.set(
      visitorSessionCacheKey(storeId, tokenHash),
      JSON.stringify({
        ...active,
        status: 'active',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        createdAt: active.createdAt.toISOString(),
      }),
      'EX',
      10,
    );
    expect(await cache.get(storeId, tokenHash)).toBeNull();
    expect(client.del).toHaveBeenCalledWith(visitorSessionCacheKey(storeId, tokenHash));
  });

  it('degrades to a cache miss on client failures', async () => {
    const failing = {
      get: vi.fn(async () => {
        throw new Error('valkey down');
      }),
      set: vi.fn(async () => {
        throw new Error('valkey down');
      }),
      del: vi.fn(async () => {
        throw new Error('valkey down');
      }),
    };
    const cache = new VisitorSessionCache(failing);
    await expect(cache.set(storeId, tokenHash, active)).resolves.toBeUndefined();
    await expect(cache.get(storeId, tokenHash)).resolves.toBeNull();
    await expect(cache.del(storeId, tokenHash)).resolves.toBeUndefined();
  });
});
