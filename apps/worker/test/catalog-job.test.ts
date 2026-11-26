import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { issueCatalogDelegation } from '@vaarg/persistence';
import { createCatalogJob } from '../src/jobs/catalog-job.js';
const binding = { host:'synthetic.example', storeId:'00000000-0000-4000-8000-000000000001', country:'FR', language:'FR', currency:'EUR', shopifyDomain:'synthetic.myshopify.com', tokenEnv:'SHOPIFY_SYNTHETIC' };
const secret='synthetic-signing-secret-at-least-32-bytes';
const merchantUserId=randomUUID(), sessionId=randomUUID();
const makeTicket=(jobId:string) => issueCatalogDelegation({host:binding.host,storeId:binding.storeId,merchantUserId,sessionId,jobId,action:'step',expiresAt:Date.now()+60000},secret);
describe('catalog worker authorization', () => {
  it('rejects invalid and cross-store authority before provider execution', async () => {
    const authorize = vi.fn(async () => null);
    const execute = vi.fn();
    const job = createCatalogJob([binding], secret, authorize, execute);
    const jobId=randomUUID();
    await expect(job.handler({ jobId, attempt:1, payload:{ ticket:makeTicket(jobId) } })).rejects.toThrow('UNAUTHORIZED');
    expect(execute).not.toHaveBeenCalled();
    await expect(job.handler({ jobId:randomUUID(), attempt:1, payload:{ ticket:makeTicket(jobId) } })).rejects.toThrow('UNAUTHORIZED');
    expect(execute).not.toHaveBeenCalled();
  });
  it('executes a job-bound signed delegation only after membership revalidation', async () => {
    const authorize = vi.fn(async () => ({ storeId:binding.storeId, role:'owner' }));
    const execute = vi.fn(async () => undefined);
    const signal = new AbortController().signal;
    const job = createCatalogJob([binding], secret, authorize, execute);
    const jobId=randomUUID();
    await job.handler({ jobId, attempt:1, payload:{ ticket:makeTicket(jobId) }, signal });
    expect(authorize).toHaveBeenCalledWith(binding, merchantUserId, sessionId);
    expect(execute).toHaveBeenCalledWith(binding, 'step', signal, jobId);
  });
});
