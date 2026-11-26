import { catalogJobSchema } from '@vaarg/shared';
import { resolveStorefront, verifyCatalogDelegation, type StorefrontBinding } from '@vaarg/persistence';
import type { JobDefinition } from './job-runner.js';

type Identity = { storeId: string; role: string } | null;
type Authorize = (binding: StorefrontBinding, merchantUserId: string, sessionId: string) => Promise<Identity>;
type Execute = (binding: StorefrontBinding, action: 'start' | 'step', signal: AbortSignal | undefined, jobId: string) => Promise<unknown>;

/** The signed short-lived delegation never contains the merchant bearer token. */
export function createCatalogJob(bindings: StorefrontBinding[], secret: string, authorize: Authorize, execute: Execute): JobDefinition {
  return { name: 'catalog.import', async handler(context) {
    const payload = catalogJobSchema.parse(context.payload);
    const claims = verifyCatalogDelegation(payload.ticket, secret);
    const binding = resolveStorefront(bindings, claims.host);
    if (!binding || binding.storeId !== claims.storeId || context.jobId !== claims.jobId) throw new Error('UNAUTHORIZED');
    const identity = await authorize(binding, claims.merchantUserId, claims.sessionId);
    if (!identity || identity.storeId !== binding.storeId || !['owner', 'marketing'].includes(identity.role)) throw new Error('UNAUTHORIZED');
    await execute(binding, claims.action, context.signal, claims.jobId);
  } };
}
