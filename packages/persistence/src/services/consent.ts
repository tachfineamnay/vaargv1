import { eq, and, sql } from 'drizzle-orm';
import {
  consentRecords,
  marketingPermissions,
} from '../schema/privacy.js';

export type Purpose =
  | 'analytics'
  | 'marketing_email'
  | 'marketing_push'
  | 'personalization'
  | 'data_retention';
export type ConsentSourceType =
  | 'user_action'
  | 'implicit'
  | 'merchant_policy'
  | 'legal_basis';
import type { AppDb } from '../db/client.js';


/**
 * Record a consent decision. Append-only: a new consent_records row is
 * written every time, preserving history. The effective marketing_permissions
 * projection is updated in the same transaction.
 */
export async function recordConsent(
  db: AppDb,
  storeId: string,
  customerId: string,
  purpose: Purpose,
  granted: boolean,
  source: ConsentSourceType,
  note?: string,
): Promise<void> {
  // Same customer lock as experience ingestion/publication: a stale consent
  // snapshot cannot restore inferred state after withdrawal commits.
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`experience:${storeId}:${customerId}`}, 0))`);
  // Append to history.
  await db.insert(consentRecords).values({
    storeId,
    customerId,
    purpose,
    granted,
    source,
    note,
  });

  // Upsert the effective projection.
  const existing = await db.query.marketingPermissions.findFirst({
    where: and(
      eq(marketingPermissions.storeId, storeId),
      eq(marketingPermissions.customerId, customerId),
      eq(marketingPermissions.purpose, purpose),
    ),
  });

  if (existing) {
    await db
      .update(marketingPermissions)
      .set({ granted, version: existing.version + 1 })
      .where(eq(marketingPermissions.permissionId, existing.permissionId));
  } else {
    await db.insert(marketingPermissions).values({
      storeId,
      customerId,
      purpose,
      granted,
    });
  }
  if (purpose === 'personalization' && !granted) {
    // Bootstrap a version tombstone even if this identity has never ingested
    // an event: pre-withdrawal version-zero work must also become obsolete.
    await db.execute(sql`INSERT INTO experience_revisions
      (store_id,session_id,state,context_version,experience_revision,expires_at)
      SELECT store_id,session_id,'{"intentSignals":[],"recentlyViewed":[]}'::jsonb,1,0,
        least(expires_at,now()+interval '7 days')
      FROM visitor_sessions WHERE store_id=${storeId} AND customer_id=${customerId}
      ON CONFLICT (store_id,session_id) DO UPDATE SET
        state=experience_revisions.state || EXCLUDED.state,
        context_version=experience_revisions.context_version+1,updated_at=now()`);
    await db.execute(sql`DELETE FROM intent_signals WHERE store_id=${storeId} AND session_id IN
      (SELECT session_id FROM visitor_sessions WHERE store_id=${storeId} AND customer_id=${customerId})`);
    await db.execute(sql`UPDATE interaction_events SET payload='{}'::jsonb, personalization_allowed=false WHERE store_id=${storeId} AND personalization_allowed=true AND session_id IN
      (SELECT session_id FROM visitor_sessions WHERE store_id=${storeId} AND customer_id=${customerId})`);
    await db.execute(sql`DELETE FROM recommendation_runs WHERE store_id=${storeId} AND consent_limited=false AND session_id IN
      (SELECT session_id FROM visitor_sessions WHERE store_id=${storeId} AND customer_id=${customerId})`);
  }

}

/** Read the effective consent state for a customer + purpose. */
export async function getConsent(
  db: AppDb,
  storeId: string,
  customerId: string,
  purpose: Purpose,
): Promise<boolean | null> {
  const perm = await db.query.marketingPermissions.findFirst({
    where: and(
      eq(marketingPermissions.storeId, storeId),
      eq(marketingPermissions.customerId, customerId),
      eq(marketingPermissions.purpose, purpose),
    ),
  });
  return perm?.granted ?? null;
}

/** Read the full effective consent map for a customer. */
export async function getConsentMap(
  db: AppDb,
  storeId: string,
  customerId: string,
): Promise<Record<Purpose, boolean>> {
  const perms = await db.query.marketingPermissions.findMany({
    where: and(
      eq(marketingPermissions.storeId, storeId),
      eq(marketingPermissions.customerId, customerId),
    ),
  });
  const map = {} as Record<Purpose, boolean>;
  for (const p of perms) {
    map[p.purpose] = p.granted;
  }
  return map;
}

/** Full consent history for a customer. */
export async function getConsentHistory(
  db: AppDb,
  storeId: string,
  customerId: string,
) {
  return db.query.consentRecords.findMany({
    where: and(
      eq(consentRecords.storeId, storeId),
      eq(consentRecords.customerId, customerId),
    ),
    orderBy: (t) => t.createdAt,
  });
}
