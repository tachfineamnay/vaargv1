import { createHash } from 'node:crypto';
import {
  EMBEDDING_DIMENSION,
  EmbeddingUnavailableError,
  chunkBatch,
  type EmbeddingAvailability,
  type EmbeddingBatchResult,
  type EmbeddingIdentity,
  type EmbeddingPort,
  type EmbeddingRequestOptions,
} from '@vaarg/shared';

/**
 * FL05 TASK 05 — server-side Gemini embedding adapter over the documented
 * `batchEmbedContents` REST contract (v1beta). Model selection is explicit
 * and configurable; nothing is hardcoded beyond documented defaults, no
 * credentials live in code, and provider responses are validated with a
 * strict runtime schema — malformed or wrong-dimension responses are
 * rejected, never coerced. No paid API call happens unless an operator
 * configures a key AND a caller invokes the port.
 *
 * Guarantees: bounded batching, per-call timeout, caller cancellation,
 * bounded retries with backoff on retryable statuses, dimension validation,
 * and NO random-vector fallback ever.
 */

export interface GeminiEmbeddingConfig {
  /** Operator-provided API key (e.g. process.env.GEMINI_API_KEY). */
  apiKey: string | undefined;
  /** Explicit model name; documented default is text-embedding-004. */
  model: string;
  /** Model version tag recorded alongside stored embeddings. */
  modelVersion: string;
  /** Expected output dimension (PRD baseline: 768). */
  dimension: number;
  /** Requests per batch (bounded). */
  batchSize: number;
  /** Per-request timeout in ms (bounded). */
  timeoutMs: number;
  /** Maximum retries for retryable failures (bounded, excluding first try). */
  maxRetries: number;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable sleep for retry backoff tests. */
  sleepImpl?: (ms: number) => Promise<void>;
}

export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'text-embedding-004';

export function loadGeminiEmbeddingConfig(
  env: NodeJS.ProcessEnv = process.env,
): GeminiEmbeddingConfig {
  const dimension = Number(env.GEMINI_EMBEDDING_DIMENSION ?? EMBEDDING_DIMENSION);
  if (!Number.isInteger(dimension) || dimension < 1 || dimension > 4096) {
    throw new Error('INVALID_GEMINI_EMBEDDING_DIMENSION');
  }
  const batchSize = Number(env.GEMINI_EMBEDDING_BATCH_SIZE ?? 16);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 64) {
    throw new Error('INVALID_GEMINI_EMBEDDING_BATCH_SIZE');
  }
  const timeoutMs = Number(env.GEMINI_EMBEDDING_TIMEOUT_MS ?? 10000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) {
    throw new Error('INVALID_GEMINI_EMBEDDING_TIMEOUT_MS');
  }
  const maxRetries = Number(env.GEMINI_EMBEDDING_MAX_RETRIES ?? 2);
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
    throw new Error('INVALID_GEMINI_EMBEDDING_MAX_RETRIES');
  }
  return {
    apiKey: env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim() ? env.GEMINI_API_KEY.trim() : undefined,
    model: (env.GEMINI_EMBEDDING_MODEL ?? DEFAULT_GEMINI_EMBEDDING_MODEL).trim(),
    modelVersion: (env.GEMINI_EMBEDDING_MODEL_VERSION ?? 'v1').trim(),
    dimension,
    batchSize,
    timeoutMs,
    maxRetries,
  };
}

// --- Response validation (no trust in provider payloads) -------------------

interface GeminiEmbeddingResponse {
  content?: {
    embeddings?: Array<{ values?: unknown }>;
  };
}

