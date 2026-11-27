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
import { scopedCatalogTransaction, scopedStoreTransaction } from '../commerce/scope.js';

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
  expires_at?: Date | string | null;
}

/**
 * FIX08: optional behavioral events (purely inferred, no essential
 * current-request state) are never persisted without personalization
 * consent. Essential events (explicit criteria, preferences, resets,
 * conversation/cart refs) are always persisted.
 */
export function isOptionalBehavioralEvent(type: string): boolean {
  return type === 'product_viewed' || type === 'comparison_changed';
}

/** Serialize writers even before the first revision exists. Customer lock is
 * shared with consent updates; identity is always re-read under RLS. */
export async function lockActiveExperience(client: PoolClient, storeId: string, sessionId: string): Promise<string | null> {
  const identity = await client.query<{ customer_id: string | null }>(
    'SELECT customer_id FROM visitor_sessions WHERE store_id=$1 AND session_id=$2', [storeId, sessionId]);
  const customerId = identity.rows[0]?.customer_id ?? null;
  if (customerId) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`experience:${storeId}:${customerId}`]);
  const active = await client.query<{ customer_id: string | null }>(
    `SELECT customer_id FROM visitor_sessions WHERE store_id=$1 AND session_id=$2 AND status='active' AND expires_at>now() FOR UPDATE`, [storeId, sessionId]);
  if (!active.rows[0] || active.rows[0].customer_id !== customerId) throw new Error('SESSION_NOT_ACTIVE');
  return customerId;
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
    `SELECT state, context_version::text, experience_revision::text, brand_revision, configuration_revision, expires_at
     FROM experience_revisions WHERE store_id=$1 AND session_id=$2`,
    [scope.storeId, sessionId],
  );
  return result.rows[0];
}

/**
 * Locked read for writers: SELECT ... FOR UPDATE serializes concurrent
 * ingestion/withdrawal on the revision row, so CAS below never races.
 * Returns expired rows too; callers clear payloads but retain versions.
 */
async function readRevisionForUpdate(
  client: PoolClient,
  scope: ExperienceScope,
  sessionId: string,
): Promise<RevisionRow | undefined> {
  const result = await client.query<RevisionRow>(
    `SELECT state, context_version::text, experience_revision::text, brand_revision, configuration_revision, expires_at
     FROM experience_revisions WHERE store_id=$1 AND session_id=$2 FOR UPDATE`,
    [scope.storeId, sessionId],
  );
  return result.rows[0];
}

