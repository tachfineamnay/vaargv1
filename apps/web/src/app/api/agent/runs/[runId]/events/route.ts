import { parseAgUiStreamCursor, uuidParamSchema } from '@vaarg/shared';
import {
  bffHost,
  bffJsonError,
  forwardSseToApi,
  newBffRequestId,
  readLastEventId,
  readVisitorCookie,
} from '../../../../../../lib/bff';

export const runtime = 'nodejs';

/** Unbuffered AG-UI 1.0.5 SSE stream (`GET /v1/agent/runs/:runId/events`). */
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

  const url = new URL(request.url);
  const afterSeqRaw = url.searchParams.get('afterSeq');
  const afterSeq = afterSeqRaw ? parseAgUiStreamCursor(afterSeqRaw, idParsed.data) : 0;
  const apiPath =
    afterSeq > 0
      ? `/v1/agent/runs/${encodeURIComponent(idParsed.data)}/events?afterSeq=${afterSeq}`
      : `/v1/agent/runs/${encodeURIComponent(idParsed.data)}/events`;

  return forwardSseToApi({
    apiPath,
    host,
    cookie: readVisitorCookie(request),
    lastEventId: readLastEventId(request),
    signal: request.signal,
    requestId,
  });
}
