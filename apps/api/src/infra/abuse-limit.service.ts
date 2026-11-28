import { HttpException, Inject, Injectable } from '@nestjs/common';
import {
  abuseBucketKey,
  abuseLimitPolicySchema,
  abusePurposeSchema,
  type AbuseLimitPolicy,
  type AbusePurpose,
} from '@vaarg/shared';
import {
  assertEnforcementAvailable,
  countAbuseLimitEvents,
  recordAbuseDecision,
} from '@vaarg/persistence';
import { DatabaseClient } from './database-client.js';
import { ValkeyClient } from './valkey-client.js';

/**
 * FL07-FIX — distributed abuse protection enforcement.
 *
 * Every sensitive/paid execution path calls `enforce()` BEFORE performing
 * the operation. Enforcement uses the Valkey fixed-window counter as the
 * fast path and the PostgreSQL `abuse_limit_events` durable ledger as the
 * fallback authority. Both a per-identity limit and a store-wide aggregate
 * limit are enforced; the aggregate bucket is fixed (not per-identity) so
 * rotating identities cannot bypass it.
 *
 * Fail-closed: if BOTH Valkey and PostgreSQL are unavailable, sensitive
 * and paid operations refuse to proceed.
 */

/** Atomic fixed-window INCR + EXPIRE; returns the new count. */
const WINDOW_INCR_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
`;

const DEFAULT_ABUSE_LIMIT_POLICY: AbuseLimitPolicy = abuseLimitPolicySchema.parse({
  merchant_login: {
    identity: { maxEvents: 5, windowSeconds: 300 },
    aggregate: { maxEvents: 30, windowSeconds: 300 },
  },
  anonymous_session: {
    aggregate: { maxEvents: 60, windowSeconds: 300 },
  },
  conversation_create: {
    identity: { maxEvents: 10, windowSeconds: 300 },
    aggregate: { maxEvents: 120, windowSeconds: 300 },
  },
  run_create: {
    identity: { maxEvents: 5, windowSeconds: 600 },
    aggregate: { maxEvents: 30, windowSeconds: 600 },
  },
  public_retrieval: {
    identity: { maxEvents: 30, windowSeconds: 60 },
    aggregate: { maxEvents: 300, windowSeconds: 60 },
  },
});

@Injectable()
export class AbuseLimitService {
  private readonly policy: AbuseLimitPolicy;

  constructor(
    @Inject(DatabaseClient) private readonly database: DatabaseClient,
    @Inject(ValkeyClient) private readonly valkey: ValkeyClient,
  ) {
    this.policy = DEFAULT_ABUSE_LIMIT_POLICY;
  }

  /**
   * Enforce abuse limits for one operation. Throws 429 when either the
   * identity or aggregate cap is exceeded, and fails closed (503) when
   * enforcement is entirely unavailable.
   */
  async enforce(
    storeId: string,
    purpose: AbusePurpose,
    identityKey: string | null,
  ): Promise<void> {
    const parsedPurpose = abusePurposeSchema.parse(purpose);
    const policy = this.policy[parsedPurpose]!;

    const identityBucket = abuseBucketKey({
      storeId,
      purpose: parsedPurpose,
      scope: 'identity',
      identityKey,
    });
    const aggregateBucket = abuseBucketKey({
      storeId,
      purpose: parsedPurpose,
      scope: 'aggregate',
    });

    const identityWindow = policy.identity?.windowSeconds ?? policy.aggregate.windowSeconds;
    const identityLimit = policy.identity?.maxEvents ?? Number.POSITIVE_INFINITY;
    const aggregateLimit = policy.aggregate.maxEvents;

    let identityCount: number;
    let aggregateCount: number;
    try {
      [identityCount, aggregateCount] = await this.countBuckets(
        storeId,
        identityBucket,
        aggregateBucket,
        identityWindow,
        policy.aggregate.windowSeconds,
      );
    } catch (err) {
      // Both Valkey and PostgreSQL failed → fail closed for sensitive ops.
      assertEnforcementAvailable(false);
      throw err;
    }

    const denied =
      identityCount > identityLimit || aggregateCount > aggregateLimit;

    await recordAbuseDecision(this.database.getPool(), {
      storeId,
      purpose: parsedPurpose,
      identityKey,
      identityBucketKey: identityBucket,
      aggregateBucketKey: aggregateBucket,
      identityWindowSeconds: identityWindow,
      aggregateWindowSeconds: policy.aggregate.windowSeconds,
      outcome: denied ? 'denied' : 'allowed',
    }).catch(() => undefined);

    if (denied) {
      throw new HttpException('Too many requests', 429);
    }
  }

  /**
   * Count both buckets. Valkey is the fast path; PostgreSQL is the durable
   * fallback. A Valkey failure degrades to the PG count; a PG failure after
   * a Valkey failure throws (fail closed).
   */
  private async countBuckets(
    storeId: string,
    identityBucket: string,
    aggregateBucket: string,
    identityWindow: number,
    aggregateWindow: number,
  ): Promise<[number, number]> {
    const pool = this.database.getPool();
    const [identityCount, aggregateCount] = await Promise.all([
      this.countOne(pool, storeId, identityBucket, identityWindow),
      this.countOne(pool, storeId, aggregateBucket, aggregateWindow),
    ]);
    return [identityCount, aggregateCount];
  }

  private async countOne(
    pool: ReturnType<DatabaseClient['getPool']>,
    storeId: string,
    bucketKey: string,
    windowSeconds: number,
  ): Promise<number> {
    try {
      const raw = await this.valkey
        .getRateClient()
        .eval(WINDOW_INCR_SCRIPT, 1, bucketKey, windowSeconds);
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 0) return n;
      // Unexpected Valkey payload → fall through to the durable authority.
    } catch {
      // Valkey unavailable → use the PostgreSQL durable ledger count.
    }
    return countAbuseLimitEvents(pool, { storeId, bucketKey, windowSeconds });
  }
}
