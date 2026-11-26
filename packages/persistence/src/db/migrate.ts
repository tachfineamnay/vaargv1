import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
const LOCK_KEY = '78233479010241';

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  // These predate checksums; their contents have NOT been verified against history.
  historicalUnverified: string[];
}

export async function runMigrations(connectionString: string, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  const pool = new Pool({ connectionString });
  const result: MigrationResult = { applied: [], skipped: [], historicalUnverified: [] };
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('SELECT pg_advisory_lock($1::bigint)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), checksum text
    )`);
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');
    await client.query('REVOKE ALL ON schema_migrations FROM PUBLIC');
    const rows = await client.query<{ version: string; checksum: string | null }>('SELECT version, checksum FROM schema_migrations');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    if (!files.length) throw new Error('No migration files found');
    const contents = new Map<string, { sql: string; checksum: string }>();
    for (const file of files) {
      const sql = await readFile(join(dir, file), 'utf8');
      contents.set(file, { sql, checksum: createHash('sha256').update(sql).digest('hex') });
    }
    for (const row of rows.rows) {
      const file = contents.get(row.version);
      if (!file) throw new Error(`Applied migration missing from image: ${row.version}`);
      if (row.checksum && row.checksum !== file.checksum) throw new Error(`Migration checksum mismatch: ${row.version}`);
      if (!row.checksum) result.historicalUnverified.push(row.version);
    }
    const applied = new Set(rows.rows.map((row) => row.version));
    const latestApplied = [...applied].sort().at(-1);
    if (latestApplied && files.some((file) => file < latestApplied && !applied.has(file))) throw new Error('Migration history is out of order');
    // 0001 and 0007 modify a cluster-wide role. Require an explicit operator
    // decision when it already exists and either of these migrations is pending.
    const group = await client.query<{ rolcanlogin: boolean }>("SELECT rolcanlogin FROM pg_roles WHERE rolname = 'vaarg_app'");
    if (group.rowCount && (!applied.has('0001_rls_roles.sql') || !applied.has('0007_runtime_group_role.sql')) && process.env.MIGRATION_ALLOW_CLUSTER_ROLE_CHANGE !== 'true') {
      throw new Error('Existing cluster-wide vaarg_app would be modified; review migration 0001/0007 and explicitly authorize');
    }
    // Prevent the historical 0001 fixed password from becoming a usable login
    // on fresh installations, without editing the immutable migration.
    if (!group.rowCount) {
      if (applied.has('0001_rls_roles.sql')) throw new Error('Migration group role is missing');
      await client.query('CREATE ROLE vaarg_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS');
    }
    await client.query('REVOKE ALL ON schema_migrations FROM vaarg_app');
    for (const [file, { sql, checksum }] of contents) {
      if (applied.has(file)) { result.skipped.push(file); continue; }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('REVOKE ALL ON schema_migrations FROM vaarg_app');
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        result.applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed`, { cause: error });
      }
    }
    await client.query('REVOKE ALL ON schema_migrations FROM vaarg_app');
    return result;
  } finally {
    if (client) {
      try { await client.query('SELECT pg_advisory_unlock($1::bigint)', [LOCK_KEY]); } finally { client.release(); }
    }
    await pool.end();
  }
}

function validateUrls(maintenanceUrl: string, runtimeUrl: string): void {
  const maintenance = new URL(maintenanceUrl);
  const runtime = new URL(runtimeUrl);
  const username = decodeURIComponent(runtime.username);
  const password = decodeURIComponent(runtime.password);
  if (!['postgres:', 'postgresql:'].includes(runtime.protocol) || !['postgres:', 'postgresql:'].includes(maintenance.protocol) || !maintenance.username || !maintenance.password || [...runtime.searchParams.keys(), ...maintenance.searchParams.keys()].some((key) => key !== 'sslmode') || runtime.hostname !== maintenance.hostname || runtime.port !== maintenance.port || runtime.pathname !== maintenance.pathname || !/^[a-z][a-z0-9_]{0,62}$/.test(username) || username === 'vaarg_app' || username === decodeURIComponent(maintenance.username) || password.length < 16) {
    throw new Error('Invalid or unsafe runtime database URL');
  }
}

