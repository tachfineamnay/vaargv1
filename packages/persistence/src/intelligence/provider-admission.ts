import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { AppError, type DirectModelProvider } from '@vaarg/shared';
import { scopedStoreTransaction } from '../commerce/scope.js';

/**
 * FL07-FIX 05 — durable provider admission ledger.
 *
 * A provider call (embedding, model inference) is only allowed when an
 * operator-authorized, unexpired allocation exists for the exact
 * store + provider + model + scope. This is the PostgreSQL authority for
 * admission: it never trusts a client-supplied allow flag, and it fails
 * closed when no allocation is present. Allocations are append-audited
 * through `provider_admission_ledger` (never silently mutated).
 */

export interface ProviderAdmissionAllocation {
  allocationId: string;
  storeId: string;
  purpose: string;
  provider: string;
  model: string;
  scopeKey: string;
  maxRequests: number;
  maxCostUsd: number;
  usedRequests: number;
  usedCostUsd: number;
  activeRequests: number;
  authorized: boolean;
  expiresAt: Date;
}

export interface ProviderAdmissionDecision {
  /** True when an authorized, unexpired allocation with remaining capacity exists. */
  admitted: boolean;
  allocationId: string | null;
  reason: string;
}

export async function createProviderAdmissionAllocation(
  pool: Pool,
  params: {
    storeId: string;
    purpose: string;
    provider: DirectModelProvider | string;
    model: string;
    scopeKey: string;
    maxRequests: number;
    maxCostUsd: number;
    expiresAt: Date;
    authorized: boolean;
  },
): Promise<ProviderAdmissionAllocation> {
  const allocationId = randomUUID();
  await scopedStoreTransaction(pool, params.storeId, async (client) => {
    await client.query(
      `INSERT INTO provider_admission_ledger (
         store_id, allocation_id, purpose, provider, model, scope_key,
         max_requests, max_cost_usd, used_requests, used_cost_usd, active_requests,
         authorized, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,0,$9,$10)`,
      [
        params.storeId,
        allocationId,
        params.purpose.slice(0, 80),
        params.provider,
        params.model,
        params.scopeKey.slice(0, 200),
        params.maxRequests,
        params.maxCostUsd,
        params.authorized,
        params.expiresAt,
      ],
    );
  });
  return {
    allocationId,
    storeId: params.storeId,
    purpose: params.purpose,
    provider: params.provider,
    model: params.model,
    scopeKey: params.scopeKey,
    maxRequests: params.maxRequests,
    maxCostUsd: params.maxCostUsd,
    usedRequests: 0,
    usedCostUsd: 0,
    activeRequests: 0,
    authorized: params.authorized,
    expiresAt: params.expiresAt,
  };
}

/**
 * FIX05: decide whether a provider call is admitted for the exact scope.
 * Fails closed: no authorized, unexpired allocation with remaining request
 * capacity ⇒ not admitted.
 */
export async function checkProviderAdmission(
  pool: Pool,
  params: {
    storeId: string;
    purpose: string;
    provider: DirectModelProvider | string;
    model: string;
    scopeKey: string;
  },
): Promise<ProviderAdmissionDecision> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const { rows } = await client.query<{
      allocation_id: string;
      max_requests: number;
      used_requests: number;
      active_requests: number;
      max_cost_usd: string;
      used_cost_usd: string;
      authorized: boolean;
      expires_at: Date;
    }>(
      `SELECT allocation_id, max_requests, used_requests, active_requests,
              max_cost_usd, used_cost_usd, authorized, expires_at
         FROM provider_admission_ledger
        WHERE store_id = $1 AND purpose = $2 AND provider = $3 AND model = $4
          AND scope_key = $5
        ORDER BY created_at DESC
        LIMIT 1`,
      [
        params.storeId,
        params.purpose.slice(0, 80),
        params.provider,
        params.model,
        params.scopeKey.slice(0, 200),
      ],
    );
    const row = rows[0];
    if (!row) {
      return { admitted: false, allocationId: null, reason: 'NO_ADMISSION_ALLOCATION' };
    }
    if (!row.authorized) {
      return { admitted: false, allocationId: row.allocation_id, reason: 'ADMISSION_NOT_AUTHORIZED' };
    }
    if (row.expires_at.getTime() <= Date.now()) {
      return { admitted: false, allocationId: row.allocation_id, reason: 'ADMISSION_EXPIRED' };
    }
    const remainingRequests = row.max_requests - row.used_requests - row.active_requests;
    if (remainingRequests <= 0) {
      return { admitted: false, allocationId: row.allocation_id, reason: 'ADMISSION_REQUEST_CAPACITY_EXCEEDED' };
    }
    const remainingCost = Number(row.max_cost_usd) - Number(row.used_cost_usd);
    if (!(remainingCost > 0)) {
      return { admitted: false, allocationId: row.allocation_id, reason: 'ADMISSION_COST_CAPACITY_EXCEEDED' };
    }
    return { admitted: true, allocationId: row.allocation_id, reason: 'ADMISSION_GRANTED' };
  });
}

