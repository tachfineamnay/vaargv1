import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { NonRetryableError } from '@hatchet-dev/typescript-sdk';
import { issueCatalogDelegation, type StorefrontBinding } from '@vaarg/persistence';
import {
  buildRegisteredHatchetWorkflows,
  runCatalogSyncWorkflowHandler,
  runEmbeddingRefreshWorkflowHandler,
} from '../src/hatchet/hatchet-workflows.js';

const SECRET = 'synthetic-catalog-signing-secret-min-32-bytes!!';
const storeId = '00000000-0000-4000-8000-000000000001';
const merchantUserId = '00000000-0000-4000-8000-000000000051';
const merchantSessionId = '00000000-0000-4000-8000-000000000052';
const fakePool = {} as unknown as Pool;

const binding: StorefrontBinding = {
  host: 'industrial.example',
  storeId,
  country: 'FR',
  language: 'FR',
  currency: 'EUR',
  shopifyDomain: 'industrial.myshopify.com',
  tokenEnv: 'SHOPIFY_INDUSTRIAL_TOKEN',
};

describe('FL06 Worker: Hatchet SDK workflow declarations, auth revalidation, bounded sweeps, and cancellation', () => {
  it('registers ONLY the 3 real implemented workflows on the Hatchet worker', () => {
    const built = buildRegisteredHatchetWorkflows({
      pool: fakePool,
      env: {},
      bindings: [binding],
      delegationSecret: SECRET,
      rateClient: undefined,
    });

    expect(built.names).toEqual([
      'vaarg.catalog.sync',
      'vaarg.embeddings.refresh',
      'vaarg.experience.retention_cleanup',
    ]);
    expect(built.declarations).toHaveLength(3);
    expect(built.declarations.map((d) => d.definition.name)).toEqual([
      'vaarg.catalog.sync',
      'vaarg.embeddings.refresh',
      'vaarg.experience.retention_cleanup',
    ]);
  });

  it('revalidates merchant delegation & role with NonRetryableError and executes bounded multi-page sweeps', async () => {
    const ticket = issueCatalogDelegation(
      {
        host: binding.host,
        storeId,
        merchantUserId,
        sessionId: merchantSessionId,
        jobId: randomUUID(),
        action: 'start',
        expiresAt: Date.now() + 600_000,
      },
      SECRET,
    );

    // 1. Revoked merchant session fails with NonRetryableError (zero wasted retries!)
    await expect(
      runCatalogSyncWorkflowHandler(
        {
          pool: fakePool,
          env: {},
          bindings: [binding],
          delegationSecret: SECRET,
          rateClient: undefined,
          authorizeMerchant: async () => null,
          executeCatalogPage: async () => ({ status: 'complete', completedAt: new Date() }),
        },
        {
          storeId,
          country: 'FR',
          language: 'FR',
          currency: 'EUR',
          shopifyDomain: binding.shopifyDomain,
          tokenEnv: binding.tokenEnv,
          delegationTicket: ticket,
          idempotencyKey: 'sync-1',
          correlationId: 'corr-1',
          concurrencyKey: `store:${storeId}:market:FR:FR`,
          initiateNewSweep: true,
          maxPages: 5,
        },
      ),
    ).rejects.toBeInstanceOf(NonRetryableError);

    // 2. Valid owner session runs start + bounded step pages and stops immediately on 'complete'
    const actionsCalled: string[] = [];
    const phases = ['products', 'collections', 'complete'];
    let stepIdx = 0;

    const completedOut = await runCatalogSyncWorkflowHandler(
      {
        pool: fakePool,
        env: {},
        bindings: [binding],
        delegationSecret: SECRET,
        rateClient: undefined,
        authorizeMerchant: async () => ({ storeId, role: 'owner' }),
        executeCatalogPage: async (_b, action) => {
          actionsCalled.push(action);
          if (action === 'start') return { status: 'STARTED_OR_RESUMED', completedAt: null };
          const status = phases[stepIdx++] ?? 'complete';
          return {
            status,
            completedAt: status === 'complete' ? new Date('2026-11-27T12:05:00.000Z') : null,
          };
        },
      },
      {
        storeId,
        country: 'FR',
        language: 'FR',
        currency: 'EUR',
        shopifyDomain: binding.shopifyDomain,
        tokenEnv: binding.tokenEnv,
        delegationTicket: ticket,
        idempotencyKey: 'sync-2',
        correlationId: 'corr-2',
        concurrencyKey: `store:${storeId}:market:FR:FR`,
        initiateNewSweep: true,
        maxPages: 10,
      },
    );

    expect(actionsCalled).toEqual(['start', 'step', 'step', 'step']);
    expect(completedOut).toEqual({
      status: 'COMPLETED',
      pagesProcessed: 3,
      finalSyncStatus: 'complete',
      completedAt: '2026-11-27T12:05:00.000Z',
    });

    // 3. Respects maxPages budget and returns CONTINUATION_REQUIRED when sweep still in progress
    const partialOut = await runCatalogSyncWorkflowHandler(
      {
        pool: fakePool,
        env: {},
        bindings: [binding],
        delegationSecret: SECRET,
        rateClient: undefined,
        authorizeMerchant: async () => ({ storeId, role: 'marketing' }),
        executeCatalogPage: async () => ({ status: 'products', completedAt: null }),
      },
      {
        storeId,
        country: 'FR',
        language: 'FR',
        currency: 'EUR',
        shopifyDomain: binding.shopifyDomain,
        tokenEnv: binding.tokenEnv,
        delegationTicket: ticket,
        idempotencyKey: 'sync-3',
        correlationId: 'corr-3',
        concurrencyKey: `store:${storeId}:market:FR:FR`,
        initiateNewSweep: false,
        maxPages: 2,
      },
    );
    expect(partialOut.status).toBe('CONTINUATION_REQUIRED');
    expect(partialOut.pagesProcessed).toBe(2);

    // 4. Aborts immediately when Hatchet cancellation signal fires
    const abort = new AbortController();
    abort.abort();
    await expect(
      runCatalogSyncWorkflowHandler(
        {
          pool: fakePool,
          env: {},
          bindings: [binding],
          delegationSecret: SECRET,
          rateClient: undefined,
          authorizeMerchant: async () => ({ storeId, role: 'owner' }),
          executeCatalogPage: vi.fn(),
        },
        {
          storeId,
          country: 'FR',
          language: 'FR',
          currency: 'EUR',
          shopifyDomain: binding.shopifyDomain,
          tokenEnv: binding.tokenEnv,
          delegationTicket: ticket,
          idempotencyKey: 'sync-4',
          correlationId: 'corr-4',
          concurrencyKey: `store:${storeId}:market:FR:FR`,
          initiateNewSweep: false,
          maxPages: 2,
        },
        { signal: abort.signal },
      ),
    ).rejects.toThrow(/CANCELLED/);
  });

  it('reports NOT_CONFIGURED cleanly for embedding refresh when GEMINI_API_KEY is absent', async () => {
    const out = await runEmbeddingRefreshWorkflowHandler(
      {
        pool: fakePool,
        env: {},
      },
      {
        storeId,
        country: 'FR',
        language: 'FR',
        idempotencyKey: 'emb-1',
        correlationId: 'corr-emb-1',
        concurrencyKey: `store:${storeId}:market:FR:FR`,
        batchSize: 32,
        maxDocuments: 128,
      },
    );

    expect(out).toEqual({
      status: 'NOT_CONFIGURED',
      processed: 0,
      skippedUnchanged: 0,
      failed: 0,
      remaining: 0,
    });
  });
});
