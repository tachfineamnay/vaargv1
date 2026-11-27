import { a2uiRendererActionEnvelopeSchema } from '@vaarg/shared';
import {
  assertSameOrigin,
  bffHost,
  bffJsonError,
  forwardToApi,
  newBffRequestId,
  readIdempotencyKey,
  readJsonBody,
  readVisitorCookie,
} from '../../../../lib/bff';
import { StorefrontError } from '../../../../lib/errors';

export const runtime = 'nodejs';

/** Controlled A2UI 1.0 UI action forwarder (`POST /v1/agent/actions`). */
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

  let rawBody: unknown;
  try {
    rawBody = await readJsonBody(request);
  } catch {
    return bffJsonError(400, 'bad_request', 'Invalid JSON body', requestId);
  }
  const parsed = a2uiRendererActionEnvelopeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return bffJsonError(400, 'bad_request', 'Invalid A2UI action envelope', requestId);
  }

  return forwardToApi({
    method: 'POST',
    apiPath: '/v1/agent/actions',
    host,
    body: parsed.data,
    cookie: readVisitorCookie(request),
    idempotencyKey: readIdempotencyKey(request),
    timeoutMs: 8000,
    requestId,
  });
}
