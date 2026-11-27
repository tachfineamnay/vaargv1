import http from 'node:http';
import https from 'node:https';
import { resolveApiBase } from './api-client';
import { StorefrontError } from './errors';

/**
 * Host-forwarding JSON transport (FL04). Node's fetch (undici) strips any
 * caller-supplied `host` header — the connection host wins — so every
 * storefront request that must carry the public host uses `node:http` with an
 * explicit `Host` header. One request id is generated per call and echoed in
 * error bodies for correlation.
 */
export interface ForwardRequest {
  method: 'GET' | 'POST' | 'DELETE';
  /** Path with optional query string, e.g. `/v1/catalog/products?limit=24`. */
  path: string;
  /** Public storefront host sent as the `Host` header (tenant authority). */
  host: string;
  body?: unknown;
  cookie?: string | null;
  origin?: string;
  idempotencyKey?: string | null;
  lastEventId?: string | null;
  timeoutMs?: number;
  /** Correlation id echoed to the API (defaults to a generated one). */
  requestId?: string;
}

export interface ForwardResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const DEFAULT_TIMEOUT_MS = 4000;

function newRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function forwardRequest(request: ForwardRequest): Promise<ForwardResponse> {
  let base: string;
  try {
    base = resolveApiBase();
  } catch {
    throw new StorefrontError('internal', 'API_BASE_URL is not configured');
  }
  const target = new URL(request.path, base);
  const client = target.protocol === 'https:' ? https : http;
  const payload = request.body === undefined ? undefined : JSON.stringify(request.body);
  const headers: Record<string, string> = {
    Host: request.host,
    Accept: 'application/json',
    'x-request-id': request.requestId ?? newRequestId(),
  };
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(payload));
  }
  if (request.cookie) headers.Cookie = request.cookie;
  if (request.origin) headers.Origin = request.origin;
  if (request.idempotencyKey) headers['Idempotency-Key'] = request.idempotencyKey;
  if (request.lastEventId) headers['Last-Event-ID'] = request.lastEventId;
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<ForwardResponse>((resolve, reject) => {
    const outgoing = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        method: request.method,
        path: `${target.pathname}${target.search}`,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    outgoing.setTimeout(timeoutMs, () => {
      outgoing.destroy(new StorefrontError('timeout', `Storefront API request timed out after ${timeoutMs}ms`));
    });
    outgoing.on('error', (error) => {
      if (error instanceof StorefrontError) {
        reject(error);
        return;
      }
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ETIMEDOUT') {
        reject(new StorefrontError('timeout', 'Storefront API request timed out'));
        return;
      }
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ECONNRESET' || code === 'EHOSTUNREACH') {
        reject(new StorefrontError('network', `Storefront API unreachable (${code})`));
        return;
      }
      reject(new StorefrontError('network', error.message || 'Storefront API request failed'));
    });
    if (payload !== undefined) outgoing.write(payload);
    outgoing.end();
  });
}

export interface ForwardSseRequest {
  path: string;
  host: string;
  cookie?: string | null;
  lastEventId?: string | null;
  requestId?: string;
  signal?: AbortSignal;
  connectTimeoutMs?: number;
}

export interface ForwardSseResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: ReadableStream<Uint8Array> | string;
}

/**
 * Unbuffered Server-Sent Events transport over `node:http` / `node:https` so
 * explicit `Host` tenant headers are preserved and SSE frames flush chunk-by-chunk
 * without intermediate buffering.
 */
export function forwardSseRequest(request: ForwardSseRequest): Promise<ForwardSseResponse> {
  let base: string;
  try {
    base = resolveApiBase();
  } catch {
    throw new StorefrontError('internal', 'API_BASE_URL is not configured');
  }
  const target = new URL(request.path, base);
  const client = target.protocol === 'https:' ? https : http;
  const headers: Record<string, string> = {
    Host: request.host,
    Accept: 'text/event-stream',
    'Cache-Control': 'no-cache',
    'x-request-id': request.requestId ?? newRequestId(),
  };
  if (request.cookie) headers.Cookie = request.cookie;
  if (request.lastEventId) headers['Last-Event-ID'] = request.lastEventId;

  const connectTimeoutMs = request.connectTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<ForwardSseResponse>((resolve, reject) => {
    let settled = false;
    const outgoing = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        method: 'GET',
        path: `${target.pathname}${target.search}`,
        headers,
      },
      (response) => {
        clearTimeout(connectTimer);
        settled = true;
        const status = response.statusCode ?? 0;
        const contentType = String(response.headers['content-type'] ?? '');

        if (status !== 200 || !contentType.includes('text/event-stream')) {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            resolve({
              status,
              headers: response.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
          return;
        }

        response.socket?.setNoDelay(true);

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const onAbort = () => {
              response.destroy();
              outgoing.destroy();
              try {
                controller.close();
              } catch {
                // Already closed
              }
            };
            request.signal?.addEventListener('abort', onAbort, { once: true });

            response.on('data', (chunk: Buffer) => {
              try {
                controller.enqueue(new Uint8Array(chunk));
              } catch {
                response.destroy();
              }
            });
            response.on('end', () => {
              request.signal?.removeEventListener('abort', onAbort);
              try {
                controller.close();
              } catch {
                // Already closed
              }
            });
            response.on('error', () => {
              request.signal?.removeEventListener('abort', onAbort);
              try {
                controller.close();
              } catch {
                // Already closed
              }
            });
          },
          cancel() {
            response.destroy();
            outgoing.destroy();
          },
        });

        resolve({
          status,
          headers: response.headers,
          body: stream,
        });
      },
    );

    outgoing.on('socket', (socket) => {
      socket.setNoDelay(true);
    });

    const connectTimer = setTimeout(() => {
      if (!settled) {
        outgoing.destroy(
          new StorefrontError('timeout', `Storefront SSE connect timed out after ${connectTimeoutMs}ms`),
        );
      }
    }, connectTimeoutMs);

    outgoing.on('error', (error) => {
      clearTimeout(connectTimer);
      if (settled) return;
      settled = true;
      if (error instanceof StorefrontError) {
        reject(error);
        return;
      }
      reject(new StorefrontError('network', error.message || 'Storefront SSE connection failed'));
    });

    if (request.signal?.aborted) {
      clearTimeout(connectTimer);
      outgoing.destroy();
      reject(new StorefrontError('network', 'Client aborted SSE request'));
      return;
    }

    outgoing.end();
  });
}
