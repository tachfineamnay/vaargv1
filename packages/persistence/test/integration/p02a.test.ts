import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withStoreContext } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createVisitorSession, resolveVisitorSession, revokeVisitorSession, rotateVisitorSession } from '../../src/sessions/visitor-sessions.js';
import { authenticateMerchant, getMerchantRole, hashToken, resolveMerchantSession, rotateMerchantSession, revokeMerchantSession } from '../../src/auth/merchant-auth.js';
import { createArgon2Hash } from '../../src/auth/passwords.js';
import { claimIdempotencyKey, completeIdempotencyKey } from '../../src/services/idempotency.js';
import { receiveWebhook } from '../../src/services/webhook-inbox.js';
import { seedSyntheticStores } from '../../src/services/seed.js';

const url = process.env.P02A_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/vaarg_p02a_test') throw new Error('A dedicated local test database is required');
}
const run = url ? describe : describe.skip;
run('P02A restricted PostgreSQL regression', () => {
  let admin: Pool;
  let app: Pool;
  const role = `p02a_${randomUUID().replaceAll('-', '')}`;
  const storeId = randomUUID();
  beforeAll(async () => {
    if (!url) throw new Error('test URL required');
    await runMigrations(url);
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE ROLE ${role} LOGIN INHERIT PASSWORD 'synthetic_test_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query(`GRANT vaarg_app TO ${role}`);
    await admin.query('INSERT INTO stores(store_id, slug, name) VALUES ($1,$2,$3)', [storeId, `p02a-${storeId}`, 'Synthetic']);
    const appUrl = new URL(url);
    appUrl.username = role;
    appUrl.password = 'synthetic_test_password';
    app = new Pool({ connectionString: appUrl.toString(), max: 4 });
  }, 30000);
  afterAll(async () => { await app?.end(); if (admin) { await admin.query(`DROP ROLE IF EXISTS ${role}`); await admin.end(); } });
  const scoped = <T>(fn: Parameters<typeof withStoreContext<T>>[2]) => withStoreContext(createDb(app), storeId, fn);

  it('does not allow login with the inherited built-in runtime role password', async () => {
    const roleState = await admin.query("SELECT rolcanlogin, rolpassword IS NULL AS no_password FROM pg_authid WHERE rolname='vaarg_app'");
    expect(roleState.rows[0]).toMatchObject({ rolcanlogin: false, no_password: true });
  });

  it('seeds synthetic stores idempotently through the maintenance connection', async () => {
    const result = await seedSyntheticStores(createDb(admin));
    expect(result.storesCreated.length + result.skipped.length).toBe(2);
    expect((await seedSyntheticStores(createDb(admin))).skipped).toHaveLength(2);
  });

  it('rejects unsafe roles and clears pooled context on commit and rollback', async () => {
    await expect(withStoreContext(createDb(admin), storeId, async () => null)).rejects.toThrow('UNSAFE_DATABASE_ROLE');
    const single = new Pool({ connectionString: app.options.connectionString, max: 1 });
    try {
      const handle = createDb(single);
      await withStoreContext(handle, storeId, async () => null);
      expect((await single.query('SELECT store_id FROM stores')).rowCount).toBe(0);
      await expect(withStoreContext(handle, storeId, async () => { throw new Error('rollback'); })).rejects.toThrow('rollback');
      expect((await single.query('SELECT store_id FROM stores')).rowCount).toBe(0);
      expect((await single.query("SELECT current_setting('app.store_id', true) AS id")).rows[0].id ?? '').toBe('');
    } finally { await single.end(); }
  });
  it('does not report a committed operation when its transaction was already aborted', async () => {
    await expect(scoped(async tx => {
      try { await tx.execute('select 1/0'); } catch { /* simulate a caller swallowing an SQL error */ }
      return 'not committed';
    })).rejects.toThrow('TRANSACTION_NOT_COMMITTED');
  });
  it('rejects a runtime role that owns a row-secured table', async () => {
    const table = `p02a_owned_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE TABLE ${table}(id int); ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} OWNER TO ${role}`);
    try { await expect(scoped(async () => null)).rejects.toThrow('UNSAFE_DATABASE_ROLE'); }
    finally { await admin.query(`DROP TABLE ${table}`); }
  });

  it('only resolves live active sessions, including after rotation and logout', async () => {
    const created = await scoped(tx => createVisitorSession(tx, storeId));
    const next = await scoped(tx => rotateVisitorSession(tx, storeId, created.token));
    expect(next).not.toBeNull();
    expect(await scoped(tx => resolveVisitorSession(tx, storeId, created.token))).toBeNull();
    expect(await scoped(tx => resolveVisitorSession(tx, storeId, next!.token))).not.toBeNull();
    await scoped(tx => revokeVisitorSession(tx, storeId, next!.sessionId));
    expect(await scoped(tx => resolveVisitorSession(tx, storeId, next!.token))).toBeNull();
    const expired = await scoped(tx => createVisitorSession(tx, storeId, null, 'default', -1000));
    expect(await scoped(tx => resolveVisitorSession(tx, storeId, expired.token))).toBeNull();
    expect(await scoped(tx => rotateVisitorSession(tx, storeId, expired.token))).toBeNull();
  });
  it('allows only one concurrent rotation of the same token', async () => {
    const created = await scoped(tx => createVisitorSession(tx, storeId));
    const rotations = await Promise.all([scoped(tx => rotateVisitorSession(tx, storeId, created.token)), scoped(tx => rotateVisitorSession(tx, storeId, created.token))]);
    expect(rotations.filter(Boolean)).toHaveLength(1);
  });
  it('rejects revoked merchant membership', async () => {
    const merchant = randomUUID();
    await admin.query('INSERT INTO merchant_users(merchant_user_id,store_id,email,password_hash) VALUES($1,$2,$3,$4)', [merchant, storeId, `${merchant}@synthetic.test`, 'unused']);
    await admin.query("INSERT INTO store_memberships(store_id,merchant_user_id,role,status) VALUES($1,$2,'owner','revoked')", [storeId, merchant]);
    expect(await scoped(tx => getMerchantRole(tx, storeId, merchant))).toBeNull();
  });
  it('persists merchant sessions, rotates once, checks membership and logs out', async () => {
    const merchant = randomUUID();
    const email = `${merchant}@synthetic.test`;
    await admin.query('INSERT INTO merchant_users(merchant_user_id,store_id,email,password_hash) VALUES($1,$2,$3,$4)', [merchant, storeId, email, await createArgon2Hash('SyntheticPassword!2026')]);
    await admin.query("INSERT INTO store_memberships(store_id,merchant_user_id,role) VALUES($1,$2,'owner')", [storeId, merchant]);
    const login = await scoped(tx => authenticateMerchant(tx, storeId, email, 'SyntheticPassword!2026'));
    expect(login).not.toBeNull();
    expect((await scoped(tx => resolveMerchantSession(tx, storeId, login!.token)))?.merchantUserId).toBe(merchant);
    const rotations = await Promise.all([scoped(tx => rotateMerchantSession(tx, storeId, login!.token)), scoped(tx => rotateMerchantSession(tx, storeId, login!.token))]);
    expect(rotations.filter(Boolean)).toHaveLength(1);
    expect(await scoped(tx => resolveMerchantSession(tx, storeId, login!.token))).toBeNull();
    const next = rotations.find(Boolean)!;
    await scoped(tx => revokeMerchantSession(tx, storeId, next.token));
    expect(await scoped(tx => resolveMerchantSession(tx, storeId, next.token))).toBeNull();
    const expired = await scoped(tx => authenticateMerchant(tx, storeId, email, 'SyntheticPassword!2026'));
    await admin.query("UPDATE merchant_sessions SET expires_at = now() - interval '1 second' WHERE store_id=$1 AND token_hash=$2", [storeId, hashToken(expired!.token)]);
    expect(await scoped(tx => resolveMerchantSession(tx, storeId, expired!.token))).toBeNull();
    expect(await scoped(tx => rotateMerchantSession(tx, storeId, expired!.token))).toBeNull();
    const fresh = await scoped(tx => authenticateMerchant(tx, storeId, email, 'SyntheticPassword!2026'));
    await admin.query("UPDATE store_memberships SET status='revoked' WHERE store_id=$1 AND merchant_user_id=$2", [storeId, merchant]);
    expect(await scoped(tx => resolveMerchantSession(tx, storeId, fresh!.token))).toBeNull();
    expect(await scoped(tx => rotateMerchantSession(tx, storeId, fresh!.token))).toBeNull();
  });
  it('claims once, reports pending/completed/conflict and rolls back', async () => {
    const claim = () => scoped(tx => claimIdempotencyKey(tx, storeId, 'order', 'principal', 'key-1', { nested: { x: 1 } }));
    const results = await Promise.all([claim(), claim()]);
    expect(results.map(x => x.status).sort()).toEqual(['claimed', 'pending']);
    expect((await scoped(tx => claimIdempotencyKey(tx, storeId, 'order', 'principal', 'key-1', { nested: { x: 2 } }))).status).toBe('conflict');
    await scoped(tx => completeIdempotencyKey(tx, storeId, 'order', 'principal', 'key-1', { nested: { x: 1 } }, { ok: true }));
    expect(await claim()).toEqual({ status: 'completed', response: { ok: true } });
    await expect(scoped(async tx => { await claimIdempotencyKey(tx, storeId, 'order', 'principal', 'rollback', {}); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect((await scoped(tx => claimIdempotencyKey(tx, storeId, 'order', 'principal', 'rollback', {}))).status).toBe('claimed');
  });
  it('deduplicates concurrent webhook replay without aborting a transaction', async () => {
    const receive = () => scoped(tx => receiveWebhook(tx, storeId, 'shopify', 'evt-1', 'products/update', { id: 1 }));
    const results = await Promise.all([receive(), receive()]);
    expect(results.map(x => x.status).sort()).toEqual(['duplicate', 'received']);
    expect(results[0]!.inboxId).toBe(results[1]!.inboxId);
    const replay = await scoped(async tx => {
      const duplicate = await receiveWebhook(tx, storeId, 'shopify', 'evt-1', 'products/update', { id: 1 });
      await receiveWebhook(tx, storeId, 'shopify', 'evt-2', 'products/update', { id: 2 });
      return duplicate;
    });
    expect(replay.inboxId).toBe(results[0]!.inboxId);
    await expect(scoped(async tx => { await receiveWebhook(tx, storeId, 'shopify', 'evt-rollback', 'products/update', {}); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect((await scoped(tx => receiveWebhook(tx, storeId, 'shopify', 'evt-rollback', 'products/update', {}))).status).toBe('received');
  });
});
