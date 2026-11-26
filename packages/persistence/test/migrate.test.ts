import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: [] as { version: string; checksum: string | null }[], queries: [] as string[] }));
vi.mock('pg', () => ({
  Pool: class {
    async connect() {
      return {
        query: async (sql: string) => {
          state.queries.push(sql);
          if (sql.startsWith('SELECT version, checksum')) return { rows: state.rows, rowCount: state.rows.length };
          if (sql.includes("FROM pg_roles WHERE rolname = 'vaarg_app'")) return { rows: [{ rolcanlogin: false }], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        },
        release: () => undefined,
      };
    }
    async end() { /* no real database */ }
  },
}));
import { runMigrations } from '../src/db/migrate.js';

describe('migration metadata (mocked PostgreSQL)', () => {
  beforeEach(() => { state.rows = []; state.queries = []; });
  it('reports historical checksums as unverified and brackets pending SQL in a lock and transaction', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vaarg-migrate-'));
    try {
      await writeFile(join(dir, 'old.sql'), 'SELECT 1');
      await writeFile(join(dir, 'zzz.sql'), 'SELECT 2');
      state.rows = [
        { version: '0001_rls_roles.sql', checksum: null },
        { version: '0007_runtime_group_role.sql', checksum: null },
        { version: 'old.sql', checksum: null },
      ];
      // Include historical filenames because missing history must fail closed.
      await writeFile(join(dir, '0001_rls_roles.sql'), 'historic');
      await writeFile(join(dir, '0007_runtime_group_role.sql'), 'historic');
      const result = await runMigrations('unused', dir);
      expect(result.historicalUnverified).toContain('old.sql');
      expect(result.applied).toEqual(['zzz.sql']);
      expect(state.queries.some((q) => q.includes('pg_advisory_lock'))).toBe(true);
      expect(state.queries).toContain('BEGIN');
      expect(state.queries).toContain('COMMIT');
      expect(state.queries.some((q) => q.includes('pg_advisory_unlock'))).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects checksum drift before applying any pending migration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vaarg-migrate-'));
    try {
      await writeFile(join(dir, 'old.sql'), 'changed');
      state.rows = [{ version: 'old.sql', checksum: createHash('sha256').update('original').digest('hex') }];
      await expect(runMigrations('unused', dir)).rejects.toThrow('checksum mismatch');
      expect(state.queries).not.toContain('BEGIN');
      expect(state.queries.some((q) => q.includes('pg_advisory_unlock'))).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
