/** Real focused PostgreSQL 18 gates for FL06 intelligence & orchestration tables.
 * Requires a dedicated, local migrated test DB (`FL06_TEST_DATABASE_URL`);
 * absent runtime is NOT_RUN, never substituted with mocked SQL. */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLE_DEFINITIONS } from '@vaarg/shared';
import { runMigrations } from '../../src/db/migrate.js';
import {
  ProviderPolicyRegistry,
  appendUserConversationMessage,
  bindExternalHermesRunId,
  claimWorkflowSubmissionRecord,
  completeChildDelegationRun,
  createConversationRecord,
  createMasterAgentRunRecord,
  getConversationWithBoundedHistory,
  getWorkflowExecutionRecord,
  purgeExpiredIntelligenceData,
  reconcileModelCallUsage,
  reserveChildDelegationRun,
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
  'FL06 real PostgreSQL RLS, shared budget authority, child concurrency, and retention purge',
  () => {
    let admin: Pool;
    let app: Pool;
    const role = `fl06_${randomUUID().replaceAll('-', '')}`;
    const storeA = randomUUID();
    const storeB = randomUUID();
    let sessionA = '';

    const policyRegistry = ProviderPolicyRegistry.fromEnv({
      GEMINI_API_KEY: 'synthetic-gemini-api-key-valid',
    });

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
      app = new Pool({ connectionString: runtime.toString(), max: 5 });

      for (const id of [storeA, storeB]) {
        await admin.query('INSERT INTO stores(store_id,name,slug) VALUES($1,$2,$3)', [
          id,
          'Synthetic FL06 store',
          id,
        ]);
      }
      sessionA = randomUUID();
      await admin.query(
        "INSERT INTO visitor_sessions(session_id,store_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
        [sessionA, storeA, randomUUID()],
      );
    }, 60_000);

    afterAll(async () => {
      await app?.end();
      if (admin) {
        await admin.query('DELETE FROM stores WHERE store_id=ANY($1::uuid[])', [[storeA, storeB]]);
        await admin.query(`DROP ROLE IF EXISTS ${role}`);
        await admin.end();
      }
    });

    it('enforces store-scoped RLS isolation across conversations and workflow_executions', async () => {
      await syncRoleDefinitionsAndProviderPolicies(app, storeA, policyRegistry.listPolicies());
      const conv = await createConversationRecord(app, {
        storeId: storeA,
        sessionId: sessionA,
        contextVersion: 0,
      });

      // Store B cannot read Store A conversation
      await expect(
        getConversationWithBoundedHistory(app, {
          storeId: storeB,
          sessionId: sessionA,
          conversationId: conv.conversationId,
          personalizationGranted: false,
        }),
      ).rejects.toThrow();

      const wf = await claimWorkflowSubmissionRecord(app, {
        storeId: storeA,
        workflowName: 'vaarg.experience.retention_cleanup',
        idempotencyKey: 'cleanup-rls-1',
        correlationId: 'corr-1',
        concurrencyKey: `store:${storeA}`,
        inputPayload: { storeId: storeA },
      });
      expect(await getWorkflowExecutionRecord(app, storeB, wf.record.executionId)).toBeNull();
      expect(
        (await getWorkflowExecutionRecord(app, storeA, wf.record.executionId))?.executionId,
      ).toBe(wf.record.executionId);
    });

    it('enforces preventive parent+child shared model budget and max 3 concurrent children', async () => {
      const conv = await createConversationRecord(app, {
        storeId: storeA,
        sessionId: sessionA,
        contextVersion: 0,
      });
      const msg = await appendUserConversationMessage(app, {
        storeId: storeA,
        sessionId: sessionA,
        conversationId: conv.conversationId,
        content: 'Compare stainless steel valves',
        contextVersion: 0,
        correlationId: 'corr-budget-1',
      });

      const createdRun = await createMasterAgentRunRecord(app, {
        storeId: storeA,
        sessionId: sessionA,
        customerId: null,
        conversationId: conv.conversationId,
        triggerMessageId: msg.message.messageId,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        promptVersion: ROLE_DEFINITIONS.master.version,
        contextVersion: 0,
        correlationId: 'corr-budget-1',
        budgetPolicy: {
          ...ROLE_DEFINITIONS.master.defaultBudgetPolicy,
          maxModelCalls: 3,
          maxConcurrentChildren: 3,
        },
      });
      const rootRunId = createdRun.record.runId;
      const parentSess = `hermes-parent-${rootRunId}`;
      await bindExternalHermesRunId(app, {
        storeId: storeA,
        runId: rootRunId,
        hermesRunId: `hermes-run-${rootRunId}`,
        hermesSessionId: parentSess,
      });

      for (let i = 1; i <= 3; i += 1) {
        await reserveChildDelegationRun(app, {
          storeId: storeA,
          rootRunId,
          parentHermesSessionId: parentSess,
          childHermesSessionId: `child-${i}`,
          delegationId: `del-${i}`,
          role: 'discovery',
          requestedDepth: 1,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          promptVersion: ROLE_DEFINITIONS.discovery.version,
        });
      }

      await expect(
        reserveChildDelegationRun(app, {
          storeId: storeA,
          rootRunId,
          parentHermesSessionId: parentSess,
          childHermesSessionId: 'child-4',
          delegationId: 'del-4',
          role: 'experience',
          requestedDepth: 1,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          promptVersion: ROLE_DEFINITIONS.experience.version,
        }),
      ).rejects.toThrow(/concurrent/i);

      await completeChildDelegationRun(app, {
        storeId: storeA,
        rootRunId,
        childHermesSessionId: 'child-1',
        status: 'completed',
      });

      for (let i = 0; i < 3; i += 1) {
        const res = await reserveModelCallBudget(app, {
          storeId: storeA,
          rootRunId,
          runId: rootRunId,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          reservedTokens: 500,
          reservedCostUsd: 0.001,
        });
        await reconcileModelCallUsage(app, {
          storeId: storeA,
          rootRunId,
          runId: rootRunId,
          reservationId: res.reservationId,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          inputTokens: 200,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          measuredCostUsd: 0.0005,
        });
      }

      await expect(
        reserveModelCallBudget(app, {
          storeId: storeA,
          rootRunId,
          runId: rootRunId,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          reservedTokens: 300,
          reservedCostUsd: 0.0005,
        }),
      ).rejects.toThrow(/budget|limit/i);

      const purged = await purgeExpiredIntelligenceData(
        app,
        storeA,
        new Date(Date.now() + 365 * 86_400_000),
      );
      expect(purged).toBeDefined();
    });
  },
);
