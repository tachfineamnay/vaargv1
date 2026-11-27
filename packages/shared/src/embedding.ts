import { z } from 'zod';

/**
 * FL05 EmbeddingPort contracts — provider-independent. Availability is
 * explicit: when no provider is configured the port reports NOT_CONFIGURED
 * and callers degrade to lexical retrieval (DEGRADED_LEXICAL). Random
 * vectors are NEVER a production fallback. Provider calls happen outside
 * database transactions, bounded and cancellable.
 */

export const embeddingAvailabilitySchema = z.enum(['READY', 'NOT_CONFIGURED', 'ERROR']);
export type EmbeddingAvailability = z.infer<typeof embeddingAvailabilitySchema>;

export const embeddingIdentitySchema = z.strictObject({
  provider: z.string().min(1).max(64),
  model: z.string().min(1).max(128),
  modelVersion: z.string().min(1).max(64),
  dimension: z.number().int().min(1).max(4096),
});
export type EmbeddingIdentity = z.infer<typeof embeddingIdentitySchema>;

export const embeddingBatchResultSchema = z.strictObject({
  vectors: z.array(z.array(z.number())).max(256),
  identity: embeddingIdentitySchema,
  /** Content hashes of the inputs, in order (reindex/staleness bookkeeping). */
  contentHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(256),
});
export type EmbeddingBatchResult = z.infer<typeof embeddingBatchResultSchema>;

export interface EmbeddingRequestOptions {
  signal?: AbortSignal;
  /** Per-call timeout bound (ms). */
  timeoutMs?: number;
  /** Content hashes of the inputs, in order (required for bookkeeping). */
  contentHashes?: string[];
}

/**
 * Provider-independent embedding port. `availability()` is cheap and must
 * never throw. `embedQuery`/`embedDocuments` reject with a typed error when
 * NOT_CONFIGURED — they never fabricate vectors.
 */
export interface EmbeddingPort {
  availability(): EmbeddingAvailability;
  identity(): EmbeddingIdentity | null;
  embedQuery(text: string, options?: EmbeddingRequestOptions): Promise<number[]>;
  embedDocuments(texts: string[], options?: EmbeddingRequestOptions): Promise<EmbeddingBatchResult>;
}

/** Typed embedding failure surfaced to callers (never a fake vector). */
export class EmbeddingUnavailableError extends Error {
  readonly availability: EmbeddingAvailability;
  constructor(availability: EmbeddingAvailability, message: string) {
    super(message);
    this.name = 'EmbeddingUnavailableError';
    this.availability = availability;
  }
}

/** Bounded batching helper: chunks inputs into fixed-size batches. */
export function chunkBatch<T>(items: readonly T[], batchSize: number): T[][] {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('INVALID_BATCH_SIZE');
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    chunks.push(items.slice(index, index + batchSize) as T[]);
  }
  return chunks;
}
