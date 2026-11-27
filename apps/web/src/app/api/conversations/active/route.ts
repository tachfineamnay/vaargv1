import {
  bffHost,
  bffJsonError,
  forwardToApi,
  newBffRequestId,
  readVisitorCookie,
} from '../../../../lib/bff';

export const runtime = 'nodejs';

/** Read-only active conversation lookup (`GET /v1/conversations/active`). */
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
    apiPath: '/v1/conversations/active',
    host,
    cookie: readVisitorCookie(request),
    requestId,
  });
}
