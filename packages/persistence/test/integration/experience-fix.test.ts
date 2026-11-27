/** Real focused PostgreSQL gates. Requires a dedicated, local migrated test DB;
 * absent runtime is NOT_RUN, never substituted with the scripted SQL tests. */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withStoreContext } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { recordConsent } from '../../src/services/consent.js';
import { ingestInteractionEvents, loadExperienceContext, publishExperienceRevision, purgeExpiredExperience } from '../../src/experience/experience-context.js';
import { scopedStoreTransaction } from '../../src/commerce/scope.js';

const url = process.env.FL05_FIX_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/vaarg_fl05_fix_test') throw new Error('Dedicated local FL05 test database required');
}
(url ? describe : describe.skip)('FL05-FIX real RLS/idempotency/withdrawal concurrency', () => {
  let admin: Pool;
  let app: Pool;
  const role = `fl05_${randomUUID().replaceAll('-', '')}`;
  const storeId = randomUUID();
  const otherStore = randomUUID();
  const customerId = randomUUID();
  const scope = { storeId, country: 'FR', language: 'FR', currency: 'EUR' };
  beforeAll(async () => {
    await runMigrations(url!);
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE ROLE ${role} LOGIN INHERIT PASSWORD 'synthetic-test-password-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.query(`GRANT vaarg_app TO ${role}`);
    const runtime = new URL(url!); runtime.username = role; runtime.password = 'synthetic-test-password-only';
    app = new Pool({ connectionString: runtime.toString(), max: 5 });
    for (const id of [storeId, otherStore]) await admin.query('INSERT INTO stores(store_id,name,slug) VALUES($1,$2,$3)', [id, 'Synthetic FL05 fixture', id]);
    await admin.query('INSERT INTO customers(customer_id,store_id) VALUES($1,$2)', [customerId, storeId]);
  }, 60000);
  afterAll(async () => {
    await app?.end();
    if (admin) {
      await admin.query('DELETE FROM stores WHERE store_id=ANY($1::uuid[])', [[storeId, otherStore]]);
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
      await admin.end();
    }
  });
  const newSession = async () => {
    const sessionId = randomUUID();
    await admin.query("INSERT INTO visitor_sessions(session_id,store_id,customer_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')", [sessionId, storeId, customerId, randomUUID()]);
    return { sessionId, customerId, status: 'active' as const };
  };
  const consent = (purpose: 'personalization' | 'analytics', granted: boolean) => withStoreContext(createDb(app), storeId, tx => recordConsent(tx, storeId, customerId, purpose, granted, 'user_action'));

  it('serializes first-write races and reduces an event only once', async () => {
    const session = await newSession();
    const event = { eventId: randomUUID(), type: 'explicit_preference_updated' as const, key: 'style', value: 'minimal', subject: 'buyer' as const };
    const results = await Promise.all([1, 2].map(() => ingestInteractionEvents(app, scope, session, [event], { personalizationGranted: false })));
    expect(results.map(result => result.accepted).sort()).toEqual([0, 1]);
    const before = await loadExperienceContext(app, scope, session);
    const duplicate = await ingestInteractionEvents(app, scope, session, [event], { personalizationGranted: false });
    expect(duplicate.contextVersion).toBe(before.contextVersion);
    expect(duplicate.context.preferences).toEqual(before.preferences);
    expect(before.preferences).toHaveLength(1);
    const isolated = await scopedStoreTransaction(app, otherStore, client => client.query('SELECT * FROM interaction_events WHERE store_id=$1', [storeId]));
    expect(isolated.rows).toHaveLength(0);
    await expect(ingestInteractionEvents(app, { ...scope, storeId: otherStore }, session, [event], { personalizationGranted: false })).rejects.toThrow('SESSION_NOT_ACTIVE');
  });

  it('withdraws immediately and cannot restore signals with a stale consent snapshot', async () => {
    const session = await newSession();
    const event = () => ({ eventId: randomUUID(), type: 'product_viewed' as const, productRef: 'gid://shopify/Product/1' });
    await consent('personalization', false);
    // Even a never-ingested identity invalidates pre-withdrawal version zero.
    expect((await loadExperienceContext(app, scope, session)).contextVersion).toBeGreaterThan(0);
    await consent('analytics', true);
    await consent('personalization', false);
    expect((await ingestInteractionEvents(app, scope, session, [event()], { personalizationGranted: true })).rejected).toBe(1);
    await consent('analytics', false);
    await consent('personalization', true);
    expect((await ingestInteractionEvents(app, scope, session, [event()], { personalizationGranted: true })).accepted).toBe(1);
    // Either ordering is legal; withdrawal is the final authority in both.
    await Promise.all([
      ingestInteractionEvents(app, scope, session, [event()], { personalizationGranted: true }),
      consent('personalization', false),
    ]);
    const stale = await ingestInteractionEvents(app, scope, session, [event()], { personalizationGranted: true });
    expect(stale.accepted).toBe(0);
    const current = await loadExperienceContext(app, scope, session);
    expect(current.intentSignals).toEqual([]);
    expect(current.recentlyViewed).toEqual([]);
    const raw = await scopedStoreTransaction(app, storeId, client => client.query('SELECT payload FROM interaction_events WHERE store_id=$1 AND session_id=$2 AND personalization_allowed=true', [storeId, session.sessionId]));
    expect(raw.rows).toHaveLength(0);
  });

  it('keeps monotonic versions through expiry/purge and rejects obsolete publication/revoked identity', async () => {
    const session = await newSession();
    const event = () => ({ eventId: randomUUID(), type: 'search_submitted' as const, query: 'synthetic ring' });
    const first = await ingestInteractionEvents(app, scope, session, [event()], { personalizationGranted: false });
    await admin.query("UPDATE experience_revisions SET expires_at=now()-interval '1 hour' WHERE store_id=$1 AND session_id=$2", [storeId, session.sessionId]);
    await purgeExpiredExperience(app, storeId);
    const recovered = await ingestInteractionEvents(app, scope, session, [event()], { personalizationGranted: false });
    expect(recovered.contextVersion).toBeGreaterThan(first.contextVersion);
    expect(await publishExperienceRevision(app, scope, session.sessionId, first.contextVersion)).toBeNull();
    await admin.query("UPDATE visitor_sessions SET status='revoked' WHERE store_id=$1 AND session_id=$2", [storeId, session.sessionId]);
    await expect(publishExperienceRevision(app, scope, session.sessionId, recovered.contextVersion)).rejects.toThrow('SESSION_NOT_ACTIVE');
  });
});
