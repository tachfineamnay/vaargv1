import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AppError, adaptiveCompositionSchema, type AdaptiveComposition } from '@vaarg/shared';
import { scopedStoreTransaction } from '../commerce/scope.js';
import { hashPayloadSha256 } from './intelligence-repository.js';

/**
 * FL07-FIX 01 — atomic proposal publication.
 *
 * The previous implementation published a composition across several separate
 * transactions (revision bump, proposal resolution, run update), so concurrent
 * requests could publish the same proposal twice and the idempotency key was
 * ignored. This module performs the entire publication inside ONE store-scoped
 * transaction with a consistent lock order:
 *
 *   session → conversation → run → proposal → experience_revisions
 *
 * The proposal row lock + status compare-and-set guarantee the composition is
 * applied exactly once. The `proposal_publications` ledger provides durable
 * idempotent results: repeated identical requests replay the original result,
 * and reusing a key with different parameters returns CONFLICT.
 *
 * Cancelled, expired, superseded or unauthorized proposals are never published.
 */

export type ProposalPublicationOutcome =
  | {
      kind: 'applied';
      runId: string;
      proposalId: string;
      contextVersion: number;
      experienceRevision: number;
    }
  | {
      kind: 'replayed';
      runId: string;
      proposalId: string;
      contextVersion: number;
      experienceRevision: number | null;
      published: boolean;
    }
  | {
      kind: 'stale';
      runId: string;
      proposalId: string;
      contextVersion: number;
      experienceRevision: number;
    }
  | { kind: 'conflict'; reason: string };

export interface PublishActionProposalAtomicParams {
  storeId: string;
  sessionId: string;
  runId: string;
  proposalId: string;
  composition: AdaptiveComposition;
  expectedContextVersion: number;
  /** Effective personalization consent at publication time (re-validated). */
  personalizationGranted: boolean;
  idempotencyKey?: string | null;
  nowMs?: number;
  retentionTtlMs?: number;
}

const DEFAULT_PUBLICATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface LockedProposalRow {
  proposal_id: string;
  run_id: string;
  session_id: string;
  status: string;
  applied_experience_revision: string | null;
  context_version: string;
  expires_at: Date;
  payload: unknown;
}

interface LockedRunRow {
  run_id: string;
  session_id: string;
  status: string;
  context_version: string;
}

/** Lock + verify the active session. Consistent first lock in the order. */
async function lockActiveSession(
  client: PoolClient,
  storeId: string,
  sessionId: string,
): Promise<{ sessionId: string; customerId: string | null }> {
  const { rows } = await client.query<{
    session_id: string;
    customer_id: string | null;
    status: string;
    expires_at: Date;
  }>(
    `SELECT session_id, customer_id, status, expires_at
       FROM visitor_sessions
      WHERE store_id = $1 AND session_id = $2
      FOR UPDATE`,
    [storeId, sessionId],
  );
  const row = rows[0];
  if (!row || row.status !== 'active' || new Date(row.expires_at).getTime() <= Date.now()) {
    throw AppError.unauthorized('Visitor session is missing, revoked, or expired');
  }
  return { sessionId: row.session_id, customerId: row.customer_id };
}

function isPublishBlockedRunStatus(status: string): boolean {
  return (
    status === 'cancelled' ||
    status === 'superseded' ||
    status === 'budget_exceeded' ||
    status === 'timed_out'
  );
}

