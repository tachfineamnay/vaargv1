import { copyFile, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
const url = process.env.P02_UPGRADE_TEST_URL;
if (url) { const parsed = new URL(url); if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/vaarg_upgrade_test') throw new Error('A dedicated local test database is required'); }
(url && new URL(url).pathname === '/vaarg_upgrade_test' ? describe : describe.skip)('populated P01 upgrade on isolated PostgreSQL', () => {
  it('keeps existing store data while applying P02 migration', async () => {
    if (!url) throw new Error('isolated test URL required');
    const dir = await mkdtemp(join(tmpdir(), 'vaarg-p02-migrations-'));
    for (const file of ['0000_0001_init.sql', '0001_rls_roles.sql']) await copyFile(resolve('migrations', file), join(dir, file));
    expect((await runMigrations(url, dir)).applied).toHaveLength(2);
    const pool = new Pool({ connectionString: url });
    try {
      await pool.query("INSERT INTO stores(store_id,name,slug) VALUES ('00000000-0000-4000-8000-000000000002','Synthetic Store','synthetic-store')");
      await pool.query("INSERT INTO idempotency_keys(store_id,scope,principal,payload_hash,response) VALUES ('00000000-0000-4000-8000-000000000002','order','legacy-principal',$1,'{}')", ['a'.repeat(64)]);
      expect((await runMigrations(url)).applied).toEqual(['0002_catalog.sql', '0003_idempotency_key.sql', '0004_rls_empty_context.sql', '0005_tenant_foreign_keys.sql', '0006_merchant_sessions.sql', '0007_runtime_group_role.sql', '0008_catalog_import_lease.sql', '0009_catalog_job_receipts.sql']);
      expect((await pool.query("SELECT name FROM stores WHERE slug='synthetic-store'")).rows[0].name).toBe('Synthetic Store');
      const old = (await pool.query("SELECT idempotency_key, response FROM idempotency_keys WHERE principal='legacy-principal'")).rows[0];
      expect(old.idempotency_key).toMatch(/^legacy:/);
      expect(old.response).toBe('{}');
    } finally { await pool.end(); }
  }, 30000);
});


