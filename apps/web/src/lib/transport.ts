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
