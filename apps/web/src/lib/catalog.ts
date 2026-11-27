import {
  catalogV1CollectionsResponseSchema,
  catalogV1CollectionResponseSchema,
  catalogV1ComparisonSchema,
  catalogV1CompatibleOptionsSchema,
  catalogV1FiltersSchema,
  catalogV1ListSchema,
  catalogV1ProductDetailResponseSchema,
  catalogV1RelatedSchema,
  catalogV1SearchResponseSchema,
  catalogV1StatusSchema,
  catalogV1VariantDetailResponseSchema,
  type CatalogV1CollectionsResponse,
  type CatalogV1CollectionResponse,
  type CatalogV1Comparison,
  type CatalogV1CompatibleOptions,
  type CatalogV1Filters,
  type CatalogV1List,
  type CatalogV1ProductDetailResponse,
  type CatalogV1Related,
  type CatalogV1SearchResponse,
  storefrontSearchResponseSchema,
  type StorefrontSearchResponse,
  type CatalogV1Status,
  type CatalogV1VariantDetailResponse,
} from '@vaarg/shared';
import { probeApiStatus, type ApiStatus } from './api-client';
import { StorefrontError, storefrontErrorFromResponse } from './errors';
import { forwardRequest } from './transport';

/**
 * Typed storefront catalog client (FL04): the FL03 v1 read endpoints plus the
 * connectivity probe — 13 methods total. Every response passes a shared Zod
 * boundary schema; every failure maps into the StorefrontError taxonomy.
 */
export type QueryValue = string | number | boolean | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface CatalogClient {
  experienceSearch(query: QueryParams): Promise<StorefrontSearchResponse>;
  listProducts(query?: QueryParams): Promise<CatalogV1List>;
  getProduct(ref: string): Promise<CatalogV1ProductDetailResponse>;
  getRelatedProducts(ref: string, query?: QueryParams): Promise<CatalogV1Related>;
  getCompatibleOptions(ref: string): Promise<CatalogV1CompatibleOptions>;
  getVariant(ref: string): Promise<CatalogV1VariantDetailResponse>;
  listCollections(query?: QueryParams): Promise<CatalogV1CollectionsResponse>;
  getCollection(ref: string): Promise<CatalogV1CollectionResponse>;
  listCollectionProducts(ref: string, query?: QueryParams): Promise<CatalogV1List>;
  getFilters(query?: QueryParams): Promise<CatalogV1Filters>;
  compareProducts(ids: string[]): Promise<CatalogV1Comparison>;
  searchProducts(query: QueryParams): Promise<CatalogV1SearchResponse>;
  getCatalogStatus(): Promise<CatalogV1Status>;
  probeStatus(): Promise<ApiStatus>;
}

export function buildQueryString(query?: QueryParams): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

function encodeRef(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.length > 300) throw new StorefrontError('bad_request', 'Invalid catalog reference');
  return encodeURIComponent(trimmed);
}

async function getJson<T>(host: string, path: string, parse: (raw: unknown) => T, timeoutMs?: number): Promise<T> {
  const response = await forwardRequest({
    method: 'GET',
    path,
    host,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  if (response.status < 200 || response.status >= 300) {
    throw storefrontErrorFromResponse(response.status, response.body);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(response.body);
  } catch {
    throw new StorefrontError('invalid_response', 'Storefront API returned a malformed body', { status: response.status });
  }
  try {
    return parse(raw);
  } catch {
    throw new StorefrontError('invalid_response', 'Storefront API response failed contract validation', { status: response.status });
  }
}

export function createCatalogClient(host: string, options: { timeoutMs?: number } = {}): CatalogClient {
  const timeoutMs = options.timeoutMs;
  const get = <T>(path: string, parse: (raw: unknown) => T): Promise<T> => getJson(host, path, parse, timeoutMs);

  return {
    experienceSearch: query => get(`/v1/experience/catalog-search${buildQueryString(query)}`, raw => storefrontSearchResponseSchema.parse(raw)),
    listProducts: (query) => get(`/v1/catalog/products${buildQueryString(query)}`, (raw) => catalogV1ListSchema.parse(raw)),
    getProduct: (ref) => get(`/v1/catalog/products/${encodeRef(ref)}`, (raw) => catalogV1ProductDetailResponseSchema.parse(raw)),
    getRelatedProducts: (ref, query) =>
      get(`/v1/catalog/products/${encodeRef(ref)}/related${buildQueryString(query)}`, (raw) => catalogV1RelatedSchema.parse(raw)),
    getCompatibleOptions: (ref) =>
      get(`/v1/catalog/products/${encodeRef(ref)}/compatible-options`, (raw) => catalogV1CompatibleOptionsSchema.parse(raw)),
    getVariant: (ref) => get(`/v1/catalog/variants/${encodeRef(ref)}`, (raw) => catalogV1VariantDetailResponseSchema.parse(raw)),
    listCollections: (query) => get(`/v1/catalog/collections${buildQueryString(query)}`, (raw) => catalogV1CollectionsResponseSchema.parse(raw)),
    getCollection: (ref) => get(`/v1/catalog/collections/${encodeRef(ref)}`, (raw) => catalogV1CollectionResponseSchema.parse(raw)),
    listCollectionProducts: (ref, query) =>
      get(`/v1/catalog/collections/${encodeRef(ref)}/products${buildQueryString(query)}`, (raw) => catalogV1ListSchema.parse(raw)),
    getFilters: (query) => get(`/v1/catalog/filters${buildQueryString(query)}`, (raw) => catalogV1FiltersSchema.parse(raw)),
    compareProducts: (ids) => {
      const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
      if (unique.length < 2) throw new StorefrontError('bad_request', 'At least two products are required');
      const query = new URLSearchParams({ ids: unique.slice(0, 4).join(',') });
      return get(`/v1/catalog/compare?${query.toString()}`, (raw) => catalogV1ComparisonSchema.parse(raw));
    },
    searchProducts: (query) => get(`/v1/catalog/search${buildQueryString(query)}`, (raw) => catalogV1SearchResponseSchema.parse(raw)),
    getCatalogStatus: () => get('/v1/catalog/status', (raw) => catalogV1StatusSchema.parse(raw)),
    probeStatus: () => probeApiStatus(),
  };
}
