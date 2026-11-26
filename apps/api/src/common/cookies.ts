import type { FastifyReply } from 'fastify';

/**
 * Browser session cookies (FL02): secure, HttpOnly, host-only (no Domain
 * attribute), explicit SameSite and Max-Age. Tokens never appear in URLs,
 * logs or localStorage.
 */
export const MERCHANT_SESSION_COOKIE = 'vaarg_merchant_session';
export const VISITOR_SESSION_COOKIE = 'vaarg_visitor_session';

const COOKIE_PATH = '/';
const EPOCH = 'Thu, 01 Jan 1970 00:00:00 GMT';

/** Parse a single cookie value from the raw Cookie header (host-only token). */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

function buildCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  secure: boolean,
  expires?: string,
): string {
  const attributes = [
    `${name}=${value}`,
    `Path=${COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (expires) attributes.push(`Expires=${expires}`);
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

/** Set a host-only session cookie bound to the session lifetime. */
export function setSessionCookie(
  reply: FastifyReply,
  name: string,
  token: string,
  ttlMs: number,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  reply.header(
    'set-cookie',
    buildCookie(name, token, ttlMs / 1000, nodeEnv === 'production'),
  );
}

/** Clear a session cookie with matching attributes (host-only, HttpOnly). */
export function clearSessionCookie(
  reply: FastifyReply,
  name: string,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  reply.header('set-cookie', buildCookie(name, '', 0, nodeEnv === 'production', EPOCH));
}
