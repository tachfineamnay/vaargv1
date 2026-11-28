import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  AppError,
  abuseOutcomeSchema,
  abusePurposeSchema,
  abuseWindowLabel,
  type AbuseOutcome,
  type AbusePurpose,
} from '@vaarg/shared';
import { scopedStoreTransaction } from '../commerce/scope.js';

/**
 * FL07-FIX — abuse-limit durable ledger (PostgreSQL authority).
 *
 * Every enforcement decision is recorded as an append-only event in
 * `abuse_limit_events`. When the Valkey fast path is unavailable, the
 * limiter falls back to counting these durable events within the window.
 * The store-scoped aggregate bucket is fixed (not per-identity) so that
 * rotating identities cannot split the count and bypass the aggregate cap.
 */

export interface AbuseLimitEvent {
  storeId: string;
  eventId: string;
  bucketKey: string;
  bucketWindow: string;
  purpose: AbusePurpose;
  outcome: AbuseOutcome;
  observedAt: Date;
}

/** Record one enforcement decision in the durable ledger (store-scoped). */
export async function recordAbuseLimitEvent(
  pool: Pool,
  params: {
    storeId: string;
    bucketKey: string;
    bucketWindow: string;
    purpose: AbusePurpose;
    outcome: AbuseOutcome;
    retentionTtlMs?: number;
  },
): Promise<void> {
  const purpose = abusePurposeSchema.parse(params.purpose);
  const outcome = abuseOutcomeSchema.parse(params.outcome);
  const eventId = randomUUID();
  const retention =
    params.retentionTtlMs ?? Math.max(3600_000, (Number(params.bucketWindow.replace(/s$/, '')) || 3600) * 1000 * 4);
  await scopedStoreTransaction(pool, params.storeId, async (client) => {
    await client.query(
      `INSERT INTO abuse_limit_events (
         store_id, event_id, bucket_key, bucket_window, purpose, outcome,
         observed_at, retention_expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6, now(), now() + make_interval(secs => $7))`,
      [
        params.storeId,
        eventId,
        params.bucketKey.slice(0, 200),
        params.bucketWindow,
        purpose,
        outcome,
        retention / 1000,
      ],
    );
  });
}

/**
 * Count durable events in a bucket within its window (Valkey fallback path).
 * Returns the count of events observed in the last `windowSeconds`.
 */
export async function countAbuseLimitEvents(
  pool: Pool,
  params: {
    storeId: string;
    bucketKey: string;
    windowSeconds: number;
  },
): Promise<number> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM abuse_limit_events
        WHERE store_id = $1
          AND bucket_key = $2
          AND observed_at >= now() - make_interval(secs => $3)`,
      [params.storeId, params.bucketKey.slice(0, 200), params.windowSeconds],
    );
    return Number(rows[0]?.count ?? 0);
  });
}

/**
 * Convenience: record both the identity and aggregate bucket decisions so
 * the durable ledger reflects the full enforcement outcome.
 */
export async function recordAbuseDecision(
  pool: Pool,
  params: {
    storeId: string;
    purpose: AbusePurpose;
    identityKey: string | null;
    identityBucketKey: string;
    aggregateBucketKey: string;
    identityWindowSeconds: number;
    aggregateWindowSeconds: number;
    outcome: AbuseOutcome;
  },
): Promise<void> {
  const outcome = abuseOutcomeSchema.parse(params.outcome);
  await recordAbuseLimitEvent(pool, {
    storeId: params.storeId,
    bucketKey: params.identityBucketKey,
    bucketWindow: abuseWindowLabel(params.identityWindowSeconds),
    purpose: params.purpose,
    outcome,
  });
  await recordAbuseLimitEvent(pool, {
    storeId: params.storeId,
    bucketKey: params.aggregateBucketKey,
    bucketWindow: abuseWindowLabel(params.aggregateWindowSeconds),
    purpose: params.purpose,
    outcome,
  });
}

/** Fail-closed guard: throw when enforcement cannot be performed at all. */
export function assertEnforcementAvailable(available: boolean): void {
  if (!available) {
    throw AppError.unavailable(
      'ABUSE_ENFORCEMENT_UNAVAILABLE: abuse protection is unavailable; refusing sensitive operation',
    );
  }
}
