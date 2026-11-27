import { experienceRecommendationsQuerySchema } from '@vaarg/shared';
import {
  bffHost,
  bffJsonError,
  forwardToApi,
  newBffRequestId,
  readVisitorCookie,
} from '../../../../lib/bff';

export const runtime = 'nodejs';

/** Deterministic recommendations for the visitor session. */
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
  const limit = url.searchParams.get('limit');
  const seed = url.searchParams.get('seed');
  if (limit !== null) raw.limit = limit;
  if (seed !== null) raw.seed = seed;
  const parsed = experienceRecommendationsQuerySchema.safeParse(raw);
  if (!parsed.success) return bffJsonError(400, 'bad_request', 'Invalid recommendations query', requestId);
  const params = new URLSearchParams({ limit: String(parsed.data.limit) });
  if (parsed.data.seed) params.set('seed', parsed.data.seed);
  return forwardToApi({
    method: 'GET',
    apiPath: `/v1/experience/recommendations?${params.toString()}`,
    host,
    cookie: readVisitorCookie(request),
    requestId,
  });
}
