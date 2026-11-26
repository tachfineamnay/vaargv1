import { eq, and, isNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { idempotencyKeys, idempotencyScopeEnum } from '../schema/operations.js';
import type { AppDb } from '../db/client.js';

function canonical(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || ancestors.has(value)) throw new Error('INVALID_JSON_PAYLOAD');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('INVALID_JSON_PAYLOAD');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return `[${Array.from(value, item => canonical(item, ancestors)).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], ancestors)}`).join(',')}}`;
  } finally { ancestors.delete(value); }
}

export function payloadHash(payload: unknown): string {
  return createHash('sha256').update(canonical(payload)).digest('hex');
}

export type IdempotencyResult =
  | { status: 'claimed' | 'pending' | 'conflict' }
  | { status: 'completed'; response: unknown };

const input = z.object({ scope: z.enum(idempotencyScopeEnum.enumValues), principal: z.string().min(1).max(200), key: z.string().min(1).max(200).refine(key => !key.startsWith('legacy:')) });

/** Claim and perform the guarded operation in the same database transaction. */
export async function claimIdempotencyKey(db: AppDb, storeId: string, scope: string, principal: string, key: string, payload: unknown): Promise<IdempotencyResult> {
  const parsed = input.parse({ scope, principal, key });
  const hash = payloadHash(payload);
  const inserted = await db.insert(idempotencyKeys).values({ storeId, scope: parsed.scope, principal, idempotencyKey: key, payloadHash: hash })
    .onConflictDoNothing({ target: [idempotencyKeys.storeId, idempotencyKeys.scope, idempotencyKeys.principal, idempotencyKeys.idempotencyKey] })
    .returning({ keyId: idempotencyKeys.keyId });
  if (inserted.length) return { status: 'claimed' };
  const existing = await db.query.idempotencyKeys.findFirst({ where: and(eq(idempotencyKeys.storeId, storeId), eq(idempotencyKeys.scope, parsed.scope), eq(idempotencyKeys.principal, principal), eq(idempotencyKeys.idempotencyKey, key)) });
  if (!existing) throw new Error('IDEMPOTENCY_CLAIM_NOT_VISIBLE');
  if (existing.payloadHash !== hash) return { status: 'conflict' };
  return existing.response === null ? { status: 'pending' } : { status: 'completed', response: JSON.parse(existing.response) };
}

/** Complete only a matching pending claim, in the operation's transaction. */
export async function completeIdempotencyKey(db: AppDb, storeId: string, scope: string, principal: string, key: string, payload: unknown, response: unknown): Promise<void> {
  const parsed = input.parse({ scope, principal, key });
  const serialized = canonical(response);
  const rows = await db.update(idempotencyKeys).set({ response: serialized }).where(and(eq(idempotencyKeys.storeId, storeId), eq(idempotencyKeys.scope, parsed.scope), eq(idempotencyKeys.principal, principal), eq(idempotencyKeys.idempotencyKey, key), eq(idempotencyKeys.payloadHash, payloadHash(payload)), isNull(idempotencyKeys.response))).returning({ keyId: idempotencyKeys.keyId });
  if (rows.length !== 1) throw new Error('IDEMPOTENCY_CLAIM_NOT_PENDING');
}
