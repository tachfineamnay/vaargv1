import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/**
 * Reproducible, versioned migration runner.
 *
 * - Applies every .sql file in migrations/ in filename order (they are named
 *   <version>__<name>.sql with zero-padded versions).
 * - Records applied migrations in schema_migrations, keyed by filename.
 * - Each migration runs in a transaction; on failure it is rolled back and
 *   the batch aborts, so a partial migration cannot be mistaken for success.
 *
 * Run as a superuser/maintenance role (the migration role must be able to
 * create extensions, roles, and enable RLS).
 */
export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(
  connectionString: string,
  dir: string = MIGRATIONS_DIR,
): Promise<MigrationResult> {
  const pool = new Pool({ connectionString });
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const appliedRows = await pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations',
    );
    const applied = new Set(appliedRows.rows.map((r) => r.version));

    const files = (await readdir(dir))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const client = await pool.connect();
    try {
      for (const file of files) {
        if (applied.has(file)) {
          result.skipped.push(file);
          continue;
        }
        const sql = await readFile(join(dir, file), 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
          await client.query('COMMIT');
          result.applied.push(file);
        } catch (error) {
          await client.query('ROLLBACK');
          throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
        }
      }
    } finally {
      client.release();
    }
    return result;
  } finally {
    await pool.end();
  }
}

// CLI entrypoint: runs when invoked directly (dev via tsx or dist via node).
const isMain = (
  process.argv[1] &&
  (process.argv[1].endsWith('migrate.ts') || process.argv[1].endsWith('migrate.js'))
);
if (isMain) {
  const conn = process.env.DATABASE_URL ?? process.env.PG_URL;
  if (!conn) {
    console.error('DATABASE_URL (or PG_URL) is required to run migrations.');
    process.exit(2);
  }
  const result = await runMigrations(conn);
  console.log(JSON.stringify(result, null, 2));
}
