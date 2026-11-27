import {
  bffHost,
  bffJsonError,
  forwardToApi,
  newBffRequestId,
  readVisitorCookie,
} from '../../../../lib/bff';

export const runtime = 'nodejs';

/** Current unified experience context for the visitor session cookie. */
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
    apiPath: '/v1/experience/context',
    host,
    cookie: readVisitorCookie(request),
    requestId,
  });
}
