import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import * as schema from '../schema/index.js';

/** Base database type shared by pool- and client-bound Drizzle instances. */
export type AppDb = NodePgDatabase<typeof schema>;
export type Db = AppDb & { $client: Pool };

/**
 * Runtime role used by the application. Has NO BYPASSRLS and NO superuser
 * privileges, so RLS policies are always enforced.
 */
export const RUNTIME_ROLE = 'vaarg_app';

/** GUC carrying the active store context for the current transaction. */
export const STORE_CONTEXT_GUC = 'app.store_id';

export interface DbHandle {
  db: Db;
  pool: Pool;
}

/**
 * Create the Drizzle handle over a pg Pool. The Pool itself is shared; the
 * store context is applied per-transaction (SET LOCAL), so tenant context
 * never leaks across pooled connections.
 */
export function createDb(pool: Pool): DbHandle {
  const db = drizzle(pool, { schema }) as Db;
  return { db, pool };
}

export function createPool(connectionString: string, opts?: { max?: number }): Pool {
  return new Pool({
    connectionString,
    max: opts?.max ?? 10,
    options: '-c search_path=public',
  });
}

/**
 * Execute `fn` inside a store-scoped transaction. The store context is set
 * with SET LOCAL, which is transaction-scoped: it is visible to the RLS
 * policies during the transaction and is automatically reverted when the
 * transaction ends — so a returned pooled connection never carries tenant
 * context into another request.
 */
export async function withStoreContext<T>(
  handle: DbHandle,
  storeId: string,
  fn: (tx: AppDb) => Promise<T>,
): Promise<T> {
  const client = await handle.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ${STORE_CONTEXT_GUC} = $1`, [storeId]);
    const tx = drizzle(client, { schema });
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Read-only variant (same isolation guarantee). */
export async function withStoreContextReadOnly<T>(
  handle: DbHandle,
  storeId: string,
  fn: (tx: AppDb) => Promise<T>,
): Promise<T> {
  return withStoreContext(handle, storeId, fn);
}

export type { PoolClient };
