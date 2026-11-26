import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import * as schema from '../schema/index.js';
import { uuidSchema } from '../validation/schemas.js';

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

/** Refuse identities that can bypass RLS, including through role membership. */
export async function assertRestrictedRole(client: PoolClient): Promise<void> {
  const role = await client.query<{ unsafe: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM pg_roles r
      WHERE (r.rolname IN (current_user, session_user) OR pg_has_role(current_user, r.oid, 'MEMBER'))
        AND (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb)
    ) OR EXISTS (
      SELECT 1 FROM pg_class c
      WHERE c.relrowsecurity AND pg_has_role(current_user, c.relowner, 'MEMBER')
    ) AS unsafe
  `);
  if (role.rows[0]?.unsafe !== false) throw new Error('UNSAFE_DATABASE_ROLE');
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
  uuidSchema.parse(storeId);
  const client = await handle.pool.connect();
  let discard = false;
  try {
    await client.query(`RESET ${STORE_CONTEXT_GUC}`);
    await client.query('BEGIN');
    await assertRestrictedRole(client);
    await client.query('SELECT set_config($1, $2, true)', [STORE_CONTEXT_GUC, storeId]);
    const tx = drizzle(client, { schema });
    const result = await fn(tx);
    const commit = await client.query('COMMIT');
    if (commit.command !== 'COMMIT') throw new Error('TRANSACTION_NOT_COMMITTED');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally {
    try { await client.query(`RESET ${STORE_CONTEXT_GUC}`); } catch { discard = true; }
    client.release(discard);
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
