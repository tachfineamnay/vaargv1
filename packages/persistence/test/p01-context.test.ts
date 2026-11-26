import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createDb, withStoreContext } from '../src/db/client.js';
const url = process.env.P02_MIGRATION_TEST_URL;
if (url) { const parsed = new URL(url); if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/vaarg_migration_test') throw new Error('A dedicated local test database is required'); }
(url && new URL(url).pathname === '/vaarg_migration_test' ? describe : describe.skip)('P01 tenant transaction against isolated PostgreSQL', () => {
  it('sets and clears the tenant context on a pooled connection', async () => {
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      const storeId = '00000000-0000-4000-8000-000000000001';
      const actual = await withStoreContext(createDb(pool), storeId, async (db) => {
        const result = await db.execute("select current_setting('app.store_id', true) as store_id");
        return result.rows[0]?.store_id;
      });
      expect(actual).toBe(storeId);
      const after = await pool.query("select current_setting('app.store_id', true) as store_id");
      expect(after.rows[0].store_id ?? '').toBe('');
    } finally { await pool.end(); }
  });
});
