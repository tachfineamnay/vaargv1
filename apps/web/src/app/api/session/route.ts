import { createSessionRequestSchema } from '@vaarg/shared';
import {
  assertSameOrigin,
  bffHost,
  bffJsonError,
  forwardToApi,
  newBffRequestId,
  readJsonBody,
  readVisitorCookie,
} from '../../../lib/bff';

export const runtime = 'nodejs';

/** Bootstrap a visitor session (idempotent create; relays Set-Cookie). */
export async function POST(request: Request): Promise<Response> {
  const requestId = newBffRequestId();
  let host: string;
  try {
    host = bffHost(request);
  } catch {
    return bffJsonError(400, 'bad_request', 'Invalid storefront host', requestId);
  }
  try {
    assertSameOrigin(request);
  } catch (error) {
    return bffJsonError(403, 'forbidden', error instanceof Error ? error.message : 'Forbidden', requestId);
  }
  let raw: unknown;
  try {
    raw = await readJsonBody(request);
  } catch (error) {
    return bffJsonError(400, 'bad_request', error instanceof Error ? error.message : 'Invalid body', requestId);
  }
  const parsed = createSessionRequestSchema.safeParse(raw);
  if (!parsed.success) return bffJsonError(400, 'bad_request', 'Invalid session request', requestId);
  return forwardToApi({
    method: 'POST',
    apiPath: '/v1/sessions',
    host,
    body: parsed.data,
    cookie: readVisitorCookie(request),
    requestId,
  });
}

/** Current session for the supplied cookie (401 when absent/expired). */
export async function GET(request: Request): Promise<Response> {
  const requestId = newBffRequestId();
  let host: string;
  try {
    host = bffHost(request);
  } catch {
    return bffJsonError(400, 'bad_request', 'Invalid storefront host', requestId);
  }
  return forwardToApi({
    method: 'GET',
    apiPath: '/v1/sessions/current',
    host,
    cookie: readVisitorCookie(request),
    requestId,
  });
}

/** Revoke the current session and clear the cookie. */
export async function DELETE(request: Request): Promise<Response> {
  const requestId = newBffRequestId();
  let host: string;
  try {
    host = bffHost(request);
  } catch {
    return bffJsonError(400, 'bad_request', 'Invalid storefront host', requestId);
  }
  try {
    assertSameOrigin(request);
  } catch (error) {
    return bffJsonError(403, 'forbidden', error instanceof Error ? error.message : 'Forbidden', requestId);
  }
  return forwardToApi({
    method: 'DELETE',
    apiPath: '/v1/sessions/current',
    host,
    cookie: readVisitorCookie(request),
    requestId,
  });
}
