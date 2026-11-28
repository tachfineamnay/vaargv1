import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AbuseLimitService } from '../src/infra/abuse-limit.service.js';
import { DatabaseClient } from '../src/infra/database-client.js';
import { ValkeyClient } from '../src/infra/valkey-client.js';

/**
 * FL07-FIX — distributed abuse enforcement regression.
 *
 * These tests exercise the real `AbuseLimitService.enforce()` execution path
 * (the same method the five sensitive/paid paths call before doing work), with
 * fake Valkey + PostgreSQL backends. They pin down the core invariants:
 *  - exceeded identity OR aggregate limit → 429;
 *  - the aggregate bucket is fixed (identity rotation cannot split the count);
 *  - both backends unavailable → fail closed (503), not a silent pass.
 */

function makeService(opts: {
  valkeyEval?: (script: string, numKeys: number, ...args: string[]) => Promise<string | number>;
  countEvents?: (
    pool: Pool,
    params: { storeId: string; bucketKey: string; windowSeconds: number },
  ) => Promise<number>;
}) {
  const database = {
    getPool: () => ({}) as unknown as Pool,
  } as unknown as DatabaseClient;

  const valkey = {
    getRateClient: () =>
      ({
        eval:
          opts.valkeyEval ??
          (async () => {
            throw new Error('valkey down');
          }),
      }) as unknown as ReturnType<ValkeyClient['getRateClient']>,
  } as unknown as ValkeyClient;

  return new AbuseLimitService(database, valkey);
}

// Stub the persistence ledger count via module mock is overkill; instead we
// rely on `countAbuseLimitEvents` being called through the real import. We
// stub it here by intercepting via vi.mock of the persistence module.
vi.mock('@vaarg/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vaarg/persistence')>();
  return {
    ...actual,
    countAbuseLimitEvents: vi.fn(
      async (
        _pool: unknown,
        params: { storeId: string; bucketKey: string; windowSeconds: number },
      ) =>
        params.bucketKey.includes('aggregate')
          ? (globalThis as unknown as { __aggCount?: number }).__aggCount ?? 0
          : 0,
    ),
    recordAbuseDecision: vi.fn(async () => undefined),
    assertEnforcementAvailable: actual.assertEnforcementAvailable,
  };
});

const STORE = '00000000-0000-4000-8000-000000000001';

describe('FL07-FIX AbuseLimitService.enforce (distributed enforcement)', () => {
  it('allows an operation when neither identity nor aggregate limit is exceeded', async () => {
    const service = makeService({
      // Valkey works and returns a fresh counter.
      valkeyEval: async () => 1,
    });
    await expect(service.enforce(STORE, 'merchant_login', 'user-a@example.com')).resolves.toBeUndefined();
  });

  it('returns 429 when the identity limit is exceeded', async () => {
    const service = makeService({
      valkeyEval: async () => 99, // exceeds merchant_login identity limit of 5
    });
    await expect(service.enforce(STORE, 'merchant_login', 'user-a@example.com')).rejects.toMatchObject({
      status: 429,
    });
  });

  it('returns 429 on aggregate excess even when identity is fresh (rotation cannot bypass)', async () => {
    // Identity key rotates to a new value each call (fresh bucket), but the
    // fixed aggregate bucket accumulates across all identities.
    const service = makeService({
      // Valkey down → PG ledger fallback. Identity bucket counts 0 (fresh),
      // aggregate bucket counts above the cap.
      valkeyEval: async () => {
        throw new Error('valkey down');
      },
    });
    (globalThis as unknown as { __aggCount?: number }).__aggCount = 100;

    await expect(service.enforce(STORE, 'anonymous_session', null)).rejects.toMatchObject({
      status: 429,
    });
    (globalThis as unknown as { __aggCount?: number }).__aggCount = 0;
  });

  it('fails closed (503) when both Valkey and PostgreSQL enforcement are unavailable', async () => {
    const service = makeService({
      valkeyEval: async () => {
        throw new Error('valkey down');
      },
    });
    // Make the PG fallback throw too.
    const { countAbuseLimitEvents } = await import('@vaarg/persistence');
    vi.mocked(countAbuseLimitEvents).mockRejectedValue(new Error('pg down'));

    // assertEnforcementAvailable(false) throws AppError.unavailable (HTTP 503).
    await expect(service.enforce(STORE, 'run_create', 'session-1')).rejects.toMatchObject({
      status: 503,
    });
    vi.mocked(countAbuseLimitEvents).mockClear();
  });
});
