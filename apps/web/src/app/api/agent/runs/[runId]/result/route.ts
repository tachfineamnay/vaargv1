import { uuidParamSchema } from '@vaarg/shared';
import {
  bffHost,
  bffJsonError,
  forwardToApi,
  newBffRequestId,
  readVisitorCookie,
} from '../../../../../../lib/bff';

export const runtime = 'nodejs';

/** Pure read-only validated run result (`GET /v1/agent/runs/:runId/result`). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const requestId = newBffRequestId();
  let host: string;
  try {
    host = bffHost(request);
  } catch {
    return bffJsonError(400, 'bad_request', 'Invalid storefront host', requestId);
  }
  const url = new URL(request.url);
  if (url.searchParams.has('publish')) {
    return bffJsonError(
      400,
      'bad_request',
      'MUTATING_GET_FORBIDDEN: Use POST /api/agent/runs/:runId/publish',
      requestId,
    );
  }
  const { runId } = await params;
  const idParsed = uuidParamSchema.safeParse(runId);
  if (!idParsed.success) {
    return bffJsonError(400, 'bad_request', 'Invalid runId', requestId);
  }
  return forwardToApi({
    method: 'GET',
    apiPath: `/v1/agent/runs/${encodeURIComponent(idParsed.data)}/result`,
    host,
    cookie: readVisitorCookie(request),
    requestId,
  });
}
