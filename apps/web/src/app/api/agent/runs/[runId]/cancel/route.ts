import { uuidParamSchema } from '@vaarg/shared';
import {
  assertSameOrigin,
  bffHost,
  bffJsonError,
  forwardToApi,
  newBffRequestId,
  readVisitorCookie,
} from '../../../../../../lib/bff';
import { StorefrontError } from '../../../../../../lib/errors';

export const runtime = 'nodejs';

/** Cancel active Personal Shopper run (`POST /v1/agent/runs/:runId/cancel`). */
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
  return forwardToApi({
    method: 'POST',
    apiPath: `/v1/agent/runs/${encodeURIComponent(idParsed.data)}/cancel`,
    host,
    body: {},
    cookie: readVisitorCookie(request),
    requestId,
  });
}