function isExpired(row: RevisionRow | undefined): boolean {
  if (!row || !row.expires_at) return false;
  return new Date(row.expires_at).getTime() <= Date.now();
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
    return toContext(scope, session, consent, isExpired(row) && row ? { ...row, state: {} } : row);
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
    const customerId = await lockActiveExperience(client, scope.storeId, session.sessionId);
    const permission = customerId ? await client.query<{ granted: boolean }>(
      `SELECT granted FROM marketing_permissions WHERE store_id=$1 AND customer_id=$2 AND purpose='personalization'`,
      [scope.storeId, customerId]) : null;
    const personal = options.personalizationGranted && permission?.rows[0]?.granted === true;
    // Locked read: concurrent ingestion/withdrawal serializes here.
    const locked = await readRevisionForUpdate(client, scope, session.sessionId);
    const expired = isExpired(locked);
    // Expired state is discarded, but versions remain monotonic (no ABA).
    // Active-session + revision locks serialize first-write and expiry races;
    // the strict CAS still guards the exact version observed.
    const before = expired && locked ? { ...locked, state: {} } : locked;
    const current = toContext(scope, session, consent, before);
    if (
      options.expectedContextVersion !== undefined &&
      options.expectedContextVersion !== current.contextVersion
    ) {
      throw new Error('CONTEXT_VERSION_CONFLICT');
    }

    // 1. Idempotent insert with RETURNING: only newly-inserted rows are
    //    reduced. Previously-persisted duplicates never re-enter the
    //    reducer (FIX02). Optional behavioral events are not persisted
    //    at all without personalization consent (FIX08).
    const persistable = events.filter(
      (event) => personal || !isOptionalBehavioralEvent(event.type),
    );
    const skippedOptional = events.length - persistable.length;
    const insertedRows: Array<{ seq: string; event: InteractionEvent }> = [];
    for (const event of persistable) {
      const result = await client.query<{ seq: string; payload: Record<string, unknown> }>(
        `INSERT INTO interaction_events
           (store_id, event_id, session_id, event_type, payload, personalization_allowed, expires_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6, now() + ($7::text || ' milliseconds')::interval)
         ON CONFLICT (store_id, event_id) DO NOTHING
         RETURNING seq::text AS seq, payload`,
        [
          scope.storeId,
          event.eventId,
          session.sessionId,
          event.type,
          JSON.stringify(personal ? event : { eventId: event.eventId, type: event.type }),
          personal,
          String(retentionMs),
        ],
      );
      for (const row of result.rows) insertedRows.push({ seq: row.seq, event });
    }
    const duplicates = persistable.length - insertedRows.length;

    // 2. Reduce ONLY newly accepted events in server sequence order.
    insertedRows.sort((a, b) => BigInt(a.seq) < BigInt(b.seq) ? -1 : BigInt(a.seq) > BigInt(b.seq) ? 1 : 0);
    const ordered = insertedRows.map(row => row.event);

    // Duplicate-only (or optional-only without consent): no version bump,
    // no preference change, no signal rewrite — return current state.
    if (ordered.length === 0) {
      return {
        accepted: 0,
        duplicates,
        rejected: skippedOptional,
        contextVersion: current.contextVersion,
        experienceRevision: current.experienceRevision,
        context: current,
      };
    }

    const reduced = reduceEvents(current, ordered, {
      personalizationGranted: personal,
      seenEventIds: new Set<string>(),
    });

    // 3. Strict CAS persist (versions retained through expiry).
    const newVersion = reduced.context.contextVersion;
    const persist = await client.query(
      `INSERT INTO experience_revisions (store_id, session_id, state, context_version, experience_revision, expires_at)
       VALUES ($1,$2,$3::jsonb,$4,$5, now() + ($6::text || ' milliseconds')::interval)
       ON CONFLICT (store_id, session_id) DO UPDATE SET
         state = EXCLUDED.state,
         context_version = EXCLUDED.context_version,
         updated_at = now(),
         expires_at = EXCLUDED.expires_at
       WHERE experience_revisions.context_version = $7`,
      [
        scope.storeId,
        session.sessionId,
        JSON.stringify(stateSlice(reduced.context)),
        newVersion,
        reduced.context.experienceRevision,
        String(retentionMs),
        String(current.contextVersion),
      ],
    );
    if ((persist.rowCount ?? 0) === 0) throw new Error('CONTEXT_VERSION_CONFLICT');

    // Persist inferred signals (consent-gated; bounded, retention-limited).
    if (personal) {
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
      rejected: skippedOptional,
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
  // Locked read + strict CAS (= current version, expired-aware). The row
  // lock serializes against concurrent ingestion, so a stale ingest that
  // started before withdrawal cannot restore signals after this commits:
  // it either commits first (and is then cleared here) or CAS-fails.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await scopedCatalogTransaction(pool, scope, async (client) => {
        await lockActiveExperience(client, scope.storeId, session.sessionId);
        const locked = await readRevisionForUpdate(client, scope, session.sessionId);
        const expired = isExpired(locked);
        const current = toContext(scope, session, emptyConsentState(), expired && locked ? { ...locked, state: {} } : locked);
        const cleared = applyConsentWithdrawal(current);
        const persist = await client.query(
          `INSERT INTO experience_revisions (store_id, session_id, state, context_version, experience_revision, expires_at)
           VALUES ($1,$2,$3::jsonb,$4,$5, now() + interval '7 days')
           ON CONFLICT (store_id, session_id) DO UPDATE SET
             state = EXCLUDED.state,
             context_version = EXCLUDED.context_version,
             updated_at = now()
           WHERE experience_revisions.context_version = $6`,
          [
            scope.storeId,
            session.sessionId,
            JSON.stringify(stateSlice(cleared)),
            cleared.contextVersion,
            cleared.experienceRevision,
            String(current.contextVersion),
          ],
        );
        if ((persist.rowCount ?? 0) === 0) throw new Error('CONTEXT_VERSION_CONFLICT');
        await client.query(
          `DELETE FROM intent_signals WHERE store_id=$1 AND session_id=$2`,
          [scope.storeId, session.sessionId],
        );
        return cleared;
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CONTEXT_VERSION_CONFLICT' && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error('CONTEXT_VERSION_CONFLICT');
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
    // FIX09: publication requires the authoritative version AND an active
    // session identity at publication time.
    await lockActiveExperience(client, scope.storeId, sessionId);
    // Bootstrap version zero proposals as well as previously ingested contexts.
    await client.query(`INSERT INTO experience_revisions (store_id,session_id,state,context_version,experience_revision,expires_at)
      VALUES ($1,$2,'{}',0,0,now()+interval '7 days') ON CONFLICT DO NOTHING`, [scope.storeId, sessionId]);
    const result = await client.query<{ experience_revision: string }>(
      `UPDATE experience_revisions
       SET experience_revision = experience_revision + 1, updated_at = now()
       WHERE store_id=$1 AND session_id=$2 AND context_version=$3 AND expires_at > now()
         AND EXISTS (
           SELECT 1 FROM visitor_sessions vs
           WHERE vs.store_id=$1 AND vs.session_id=$2 AND vs.status='active' AND vs.expires_at > now()
         )
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
  eval?(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
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
    if (!this.client.eval) return; // No non-atomic GET/SET fallback.
    await this.client.eval(`
      local old = redis.call('GET', KEYS[1])
      if old then
        local ok, current = pcall(cjson.decode, old)
        if not ok then return 0 end
        local incoming = cjson.decode(ARGV[1])
        if current.contextVersion > incoming.contextVersion or
           (current.contextVersion == incoming.contextVersion and current.experienceRevision > incoming.experienceRevision) then return 0 end
      end
      redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
      return 1`, 1, experienceCacheKey(storeId, sessionId), JSON.stringify(context),
      String(Math.max(1, Math.min(ttlSeconds, 86400))));
  }

  async invalidate(storeId: string, sessionId: string): Promise<void> {
    await this.client.del(experienceCacheKey(storeId, sessionId));
  }
}

/**
 * FIX08: usable retention cleanup. Calls the migration-0012
 * forward-migrated purge_expired_experience function under the store-scoped
 * RLS boundary. Returns the number of rows removed. Scheduled callers
 * (worker/cron) invoke this per store; it never touches other stores.
 */
export async function purgeExpiredExperience(pool: Pool, storeId: string): Promise<number> {
  const result = await scopedStoreTransaction(pool, storeId, (client) =>
    client.query<{ purge_expired_experience: string }>(
      'SELECT purge_expired_experience($1) AS purge_expired_experience',
      [storeId],
    ),
  );
  return Number(result.rows[0]?.purge_expired_experience ?? '0');
}
