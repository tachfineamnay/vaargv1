import {
  catalogV1CollectionsQuerySchema,
  catalogV1ProductsQuerySchema,
  catalogV1SearchQuerySchema,
} from '@vaarg/shared';

/**
 * URL-authoritative list state (FL04). Raw searchParams are flattened,
 * validated against the shared query contract (invalid keys are dropped one
 * by one so a single bad parameter never breaks the page), and normalized
 * into wire params for the API plus form values for the UI. Cursor pagination
 * carries a comma-joined cursor trail (`c=`) so Next/Previous links are
 * deterministic and shareable.
 */
export type ListKind = 'products' | 'collections' | 'search';

export interface ListUiValues {
  sort: string;
  q: string;
  available: string;
  priceMin: string;
  priceMax: string;
  productType: string;
  vendor: string;
  attribute: string;
  collection: string;
  limit: string;
}

export interface ListParams {
  /** Validated wire query parameters (always passes the shared schema). */
  api: Record<string, string>;
  /** Normalized values for rendering filter forms. */
  ui: ListUiValues;
  /** Cursor of the current page ('' = first page). */
  cursor: string;
  /** Cursors of preceding pages, oldest first. */
  trail: string[];
}

const MAX_TRAIL = 50;
const MAX_CURSOR_LENGTH = 500;

type RawSearchParams = Record<string, string | string[] | undefined>;

function flatten(raw: RawSearchParams): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (first === undefined || first === '') continue;
    flat[key] = first;
  }
  return flat;
}

function schemaFor(kind: ListKind) {
  if (kind === 'products') return catalogV1ProductsQuerySchema;
  if (kind === 'collections') return catalogV1CollectionsQuerySchema;
  return catalogV1SearchQuerySchema;
}

export function parseListParams(raw: RawSearchParams, kind: ListKind): ListParams {
  const candidate = flatten(raw);
  const trail = (candidate.c ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.length <= MAX_CURSOR_LENGTH)
    .slice(0, MAX_TRAIL);
  delete candidate.c;
  // Market currency is owned by the binding — never taken from the URL.
  delete candidate.currency;

  const schema = schemaFor(kind);
  let validated = false;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const result = schema.safeParse(candidate);
    if (result.success) {
      validated = true;
      break;
    }
    let dropped = false;
    for (const issue of result.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        // Strict objects report unknown keys with an empty path — drop each
        // named key (utm_*, fbclid, etc.) instead of failing the whole query.
        for (const unknownKey of issue.keys) {
          if (Object.hasOwn(candidate, unknownKey)) {
            delete candidate[unknownKey];
            dropped = true;
          }
        }
        continue;
      }
      const key = issue.path.length > 0 ? String(issue.path[0]) : '';
      if (key && Object.hasOwn(candidate, key)) {
        delete candidate[key];
        dropped = true;
      }
    }
    if (!dropped) break;
  }

  const api: Record<string, string> = validated ? { ...candidate } : {};
  const cursor = validated && typeof candidate.cursor === 'string' ? candidate.cursor : '';
  const ui: ListUiValues = {
    sort: typeof candidate.sort === 'string' ? candidate.sort : 'title-asc',
    q: candidate.q ?? '',
    available: candidate.available ?? '',
    priceMin: candidate.priceMin ?? '',
    priceMax: candidate.priceMax ?? '',
    productType: candidate.productType ?? '',
    vendor: candidate.vendor ?? '',
    attribute: candidate.attribute ?? '',
    collection: candidate.collection ?? '',
    limit: candidate.limit ?? '',
  };
  return { api, ui, cursor, trail };
}

function toSearch(api: Record<string, string>, trail: string[]): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(api).sort()) {
    const value = api[key];
    if (value === undefined || value === '') continue;
    params.set(key, value);
  }
  if (trail.length > 0) params.set('c', trail.join(','));
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

/** Query string for the current page (retry links, canonical state). */
export function currentListSearch(params: ListParams): string {
  return toSearch(params.api, params.trail);
}

/** Query string for the next page: push the current cursor onto the trail. */
export function nextPageListSearch(params: ListParams, nextCursor: string): string {
  const api = { ...params.api, cursor: nextCursor };
  const trail = [...params.trail, params.cursor].filter((entry) => entry !== '').slice(-MAX_TRAIL);
  return toSearch(api, trail);
}

/** Query string for the previous page: pop the trail (empty trail = first page). */
export function previousPageListSearch(params: ListParams): string {
  const api = { ...params.api };
  const trail = [...params.trail];
  const previous = trail.pop();
  if (previous) api.cursor = previous;
  else delete api.cursor;
  return toSearch(api, trail);
}

/** Whether a previous page exists for this state. */
export function hasPreviousPage(params: ListParams): boolean {
  return params.cursor !== '' || params.trail.length > 0;
}