/** Provision only an unprivileged login. Refuse to repurpose elevated or unrelated roles. */
async function provisionRuntime(maintenanceUrl: string, runtimeUrl: string): Promise<void> {
  validateUrls(maintenanceUrl, runtimeUrl);
  const runtime = new URL(runtimeUrl);
  const username = decodeURIComponent(runtime.username);
  const password = decodeURIComponent(runtime.password);
  const pool = new Pool({ connectionString: maintenanceUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1::bigint)', [LOCK_KEY]);
      const group = await client.query<{ safe: boolean }>("SELECT NOT (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AS safe FROM pg_roles WHERE rolname='vaarg_app'");
      const groupGrants = await client.query("SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='vaarg_app'");
      if (!group.rows[0]?.safe || groupGrants.rowCount) throw new Error('Runtime group is not safely restricted');
      const role = await client.query<{ safe: boolean; marker: string | null }>(`SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolcanlogin AND rolinherit AS safe, shobj_description(oid, 'pg_authid') AS marker FROM pg_roles WHERE rolname = $1`, [username]);
      if (role.rowCount) {
        const otherGrants = await client.query(`SELECT 1 FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid WHERE member.rolname=$1 AND parent.rolname <> 'vaarg_app'`, [username]);
        const owns = await client.query(`SELECT 1 FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=$1) UNION ALL SELECT 1 FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname=$1) UNION ALL SELECT 1 FROM pg_database WHERE datdba=(SELECT oid FROM pg_roles WHERE rolname=$1) LIMIT 1`, [username]);
        if (!role.rows[0]?.safe || role.rows[0].marker !== 'VAARG FL01 restricted runtime login' || otherGrants.rowCount || owns.rowCount) throw new Error('Existing runtime role is not safely restricted');
        const member = await client.query("SELECT pg_has_role($1, 'vaarg_app', 'MEMBER') AS member", [username]);
        if (!member.rows[0]?.member) throw new Error('Refusing to modify an unrelated existing role');
      }
      const quoted = await client.query<{ ident: string; secret: string }>('SELECT format(\'%I\', $1::text) AS ident, format(\'%L\', $2::text) AS secret', [username, password]);
      const { ident, secret } = quoted.rows[0]!;
      await client.query('BEGIN');
      try {
        if (!role.rowCount) {
          await client.query(`CREATE ROLE ${ident} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${secret}`);
          await client.query(`COMMENT ON ROLE ${ident} IS 'VAARG FL01 restricted runtime login'`);
        } else await client.query(`ALTER ROLE ${ident} PASSWORD ${secret}`);
        await client.query(`GRANT vaarg_app TO ${ident}`);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [LOCK_KEY]);
    } finally { client.release(); }
  } finally { await pool.end(); }
  const runtimePool = new Pool({ connectionString: runtimeUrl });
  try { await runtimePool.query('SELECT 1'); } finally { await runtimePool.end(); }
}

const isMain = process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url);
if (isMain) {
  const maintenance = process.env.MAINTENANCE_DATABASE_URL;
  const runtime = process.env.DATABASE_URL;
  if (!maintenance || !runtime) {
    console.error('MAINTENANCE_DATABASE_URL and restricted DATABASE_URL are required');
    process.exitCode = 2;
  } else {
    try {
      validateUrls(maintenance, runtime);
      const result = await runMigrations(maintenance);
      await provisionRuntime(maintenance, runtime);
      console.info(JSON.stringify({ event: 'migrations_complete', ...result }));
    } catch (error) {
      // Database errors may contain credentials; never emit raw errors here.
      console.error(JSON.stringify({ event: 'migration_failed', message: error instanceof Error && /^(Migration |Applied migration |Existing cluster-wide|No migration files|Invalid or unsafe|Existing runtime role|Refusing)/.test(error.message) ? error.message : 'Migration or provisioning failed; inspect securely' }));
      process.exitCode = 1;
    }
  }
}
