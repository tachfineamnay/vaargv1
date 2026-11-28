import { uuidParamSchema } from '@vaarg/shared';
import {
  bffHost,
  bffJsonError,
  forwardToApi,
  newBffRequestId,
  readVisitorCookie,
} from '../../../../../lib/bff';

export const runtime = 'nodejs';

/** Pure read-only run status (`GET /v1/agent/runs/:runId`). */
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
  const { runId } = await params;
  const idParsed = uuidParamSchema.safeParse(runId);
  if (!idParsed.success) {
    return bffJsonError(400, 'bad_request', 'Invalid runId', requestId);
  }
  return forwardToApi({
    method: 'GET',
    apiPath: `/v1/agent/runs/${encodeURIComponent(idParsed.data)}`,
    host,
    cookie: readVisitorCookie(request),
    requestId,
  });
}
