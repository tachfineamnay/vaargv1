import { REQUEST_ID_SCHEMA, storeStatusSchema } from '@vaarg/shared';
import {
  resolveStorefront,
  type StorefrontBinding,
} from '../commerce/store-config.js';
import { withStoreContext, type DbHandle } from '../db/client.js';
import { getStoreById } from '../services/stores.js';

/**
 * Trusted server-side tenant context resolution (FL02 TASK 2).
 *
 * Authority chain: operator-configured storefront bindings identify the
 * requested storefront from the direct Host header; PostgreSQL (RLS-scoped)
 * verifies the store exists and is active. Client-supplied store ids and
 * forwarded headers never establish tenant authority.
 */

export type TenantResolutionErrorCode =
  | 'UNKNOWN_HOST'
  | 'STORE_MISSING'
  | 'STORE_INACTIVE'
  | 'INVALID_CORRELATION_ID';

export class TenantResolutionError extends Error {
  readonly code: TenantResolutionErrorCode;

  constructor(code: TenantResolutionErrorCode, message = code) {
    super(message);
    this.name = 'TenantResolutionError';
    this.code = code;
    Object.setPrototypeOf(this, TenantResolutionError.prototype);
  }
}

export interface TenantContextRecord {
  storeId: string;
  host: string;
  country: string;
  language: string;
  currency: string;
  storeStatus: 'active' | 'suspended' | 'archived';
  correlationId: string;
}

export interface TenantResolutionInput {
  /** Raw Host header value (never X-Forwarded-Host). */
  host: unknown;
  /** Request correlation id (x-request-id). */
  correlationId: unknown;
}

/**
 * Resolve the tenant context for a request. Throws TenantResolutionError:
 * - UNKNOWN_HOST: host is not a bound storefront (also covers malformed hosts)
 * - STORE_MISSING: binding references a store that no longer exists
 * - STORE_INACTIVE: store status is suspended/archived
 * - INVALID_CORRELATION_ID: correlation id fails the shared contract
 *
 * Reuses the single withStoreContext transaction implementation, so the
 * status read runs under the restricted runtime role with RLS enforced and
 * the store GUC never leaks across pooled connections.
 */
export async function resolveTenantContext(
  handle: DbHandle,
  bindings: readonly StorefrontBinding[],
  input: TenantResolutionInput,
): Promise<TenantContextRecord> {
  const correlationId = REQUEST_ID_SCHEMA.safeParse(input.correlationId);
  if (!correlationId.success) {
    throw new TenantResolutionError('INVALID_CORRELATION_ID');
  }
  const binding = resolveStorefront(bindings, input.host);
  if (!binding) throw new TenantResolutionError('UNKNOWN_HOST');

  const store = await withStoreContext(handle, binding.storeId, (tx) =>
    getStoreById(tx, binding.storeId),
  );
  if (!store) throw new TenantResolutionError('STORE_MISSING');
  const status = storeStatusSchema.safeParse(store.status);
  if (!status.success || status.data !== 'active') {
    throw new TenantResolutionError('STORE_INACTIVE');
  }

  return {
    storeId: binding.storeId,
    host: binding.host,
    country: binding.country,
    language: binding.language,
    currency: binding.currency,
    storeStatus: status.data,
    correlationId: correlationId.data,
  };
}
