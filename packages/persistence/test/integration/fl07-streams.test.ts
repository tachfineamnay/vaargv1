import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AG_UI_PROTOCOL_VERSION,
  EventType,
  ROLE_DEFINITIONS,
  type AGUIEvent,
} from '@vaarg/shared';
import {
  ProviderPolicyRegistry,
  appendAgentRunStreamEvent,
  createConversationRecord,
  createMasterAgentRunRecord,
  listAgentRunStreamEvents,
  syncRoleDefinitionsAndProviderPolicies,
} from '../../src/index.js';

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('FL07 PostgreSQL Integration — RLS Stream Events, Dedup & Resync', () => {
  let pool: Pool;
  const storeA = '00000000-0000-4000-8000-00000000f701';
  const storeB = '00000000-0000-4000-8000-00000000f702';
  const sessionA = '00000000-0000-4000-8000-00000000f711';
  const sessionB = '00000000-0000-4000-8000-00000000f712';

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('enforces idempotent sourceKey append, bounded retention resync flag, and cross-store RLS isolation on agent_run_events', async () => {
    await pool.query(
      `INSERT INTO stores (store_id, slug, display_name, primary_domain, default_currency, status)
       VALUES ($1, 'fl07-a', 'FL07 Store A', 'fl07-a.example.test', 'EUR', 'active'),
              ($2, 'fl07-b', 'FL07 Store B', 'fl07-b.example.test', 'EUR', 'active')
       ON CONFLICT (store_id) DO NOTHING`,
      [storeA, storeB],
    );
    await pool.query(
      `INSERT INTO visitor_sessions (session_id, store_id, token_hash, status, context, expires_at)
       VALUES ($1, $2, 'hash-fl07-a', 'active', '{}', now() + interval '1 day'),
              ($3, $4, 'hash-fl07-b', 'active', '{}', now() + interval '1 day')
       ON CONFLICT (session_id) DO NOTHING`,
      [sessionA, storeA, sessionB, storeB],
    );

    const policies = ProviderPolicyRegistry.fromEnv({}).listPolicies();
    await syncRoleDefinitionsAndProviderPolicies(pool, storeA, policies);
    const conv = await createConversationRecord(pool, {
      storeId: storeA,
      sessionId: sessionA,
      contextVersion: 1,
    });
    const created = await createMasterAgentRunRecord(pool, {
      storeId: storeA,
      sessionId: sessionA,
      conversationId: conv.conversationId,
      triggerMessageId: null,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      promptVersion: ROLE_DEFINITIONS.master.version,
      budgetPolicy: ROLE_DEFINITIONS.master.defaultBudgetPolicy,
      contextVersion: 1,
      correlationId: 'corr-pg-fl07',
      payloadForHash: { k: 1 },
    });

    const startedEvent = {
      type: EventType.RUN_STARTED,
      threadId: conv.conversationId,
      runId: created.run.runId,
      protocolVersion: AG_UI_PROTOCOL_VERSION,
      timestamp: Date.now(),
    } as unknown as AGUIEvent;

    const first = await appendAgentRunStreamEvent(pool, {
      storeId: storeA,
      runId: created.run.runId,
      event: startedEvent,
      sourceKey: 'lifecycle:start',
    });
    const duplicate = await appendAgentRunStreamEvent(pool, {
      storeId: storeA,
      runId: created.run.runId,
      event: startedEvent,
      sourceKey: 'lifecycle:start',
    });
    expect(duplicate.eventSeq).toBe(first.eventSeq);

    const listedA = await listAgentRunStreamEvents(pool, {
      storeId: storeA,
      sessionId: sessionA,
      runId: created.run.runId,
      afterSeq: 0,
    });
    expect(listedA.events).toHaveLength(1);
    expect(listedA.resyncRequired).toBe(false);

    // Cross-store session B cannot read Store A's run events
    await expect(
      listAgentRunStreamEvents(pool, {
        storeId: storeB,
        sessionId: sessionB,
        runId: created.run.runId,
        afterSeq: 0,
      }),
    ).rejects.toThrow();
  });
});
