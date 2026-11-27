import { submitMessageInputSchema, uuidParamSchema } from '@vaarg/shared';
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

/** Submit visitor message (`POST /v1/conversations/:conversationId/messages`). */
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
  const parsed = submitMessageInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return bffJsonError(400, 'bad_request', 'Invalid message payload', requestId);
  }

  return forwardToApi({
    method: 'POST',
    apiPath: `/v1/conversations/${encodeURIComponent(idParsed.data)}/messages`,
    host,
    body: parsed.data,
    cookie: readVisitorCookie(request),
    idempotencyKey: readIdempotencyKey(request),
    timeoutMs: 8000,
    requestId,
  });
}
