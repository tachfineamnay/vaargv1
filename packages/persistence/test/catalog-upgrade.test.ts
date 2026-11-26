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
      expect((await runMigrations(url)).applied).toEqual(['0002_catalog.sql']);
      expect((await pool.query("SELECT name FROM stores WHERE slug='synthetic-store'")).rows[0].name).toBe('Synthetic Store');
    } finally { await pool.end(); }
  }, 30000);
});
