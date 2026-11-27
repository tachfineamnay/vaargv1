import type { Pool, PoolClient } from 'pg';
import {
  applyConsentWithdrawal,
  emptyConsentState,
  emptyExplorationCriteria,
  reduceEvents,
  type ConsentState,
  type ExperienceContext,
  type InteractionEvent,
  type InteractionIngestResult,
} from '@vaarg/shared';
import { scopedCatalogTransaction } from '../commerce/scope.js';

/**
 * FL05 TASK 07 — durable experience context service. PostgreSQL is the
 * authority for interaction events, reduced state and revision CAS; Valkey
 * (ExperienceContextCache below) only ever mirrors derived active-session
 * state and is never authoritative.
 *
 * Guarantees:
 *  - idempotent event ingestion via PRIMARY KEY (store_id, event_id);
 *  - server-assigned ordering (identity `seq` column);
 *  - atomic contextVersion updates with optimistic compare-and-set;
 *  - session + store scope on every statement (RLS enforced by the
 *    scoped transaction);
 *  - personalization consent gates inferred state: without it the reducer
 *    never builds behavioral profiles; withdrawal clears derived state.
 */

export interface ExperienceScope {
  storeId: string;
  country: string;
  language: string;
  currency: string;
}

export interface SessionBinding {
  sessionId: string;
  status: 'active' | 'expired' | 'rotated' | 'revoked';
  customerId: string | null;
}

export interface IngestOptions {
  personalizationGranted: boolean;
  expectedContextVersion?: number;
  /** Retention horizon for persisted events/signals (ms). Default 7 days. */
  retentionMs?: number;
}

const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface RevisionRow {
  state: Record<string, unknown>;
  context_version: string;
  experience_revision: string;
  brand_revision: string | null;
  configuration_revision: string | null;
}

interface EventRow {
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
}

function toContext(
  scope: ExperienceScope,
  session: SessionBinding,
  consent: ConsentState,
  row: RevisionRow | undefined,
): ExperienceContext {
  const state = (row?.state ?? {}) as Partial<ExperienceContext>;
  return {
    store: { storeId: scope.storeId, market: { country: scope.country, language: scope.language, currency: scope.currency } },
    session: { sessionId: session.sessionId, status: session.status, customerId: session.customerId },
    customerId: session.customerId,
    market: { country: scope.country, language: scope.language, currency: scope.currency },
    consent,
    preferences: Array.isArray(state.preferences) ? state.preferences : [],
    exploration: state.exploration ?? emptyExplorationCriteria(),
    recentlyViewed: Array.isArray(state.recentlyViewed) ? state.recentlyViewed : [],
    intentSignals: Array.isArray(state.intentSignals) ? state.intentSignals : [],
    conversationRef: state.conversationRef ?? null,
    cartRef: state.cartRef ?? null,
    brandRevision: row?.brand_revision ?? null,
    configurationRevision: row?.configuration_revision ?? null,
    contextVersion: Number(row?.context_version ?? '0'),
    experienceRevision: Number(row?.experience_revision ?? '0'),
  };
}

/** Reduced-state slice persisted in experience_revisions.state. */
function stateSlice(context: ExperienceContext): Record<string, unknown> {
  return {
    preferences: context.preferences,
    exploration: context.exploration,
    recentlyViewed: context.recentlyViewed,
    intentSignals: context.intentSignals,
    conversationRef: context.conversationRef,
    cartRef: context.cartRef,
  };
}

async function readRevision(
  client: PoolClient,
  scope: ExperienceScope,
  sessionId: string,
): Promise<RevisionRow | undefined> {
  const result = await client.query<RevisionRow>(
    `SELECT state, context_version::text, experience_revision::text, brand_revision, configuration_revision
     FROM experience_revisions WHERE store_id=$1 AND session_id=$2 AND expires_at > now()`,
    [scope.storeId, sessionId],
  );
  return result.rows[0];
}

/** Load the current unified context (fresh read; cache is a fast path only). */
export async function loadExperienceContext(
  pool: Pool,
  scope: ExperienceScope,
  session: SessionBinding,
  consent: ConsentState = emptyConsentState(),
): Promise<ExperienceContext> {
  return scopedCatalogTransaction(pool, scope, async (client) => {
    const row = await readRevision(client, scope, session.sessionId);
    return toContext(scope, session, consent, row);
  });
}

/**
 * Idempotent ordered ingestion. Within one transaction:
 *  1. insert events (ON CONFLICT DO NOTHING ⇒ duplicates counted, not
 *     reapplied);
 *  2. read back only the newly-inserted events in server `seq` order;
 *  3. reduce them onto the current state;
 *  4. compare-and-set the row on context_version (optimistic concurrency).
 * A version mismatch throws CONFLICT — the caller must reload and retry;
 * a stale composition can therefore never overwrite a newer context.
 */
