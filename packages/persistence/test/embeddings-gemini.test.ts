import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  GeminiEmbeddingAdapter,
  createGeminiEmbeddingPort,
  loadGeminiEmbeddingConfig,
  type GeminiEmbeddingConfig,
} from '../src/embeddings/gemini.js';
import { EmbeddingUnavailableError, chunkBatch } from '@vaarg/shared';

const baseConfig: GeminiEmbeddingConfig = {
  apiKey: 'test-key',
  model: DEFAULT_GEMINI_EMBEDDING_MODEL,
  modelVersion: 'v1',
  dimension: 768,
  batchSize: 8,
  timeoutMs: 1000,
  maxRetries: 2,
};

function okResponse(count: number, dimension: number): Response {
  return new Response(
    JSON.stringify({
      content: {
        embeddings: Array.from({ length: count }, () => ({
          values: Array.from({ length: dimension }, (_, index) => index / 1000),
        })),
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('FL05 Gemini embedding adapter (no paid calls in tests)', () => {
  it('reports NOT_CONFIGURED without a key and never calls the network', async () => {
    const fetchImpl = vi.fn();
    const adapter = new GeminiEmbeddingAdapter({ ...baseConfig, apiKey: undefined }, { fetchImpl });
    expect(adapter.availability()).toBe('NOT_CONFIGURED');
    expect(adapter.identity()).toBeNull();
    await expect(adapter.embedQuery('silver ring')).rejects.toBeInstanceOf(EmbeddingUnavailableError);
    await expect(adapter.embedDocuments(['a', 'b'])).rejects.toBeInstanceOf(EmbeddingUnavailableError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('factory returns a NOT_CONFIGURED adapter for an empty env', () => {
    const saved = { ...process.env };
    delete process.env.GEMINI_API_KEY;
    try {
      const adapter = createGeminiEmbeddingPort(loadGeminiEmbeddingConfig({}));
      expect(adapter.availability()).toBe('NOT_CONFIGURED');
    } finally {
      process.env = saved;
    }
  });

  it('embeds batches with identity, content hashes and exact dimension', async () => {
    const fetchImpl = vi.fn(async () => okResponse(3, 768));
    const adapter = new GeminiEmbeddingAdapter(baseConfig, { fetchImpl });
    expect(adapter.availability()).toBe('READY');
    expect(adapter.identity()).toEqual({
      provider: 'gemini',
      model: DEFAULT_GEMINI_EMBEDDING_MODEL,
      modelVersion: 'v1',
      dimension: 768,
    });
    const result = await adapter.embedDocuments(['one', 'two', 'three']);
    expect(result.vectors).toHaveLength(3);
    expect(result.vectors[0]).toHaveLength(768);
    expect(result.contentHashes.every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.headers ? (init.headers as Record<string, string>)['x-goog-api-key'] : '')).toBe('test-key');
    const body = JSON.parse(String(init.body)) as { requests: unknown[] };
    expect(body.requests).toHaveLength(3);
  });

  it('splits large batches to the configured size', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { requests: unknown[] };
      return okResponse(body.requests.length, 768);
    });
    const adapter = new GeminiEmbeddingAdapter(baseConfig, { fetchImpl }); // batchSize 8
    const texts = Array.from({ length: 20 }, (_, index) => `doc ${index}`);
    const result = await adapter.embedDocuments(texts);
    expect(result.vectors).toHaveLength(20);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 8 + 8 + 4
    expect(chunkBatch(texts, 8).map((batch) => batch.length)).toEqual([8, 8, 4]);
  });

  it('rejects wrong-dimension and malformed provider payloads', async () => {
    const wrongDim = vi.fn(
      async () =>
        new Response(JSON.stringify({ content: { embeddings: [{ values: [0.1, 0.2] }] } }), {
          status: 200,
        }),
    );
    const adapter = new GeminiEmbeddingAdapter(baseConfig, { fetchImpl: wrongDim, sleepImpl: async () => undefined });
    await expect(adapter.embedQuery('x')).rejects.toThrow('EMBEDDING_DIMENSION_MISMATCH');
    expect(wrongDim).toHaveBeenCalledTimes(1); // dimension errors are not retried

    const malformed = vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 }));
    const adapter2 = new GeminiEmbeddingAdapter(baseConfig, { fetchImpl: malformed, sleepImpl: async () => undefined });
    await expect(adapter2.embedQuery('x')).rejects.toThrow('EMBEDDING_INVALID_RESPONSE');
  });

  it('retries retryable HTTP statuses with backoff, then surfaces the failure', async () => {
    const sleepImpl = vi.fn(async () => undefined);
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return new Response('{}', { status: 429 });
    });
    const adapter = new GeminiEmbeddingAdapter(
      { ...baseConfig, maxRetries: 2 },
      { fetchImpl, sleepImpl },
    );
    await expect(adapter.embedQuery('x')).rejects.toThrow('EMBEDDING_HTTP_429');
    expect(calls).toBe(3); // first try + 2 retries
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable client errors', async () => {
    const sleepImpl = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 403 }));
    const adapter = new GeminiEmbeddingAdapter(baseConfig, { fetchImpl, sleepImpl });
    await expect(adapter.embedQuery('x')).rejects.toThrow('EMBEDDING_HTTP_403');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it('honors caller cancellation before and during the request', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          // Real fetch rejects with a DOMException named AbortError.
          const abortError = new Error('The operation was aborted.');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      }),
    );
    const adapter = new GeminiEmbeddingAdapter(baseConfig, { fetchImpl });
    const already = new AbortController();
    already.abort();
    await expect(adapter.embedQuery('x', { signal: already.signal })).rejects.toThrow('ABORTED');

    const during = new AbortController();
    const pending = adapter.embedQuery('y', { signal: during.signal });
    during.abort();
    await expect(pending).rejects.toThrow('ABORTED');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('enforces the bounded batch size', async () => {
    const fetchImpl = vi.fn();
    const adapter = new GeminiEmbeddingAdapter(baseConfig, { fetchImpl });
    await expect(adapter.embedDocuments(Array.from({ length: 257 }, () => 'x'))).rejects.toThrow(
      'EMBEDDING_BATCH_TOO_LARGE',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