export async function publishActionProposalAtomic(
  pool: Pool,
  params: PublishActionProposalAtomicParams,
): Promise<ProposalPublicationOutcome> {
  const validated = adaptiveCompositionSchema.parse(params.composition);
  const payloadHash = hashPayloadSha256({
    runId: params.runId,
    proposalId: params.proposalId,
    composition: validated,
    expectedContextVersion: params.expectedContextVersion,
  });

  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    // 1. Session ownership + first lock.
    const session = await lockActiveSession(client, params.storeId, params.sessionId);

    // 2. Idempotent replay check (before mutating revisions). The proposal row
    //    lock below guarantees we observe any committed publication.
    if (params.idempotencyKey) {
      const existing = await client.query<{
        payload_hash: string;
        status: string;
        result: Record<string, unknown>;
        experience_revision: string | null;
        context_version: string;
      }>(
        `SELECT payload_hash, status, result, experience_revision::text AS experience_revision,
                context_version::text AS context_version
           FROM proposal_publications
          WHERE store_id = $1 AND idempotency_key = $2
          LIMIT 1`,
        [params.storeId, params.idempotencyKey],
      );
      const prior = existing.rows[0];
      if (prior) {
        if (prior.payload_hash !== payloadHash) {
          throw AppError.conflict(
            'IDEMPOTENCY_KEY_CONFLICT: Proposal publication parameters differ for this idempotency key',
          );
        }
        const stored = prior.result as {
          runId?: string;
          proposalId?: string;
          published?: boolean;
        };
        return {
          kind: 'replayed',
          runId: stored.runId ?? params.runId,
          proposalId: stored.proposalId ?? params.proposalId,
          contextVersion: Number(prior.context_version),
          experienceRevision:
            prior.experience_revision === null ? null : Number(prior.experience_revision),
          published: Boolean(stored.published),
        };
      }
    }

    // 3. Lock conversation (consistent order).
    const conv = await client.query<{ conversation_id: string; session_id: string }>(
      `SELECT conversation_id, session_id FROM conversations
        WHERE store_id = $1 AND conversation_id = (
          SELECT conversation_id FROM agent_runs WHERE store_id = $1 AND run_id = $2
        )
        FOR UPDATE`,
      [params.storeId, params.runId],
    );
    if (conv.rows.length === 0) throw AppError.notFound('Conversation not found');
    const convRow = conv.rows[0]!;
    if (String(convRow.session_id) !== session.sessionId) {
      throw AppError.forbidden('Conversation is not owned by the active session');
    }

    // 4. Lock + validate run.
    const run = await client.query<LockedRunRow>(
      `SELECT run_id, session_id, status, context_version::text AS context_version
         FROM agent_runs
        WHERE store_id = $1 AND run_id = $2
        FOR UPDATE`,
      [params.storeId, params.runId],
    );
    const runRow = run.rows[0];
    if (!runRow || String(runRow.session_id) !== session.sessionId) {
      throw AppError.notFound('Agent run not found');
    }
    if (isPublishBlockedRunStatus(runRow.status)) {
      throw AppError.conflict(`RUN_${runRow.status.toUpperCase()}: Proposal cannot be published`);
    }

    // 5. Lock + validate proposal.
    const proposal = await client.query<LockedProposalRow>(
      `SELECT proposal_id, run_id, session_id, status,
               applied_experience_revision::text AS applied_experience_revision,
               context_version::text AS context_version, expires_at, payload
         FROM action_proposals
        WHERE store_id = $1 AND proposal_id = $2
        FOR UPDATE`,
      [params.storeId, params.proposalId],
    );
    const proposalRow = proposal.rows[0];
    if (
      !proposalRow ||
      String(proposalRow.run_id) !== params.runId ||
      String(proposalRow.session_id) !== session.sessionId
    ) {
      throw AppError.notFound('Composition proposal not found for this run');
    }

    // Already applied by a concurrent request: replay the durable result.
    if (proposalRow.status === 'applied' && proposalRow.applied_experience_revision !== null) {
      return {
        kind: 'replayed',
        runId: params.runId,
        proposalId: params.proposalId,
        contextVersion: Number(proposalRow.context_version),
        experienceRevision: Number(proposalRow.applied_experience_revision),
        published: true,
      };
    }

    if (proposalRow.status !== 'proposed' && proposalRow.status !== 'pending_confirmation') {
      throw AppError.conflict(
        `PROPOSAL_NOT_PUBLISHABLE: Proposal is in terminal status "${proposalRow.status}"`,
      );
    }
    if (new Date(proposalRow.expires_at).getTime() <= Date.now()) {
      await markProposalStale(client, params.storeId, params.proposalId);
      throw AppError.conflict('PROPOSAL_EXPIRED: Proposal has expired');
    }

    // Effective consent: adaptive compositions require an active personalization grant.
    if (validated.mode === 'adaptive' && !params.personalizationGranted) {
      await markProposalStale(client, params.storeId, params.proposalId);
      throw AppError.forbidden('CONSENT_REQUIRED: Personalization consent is required');
    }

    // 6. Authoritative context version must match run, proposal and composition.
    const expected = params.expectedContextVersion;
    if (
      Number(runRow.context_version) !== expected ||
      Number(proposalRow.context_version) !== expected ||
      validated.contextVersion !== expected
    ) {
      await markProposalStale(client, params.storeId, params.proposalId);
      throw AppError.conflict(
        'STALE_COMPOSITION_PROPOSAL: Visitor context advanced; refresh before publishing',
      );
    }

    // 7. Lock + CAS the experience revision inside the same transaction.
    await client.query(
      `INSERT INTO experience_revisions (store_id, session_id, state, context_version, experience_revision, expires_at)
       VALUES ($1, $2, '{}', $3, 0, now() + interval '7 days')
       ON CONFLICT (store_id, session_id) DO NOTHING`,
      [params.storeId, params.sessionId, expected],
    );
    const revision = await client.query<{ experience_revision: string }>(
      `UPDATE experience_revisions
          SET experience_revision = experience_revision + 1, updated_at = now()
        WHERE store_id = $1 AND session_id = $2 AND context_version = $3
          AND expires_at > now()
          AND EXISTS (
            SELECT 1 FROM visitor_sessions vs
            WHERE vs.store_id = $1 AND vs.session_id = $2 AND vs.status = 'active'
              AND vs.expires_at > now()
          )
        RETURNING experience_revision::text AS experience_revision`,
      [params.storeId, params.sessionId, expected],
    );
    if (!revision.rows[0]) {
      await markProposalStale(client, params.storeId, params.proposalId);
      throw AppError.conflict('STALE_COMPOSITION_PROPOSAL: Context version is no longer current');
    }
    const experienceRevision = Number(revision.rows[0].experience_revision);

    // 8. Resolve proposal status via compare-and-set (exactly-once guard).
    const resolved = await client.query(
      `UPDATE action_proposals
          SET status = 'applied',
              applied_experience_revision = $3,
              resolved_at = now(),
              updated_at = now()
        WHERE store_id = $1 AND proposal_id = $2
          AND status IN ('proposed', 'pending_confirmation')
        RETURNING proposal_id`,
      [params.storeId, params.proposalId, experienceRevision],
    );
    if ((resolved.rowCount ?? 0) === 0) {
      // A concurrent request applied it; replay the durable applied revision.
      const fresh = await client.query<{
        applied_experience_revision: string | null;
        context_version: string;
      }>(
        `SELECT applied_experience_revision::text AS applied_experience_revision,
                context_version::text AS context_version
           FROM action_proposals
          WHERE store_id = $1 AND proposal_id = $2`,
        [params.storeId, params.proposalId],
      );
      const row = fresh.rows[0];
      if (row && row.applied_experience_revision !== null) {
        return {
          kind: 'replayed',
          runId: params.runId,
          proposalId: params.proposalId,
          contextVersion: Number(row.context_version),
          experienceRevision: Number(row.applied_experience_revision),
          published: true,
        };
      }
      throw AppError.conflict('PROPOSAL_PUBLICATION_RACE: Proposal was resolved concurrently');
    }

    // 9. Update the run and persist the applied composition reference.
    await client.query(
      `UPDATE agent_runs
          SET published_experience_revision = $3, updated_at = now()
        WHERE store_id = $1 AND run_id = $2`,
      [params.storeId, params.runId, experienceRevision],
    );
    await client.query(
      `UPDATE messages
          SET structured_payload = jsonb_set(
                COALESCE(structured_payload, '{}'::jsonb),
                '{experienceRevision}',
                to_jsonb($3::bigint),
                true
              )
        WHERE store_id = $1 AND run_id = $2 AND role = 'assistant'`,
      [params.storeId, params.runId, experienceRevision],
    );

    // 10. Durable publication ledger + publication event.
    const publicationId = randomUUID();
    const result = {
      published: true,
      replayed: false,
      runId: params.runId,
      proposalId: params.proposalId,
      contextVersion: expected,
      experienceRevision,
    };
    if (params.idempotencyKey) {
      await client.query(
        `INSERT INTO proposal_publications (
           store_id, publication_id, run_id, proposal_id, session_id,
           idempotency_key, payload_hash, status, experience_revision,
           context_version, result, retention_expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'applied',$8,$9,$10::jsonb,$11)`,
        [
          params.storeId,
          publicationId,
          params.runId,
          params.proposalId,
          session.sessionId,
          params.idempotencyKey,
          payloadHash,
          experienceRevision,
          expected,
          JSON.stringify(result),
          new Date(Date.now() + (params.retentionTtlMs ?? DEFAULT_PUBLICATION_TTL_MS)),
        ],
      );
    }

    await client.query(
      `INSERT INTO agent_run_events (
         store_id, run_id, event_seq, event_id, ag_ui_type, source_key,
         payload, retention_expires_at
       ) SELECT $1, agent_runs.run_id, agent_runs.event_seq + 1,
                 $1 || ':' || (agent_runs.event_seq + 1), 'custom', $2, $3::jsonb, $4
         FROM agent_runs
        WHERE store_id = $1 AND run_id = $2`,
      [
        params.storeId,
        `publish:${params.proposalId}:${experienceRevision}`,
        JSON.stringify({
          type: 'custom',
          name: 'vaarg.context.v1.sync',
          value: {
            runId: params.runId,
            proposalId: params.proposalId,
            contextVersion: expected,
            experienceRevision,
          },
          timestamp: Date.now(),
        }),
        new Date(Date.now() + (params.retentionTtlMs ?? DEFAULT_PUBLICATION_TTL_MS)),
      ],
    );

    return {
      kind: 'applied',
      runId: params.runId,
      proposalId: params.proposalId,
      contextVersion: expected,
      experienceRevision,
    };
  });
}

async function markProposalStale(
  client: PoolClient,
  storeId: string,
  proposalId: string,
): Promise<void> {
  await client.query(
    `UPDATE action_proposals
        SET status = 'stale', resolved_at = now(), updated_at = now()
      WHERE store_id = $1 AND proposal_id = $2
        AND status IN ('proposed', 'pending_confirmation')`,
    [storeId, proposalId],
  );
}

/** Compute a stable idempotency payload hash (re-exported for service use). */
export function proposalPublicationPayloadHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
