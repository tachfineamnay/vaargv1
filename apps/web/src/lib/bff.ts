import { StorefrontError, type StorefrontErrorKind } from './errors';
import { parseStorefrontHost, storefrontOrigin } from './host';
import { forwardRequest } from './transport';

/**
 * Constrained same-origin BFF (FL04): fixed paths only, strict body
 * validation, same-origin enforcement on mutations, session-cookie-only
 * forwarding, constructed `Origin` for the API's CSRF boundary, and a 4s
 * upstream timeout. Never proxies arbitrary paths or query strings.
 */
export const VISITOR_SESSION_COOKIE = 'vaarg_visitor_session';
const MAX_BODY_BYTES = 4096;

export function newBffRequestId(): string {
  return `bff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function bffJsonError(status: number, kind: StorefrontErrorKind, message: string, requestId: string): Response {
  return Response.json(
    { error: { kind, message, requestId } },
    { status, headers: { 'cache-control': 'private, no-store' } },
  );
}

/**
 * Extract only the visitor session cookie (as a `name=value` pair) — never
 * forward unrelated cookies from the browser's header.
 */
export function readVisitorCookie(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== VISITOR_SESSION_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? `${VISITOR_SESSION_COOKIE}=${value}` : null;
  }
  return null;
}

/**
 * Browser mutations must carry an `Origin` matching the request host —
 * cross-site requests (which always send Origin on POST/DELETE) are rejected
 * before anything reaches the API.
 */
export function assertSameOrigin(request: Request): void {
  const host = request.headers.get('host')?.toLowerCase().trim();
  if (!host) throw new StorefrontError('forbidden', 'Missing host header');
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') throw new StorefrontError('forbidden', 'Same-origin Origin header required');
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new StorefrontError('forbidden', 'Invalid Origin header');
  }
  if (parsed.host.toLowerCase() !== host) throw new StorefrontError('forbidden', 'Cross-origin request rejected');
}

/** Read and validate a small JSON body ({} when empty). */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return {};
  if (text.length > MAX_BODY_BYTES) throw new StorefrontError('bad_request', 'Request body too large');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new StorefrontError('bad_request', 'Invalid JSON body');
  }
}

export interface BffForwardOptions {
  method: 'GET' | 'POST' | 'DELETE';
  /** Fixed upstream path on the API (no client-controlled paths). */
  apiPath: string;
  host: string;
  body?: unknown;
  cookie: string | null;
  requestId: string;
}

/** Forward to the API with Host + constructed Origin; relay set-cookie back. */
export async function forwardToApi(options: BffForwardOptions): Promise<Response> {
  try {
    const response = await forwardRequest({
      method: options.method,
      path: options.apiPath,
      host: options.host,
      ...(options.body === undefined ? {} : { body: options.body }),
      cookie: options.cookie,
      origin: storefrontOrigin(options.host),
      requestId: options.requestId,
    });
    const headers = new Headers({ 'cache-control': 'private, no-store' });
    const setCookies = response.headers['set-cookie'];
    if (Array.isArray(setCookies)) {
      for (const value of setCookies) headers.append('set-cookie', value);
    } else if (typeof setCookies === 'string') {
      headers.append('set-cookie', setCookies);
    }
    const contentType = response.headers['content-type'];
    if (typeof contentType === 'string') headers.set('content-type', contentType);
    return new Response(response.body.length > 0 ? response.body : null, { status: response.status, headers });
  } catch (error) {
    if (error instanceof StorefrontError && error.kind === 'timeout') {
      return bffJsonError(503, 'unavailable', 'Storefront API timeout', options.requestId);
    }
    if (error instanceof StorefrontError && error.kind === 'internal') {
      return bffJsonError(503, 'unavailable', error.message, options.requestId);
    }
    return bffJsonError(503, 'unavailable', 'Storefront API unreachable', options.requestId);
  }
}

/** Shared host-resolution step for every BFF route. */
export function bffHost(request: Request): string {
  return parseStorefrontHost(request.headers.get('host'), request.headers.get('x-forwarded-host'));
}