/**
 * FIX05: atomically claim one request against an allocation (idempotent by
 * allocation + scope). Returns the allocation id on success, throws when the
 * allocation is absent/unauthorized/expired/exhausted (fail closed).
 */
export async function claimProviderAdmission(
  pool: Pool,
  params: {
    storeId: string;
    purpose: string;
    provider: DirectModelProvider | string;
    model: string;
    scopeKey: string;
    reservedCostUsd: number;
  },
): Promise<{ allocationId: string }> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const { rows } = await client.query<{
      allocation_id: string;
      max_requests: number;
      used_requests: number;
      active_requests: number;
      max_cost_usd: string;
      used_cost_usd: string;
      authorized: boolean;
      expires_at: Date;
    }>(
      `SELECT allocation_id, max_requests, used_requests, active_requests,
              max_cost_usd, used_cost_usd, authorized, expires_at
         FROM provider_admission_ledger
        WHERE store_id = $1 AND purpose = $2 AND provider = $3 AND model = $4
          AND scope_key = $5
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [
        params.storeId,
        params.purpose.slice(0, 80),
        params.provider,
        params.model,
        params.scopeKey.slice(0, 200),
      ],
    );
    const row = rows[0];
    if (!row) throw AppError.forbidden('NO_ADMISSION_ALLOCATION: provider call not admitted');
    if (!row.authorized) throw AppError.forbidden('ADMISSION_NOT_AUTHORIZED: provider call not authorized');
    if (row.expires_at.getTime() <= Date.now()) {
      throw AppError.forbidden('ADMISSION_EXPIRED: provider admission allocation expired');
    }
    const remainingRequests = row.max_requests - row.used_requests - row.active_requests;
    if (remainingRequests <= 0) {
      throw AppError.forbidden('ADMISSION_REQUEST_CAPACITY_EXCEEDED: provider admission exhausted');
    }
    const remainingCost = Number(row.max_cost_usd) - Number(row.used_cost_usd);
    if (params.reservedCostUsd > remainingCost) {
      throw AppError.forbidden('ADMISSION_COST_CAPACITY_EXCEEDED: provider admission cost exhausted');
    }

    await client.query(
      `UPDATE provider_admission_ledger
          SET active_requests = active_requests + 1, updated_at = now()
        WHERE store_id = $1 AND allocation_id = $2`,
      [params.storeId, row.allocation_id],
    );
    return { allocationId: row.allocation_id };
  });
}

/** FIX05: release a claimed request after a provider call completes. */
export async function releaseProviderAdmission(
  pool: Pool,
  params: {
    storeId: string;
    allocationId: string;
    usedRequests: number;
    usedCostUsd: number;
  },
): Promise<void> {
  await scopedStoreTransaction(pool, params.storeId, async (client) => {
    await client.query(
      `UPDATE provider_admission_ledger
          SET active_requests = GREATEST(0, active_requests - $3),
              used_requests = used_requests + $3,
              used_cost_usd = used_cost_usd + $4,
              updated_at = now()
        WHERE store_id = $1 AND allocation_id = $2`,
      [
        params.storeId,
        params.allocationId,
        params.usedRequests,
        params.usedCostUsd,
      ],
    );
  });
}