function parseEmbeddingResponse(raw: unknown, expected: number, count: number): number[][] {
  if (!raw || typeof raw !== 'object') throw new Error('EMBEDDING_INVALID_RESPONSE');
  const parsed = (raw as GeminiEmbeddingResponse).content?.embeddings;
  if (!Array.isArray(parsed) || parsed.length !== count) {
    throw new Error('EMBEDDING_INVALID_RESPONSE');
  }
  return parsed.map((entry) => {
    const values = entry?.values;
    if (!Array.isArray(values) || values.length !== expected) {
      throw new Error('EMBEDDING_DIMENSION_MISMATCH');
    }
    for (const value of values) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('EMBEDDING_INVALID_RESPONSE');
      }
    }
    return values as number[];
  });
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GeminiEmbeddingAdapter implements EmbeddingPort {
  private readonly config: GeminiEmbeddingConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(config: GeminiEmbeddingConfig, hooks?: { fetchImpl?: typeof fetch; sleepImpl?: (ms: number) => Promise<void> }) {
    if (!Number.isInteger(config.dimension) || config.dimension < 1) {
      throw new Error('INVALID_EMBEDDING_DIMENSION');
    }
    this.config = config;
    this.fetchImpl = hooks?.fetchImpl ?? fetch;
    this.sleepImpl = hooks?.sleepImpl ?? defaultSleep;
  }

  availability(): EmbeddingAvailability {
    return this.config.apiKey ? 'READY' : 'NOT_CONFIGURED';
  }

  identity(): EmbeddingIdentity | null {
    if (!this.config.apiKey) return null;
    return {
      provider: 'gemini',
      model: this.config.model,
      modelVersion: this.config.modelVersion,
      dimension: this.config.dimension,
    };
  }

  async embedQuery(text: string, options?: EmbeddingRequestOptions): Promise<number[]> {
    const result = await this.embedBatch([text], options);
    const vector = result.vectors[0];
    if (!vector) throw new Error('EMBEDDING_INVALID_RESPONSE');
    return vector;
  }

  async embedDocuments(
    texts: string[],
    options?: EmbeddingRequestOptions,
  ): Promise<EmbeddingBatchResult> {
    if (texts.length === 0) {
      const identity = this.identity();
      if (!identity) throw new EmbeddingUnavailableError('NOT_CONFIGURED', 'Embedding provider not configured');
      return { vectors: [], identity, contentHashes: [] };
    }
    if (texts.length > 256) throw new Error('EMBEDDING_BATCH_TOO_LARGE');
    return this.embedBatch(texts, options);
  }

  private async embedBatch(
    texts: string[],
    options?: EmbeddingRequestOptions,
  ): Promise<EmbeddingBatchResult> {
    const identity = this.identity();
    if (!identity || !this.config.apiKey) {
      throw new EmbeddingUnavailableError('NOT_CONFIGURED', 'Embedding provider not configured');
    }
    const contentHashes =
      options?.contentHashes?.length === texts.length
        ? [...(options.contentHashes as string[])]
        : texts.map((text) => createHash('sha256').update(text).digest('hex'));

    const batches = chunkBatch(texts, this.config.batchSize);
    const vectors: number[][] = [];
    for (const batch of batches) {
      const chunk = await this.requestWithRetry(batch, options);
      vectors.push(...chunk);
    }
    if (vectors.length !== texts.length) throw new Error('EMBEDDING_INVALID_RESPONSE');
    return { vectors, identity, contentHashes };
  }

  private async requestWithRetry(
    texts: string[],
    options?: EmbeddingRequestOptions,
  ): Promise<number[][]> {
    const baseTimeout = options?.timeoutMs ?? this.config.timeoutMs;
    const timeoutMs = Math.max(100, Math.min(baseTimeout, 60000));
    let lastError: unknown = new Error('EMBEDDING_FAILED');
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      if (options?.signal?.aborted) throw new Error('ABORTED');
      try {
        return await this.requestOnce(texts, timeoutMs, options?.signal);
      } catch (error) {
        lastError = error;
        if (options?.signal?.aborted) throw error;
        if (error instanceof Error && error.message === 'ABORTED') throw error;
        const retryable =
          error instanceof Error &&
          'status' in error &&
          typeof (error as { status: unknown }).status === 'number' &&
          RETRYABLE_STATUSES.has((error as { status: number }).status);
        const network =
          error instanceof Error && (error.name === 'AbortError' || error.message === 'EMBEDDING_NETWORK_ERROR');
        if (attempt < this.config.maxRetries && (retryable || network)) {
          await this.sleepImpl(Math.min(2000, 100 * 2 ** attempt));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  private async requestOnce(
    texts: string[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<number[][]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('EMBEDDING_TIMEOUT')), timeoutMs);
    const onAbort = () => controller.abort(signal?.reason ?? new Error('ABORTED'));
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        throw new Error('ABORTED');
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.config.model)}:batchEmbedContents`;
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.config.apiKey ?? '',
        },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${this.config.model}`,
            content: { role: 'user', parts: [{ text }] },
            outputDimensionality: this.config.dimension,
          })),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`EMBEDDING_HTTP_${response.status}`) as Error & { status: number };
        error.status = response.status;
        throw error;
      }
      const raw: unknown = await response.json();
      return parseEmbeddingResponse(raw, this.config.dimension, texts.length);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        if (signal?.aborted) throw new Error('ABORTED');
        const timeout = new Error('EMBEDDING_TIMEOUT') as Error & { status: number };
        timeout.status = 408;
        throw timeout;
      }
      if (error instanceof TypeError) {
        const network = new Error('EMBEDDING_NETWORK_ERROR') as Error & { status: number };
        network.status = 503;
        throw network;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
}

/** Factory: returns a NOT_CONFIGURED adapter when no key exists (never fake). */
export function createGeminiEmbeddingPort(
  config: GeminiEmbeddingConfig,
  hooks?: { fetchImpl?: typeof fetch; sleepImpl?: (ms: number) => Promise<void> },
): EmbeddingPort {
  return new GeminiEmbeddingAdapter(config, hooks);
}
