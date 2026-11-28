/** FL07-FIX real PostgreSQL gates for FIX01/FIX04/FIX05/FIX07 invariants.
 * Requires a dedicated, local migrated test DB (`FL06_TEST_DATABASE_URL`);
 * absent runtime is NOT_RUN, never substituted with mocked SQL. */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLE_DEFINITIONS, adaptiveCompositionSchema } from '@vaarg/shared';
import { runMigrations } from '../../src/db/migrate.js';
import {
  ProviderPolicyRegistry,
  checkProviderAdmission,
  createProviderAdmissionAllocation,
  createConversationRecord,
  createMasterAgentRunRecord,
  getAnonymousConsentState,
  publishActionProposalAtomic,
  recordAnonymousConsent,
  reserveModelCallBudget,
  syncRoleDefinitionsAndProviderPolicies,
} from '../../src/index.js';

const url = process.env.FL06_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
    parsed.pathname !== '/vaarg_fl06_test'
  ) {
    throw new Error('Dedicated local FL06 test database (/vaarg_fl06_test) required');
  }
}

(url ? describe : describe.skip)(
  'FL07-FIX real PostgreSQL: atomic publication, provider-call identity, admission, anonymous consent',
  () => {
    let admin: Pool;
    let app: Pool;
    const role = `fl07fix_${randomUUID().replaceAll('-', '')}`;
    const storeA = randomUUID();
    const sessionA = randomUUID();

    beforeAll(async () => {
      await runMigrations(url!);
      admin = new Pool({ connectionString: url });
      await admin.query(
        `CREATE ROLE ${role} LOGIN INHERIT PASSWORD 'synthetic-test-password-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
      );
      await admin.query(`GRANT vaarg_app TO ${role}`);
      const runtime = new URL(url!);
      runtime.username = role;
      runtime.password = 'synthetic-test-password-only';
      app = new Pool({ connectionString: runtime.toString() });
      await app.query(
        `INSERT INTO stores (store_id, slug, display_name, primary_domain, default_currency, status)
         VALUES ($1, 'fl07fix-a', 'FL07-FIX Store A', 'fl07fix-a.example.test', 'EUR', 'active')
         ON CONFLICT (store_id) DO NOTHING`,
        [storeA],
      );
      await app.query(
        `INSERT INTO visitor_sessions (session_id, store_id, token_hash, status, context, expires_at)
         VALUES ($1, $2, 'hash-fl07fix', 'active', '{}', now() + interval '1 day')
         ON CONFLICT (session_id) DO NOTHING`,
        [sessionA, storeA],
      );
      const policies = ProviderPolicyRegistry.fromEnv({
        GEMINI_API_KEY: 'synthetic-gemini-api-key-valid',
      }).listPolicies();
      await syncRoleDefinitionsAndProviderPolicies(app, storeA, policies);
    });

    afterAll(async () => {
      await app?.end();
      await admin?.end();
    });

    describe('FIX01 — atomic proposal publication', () => {
      it('replays identical idempotency key and conflicts on a differing payload', async () => {
        const conv = await createConversationRecord(app, {
          storeId: storeA,
          sessionId: sessionA,
          contextVersion: 1,
        });
        const created = await createMasterAgentRunRecord(app, {
          storeId: storeA,
          sessionId: sessionA,
          conversationId: conv.conversationId,
          triggerMessageId: null,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          promptVersion: ROLE_DEFINITIONS.master.version,
          budgetPolicy: ROLE_DEFINITIONS.master.defaultBudgetPolicy,
          contextVersion: 1,
          correlationId: 'corr-fl07fix-pub',
          payloadForHash: { k: 1 },
        });
        const proposalId = randomUUID();
        await app.query(
          `INSERT INTO action_proposals (
             store_id, proposal_id, run_id, conversation_id, session_id,
             proposed_by_role, proposal_type, status, context_version,
             payload, correlation_id, expires_at, retention_expires_at
           ) VALUES ($1,$2,$3,$4,$5,'master','experience_composition','pending_confirmation',
             1, $6::jsonb, 'corr-fl07fix-prop', now() + interval '1 day', now() + interval '30 days')`,
          [
            storeA,
            proposalId,
            created.runId,
            conv.conversationId,
            sessionA,
            JSON.stringify(
              adaptiveCompositionSchema.parse({
                contextVersion: 1,
                experienceRevision: 0,
                sections: [],
                dataModel: {},
              }),
            ),
          ],
        );

        const composition = adaptiveCompositionSchema.parse({
          contextVersion: 1,
          experienceRevision: 0,
          sections: [],
          dataModel: {},
        });
        const key = 'fl07fix-pub-key-1';

        const first = await publishActionProposalAtomic(app, {
          storeId: storeA,
          sessionId: sessionA,
          runId: created.runId,
          proposalId,
          composition,
          expectedContextVersion: 1,
          personalizationGranted: false,
          idempotencyKey: key,
        });
        expect(first.kind).toBe('applied');

        const replay = await publishActionProposalAtomic(app, {
          storeId: storeA,
          sessionId: sessionA,
          runId: created.runId,
          proposalId,
          composition,
          expectedContextVersion: 1,
          personalizationGranted: false,
          idempotencyKey: key,
        });
        expect(replay.kind).toBe('replayed');

        const conflict = await publishActionProposalAtomic(app, {
          storeId: storeA,
          sessionId: sessionA,
          runId: created.runId,
          proposalId,
          composition: adaptiveCompositionSchema.parse({
            contextVersion: 1,
            experienceRevision: 0,
            sections: [{ kind: 'catalog_products', data: { products: [] } }],
            dataModel: {},
          }),
          expectedContextVersion: 1,
          personalizationGranted: false,
          idempotencyKey: key,
        });
        expect(conflict.kind).toBe('conflict');
      });
    });

    describe('FIX04 — stable provider-call identity', () => {
      it('commits a terminal budget-exceeded state and surfaces it after commit', async () => {
        const convRow = await app.query<{ conversation_id: string }>(
          `SELECT conversation_id FROM conversations WHERE store_id=$1 AND session_id=$2 LIMIT 1`,
          [storeA, sessionA],
        );
        const runId = randomUUID();
        await app.query(
          `INSERT INTO agent_runs (
             store_id, run_id, root_run_id, parent_run_id, conversation_id, session_id,
             customer_id, trigger_message_id, role, hermes_session_id, hermes_run_id,
             status, provider, model, prompt_version, policy_key,
             max_tokens, max_model_calls, max_tool_calls, max_cost_usd,
             max_duration_ms, max_concurrent_children, max_total_children,
             reserved_model_calls, reserved_tokens, reserved_cost_usd,
             consumed_model_calls, consumed_tokens, consumed_cost_usd,
             context_version, correlation_id, expires_at, retention_expires_at,
             created_at, updated_at
           ) VALUES ($1,$2,$2,NULL,$3,$4,NULL,NULL,'master','hs','hr','running',
             'gemini','gemini-2.5-flash','v1','policy-master',
             1,1,0,0.000001,60000,3,10,
             0,0,0,0,0,0,0,1,'corr-fl07fix-budget', now()+interval '1 day', now()+interval '30 days',
             now(), now())`,
          [storeA, runId, convRow.rows[0]!.conversation_id, sessionA],
        );

        let thrown: unknown = null;
        await reserveModelCallBudget(app, {
          storeId: storeA,
          rootRunId: runId,
          runId,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          reservedTokens: 10_000,
          reservedCostUsd: 100,
        }).catch((err: unknown) => {
          thrown = err;
        });
        expect(thrown).not.toBeNull();
        const { rows } = await app.query<{ status: string }>(
          `SELECT status FROM agent_runs WHERE store_id=$1 AND run_id=$2`,
          [storeA, runId],
        );
        expect(rows[0]!.status).toBe('budget_exceeded');
      });
    });

    describe('FIX05 — provider admission ledger', () => {
      it('fails closed without an allocation and admits with a valid one', async () => {
        const denied = await checkProviderAdmission(app, {
          storeId: storeA,
          purpose: 'storefront_hybrid_search',
          provider: 'gemini',
          model: 'text-embedding-004',
          scopeKey: `${storeA}:en:en`,
        });
        expect(denied.admitted).toBe(false);
        expect(denied.reason).toBe('NO_ADMISSION_ALLOCATION');

        const allocation = await createProviderAdmissionAllocation(app, {
          storeId: storeA,
          purpose: 'storefront_hybrid_search',
          provider: 'gemini',
          model: 'text-embedding-004',
          scopeKey: `${storeA}:en:en`,
          maxRequests: 10,
          maxCostUsd: 1,
          expiresAt: new Date(Date.now() + 3600_000),
          authorized: true,
        });
        const admitted = await checkProviderAdmission(app, {
          storeId: storeA,
          purpose: 'storefront_hybrid_search',
          provider: 'gemini',
          model: 'text-embedding-004',
          scopeKey: `${storeA}:en:en`,
        });
        expect(admitted.admitted).toBe(true);
        expect(admitted.allocationId).toBe(allocation.allocationId);
      });
    });

    describe('FIX07 — anonymous session consent', () => {
      it('records grants and tombstones personalization withdrawal atomically', async () => {
        const before = await getAnonymousConsentState(app, { storeId: storeA, sessionId: sessionA });
        expect(before.personalization).toBeNull();

        await recordAnonymousConsent(app, {
          storeId: storeA,
          sessionId: sessionA,
          purpose: 'personalization',
          granted: true,
          source: 'user_action',
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        });
        const granted = await getAnonymousConsentState(app, { storeId: storeA, sessionId: sessionA });
        expect(granted.personalization).toBe(true);

        await recordAnonymousConsent(app, {
          storeId: storeA,
          sessionId: sessionA,
          purpose: 'personalization',
          granted: false,
          source: 'user_action',
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        });
        const withdrawn = await getAnonymousConsentState(app, { storeId: storeA, sessionId: sessionA });
        expect(withdrawn.personalization).toBe(false);
      });
    });
  },
);
