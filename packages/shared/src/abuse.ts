import { z } from 'zod';

/**
 * FL07-FIX — distributed abuse protection contracts.
 *
 * The `abuse_limit_events` durable ledger records every enforcement
 * decision. Enforcement is distributed (Valkey fast path + PostgreSQL
 * durable authority) and enforces BOTH a per-identity limit and a
 * store-wide aggregate limit so that rotating identities cannot bypass
 * the aggregate cap.
 */

/** Purposes mirror the `abuse_limit_events.purpose` CHECK constraint. */
export const abusePurposeSchema = z.enum([
  'merchant_login',
  'anonymous_session',
  'conversation_create',
  'run_create',
  'public_retrieval',
]);
export type AbusePurpose = z.infer<typeof abusePurposeSchema>;

export const abuseOutcomeSchema = z.enum(['allowed', 'denied']);
export type AbuseOutcome = z.infer<typeof abuseOutcomeSchema>;

/**
 * A single limit: max events within a fixed window (seconds).
 */
export const abuseLimitSchema = z.object({
  maxEvents: z.number().int().min(1).max(100_000),
  windowSeconds: z.number().int().min(1).max(86_400),
});
export type AbuseLimit = z.infer<typeof abuseLimitSchema>;

/**
 * Limit policy for one purpose. `identity` caps a single identity;
 * `aggregate` caps the whole store for that purpose (identity-rotation
 * protection). Both are enforced; the aggregate is the rotation guard.
 */
export const abusePurposePolicySchema = z.object({
  identity: abuseLimitSchema.optional(),
  aggregate: abuseLimitSchema,
});
export type AbusePurposePolicy = z.infer<typeof abusePurposePolicySchema>;

export const abuseLimitPolicySchema = z.record(abusePurposeSchema, abusePurposePolicySchema);
export type AbuseLimitPolicy = z.infer<typeof abuseLimitPolicySchema>;

/** Deterministic bucket key. Aggregate scope is fixed so rotation can't split it. */
export function abuseBucketKey(params: {
  storeId: string;
  purpose: AbusePurpose;
  scope: 'aggregate' | 'identity';
  identityKey?: string | null;
}): string {
  const identity =
    params.scope === 'identity' ? `id:${params.identityKey ?? 'unknown'}` : 'aggregate';
  return `store:${params.storeId}:${params.purpose}:${identity}`;
}

/** Window label recorded with each durable event. */
export function abuseWindowLabel(windowSeconds: number): string {
  return `${windowSeconds}s`;
}
