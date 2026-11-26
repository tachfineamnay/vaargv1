import type { FastifyRequest } from 'fastify';
import { AppError, REQUEST_ID_SCHEMA } from '@vaarg/shared';
import { MERCHANT_SESSION_COOKIE, VISITOR_SESSION_COOKIE, readCookie } from './cookies.js';

export const REQUEST_ID_HEADER = 'x-request-id';

export function extractRequestId(request: FastifyRequest): string {
  const header = request.headers[REQUEST_ID_HEADER];
  const raw = Array.isArray(header) ? header[0] : header;
  const result = REQUEST_ID_SCHEMA.safeParse(raw);
  if (!result.success) {
    throw AppError.badRequest(
      `${REQUEST_ID_HEADER} header must be a safe string of at least 8 characters`,
    );
  }
  return result.data;
}

/**
 * Correlation id for the tenant context: the validated x-request-id when
 * present, otherwise a freshly generated safe id (the request-id hook is
 * installed by main.ts; injected/test requests may bypass it).
 */
export function correlationIdOf(request: FastifyRequest): string {
  const header = request.headers[REQUEST_ID_HEADER];
  const raw = Array.isArray(header) ? header[0] : header;
  const parsed = REQUEST_ID_SCHEMA.safeParse(raw);
  if (parsed.success) return parsed.data;
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface RequestCredential {
  token: string;
  via: 'bearer' | 'cookie';
}

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9_-]{43})$/;

/** Extract a raw bearer token from an Authorization header. */
export function bearerToken(authorization: string | undefined): string | null {
  const match = typeof authorization === 'string' ? BEARER_PATTERN.exec(authorization) : null;
  return match ? match[1]! : null;
}

/**
 * Resolve the merchant credential: bearer token takes precedence (server
 * compatibility), then the HttpOnly merchant session cookie. Tokens are
 * never read from URLs or query strings.
 */
export function merchantCredential(request: FastifyRequest): RequestCredential | null {
  const token = bearerToken(request.headers.authorization);
  if (token) return { token, via: 'bearer' };
  const cookie = readCookie(request.headers.cookie, MERCHANT_SESSION_COOKIE);
  if (cookie && /^[A-Za-z0-9_-]{43}$/.test(cookie)) return { token: cookie, via: 'cookie' };
  return null;
}

/** Resolve the visitor session credential (bearer or HttpOnly cookie). */
export function visitorCredential(request: FastifyRequest): RequestCredential | null {
  const token = bearerToken(request.headers.authorization);
  if (token) return { token, via: 'bearer' };
  const cookie = readCookie(request.headers.cookie, VISITOR_SESSION_COOKIE);
  if (cookie && /^[A-Za-z0-9_-]{43}$/.test(cookie)) return { token: cookie, via: 'cookie' };
  return null;
}

/**
 * Catalog compatibility: when no Authorization header is present, fall back
 * to the merchant session cookie expressed as a bearer credential, so the
 * existing service contract (header string) is preserved unchanged.
 */
export function authorizationHeaderOf(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.length > 0) return authorization;
  const credential = merchantCredential(request);
  return credential && credential.via === 'cookie' ? `Bearer ${credential.token}` : undefined;
}
