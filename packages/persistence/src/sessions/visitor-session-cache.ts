import { z } from 'zod';

/**
 * Store-scoped Valkey derived state for visitor sessions (FL02 TASK 4).
 *
 * PostgreSQL is the durable authority; this cache only ever holds entries
 * written by the write-through paths (create/rotate) and entries whose TTL
 * is derived from the database `expires_at`. Keys are derived from the
 * SHA-256 token hash (never the raw token), scoped per store, so a
 * revoked or expired session is never restored from cache.
 */

export interface VisitorSessionCacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export const visitorSessionCacheEntrySchema = z.strictObject({
  sessionId: z.uuid(),
  storeId: z.uuid(),
  customerId: z.uuid().nullable(),
  status: z.string().max(32),
  context: z.string().max(32),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export type VisitorSessionCacheEntry = z.infer<typeof visitorSessionCacheEntrySchema>;

export interface CachedVisitorSession {
  sessionId: string;
  storeId: string;
  customerId: string | null;
  status: string;
  context: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Cache keys are always store-scoped and keyed by the hashed token, so
 * neither the raw token nor cross-store lookups can appear in Valkey.
 */
export function visitorSessionCacheKey(storeId: string, tokenHash: string): string {
  return `visitor-session:${storeId}:token:${tokenHash}`;
}

/**
 * TTL in seconds derived from the session expiry. Returns null when the
 * session is already expired (nothing is cached for expired sessions), so
 * cache expiration stays consistent with session expiration.
 */
export function sessionCacheTtlSeconds(
  expiresAt: Date,
  now: Date = new Date(),
): number | null {
  const remainingMs = expiresAt.getTime() - now.getTime();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

export class VisitorSessionCache {
  constructor(private readonly client: VisitorSessionCacheClient) {}

  /** Write-through set. Never caches expired or revoked records. */
  async set(
    storeId: string,
    tokenHash: string,
    session: CachedVisitorSession,
  ): Promise<void> {
    if (session.storeId !== storeId || session.status !== 'active') return;
    const ttl = sessionCacheTtlSeconds(session.expiresAt);
    if (ttl === null) return;
    let payload: string;
    try {
      payload = JSON.stringify(
        visitorSessionCacheEntrySchema.parse({
          sessionId: session.sessionId,
          storeId: session.storeId,
          customerId: session.customerId,
          status: session.status,
          context: session.context,
          expiresAt: session.expiresAt.toISOString(),
          createdAt: session.createdAt.toISOString(),
        }),
      );
    } catch {
      return;
    }
    try {
      await this.client.set(
        visitorSessionCacheKey(storeId, tokenHash),
        payload,
        'EX',
        ttl,
      );
    } catch {
      // Cache is derived state: failures degrade to the PostgreSQL read.
    }
  }

  /**
   * Read the derived entry. Entries that are not active, not store-matched
   * or already past `expiresAt` are treated as absent (and best-effort
   * deleted) — the cache never resurrects revoked/expired sessions.
   */
  async get(
    storeId: string,
    tokenHash: string,
  ): Promise<CachedVisitorSession | null> {
    let raw: string | null;
    try {
      raw = await this.client.get(visitorSessionCacheKey(storeId, tokenHash));
    } catch {
      return null;
    }
    if (!raw) return null;
    let entry: VisitorSessionCacheEntry | null = null;
    try {
      const result = visitorSessionCacheEntrySchema.safeParse(JSON.parse(raw));
      if (result.success) entry = result.data;
    } catch {
      entry = null;
    }
    if (!entry || entry.storeId !== storeId) {
      await this.deleteQuietly(storeId, tokenHash);
      return null;
    }
    if (entry.status !== 'active' || new Date(entry.expiresAt).getTime() <= Date.now()) {
      await this.deleteQuietly(storeId, tokenHash);
      return null;
    }
    return {
      sessionId: entry.sessionId,
      storeId: entry.storeId,
      customerId: entry.customerId,
      status: entry.status,
      context: entry.context,
      expiresAt: new Date(entry.expiresAt),
      createdAt: new Date(entry.createdAt),
    };
  }

  /** Delete on revocation/rotation so the cache follows the durable state. */
  async del(storeId: string, tokenHash: string): Promise<void> {
    await this.deleteQuietly(storeId, tokenHash);
  }

  private async deleteQuietly(storeId: string, tokenHash: string): Promise<void> {
    try {
      await this.client.del(visitorSessionCacheKey(storeId, tokenHash));
    } catch {
      // Derived state: TTL still bounds staleness.
    }
  }
}
