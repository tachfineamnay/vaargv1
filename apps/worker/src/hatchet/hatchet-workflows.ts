import {
  ConcurrencyLimitStrategy,
  CreateTaskWorkflow,
  NonRetryableError,
  Priority,
  type Context,
  type HatchetClient,
  type Worker,
} from '@hatchet-dev/typescript-sdk';
import type { Pool } from 'pg';
import {
  WORKFLOW_CONTRACT_REGISTRY,
  catalogSyncWorkflowInputSchema,
  catalogSyncWorkflowOutputSchema,
  embeddingRefreshWorkflowInputSchema,
  embeddingRefreshWorkflowOutputSchema,
  retentionCleanupWorkflowInputSchema,
  retentionCleanupWorkflowOutputSchema,
  type CatalogSyncWorkflowInput,
  type CatalogSyncWorkflowOutput,
  type EmbeddingRefreshWorkflowInput,
  type EmbeddingRefreshWorkflowOutput,
  type ImplementedWorkflowName,
  type RetentionCleanupWorkflowInput,
  type RetentionCleanupWorkflowOutput,
  type WorkflowOrchestrationPort,
} from '@vaarg/shared';
import {
  createDb,
  createGeminiEmbeddingPort,
  executeCatalogStep,
  loadGeminiEmbeddingConfig,
  markWorkflowLifecycleStatus,
  purgeExpiredExperience,
  purgeExpiredIntelligenceData,
  resolveMerchantSessionId,
  resolveStorefront,
  runEmbeddingJob,
  verifyCatalogDelegation,
  withStoreContext,
  type RateLimitClient,
  type StorefrontBinding,
} from '@vaarg/persistence';

export interface HatchetWorkflowRuntimeDeps {
  pool: Pool;
  env: NodeJS.ProcessEnv;
  bindings: StorefrontBinding[];
  delegationSecret: string | undefined;
  rateClient: RateLimitClient | undefined;
  authorizeMerchant?: (
    binding: StorefrontBinding,
    merchantUserId: string,
    sessionId: string,
  ) => Promise<{ storeId: string; role: string } | null>;
  executeCatalogPage?: (
    binding: StorefrontBinding,
    action: 'start' | 'step',
    signal: AbortSignal | undefined,
  ) => Promise<{ status: string; completedAt: Date | null }>;
  workflowOrchestration?: WorkflowOrchestrationPort;
}

export interface WorkflowTaskExecutionContext {
  workflowRunId?: string;
  signal?: AbortSignal;
  cancelled?: () => boolean;
}

