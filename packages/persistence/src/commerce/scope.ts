import type { Pool, PoolClient } from 'pg';
import { assertRestrictedRole } from '../db/client.js';
import { marketScopeSchema, type MarketScope } from './catalog-projection.js';

/**
 * Store-scoped transaction boundary for catalog work: the store context GUC
 * is set per transaction (SET LOCAL), the restricted role is re-asserted, and
 * RLS is always enforced. Catalog synchronization keeps provider network calls
 * strictly OUTSIDE these transactions; only checkpoint work runs inside.
 */
export async function scopedCatalogTransaction<T>(
  pool: Pool,
  rawScope: MarketScope & { currency?: string },
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  // Extract the market subset: callers may carry a wider scope (e.g.
  // ExperienceScope with currency) — strict validation applies to the
  // market fields only, extra fields are ignored, never trusted.
  const scope = marketScopeSchema.parse({
    storeId: rawScope.storeId,
    country: rawScope.country,
    language: rawScope.language,
  });
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('RESET app.store_id');
    await client.query('BEGIN');
    await assertRestrictedRole(client);
    await client.query("SELECT set_config('app.store_id', $1, true)", [scope.storeId]);
    const result = await action(client);
    const commit = await client.query('COMMIT');
    if (commit.command !== 'COMMIT') throw new Error('TRANSACTION_NOT_COMMITTED');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally {
    try { await client.query('RESET app.store_id'); } catch { discard = true; }
    client.release(discard);
  }
}

/**
 * Store-only scoped transaction (no market): same GUC + restricted-role
 * guarantees for store-owned tables that need no market columns
 * (visitor_sessions, experience retention purge). RLS is always enforced.
 */
export async function scopedStoreTransaction<T>(
  pool: Pool,
  storeId: string,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const parsed = marketScopeSchema.shape.storeId.parse(storeId);
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('RESET app.store_id');
    await client.query('BEGIN');
    await assertRestrictedRole(client);
    await client.query("SELECT set_config('app.store_id', $1, true)", [parsed]);
    const result = await action(client);
    const commit = await client.query('COMMIT');
    if (commit.command !== 'COMMIT') throw new Error('TRANSACTION_NOT_COMMITTED');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally {
    try { await client.query('RESET app.store_id'); } catch { discard = true; }
    client.release(discard);
  }
}
