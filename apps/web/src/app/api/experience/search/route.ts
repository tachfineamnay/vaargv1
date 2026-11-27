import { experienceSearchQuerySchema } from '@vaarg/shared';
import {
  bffHost,
  bffJsonError,
  forwardToApi,
  newBffRequestId,
  readVisitorCookie,
} from '../../../../lib/bff';

export const runtime = 'nodejs';

/**
 * Contextual search BFF. Unlike mutations, the query string is REQUIRED
 * here — it is strictly validated against the shared contract first and
 * only whitelisted parameters are forwarded (never an arbitrary passthrough).
 */
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
  for (const key of ['q', 'mode', 'limit', 'available', 'currency', 'priceMin', 'priceMax', 'collection', 'productType', 'vendor', 'attribute']) {
    const value = url.searchParams.get(key);
    if (value !== null) raw[key] = value;
  }
  const parsed = experienceSearchQuerySchema.safeParse(raw);
  if (!parsed.success) return bffJsonError(400, 'bad_request', 'Invalid search query', requestId);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return forwardToApi({
    method: 'GET',
    apiPath: `/v1/experience/search${query ? `?${query}` : ''}`,
    host,
    cookie: readVisitorCookie(request),
    requestId,
  });
}
