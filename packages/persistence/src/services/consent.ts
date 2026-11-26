import { eq, and } from 'drizzle-orm';
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