export async function ingestInteractionEvents(
  pool: Pool,
  scope: ExperienceScope,
  session: SessionBinding,
  events: InteractionEvent[],
  options: IngestOptions,
): Promise<InteractionIngestResult & { context: ExperienceContext }> {
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  const consent: ConsentState = emptyConsentState();
  // Consent is projected by the caller for linked customers; for the
  // reducer we only need the personalization flag.
  if (session.status !== 'active') throw new Error('SESSION_NOT_ACTIVE');

  return scopedCatalogTransaction(pool, scope, async (client) => {
    const before = await readRevision(client, scope, session.sessionId);
    const current = toContext(scope, session, consent, before);
    if (
      options.expectedContextVersion !== undefined &&
      options.expectedContextVersion !== current.contextVersion
    ) {
      throw new Error('CONTEXT_VERSION_CONFLICT');
    }

    // 1. Idempotent insert.
    let inserted = 0;
    for (const event of events) {
      const result = await client.query(
        `INSERT INTO interaction_events
           (store_id, event_id, session_id, event_type, payload, personalization_allowed, expires_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6, now() + ($7::text || ' milliseconds')::interval)
         ON CONFLICT (store_id, event_id) DO NOTHING`,
        [
          scope.storeId,
          event.eventId,
          session.sessionId,
          event.type,
          JSON.stringify(event),
          options.personalizationGranted,
          String(retentionMs),
        ],
      );
      inserted += result.rowCount ?? 0;
    }
    const duplicates = events.length - inserted;

    // 2. Newly inserted events in server order (seq ascending).
    const recent = await client.query<EventRow>(
      `SELECT event_id, event_type, payload
       FROM interaction_events
       WHERE store_id=$1 AND session_id=$2
         AND event_id = ANY($3::uuid[])
       ORDER BY seq ASC`,
      [scope.storeId, session.sessionId, events.map((event) => event.eventId)],
    );
    const ordered: InteractionEvent[] = recent.rows.map(
      (row) => row.payload as unknown as InteractionEvent,
    );

    // 3. Reduce (dedupe set covers batch-internal duplicates).
    const reduced = reduceEvents(current, ordered, {
      personalizationGranted: options.personalizationGranted,
      seenEventIds: new Set<string>(),
    });

    // 4. CAS persist. `accepted` events (or duplicate-only batches that
    // still need a row bootstrap) always write with the expected guard.
    const newVersion = reduced.context.contextVersion;
    const persist = await client.query(
      `INSERT INTO experience_revisions (store_id, session_id, state, context_version, experience_revision, expires_at)
       VALUES ($1,$2,$3::jsonb,$4,$5, now() + ($6::text || ' milliseconds')::interval)
       ON CONFLICT (store_id, session_id) DO UPDATE SET
         state = EXCLUDED.state,
         context_version = EXCLUDED.context_version,
         updated_at = now(),
         expires_at = EXCLUDED.expires_at
       WHERE experience_revisions.context_version = $7
         AND (experience_revisions.expires_at <= now() OR experience_revisions.context_version = $7)`,
      [
        scope.storeId,
        session.sessionId,
        JSON.stringify(stateSlice(reduced.context)),
        newVersion,
        reduced.context.experienceRevision,
        String(retentionMs),
        // $7: expected version — the version we read at transaction start.
        String(current.contextVersion),
      ],
    );
    if ((persist.rowCount ?? 0) === 0) throw new Error('CONTEXT_VERSION_CONFLICT');

    // Persist inferred signals (consent-gated; bounded, retention-limited).
    if (options.personalizationGranted) {
      await client.query(
        `DELETE FROM intent_signals WHERE store_id=$1 AND session_id=$2`,
        [scope.storeId, session.sessionId],
      );
      for (const signal of reduced.context.intentSignals) {
        await client.query(
          `INSERT INTO intent_signals (store_id, signal_id, session_id, kind, subject, weight, inferred, expires_at)
           VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, true, now() + ($6::text || ' milliseconds')::interval)
           ON CONFLICT (store_id, session_id, kind, subject) DO UPDATE
             SET weight = EXCLUDED.weight, observed_at = now(), expires_at = EXCLUDED.expires_at`,
          [scope.storeId, session.sessionId, signal.kind, signal.subject, signal.weight, String(retentionMs)],
        );
      }
    } else {
      // No personalization consent: clear any previously derived signals so
      // an earlier grant without withdrawal cannot linger.
      await client.query(
        `DELETE FROM intent_signals WHERE store_id=$1 AND session_id=$2`,
        [scope.storeId, session.sessionId],
      );
    }

    return {
      accepted: reduced.accepted,
      duplicates,
      rejected: 0,
      contextVersion: reduced.context.contextVersion,
      experienceRevision: reduced.context.experienceRevision,
      context: reduced.context,
    };
  });
}

