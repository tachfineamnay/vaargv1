import type { Pool } from 'pg';
import {
  createGeminiEmbeddingPort,
  loadGeminiEmbeddingConfig,
  loadStorefrontBindings,
  runEmbeddingJob,
} from '@vaarg/persistence';
import type { JobDefinition } from './job-runner.js';

/**
 * Embeddings maintenance job (FL05). Runs the real incremental embedding
 * pass per storefront binding — batching, retries and idempotent writes
 * live in persistence. Without a provider key the adapter reports
 * NOT_CONFIGURED and nothing is embedded (never random vectors, never
 * paid calls). `AbortSignal` cancellation propagates to the provider.
 */
export function createEmbeddingJob(pool: Pool, env: NodeJS.ProcessEnv): JobDefinition {
  return {
    name: 'embeddings.refresh',
    async handler(context) {
      const bindings = loadStorefrontBindings(env);
      if (bindings.length === 0) return; // no configured storefronts: nothing to embed
      const embedding = createGeminiEmbeddingPort(loadGeminiEmbeddingConfig(env));
      const seen = new Set<string>();
      for (const binding of bindings) {
        if (context.signal?.aborted) throw new Error('ABORTED');
        const scope = `${binding.storeId}:${binding.country}:${binding.language}`;
        if (seen.has(scope)) continue;
        seen.add(scope);
        await runEmbeddingJob(
          pool,
          embedding,
          { storeId: binding.storeId, country: binding.country, language: binding.language },
          {
            ...(context.signal ? { signal: context.signal } : {}),
            maxDocuments: Number(env.EMBEDDING_JOB_MAX_DOCUMENTS ?? 512),
            batchSize: Number(env.EMBEDDING_BATCH_SIZE ?? 16),
          },
        );
      }
    },
  };
}
