import { describe, expect, it, vi } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { createDb, withStoreContext } from '../src/db/client.js';

const id = '00000000-0000-4000-8000-000000000001';

describe('store context boundary', () => {
  it('rejects invalid tenant identifiers before acquiring a connection', async () => {
    const pool = new Pool();
    const connect = vi.spyOn(pool, 'connect');
    await expect(withStoreContext(createDb(pool), 'bad', async () => null)).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
    await pool.end();
  });
  it('rejects unsafe roles and rolls back', async () => {
    const pool = new Pool();
    const query = vi.fn(async (sql: string) => sql.includes('pg_roles') ? { rows: [{ unsafe: true }] } : { rows: [] });
    const release = vi.fn();
    vi.spyOn(pool, 'connect').mockResolvedValue({ query, release } as unknown as PoolClient);
    const action = vi.fn();
    await expect(withStoreContext(createDb(pool), id, action)).rejects.toThrow('UNSAFE_DATABASE_ROLE');
    expect(action).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalled();
    await pool.end();
  });
});
