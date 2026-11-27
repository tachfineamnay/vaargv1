import {
  assertSameOrigin,
  bffHost,
  bffJsonError,
  forwardToApi,
  newBffRequestId,
  readVisitorCookie,
} from '../../../../lib/bff';

export const runtime = 'nodejs';

/** Rotate the visitor session token (CSRF-protected cookie mutation). */
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
  return forwardToApi({
    method: 'POST',
    apiPath: '/v1/sessions/rotate',
    host,
    cookie: readVisitorCookie(request),
    requestId,
  });
}
