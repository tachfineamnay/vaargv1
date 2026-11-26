import { consentUpdateRequestSchema } from '@vaarg/shared';
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

/**
 * Consent state for the current actor. No query passthrough: visitors read
 * their own state (unlinked sessions get the undecided projection).
 */
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
    apiPath: '/v1/privacy/consents',
    host,
    cookie: readVisitorCookie(request),
    requestId,
  });
}

/**
 * Explicit consent update/withdrawal. The body is validated with the shared
 * contract minus `customerId`/`source`: identity and provenance are decided
 * server-side, never by the browser.
 */
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
  const parsed = consentUpdateRequestSchema.omit({ customerId: true, source: true }).safeParse(raw);
  if (!parsed.success) return bffJsonError(400, 'bad_request', 'Invalid consent request', requestId);
  return forwardToApi({
    method: 'POST',
    apiPath: '/v1/privacy/consents',
    host,
    body: parsed.data,
    cookie: readVisitorCookie(request),
    requestId,
  });
}
