import { ForbiddenException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/**
 * CSRF protection for cookie-authenticated mutations (PRD §10).
 *
 * Session cookies are SameSite=Lax; on top of that, any mutation that was
 * authenticated with a cookie must carry an Origin header matching the
 * validated storefront host. Bearer-authenticated (server-side) clients do
 * not send cookies and are unaffected. Never relies on client-supplied
 * store ids — the host is validated by the tenant resolver first.
 */
export function assertSafeCookieMutation(
  request: FastifyRequest,
  validatedHost: string,
): void {
  const origin = request.headers.origin;
  if (origin === undefined || origin.length === 0) {
    throw new ForbiddenException('Origin required for cookie-authenticated mutations');
  }
  const allowed = [`https://${validatedHost}`];
  if (process.env.NODE_ENV !== 'production') {
    // Local development may serve plain HTTP; production requires HTTPS.
    allowed.push(`http://${validatedHost}`);
  }
  if (!allowed.includes(origin)) {
    throw new ForbiddenException('Cross-origin request rejected');
  }
}
