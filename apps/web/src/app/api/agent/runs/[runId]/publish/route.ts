import { publishRunCompositionInputSchema, uuidParamSchema } from '@vaarg/shared';
import {
  assertSameOrigin,
  bffHost,
  bffJsonError,
  forwardToApi,
  newBffRequestId,
  readIdempotencyKey,
  readJsonBody,
  readVisitorCookie,
} from '../../../../../../lib/bff';
import { StorefrontError } from '../../../../../../lib/errors';

export const runtime = 'nodejs';

/** Explicit CSRF-protected POST publication of validated run composition (`POST /v1/agent/runs/:runId/publish`). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
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
  const { runId } = await params;
  const idParsed = uuidParamSchema.safeParse(runId);
  if (!idParsed.success) {
    return bffJsonError(400, 'bad_request', 'Invalid runId', requestId);
  }

  let rawBody: unknown;
  try {
    rawBody = await readJsonBody(request);
  } catch {
    return bffJsonError(400, 'bad_request', 'Invalid JSON body', requestId);
  }
  const parsed = publishRunCompositionInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return bffJsonError(400, 'bad_request', 'Invalid publish payload', requestId);
  }

  return forwardToApi({
    method: 'POST',
    apiPath: `/v1/agent/runs/${encodeURIComponent(idParsed.data)}/publish`,
    host,
    body: parsed.data,
    cookie: readVisitorCookie(request),
    idempotencyKey: readIdempotencyKey(request),
    timeoutMs: 8000,
    requestId,
  });
}
