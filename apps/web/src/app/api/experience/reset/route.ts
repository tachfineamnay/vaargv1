import {
  assertSameOrigin,
  bffHost,
  bffJsonError,
  forwardToApi,
  newBffRequestId,
  readJsonBody,
  readVisitorCookie,
} from '../../../../lib/bff';

export const runtime = 'nodejs';

/**
 * Exploration reset — return to general exploration. The body must be an
 * empty object (no payload passthrough); CSRF Same-Origin enforced.
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
  try {
    const body = await readJsonBody(request);
    if (body !== null && typeof body === 'object' && Object.keys(body as object).length > 0) {
      return bffJsonError(400, 'bad_request', 'Reset takes no payload', requestId);
    }
  } catch (error) {
    return bffJsonError(400, 'bad_request', error instanceof Error ? error.message : 'Invalid body', requestId);
  }
  return forwardToApi({
    method: 'POST',
    apiPath: '/v1/experience/reset',
    host,
    body: {},
    cookie: readVisitorCookie(request),
    requestId,
  });
}