export async function runCatalogSyncWorkflowHandler(
  deps: HatchetWorkflowRuntimeDeps,
  rawInput: CatalogSyncWorkflowInput,
  execCtx: WorkflowTaskExecutionContext = {},
): Promise<CatalogSyncWorkflowOutput> {
  const parsed = catalogSyncWorkflowInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new NonRetryableError(
      `INVALID_CATALOG_SYNC_INPUT: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  const input = parsed.data;

  if (!deps.delegationSecret || deps.delegationSecret.length < 32) {
    throw new NonRetryableError('CATALOG_JOB_SIGNING_SECRET is not configured');
  }
  if (!deps.rateClient && !deps.executeCatalogPage) {
    throw new NonRetryableError('Valkey rate limiter is not configured for catalog sync');
  }

  // Revalidate signed operator delegation + live merchant role in PostgreSQL
  let claims;
  try {
    claims = verifyCatalogDelegation(input.delegationTicket, deps.delegationSecret);
  } catch {
    throw new NonRetryableError('UNAUTHORIZED: Invalid or expired catalog delegation ticket');
  }

  const binding = resolveStorefront(deps.bindings, claims.host);
  if (
    !binding ||
    binding.storeId !== input.storeId ||
    binding.storeId !== claims.storeId ||
    binding.country !== input.country ||
    binding.language !== input.language
  ) {
    throw new NonRetryableError('UNAUTHORIZED: Storefront binding mismatch');
  }

  const authorize =
    deps.authorizeMerchant ??
    (async (b, merchantUserId, sessionId) => {
      const identity = await withStoreContext(createDb(deps.pool), b.storeId, (tx) =>
        resolveMerchantSessionId(tx, b.storeId, sessionId),
      );
      return identity?.merchantUserId === merchantUserId ? identity : null;
    });

  const merchantIdentity = await authorize(binding, claims.merchantUserId, claims.sessionId);
  if (
    !merchantIdentity ||
    merchantIdentity.storeId !== binding.storeId ||
    !['owner', 'marketing'].includes(merchantIdentity.role)
  ) {
    throw new NonRetryableError('UNAUTHORIZED: Merchant session revoked or lacks permission');
  }

  if (execCtx.workflowRunId) {
    await markWorkflowLifecycleStatus(deps.pool, {
      storeId: input.storeId,
      hatchetWorkflowRunId: execCtx.workflowRunId,
      status: 'running',
    }).catch(() => null);
  }

  const runPage =
    deps.executeCatalogPage ??
    ((b: StorefrontBinding, action: 'start' | 'step', sig: AbortSignal | undefined) =>
      executeCatalogStep(deps.pool, deps.rateClient!, b, deps.env, action, sig));

  if (input.initiateNewSweep) {
    await runPage(binding, 'start', execCtx.signal);
  }

  let pagesProcessed = 0;
  let finalSyncStatus = 'in_progress';
  let completedAt: Date | null = null;

  while (pagesProcessed < input.maxPages) {
    if (execCtx.cancelled?.() || execCtx.signal?.aborted) {
      throw new Error('CANCELLED: Catalog sync workflow cancelled');
    }

    const stepResult = await runPage(binding, 'step', execCtx.signal);
    pagesProcessed += 1;
    finalSyncStatus = stepResult.status;
    completedAt = stepResult.completedAt;

    if (stepResult.status === 'complete') {
      break;
    }
  }

  let continuationDispatched = false;
  let nextExecutionId: string | null = null;

  if (
    finalSyncStatus !== 'complete' &&
    deps.workflowOrchestration &&
    input.continuationIndex < input.maxContinuations &&
    claims.expiresAt > Date.now() + 30_000
  ) {
    const rootKey = input.idempotencyKey.replace(/:cont:\d+$/, '');
    const nextIndex = input.continuationIndex + 1;
    const nextIdempotencyKey = `${rootKey}:cont:${nextIndex}`.slice(0, 200);
    const nextExec = await deps.workflowOrchestration.submitWorkflow('vaarg.catalog.sync', {
      storeId: input.storeId,
      country: input.country,
      language: input.language,
      currency: input.currency,
      shopifyDomain: input.shopifyDomain,
      tokenEnv: input.tokenEnv,
      delegationTicket: input.delegationTicket,
      idempotencyKey: nextIdempotencyKey,
      correlationId: input.correlationId,
      concurrencyKey: input.concurrencyKey,
      initiateNewSweep: false,
      maxPages: input.maxPages,
      continuationIndex: nextIndex,
      maxContinuations: input.maxContinuations,
    });
    continuationDispatched = true;
    nextExecutionId = nextExec.executionId;
  }

  const output = catalogSyncWorkflowOutputSchema.parse({
    status: finalSyncStatus === 'complete' ? 'COMPLETED' : 'CONTINUATION_REQUIRED',
    pagesProcessed,
    finalSyncStatus,
    completedAt: completedAt ? completedAt.toISOString() : null,
    continuationDispatched,
    nextExecutionId,
  });

  if (execCtx.workflowRunId) {
    await markWorkflowLifecycleStatus(deps.pool, {
      storeId: input.storeId,
      hatchetWorkflowRunId: execCtx.workflowRunId,
      status: finalSyncStatus === 'complete' ? 'completed' : 'continuation_required',
      resultSummary: output as unknown as Record<string, unknown>,
    }).catch(() => null);
  }

  return output;
}

export async function runEmbeddingRefreshWorkflowHandler(
  deps: Pick<HatchetWorkflowRuntimeDeps, 'pool' | 'env'>,
  rawInput: EmbeddingRefreshWorkflowInput,
  execCtx: WorkflowTaskExecutionContext = {},
): Promise<EmbeddingRefreshWorkflowOutput> {
  const parsed = embeddingRefreshWorkflowInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new NonRetryableError(
      `INVALID_EMBEDDING_REFRESH_INPUT: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  const input = parsed.data;

  if (execCtx.workflowRunId) {
    await markWorkflowLifecycleStatus(deps.pool, {
      storeId: input.storeId,
      hatchetWorkflowRunId: execCtx.workflowRunId,
      status: 'running',
    }).catch(() => null);
  }

  const geminiConfig = loadGeminiEmbeddingConfig(deps.env);
  const embeddingPort = createGeminiEmbeddingPort(geminiConfig);

  const result = await runEmbeddingJob(
    deps.pool,
    embeddingPort,
    {
      storeId: input.storeId,
      country: input.country,
      language: input.language,
    },
    {
      batchSize: input.batchSize,
      maxDocuments: input.maxDocuments,
      ...(execCtx.signal ? { signal: execCtx.signal } : {}),
    },
  );

  const output = embeddingRefreshWorkflowOutputSchema.parse({
    status: result.status,
    processed: result.processed,
    skippedUnchanged: result.skipped,
    failed: result.stale,
    remaining: result.remaining,
  });

  if (execCtx.workflowRunId) {
    await markWorkflowLifecycleStatus(deps.pool, {
      storeId: input.storeId,
      hatchetWorkflowRunId: execCtx.workflowRunId,
      status: 'completed',
      resultSummary: output as unknown as Record<string, unknown>,
    }).catch(() => null);
  }

  return output;
}

export async function runRetentionCleanupWorkflowHandler(
  deps: Pick<HatchetWorkflowRuntimeDeps, 'pool'>,
  rawInput: RetentionCleanupWorkflowInput,
  execCtx: WorkflowTaskExecutionContext = {},
): Promise<RetentionCleanupWorkflowOutput> {
  const parsed = retentionCleanupWorkflowInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new NonRetryableError(
      `INVALID_RETENTION_CLEANUP_INPUT: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  const input = parsed.data;
  const asOf = input.asOfIso ? new Date(input.asOfIso) : new Date();

  if (execCtx.workflowRunId) {
    await markWorkflowLifecycleStatus(deps.pool, {
      storeId: input.storeId,
      hatchetWorkflowRunId: execCtx.workflowRunId,
      status: 'running',
    }).catch(() => null);
  }

  const [experienceDeletedCount, intelligencePurged] = await Promise.all([
    purgeExpiredExperience(deps.pool, input.storeId),
    purgeExpiredIntelligenceData(deps.pool, input.storeId, asOf),
  ]);

  const output = retentionCleanupWorkflowOutputSchema.parse({
    status: 'COMPLETED',
    experiencePurged: { total: experienceDeletedCount },
    intelligencePurged,
    executedAt: asOf.toISOString(),
  });

  if (execCtx.workflowRunId) {
    await markWorkflowLifecycleStatus(deps.pool, {
      storeId: input.storeId,
      hatchetWorkflowRunId: execCtx.workflowRunId,
      status: 'completed',
      resultSummary: output as unknown as Record<string, unknown>,
    }).catch(() => null);
  }

  return output;
}

/**
 * Builds Hatchet v1 TaskWorkflowDeclaration instances ONLY for workflows with
 * real, implemented handlers (`vaarg.catalog.sync`, `vaarg.embeddings.refresh`,
 * `vaarg.experience.retention_cleanup`). Unimplemented FL09–FL11 contracts are
 * intentionally never registered on the worker.
 */
export function buildRegisteredHatchetWorkflows(
  deps: HatchetWorkflowRuntimeDeps,
  client?: HatchetClient,
): {
  names: readonly ImplementedWorkflowName[];
  declarations: Parameters<Worker['registerWorkflows']>[0];
} {
  const catalogMeta = WORKFLOW_CONTRACT_REGISTRY['vaarg.catalog.sync'];
  const embeddingMeta = WORKFLOW_CONTRACT_REGISTRY['vaarg.embeddings.refresh'];
  const retentionMeta = WORKFLOW_CONTRACT_REGISTRY['vaarg.experience.retention_cleanup'];

  const catalogSyncWorkflow = CreateTaskWorkflow(
    {
      name: 'vaarg.catalog.sync',
      description: 'Bounded multi-page Shopify catalog synchronization resuming from persisted checkpoints',
      defaultPriority: Priority.MEDIUM,
      executionTimeout: catalogMeta.executionTimeout,
      scheduleTimeout: catalogMeta.scheduleTimeout,
      retries: catalogMeta.retries,
      backoff: {
        factor: catalogMeta.backoffFactor,
        maxSeconds: catalogMeta.backoffMaxSeconds,
      },
      concurrency: {
        expression: 'input.concurrencyKey',
        maxRuns: 1,
        limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
      },
      idempotency: {
        expression: 'input.idempotencyKey',
        strategy: 'status',
        fallbackTtlMs: 86_400_000,
      },
      fn: async (input: CatalogSyncWorkflowInput, ctx?: Context<CatalogSyncWorkflowInput>) => {
        try {
          return await runCatalogSyncWorkflowHandler(deps, input, {
            ...(ctx ? { workflowRunId: ctx.workflowRunId() } : {}),
            ...(ctx ? { signal: ctx.abortController.signal } : {}),
            ...(ctx ? { cancelled: () => ctx.cancelled } : {}),
          });
        } catch (err) {
          ctx?.rethrowIfCancelled(err);
          throw err;
        }
      },
    },
    client,
  );

  const embeddingRefreshWorkflow = CreateTaskWorkflow(
    {
      name: 'vaarg.embeddings.refresh',
      description: 'Incremental market-scoped catalog search embedding refresh',
      defaultPriority: Priority.LOW,
      executionTimeout: embeddingMeta.executionTimeout,
      scheduleTimeout: embeddingMeta.scheduleTimeout,
      retries: embeddingMeta.retries,
      backoff: {
        factor: embeddingMeta.backoffFactor,
        maxSeconds: embeddingMeta.backoffMaxSeconds,
      },
      concurrency: {
        expression: 'input.concurrencyKey',
        maxRuns: 1,
        limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
      },
      idempotency: {
        expression: 'input.idempotencyKey',
        strategy: 'status',
        fallbackTtlMs: 86_400_000,
      },
      fn: async (
        input: EmbeddingRefreshWorkflowInput,
        ctx?: Context<EmbeddingRefreshWorkflowInput>,
      ) => {
        try {
          return await runEmbeddingRefreshWorkflowHandler(deps, input, {
            ...(ctx ? { workflowRunId: ctx.workflowRunId() } : {}),
            ...(ctx ? { signal: ctx.abortController.signal } : {}),
            ...(ctx ? { cancelled: () => ctx.cancelled } : {}),
          });
        } catch (err) {
          ctx?.rethrowIfCancelled(err);
          throw err;
        }
      },
    },
    client,
  );

  const retentionCleanupWorkflow = CreateTaskWorkflow(
    {
      name: 'vaarg.experience.retention_cleanup',
      description: 'Store-scoped retention purge for expired experience and intelligence data',
      defaultPriority: Priority.LOW,
      executionTimeout: retentionMeta.executionTimeout,
      scheduleTimeout: retentionMeta.scheduleTimeout,
      retries: retentionMeta.retries,
      backoff: {
        factor: retentionMeta.backoffFactor,
        maxSeconds: retentionMeta.backoffMaxSeconds,
      },
      concurrency: {
        expression: 'input.concurrencyKey',
        maxRuns: 1,
        limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
      },
      idempotency: {
        expression: 'input.idempotencyKey',
        strategy: 'ttl',
        ttlMs: 3_600_000,
      },
      fn: async (
        input: RetentionCleanupWorkflowInput,
        ctx?: Context<RetentionCleanupWorkflowInput>,
      ) => {
        try {
          return await runRetentionCleanupWorkflowHandler(deps, input, {
            ...(ctx ? { workflowRunId: ctx.workflowRunId() } : {}),
            ...(ctx ? { signal: ctx.abortController.signal } : {}),
            ...(ctx ? { cancelled: () => ctx.cancelled } : {}),
          });
        } catch (err) {
          ctx?.rethrowIfCancelled(err);
          throw err;
        }
      },
    },
    client,
  );

  return {
    names: [
      'vaarg.catalog.sync',
      'vaarg.embeddings.refresh',
      'vaarg.experience.retention_cleanup',
    ],
    declarations: [
      catalogSyncWorkflow,
      embeddingRefreshWorkflow,
      retentionCleanupWorkflow,
    ],
  };
}
