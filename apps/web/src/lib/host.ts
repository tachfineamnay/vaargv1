import { StorefrontError } from './errors';

/**
 * Storefront host resolution (FL04). The request `host` header is the tenant
 * authority — exactly what the API resolves against its binding table.
 * `x-forwarded-host` is consulted ONLY when `host` is loopback (preview
 * proxies that rewrite Host to localhost); direct clients cannot use it to
 * spoof a non-loopback host, and the API re-validates every host against its
 * bindings regardless.
 */
const HOST_PATTERN = /^[a-z0-9.-]+(?::[0-9]{1,5})?$/i;
const LOOPBACK_PATTERN = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i;

/** Pure host resolution from raw header values (unit-testable). */
export function parseStorefrontHost(
  host: string | null | undefined,
  forwardedHost?: string | null | undefined,
): string {
  let candidate = (host ?? '').trim();
  const forwarded = (forwardedHost ?? '').split(',')[0]?.trim() ?? '';
  if ((!candidate || LOOPBACK_PATTERN.test(candidate)) && forwarded && HOST_PATTERN.test(forwarded)) {
    candidate = forwarded;
  }
  if (!candidate || !HOST_PATTERN.test(candidate)) {
    throw new StorefrontError('invalid_host', 'Invalid storefront host');
  }
  return candidate.toLowerCase();
}

/**
 * Canonical storefront origin used as the CSRF Origin the BFF asserts to the
 * API. Always `https://<hostname>` (port stripped, lowercased): the API allows
 * that origin in both development and production (it always permits
 * `https://<binding-host>`).
 */
export function storefrontOrigin(host: string): string {
  const hostname = host.replace(/:\d+$/, '').toLowerCase();
  return `https://${hostname}`;
}
