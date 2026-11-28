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
      continuationDispatched: false,
      nextExecutionId: null,
    });

    // 3. Respects maxPages budget, dispatches bounded continuation slice resuming from checkpoint,
    //    and never reports page-budget exhaustion as COMPLETED
    const dispatchedContinuations: Array<Record<string, unknown>> = [];
    const partialOut = await runCatalogSyncWorkflowHandler(
      {
        pool: fakePool,
        env: {},
        bindings: [binding],
        delegationSecret: SECRET,
        rateClient: undefined,
        authorizeMerchant: async () => ({ storeId, role: 'marketing' }),
        executeCatalogPage: async () => ({ status: 'products', completedAt: null }),
        workflowOrchestration: {
          readiness: () => ({ status: 'READY', detail: 'ok' }),
          submitWorkflow: vi.fn(async (_name, nextInput) => {
            dispatchedContinuations.push(nextInput as unknown as Record<string, unknown>);
            return {
              executionId: '00000000-0000-4000-8000-000000000099',
              storeId,
              workflowName: 'vaarg.catalog.sync',
              idempotencyKey: nextInput.idempotencyKey,
              correlationId: nextInput.correlationId,
              concurrencyKey: nextInput.concurrencyKey,
              hatchetWorkflowRunId: 'hatchet-cont-1',
              outboxEventId: null,
              status: 'submitted',
              payloadHash: 'hash',
              attempts: 1,
              lastError: null,
              submittedAt: '2026-11-27T12:06:00.000Z',
              startedAt: null,
              completedAt: null,
              createdAt: '2026-11-27T12:06:00.000Z',
              updatedAt: '2026-11-27T12:06:00.000Z',
            };
          }),
          getWorkflowExecution: vi.fn(),
          cancelWorkflowExecution: vi.fn(),
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
        idempotencyKey: 'sync-3',
        correlationId: 'corr-3',
        concurrencyKey: `store:${storeId}:market:FR:FR`,
        initiateNewSweep: true,
        maxPages: 2,
        continuationIndex: 0,
        maxContinuations: 3,
      },
    );
    expect(partialOut.status).toBe('CONTINUATION_REQUIRED');
    expect(partialOut.pagesProcessed).toBe(2);
    expect(partialOut.continuationDispatched).toBe(true);
    expect(partialOut.nextExecutionId).toBe('00000000-0000-4000-8000-000000000099');
    expect(dispatchedContinuations).toHaveLength(1);
    expect(dispatchedContinuations[0]).toMatchObject({
      idempotencyKey: 'sync-3:cont:1',
      initiateNewSweep: false,
      continuationIndex: 1,
      maxContinuations: 3,
    });

    // 3b. Safely stops continuation chaining when maxContinuations cap is reached (still CONTINUATION_REQUIRED, never COMPLETED)
    const cappedOut = await runCatalogSyncWorkflowHandler(
      {
        pool: fakePool,
        env: {},
        bindings: [binding],
        delegationSecret: SECRET,
        rateClient: undefined,
        authorizeMerchant: async () => ({ storeId, role: 'marketing' }),
        executeCatalogPage: async () => ({ status: 'products', completedAt: null }),
        workflowOrchestration: {
          readiness: () => ({ status: 'READY', detail: 'ok' }),
          submitWorkflow: vi.fn(),
          getWorkflowExecution: vi.fn(),
          cancelWorkflowExecution: vi.fn(),
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
        idempotencyKey: 'sync-3:cont:3',
        correlationId: 'corr-3',
        concurrencyKey: `store:${storeId}:market:FR:FR`,
        initiateNewSweep: false,
        maxPages: 2,
        continuationIndex: 3,
        maxContinuations: 3,
      },
    );
    expect(cappedOut.status).toBe('CONTINUATION_REQUIRED');
    expect(cappedOut.continuationDispatched).toBe(false);
    expect(cappedOut.nextExecutionId).toBeNull();

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

  it('binds catalog continuations to the original generation and handles authorization expiry explicitly', async () => {
    // --- Generation binding: a continuation whose original generation has been
    // superseded by a new sweep must be rejected, not silently redirected.
    const staleTicket = issueCatalogDelegation(
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

    await expect(
      runCatalogSyncWorkflowHandler(
        {
          pool: fakePool,
          env: {},
          bindings: [binding],
          delegationSecret: SECRET,
          rateClient: undefined,
          authorizeMerchant: async () => ({ storeId, role: 'owner' }),
          executeCatalogPage: async () => ({ status: 'products', completedAt: null }),
          readCatalogGeneration: async () => '11111111-1111-4111-8111-111111111111',
        },
        {
          storeId,
          country: 'FR',
          language: 'FR',
          currency: 'EUR',
          shopifyDomain: binding.shopifyDomain,
          tokenEnv: binding.tokenEnv,
          delegationTicket: staleTicket,
          idempotencyKey: 'sync-gen-mismatch',
          correlationId: 'corr-gen',
          concurrencyKey: `store:${storeId}:market:FR:FR`,
          initiateNewSweep: false,
          maxPages: 2,
          generation: '22222222-2222-4222-8222-222222222222',
        },
      ),
    ).rejects.toThrow(/CATALOG_GENERATION_MISMATCH/);

    // --- Continuation carries the bound generation forward.
    const dispatchedGenerations: Array<Record<string, unknown>> = [];
    await runCatalogSyncWorkflowHandler(
      {
        pool: fakePool,
        env: {},
        bindings: [binding],
        delegationSecret: SECRET,
        rateClient: undefined,
        authorizeMerchant: async () => ({ storeId, role: 'owner' }),
        executeCatalogPage: async () => ({ status: 'products', completedAt: null }),
        readCatalogGeneration: async () => '33333333-3333-4333-8333-333333333333',
        workflowOrchestration: {
          readiness: () => ({ status: 'READY', detail: 'ok' }),
          submitWorkflow: vi.fn(async (_name, nextInput) => {
            dispatchedGenerations.push(nextInput as unknown as Record<string, unknown>);
            return {
              executionId: '00000000-0000-4000-8000-000000000098',
              storeId,
              workflowName: 'vaarg.catalog.sync',
              idempotencyKey: nextInput.idempotencyKey,
              correlationId: nextInput.correlationId,
              concurrencyKey: nextInput.concurrencyKey,
              hatchetWorkflowRunId: 'hatchet-cont-gen',
              outboxEventId: null,
              status: 'submitted',
              payloadHash: 'hash',
              attempts: 1,
              lastError: null,
              submittedAt: '2026-11-27T12:06:00.000Z',
              startedAt: null,
              completedAt: null,
              createdAt: '2026-11-27T12:06:00.000Z',
              updatedAt: '2026-11-27T12:06:00.000Z',
            };
          }),
          getWorkflowExecution: vi.fn(),
          cancelWorkflowExecution: vi.fn(),
        },
      },
      {
        storeId,
        country: 'FR',
        language: 'FR',
        currency: 'EUR',
        shopifyDomain: binding.shopifyDomain,
        tokenEnv: binding.tokenEnv,
        delegationTicket: staleTicket,
        idempotencyKey: 'sync-gen-cont',
        correlationId: 'corr-gen-2',
        concurrencyKey: `store:${storeId}:market:FR:FR`,
        initiateNewSweep: false,
        maxPages: 2,
        continuationIndex: 0,
        maxContinuations: 3,
        generation: '33333333-3333-4333-8333-333333333333',
      },
    );
    expect(dispatchedGenerations[0]).toMatchObject({
      generation: '33333333-3333-4333-8333-333333333333',
    });

    // --- Explicit expired-authorization: a ticket valid at start but expiring
    // before the continuation budget is exhausted stops the run and is
    // recorded as `authorization_expired`, never a false completion.
    const expiringTicket = issueCatalogDelegation(
      {
        host: binding.host,
        storeId,
        merchantUserId,
        sessionId: merchantSessionId,
        jobId: randomUUID(),
        action: 'start',
        expiresAt: Date.now() + 5_000, // valid now, expires within the continuation window
      },
      SECRET,
    );
    const expiredOut = await runCatalogSyncWorkflowHandler(
      {
        pool: fakePool,
        env: {},
        bindings: [binding],
        delegationSecret: SECRET,
        rateClient: undefined,
        authorizeMerchant: async () => ({ storeId, role: 'owner' }),
        executeCatalogPage: async () => ({ status: 'products', completedAt: null }),
        workflowOrchestration: {
          readiness: () => ({ status: 'READY', detail: 'ok' }),
          submitWorkflow: vi.fn(),
          getWorkflowExecution: vi.fn(),
          cancelWorkflowExecution: vi.fn(),
        },
      },
      {
        storeId,
        country: 'FR',
        language: 'FR',
        currency: 'EUR',
        shopifyDomain: binding.shopifyDomain,
        tokenEnv: binding.tokenEnv,
        delegationTicket: expiringTicket,
        idempotencyKey: 'sync-expired',
        correlationId: 'corr-expired',
        concurrencyKey: `store:${storeId}:market:FR:FR`,
        initiateNewSweep: false,
        maxPages: 2,
        continuationIndex: 0,
        maxContinuations: 3,
      },
    );
    expect(expiredOut.continuationDispatched).toBe(false);
    expect(expiredOut.finalSyncStatus).toBe('authorization_expired');
    expect(expiredOut.status).toBe('CONTINUATION_REQUIRED');
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
