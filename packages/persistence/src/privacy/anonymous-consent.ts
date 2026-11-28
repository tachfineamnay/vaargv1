import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { AppError } from '@vaarg/shared';
import { z } from 'zod';
import { scopedStoreTransaction } from '../commerce/scope.js';

/**
 * FL07-FIX 07 — session-scoped anonymous consent.
 *
 * Anonymous visitors (no customer identity) still exercise analytics and
 * personalization. Their consent is recorded as append-only evidence keyed
 * by the anonymous visitor session — NEVER a synthetic customer identity.
 * The effective projection is upserted in the same transaction, and
 * withdrawal atomically tombstones personalization for that session.
 *
 * All statements are parameterized and run inside a store-scoped
 * transaction (RLS enforced). Fails closed on unknown session/purpose.
 */

export const anonymousConsentPurposeSchema = z.enum(['analytics', 'personalization']);
export const anonymousConsentSourceSchema = z.enum([
  'user_action',
  'merchant_policy',
  'legal_basis',
]);
export type AnonymousConsentPurpose = z.infer<typeof anonymousConsentPurposeSchema>;
export type AnonymousConsentSource = z.infer<typeof anonymousConsentSourceSchema>;

export interface AnonymousConsentState {
  analytics: boolean | null;
  personalization: boolean | null;
}

/**
 * Record an anonymous consent decision (append-only) and update the
 * effective projection in ONE store-scoped transaction.
 */
export async function recordAnonymousConsent(
  pool: Pool,
  params: {
    storeId: string;
    sessionId: string;
    purpose: AnonymousConsentPurpose;
    granted: boolean;
    source: AnonymousConsentSource;
    note?: string;
    expiresAt: Date;
  },
): Promise<void> {
  const purpose = anonymousConsentPurposeSchema.parse(params.purpose);
  const source = anonymousConsentSourceSchema.parse(params.source);

  await scopedStoreTransaction(pool, params.storeId, async (client) => {
    // Session must exist and belong to this store (fail closed).
    const sess = await client.query<{ session_id: string }>(
      `SELECT session_id FROM visitor_sessions
        WHERE store_id = $1 AND session_id = $2`,
      [params.storeId, params.sessionId],
    );
    if (sess.rows.length === 0) {
      throw AppError.notFound('UNKNOWN_VISITOR_SESSION');
    }

    const recordId = randomUUID();
    await client.query(
      `INSERT INTO anonymous_consent_records (
         store_id, record_id, session_id, purpose, granted, source, note,
         version, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8)`,
      [
        params.storeId,
        recordId,
        params.sessionId,
        purpose,
        params.granted,
        source,
        params.note?.slice(0, 400) ?? null,
        params.expiresAt,
      ],
    );

    await client.query(
      `INSERT INTO anonymous_consent_projections (
         store_id, session_id, purpose, granted, version
       ) VALUES ($1,$2,$3,$4,1)
       ON CONFLICT (store_id, session_id, purpose) DO UPDATE
         SET granted = EXCLUDED.granted, version = anonymous_consent_projections.version + 1`,
      [params.storeId, params.sessionId, purpose, params.granted],
    );

    if (purpose === 'personalization' && !params.granted) {
      // Atomic personalization tombstone for the anonymous session: expire
      // its experience revision so stale version-zero work cannot survive.
      await client.query(
        `UPDATE experience_revisions
            SET state = state || '{"intentSignals":[],"recentlyViewed":[]}'::jsonb,
                context_version = context_version + 1,
                updated_at = now(),
                expires_at = least(expires_at, now() + interval '7 days')
          WHERE store_id = $1 AND session_id = $2`,
        [params.storeId, params.sessionId],
      );
      await client.query(
        `DELETE FROM intent_signals WHERE store_id = $1 AND session_id = $2`,
        [params.storeId, params.sessionId],
      );
      await client.query(
        `UPDATE interaction_events
            SET payload = '{}'::jsonb, personalization_allowed = false
          WHERE store_id = $1 AND session_id = $2 AND personalization_allowed = true`,
        [params.storeId, params.sessionId],
      );
      await client.query(
        `DELETE FROM recommendation_runs
          WHERE store_id = $1 AND session_id = $2 AND consent_limited = false`,
        [params.storeId, params.sessionId],
      );
    }
  });
}

/** Read the effective anonymous consent state for a session. */
export async function getAnonymousConsentState(
  pool: Pool,
  params: { storeId: string; sessionId: string },
): Promise<AnonymousConsentState> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const { rows } = await client.query<{ purpose: string; granted: boolean }>(
      `SELECT purpose, granted
         FROM anonymous_consent_projections
        WHERE store_id = $1 AND session_id = $2`,
      [params.storeId, params.sessionId],
    );
    // The projection table has no expires_at column; expiry is enforced on
    // the append-only records. Recompute the effective state from unexpired
    // records so a withdrawn/expired grant never reports as granted.
    const { rows: recs } = await client.query<{
      purpose: AnonymousConsentPurpose;
      granted: boolean;
      expires_at: Date;
    }>(
      `SELECT purpose, granted, expires_at
         FROM anonymous_consent_records
        WHERE store_id = $1 AND session_id = $2
        ORDER BY created_at DESC, record_id DESC`,
      [params.storeId, params.sessionId],
    );
    const state: AnonymousConsentState = { analytics: null, personalization: null };
    for (const rec of recs) {
      if (rec.expires_at.getTime() <= Date.now()) continue;
      if (state[rec.purpose] === null) state[rec.purpose] = rec.granted;
    }
    // Fail closed: only fall back to the projection when NO records exist at
    // all. An expired/withdrawn grant never reports as granted.
    if (recs.length === 0) {
      const proj = new Map(rows.map((r) => [r.purpose, r.granted]));
      state.analytics = proj.get('analytics') ?? null;
      state.personalization = proj.get('personalization') ?? null;
    }
    return state;
  });
}

/** Full append-only anonymous consent history for a session. */
export async function getAnonymousConsentHistory(
  pool: Pool,
  params: { storeId: string; sessionId: string },
) {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const { rows } = await client.query<{
      record_id: string;
      purpose: AnonymousConsentPurpose;
      granted: boolean;
      source: AnonymousConsentSource;
      note: string | null;
      version: number;
      expires_at: Date;
      created_at: Date;
    }>(
      `SELECT record_id, purpose, granted, source, note, version, expires_at, created_at
         FROM anonymous_consent_records
        WHERE store_id = $1 AND session_id = $2
        ORDER BY created_at, record_id`,
      [params.storeId, params.sessionId],
    );
    return rows;
  });
}
