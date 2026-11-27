import { startConversationRunInputSchema, uuidParamSchema } from '@vaarg/shared';
import {
  assertSameOrigin,
  bffHost,
  bffJsonError,
  forwardToApi,
  newBffRequestId,
  readIdempotencyKey,
  readJsonBody,
  readVisitorCookie,
} from '../../../../../lib/bff';
import { StorefrontError } from '../../../../../lib/errors';

export const runtime = 'nodejs';

/** Start Personal Shopper run (`POST /v1/conversations/:conversationId/runs`). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
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
  const { conversationId } = await params;
  const idParsed = uuidParamSchema.safeParse(conversationId);
  if (!idParsed.success) {
    return bffJsonError(400, 'bad_request', 'Invalid conversationId', requestId);
  }

  let rawBody: unknown;
  try {
    rawBody = await readJsonBody(request);
  } catch {
    return bffJsonError(400, 'bad_request', 'Invalid JSON body', requestId);
  }
  const parsed = startConversationRunInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return bffJsonError(400, 'bad_request', 'Invalid run start payload', requestId);
  }

  return forwardToApi({
    method: 'POST',
    apiPath: `/v1/conversations/${encodeURIComponent(idParsed.data)}/runs`,
    host,
    body: parsed.data,
    cookie: readVisitorCookie(request),
    idempotencyKey: readIdempotencyKey(request),
    timeoutMs: 10000,
    requestId,
  });
}
