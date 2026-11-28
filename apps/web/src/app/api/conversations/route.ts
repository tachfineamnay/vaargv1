import {
  assertSameOrigin,
  bffHost,
  bffJsonError,
  forwardToApi,
  newBffRequestId,
  readJsonBody,
  readVisitorCookie,
} from '../../../lib/bff';
import { StorefrontError } from '../../../lib/errors';

export const runtime = 'nodejs';

/** Create or reuse active visitor conversation (`POST /v1/conversations`). */
export async function POST(request: Request): Promise<Response> {
  const requestId = newBffRequestId();
  let host: string;
  try {
    host = bffHost(request);
    assertSameOrigin(request);
  } catch (err) {
    const status = err instanceof StorefrontError && err.kind === 'forbidden' ? 403 : 400;
    return bffJsonError(
      status,
      status === 403 ? 'forbidden' : 'bad_request',
      err instanceof Error ? err.message : 'Invalid request',
      requestId,
    );
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch {
    return bffJsonError(400, 'bad_request', 'Invalid JSON body', requestId);
  }
  const reuseActive =
    body !== null &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    (body as Record<string, unknown>).reuseActive === true;

  return forwardToApi({
    method: 'POST',
    apiPath: '/v1/conversations',
    host,
    body: { reuseActive },
    cookie: readVisitorCookie(request),
    requestId,
  });
}