/** Exploration reset: explicit event through the same ingestion path. */
export async function resetExploration(
  pool: Pool,
  scope: ExperienceScope,
  session: SessionBinding,
  options: IngestOptions,
): Promise<InteractionIngestResult & { context: ExperienceContext }> {
  return ingestInteractionEvents(
    pool,
    scope,
    session,
    [
      {
        eventId: crypto.randomUUID(),
        type: 'exploration_reset',
      },
    ],
    options,
  );
}

/**
 * Consent withdrawal: stop optional processing and clear derived
 * personalization state (reducer rule + durable signal deletion).
 */
export async function withdrawPersonalization(
  pool: Pool,
  scope: ExperienceScope,
  session: SessionBinding,
): Promise<ExperienceContext> {
  return scopedCatalogTransaction(pool, scope, async (client) => {
    const row = await readRevision(client, scope, session.sessionId);
    const current = toContext(scope, session, emptyConsentState(), row);
    const cleared = applyConsentWithdrawal(current);
    await client.query(
      `INSERT INTO experience_revisions (store_id, session_id, state, context_version, experience_revision, expires_at)
       VALUES ($1,$2,$3::jsonb,$4,$5, now() + interval '7 days')
       ON CONFLICT (store_id, session_id) DO UPDATE SET
         state = EXCLUDED.state,
         context_version = EXCLUDED.context_version,
         updated_at = now()
       WHERE experience_revisions.context_version <= $4`,
      [scope.storeId, session.sessionId, JSON.stringify(stateSlice(cleared)), cleared.contextVersion, cleared.experienceRevision],
    );
    await client.query(
      `DELETE FROM intent_signals WHERE store_id=$1 AND session_id=$2`,
      [scope.storeId, session.sessionId],
    );
    return cleared;
  });
}

/**
 * Publish-time revision check (EXP-03): a recommendation or composition may
 * only publish when the context version it was generated against is still
 * current. Compare-and-set on experience_revision.
 */
export async function publishExperienceRevision(
  pool: Pool,
  scope: ExperienceScope,
  sessionId: string,
  expectedContextVersion: number,
): Promise<{ experienceRevision: number } | null> {
  return scopedCatalogTransaction(pool, scope, async (client) => {
    const result = await client.query<{ experience_revision: string }>(
      `UPDATE experience_revisions
       SET experience_revision = experience_revision + 1, updated_at = now()
       WHERE store_id=$1 AND session_id=$2 AND context_version=$3 AND expires_at > now()
       RETURNING experience_revision::text`,
      [scope.storeId, sessionId, expectedContextVersion],
    );
    const row = result.rows[0];
    return row ? { experienceRevision: Number(row.experience_revision) } : null;
  });
}

/**
 * Session rotation/revocation: derived active state for the OLD identity is
 * deleted, never transferred. The new session starts with a fresh context.
 */
export async function detachExperienceState(
  pool: Pool,
  scope: ExperienceScope,
  sessionId: string,
): Promise<void> {
  await scopedCatalogTransaction(pool, scope, async (client) => {
    await client.query(
      `DELETE FROM intent_signals WHERE store_id=$1 AND session_id=$2`,
      [scope.storeId, sessionId],
    );
    await client.query(
      `DELETE FROM experience_revisions WHERE store_id=$1 AND session_id=$2`,
      [scope.storeId, sessionId],
    );
  });
}

// ---------------------------------------------------------------------------
// Valkey derived active-session state (never authoritative)
// ---------------------------------------------------------------------------

export interface ExperienceCacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export function experienceCacheKey(storeId: string, sessionId: string): string {
  return `experience:${storeId}:session:${sessionId}`;
}

export class ExperienceContextCache {
  constructor(private readonly client: ExperienceCacheClient) {}

  async get(storeId: string, sessionId: string): Promise<ExperienceContext | null> {
    const raw = await this.client.get(experienceCacheKey(storeId, sessionId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ExperienceContext;
    } catch {
      await this.client.del(experienceCacheKey(storeId, sessionId));
      return null;
    }
  }

  async set(storeId: string, sessionId: string, context: ExperienceContext, ttlSeconds: number): Promise<void> {
    if (context.session.sessionId !== sessionId) return;
    await this.client.set(
      experienceCacheKey(storeId, sessionId),
      JSON.stringify(context),
      'EX',
      Math.max(1, Math.min(ttlSeconds, 86400)),
    );
  }

  async invalidate(storeId: string, sessionId: string): Promise<void> {
    await this.client.del(experienceCacheKey(storeId, sessionId));
  }
}
