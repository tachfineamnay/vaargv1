import { uuidParamSchema } from '@vaarg/shared';
import {
  bffHost,
  bffJsonError,
  forwardToApi,
  newBffRequestId,
  readVisitorCookie,
} from '../../../../lib/bff';

export const runtime = 'nodejs';

/** Read-only bounded conversation history (`GET /v1/conversations/:conversationId`). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const requestId = newBffRequestId();
  let host: string;
  try {
    host = bffHost(request);
  } catch {
    return bffJsonError(400, 'bad_request', 'Invalid storefront host', requestId);
  }
  const { conversationId } = await params;
  const idParsed = uuidParamSchema.safeParse(conversationId);
  if (!idParsed.success) {
    return bffJsonError(400, 'bad_request', 'Invalid conversationId', requestId);
  }
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit ? Math.min(50, Math.max(1, Number.parseInt(rawLimit, 10) || 24)) : 24;

  return forwardToApi({
    method: 'GET',
    apiPath: `/v1/conversations/${encodeURIComponent(idParsed.data)}?limit=${limit}`,
    host,
    cookie: readVisitorCookie(request),
    requestId,
  });
}
