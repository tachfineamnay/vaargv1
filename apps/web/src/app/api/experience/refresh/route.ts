import { experienceRefreshRequestSchema } from '@vaarg/shared';
import {
  assertSameOrigin,
  bffHost,
  bffJsonError,
  forwardToApi,
  newBffRequestId,
  readJsonBody,
  readVisitorCookie,
} from '../../../../lib/bff';

export const runtime = 'nodejs';

/** Adaptation refresh (revision-safe, stale versions rejected upstream). */
export async function POST(request: Request): Promise<Response> {
  const requestId = newBffRequestId();
  let host: string;
  try {
    host = bffHost(request);
  } catch {
    return bffJsonError(400, 'bad_request', 'Invalid storefront host', requestId);
  }
  try {
    assertSameOrigin(request);
  } catch (error) {
    return bffJsonError(403, 'forbidden', error instanceof Error ? error.message : 'Forbidden', requestId);
  }
  let raw: unknown;
  try {
    raw = await readJsonBody(request);
  } catch (error) {
    return bffJsonError(400, 'bad_request', error instanceof Error ? error.message : 'Invalid body', requestId);
  }
  const parsed = experienceRefreshRequestSchema.safeParse(raw ?? {});
  if (!parsed.success) return bffJsonError(400, 'bad_request', 'Invalid refresh request', requestId);
  return forwardToApi({
    method: 'POST',
    apiPath: '/v1/experience/refresh',
    host,
    body: parsed.data,
    cookie: readVisitorCookie(request),
    requestId,
  });
}
