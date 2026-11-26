import { eq, and } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { idempotencyKeys } from '../schema/operations.js';
import type { AppDb } from '../db/client.js';

/** Compute a SHA-256 hex digest of a payload for dedup. */
export function payloadHash(payload: unknown): string {
  const normalized = JSON.stringify(payload, Object.keys(payload as object).sort());
  return createHash('sha256').update(normalized).digest('hex');
}

export interface IdempotencyResult {
  reused: boolean;
  response: unknown;
}

/**
 * Claim an idempotency key. If the same (scope, principal, payload_hash) was
 * already processed, returns the stored response (reused). Otherwise records
 * the key and returns reused=false so the caller proceeds.
 *
 * Call within the same transaction as the operation it guards.
 */
export async function claimIdempotencyKey(
  db: AppDb,
  storeId: string,
  scope: string,
  principal: string,
  payload: unknown,
): Promise<IdempotencyResult> {
  const hash = payloadHash(payload);

  const existing = await db.query.idempotencyKeys.findFirst({
    where: and(
      eq(idempotencyKeys.storeId, storeId),
      eq(idempotencyKeys.scope, scope as never),
      eq(idempotencyKeys.principal, principal),
      eq(idempotencyKeys.payloadHash, hash),
    ),
  });

  if (existing?.response) {
    return { reused: true, response: JSON.parse(existing.response) };
  }

  await db.insert(idempotencyKeys).values({
    storeId,
    scope: scope as never,
    principal,
    payloadHash: hash,
  });

  return { reused: false, response: null };
}

/** Store the response for a previously claimed idempotency key. */
export async function completeIdempotencyKey(
  db: AppDb,
  storeId: string,
  scope: string,
  principal: string,
  payload: unknown,
  response: unknown,
): Promise<void> {
  const hash = payloadHash(payload);
  await db
    .update(idempotencyKeys)
    .set({ response: JSON.stringify(response) })
    .where(
      and(
        eq(idempotencyKeys.storeId, storeId),
        eq(idempotencyKeys.scope, scope as never),
        eq(idempotencyKeys.principal, principal),
        eq(idempotencyKeys.payloadHash, hash),
      ),
    );
}
