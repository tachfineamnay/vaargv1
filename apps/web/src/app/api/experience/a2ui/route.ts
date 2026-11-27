import { experienceCompositionQuerySchema } from '@vaarg/shared';
import {
  bffHost,
  bffJsonError,
  forwardToApi,
  newBffRequestId,
  readVisitorCookie,
} from '../../../../lib/bff';

export const runtime = 'nodejs';

/** Validated adaptive A2UI 1.0 surface bundle (`GET /v1/experience/a2ui`). */
export async function GET(request: Request): Promise<Response> {
  const requestId = newBffRequestId();
  let host: string;
  try {
    host = bffHost(request);
  } catch {
    return bffJsonError(400, 'bad_request', 'Invalid storefront host', requestId);
  }
  const url = new URL(request.url);
  const raw: Record<string, unknown> = {};
  const compare = url.searchParams.get('compare');
  if (compare !== null) raw.compare = compare;
  const parsed = experienceCompositionQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return bffJsonError(400, 'bad_request', 'Invalid composition query', requestId);
  }
  const apiPath = parsed.data.compare
    ? `/v1/experience/a2ui?compare=${encodeURIComponent(parsed.data.compare)}`
    : '/v1/experience/a2ui';
  return forwardToApi({
    method: 'GET',
    apiPath,
    host,
    cookie: readVisitorCookie(request),
    requestId,
  });
}
