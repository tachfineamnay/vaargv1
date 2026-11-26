import { z } from 'zod';

const image = z.object({ id: z.string().nullable(), url: z.url(), altText: z.string().nullable() });
const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const money = z.object({ amount: z.string().regex(/^\d+(\.\d+)?$/), currencyCode: z.string().regex(/^[A-Z]{3}$/) });
const variant = z.object({
  id: z.string().startsWith('gid://shopify/ProductVariant/'),
  title: z.string(),
  availableForSale: z.boolean(),
  price: money,
  selectedOptions: z.array(z.object({ name: z.string(), value: z.string() })),
  // FL03 additive verified Storefront fields (2026-10). Optional so the
  // legacy contract stays backwards compatible with older snapshots.
  sku: z.string().max(255).nullable().optional(),
  position: z.number().int().min(0).optional(),
  compareAtPrice: money.nullable().optional(),
  image: image.nullable().optional(),
  quantityAvailable: z.number().int().min(0).nullable().optional(),
  currentlyNotInStock: z.boolean().optional(),
});
const metafield = z.object({ namespace:z.string(), key:z.string(), type:z.string(), value:z.string() }).nullable();
export const catalogProductSchema = z.object({
  metafields:z.array(metafield).optional(),
  id: z.string().startsWith('gid://shopify/Product/'),
  handle: z.string().min(1),
  title: z.string(),
  description: z.string(),
  productType: z.string(),
  vendor: z.string(),
  tags: z.array(z.string()),
  options: z.array(z.object({ id: z.string(), name: z.string(), optionValues: z.array(z.object({ id: z.string(), name: z.string() })) })).optional(),
  updatedAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().optional(),
  availableForSale: z.boolean(),
  variants: z.object({ nodes: z.array(variant), pageInfo }),
  images: z.object({ nodes: z.array(image), pageInfo }),
  media: z.object({ nodes: z.array(z.object({ id: z.string(), mediaContentType: z.enum(['IMAGE','VIDEO','EXTERNAL_VIDEO','MODEL_3D']) }).passthrough()), pageInfo }),
});
export const catalogCollectionSchema = z.object({ metafields:z.array(metafield).optional(), id: z.string().startsWith('gid://shopify/Collection/'), handle: z.string().min(1), title: z.string(), description: z.string(), updatedAt: z.iso.datetime(), image: image.nullable(), products: z.object({ nodes: z.array(z.object({ id: z.string().startsWith('gid://shopify/Product/') })), pageInfo }) });
export const catalogItemSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('product'), data: catalogProductSchema }), z.object({ kind: z.literal('collection'), data: catalogCollectionSchema })]);
export const catalogResponseSchema = z.object({ status: z.enum(['NOT_CONFIGURED','NOT_SYNCED','IN_PROGRESS','STALE','FRESH']), completedAt: z.iso.datetime().nullable(), items: z.array(catalogItemSchema), nextCursor: z.string().nullable() });
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;
export const catalogSyncResponseSchema = z.object({ status: z.enum(['NOT_SYNCED','IN_PROGRESS','STALE','FRESH','STARTED_OR_RESUMED','products','collections','complete']), completedAt: z.iso.datetime().nullable() });
export const catalogHttpQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(300).optional(),
  q: z.string().min(1).max(200).optional(),
  available: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  collectionId: z.string().startsWith('gid://shopify/Collection/').max(300).optional(),
});
export const catalogJobSchema = z.strictObject({
  ticket: z.string().min(1).max(4096),
});
export const merchantLoginRequestSchema = z.strictObject({ email: z.email().max(320), password: z.string().min(8).max(200) });
export const merchantLoginResponseSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const catalogDelegationRequestSchema = z.strictObject({ action: z.enum(['start','step']) });
export const catalogDelegationResponseSchema = z.strictObject({ jobId: z.uuid(), ticket: z.string().min(1).max(4096), expiresAt: z.iso.datetime() });

// ---------------------------------------------------------------------------
// FL03 — versioned /v1/catalog contracts (curated DTOs; never raw database
// entities, provider configuration, secrets or unrestricted metafields).
// ---------------------------------------------------------------------------

const decimal = z.string().regex(/^\d+(\.\d+)?$/);
const v1Price = z.strictObject({ amount: decimal, currencyCode: z.string().regex(/^[A-Z]{3}$/) });
export type CatalogV1Price = z.infer<typeof v1Price>;
const v1Image = z.strictObject({ url: z.url(), altText: z.string().nullable() });
const freshnessSchema = z.enum(['NOT_SYNCED','IN_PROGRESS','STALE','FRESH']);
/** List-level states include provider configuration absence. */
const availabilitySchema = z.enum(['NOT_CONFIGURED','NOT_SYNCED','IN_PROGRESS','STALE','FRESH']);
const provenanceSchema = z.strictObject({
  source: z.literal('shopify'),
  shopifyId: z.string().min(1).max(300),
  generation: z.uuid(),
  observedAt: z.iso.datetime(),
});
export type CatalogProvenance = z.infer<typeof provenanceSchema>;
export const catalogV1SortSchema = z.enum(['title-asc','title-desc','price-asc','price-desc','updated-desc','updated-asc']);
export type CatalogV1Sort = z.infer<typeof catalogV1SortSchema>;

/** A single available=value filter entry (option name or configured attribute name). */
const attributeFilterSchema = z.strictObject({ name: z.string().min(1).max(255), value: z.string().min(1).max(255) });
export type CatalogAttributeFilter = z.infer<typeof attributeFilterSchema>;

const httpDecimal = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/);
/** Query-string shape; values arrive as strings from the HTTP layer. */
export const catalogV1ProductsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(24),
  cursor: z.string().min(1).max(500).optional(),
  sort: catalogV1SortSchema.default('title-asc'),
  q: z.string().min(1).max(200).optional(),
  collection: z.string().min(1).max(300).optional(),
  productType: z.string().min(1).max(200).optional(),
  vendor: z.string().min(1).max(200).optional(),
  available: z.enum(['true','false']).transform(value => value === 'true').optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  priceMin: httpDecimal.optional(),
  priceMax: httpDecimal.optional(),
  // FL04: HTTP callers send `attribute=Size:M`; split on the first colon into
  // `{name, value}`. Values without a colon (or with an empty name/value) fall
  // through to the object schema and fail validation with400. Objects produced
  // internally (unit callers) pass through unchanged.
  attribute: z.preprocess((raw) => {
    if (typeof raw !== 'string') return raw;
    const index = raw.indexOf(':');
    if (index <= 0) return raw;
    return { name: raw.slice(0, index), value: raw.slice(index + 1) };
  }, attributeFilterSchema.optional()),
});
export type CatalogV1ProductsQuery = z.input<typeof catalogV1ProductsQuerySchema>;

export const catalogV1CollectionsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(24),
  cursor: z.string().min(1).max(500).optional(),
  q: z.string().min(1).max(200).optional(),
});
export type CatalogV1CollectionsQuery = z.input<typeof catalogV1CollectionsQuerySchema>;

export const catalogV1SearchQuerySchema = z.strictObject({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  cursor: z.string().min(1).max(500).optional(),
});
export type CatalogV1SearchQuery = z.input<typeof catalogV1SearchQuerySchema>;

export const catalogV1RelatedQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(12).default(6),
});
export const catalogV1CompareQuerySchema = z.strictObject({
  ids: z.string().min(1).max(400),
});

/** Curated product summary (list/search/related payloads). */
export const catalogV1ProductSummarySchema = z.strictObject({
  id: z.string().startsWith('gid://shopify/Product/'),
  handle: z.string().min(1),
  title: z.string(),
  productType: z.string(),
  vendor: z.string(),
  tags: z.array(z.string()),
  availableForSale: z.boolean(),
  priceMin: v1Price.nullable(),
  priceMax: v1Price.nullable(),
  image: v1Image.nullable(),
  updatedAt: z.iso.datetime(),
  provenance: provenanceSchema,
});
export type CatalogV1ProductSummary = z.infer<typeof catalogV1ProductSummarySchema>;

export const catalogV1VariantSchema = z.strictObject({
  id: z.string().startsWith('gid://shopify/ProductVariant/'),
  title: z.string(),
  sku: z.string().nullable(),
  selectedOptions: z.array(z.strictObject({ name: z.string(), value: z.string() })),
  availableForSale: z.boolean(),
  quantityAvailable: z.number().int().min(0).nullable(),
  currentlyNotInStock: z.boolean(),
  price: v1Price,
  compareAtPrice: v1Price.nullable(),
  image: v1Image.nullable(),
  position: z.number().int().min(0),
});
export type CatalogV1Variant = z.infer<typeof catalogV1VariantSchema>;

const attributeSchema = z.strictObject({
  source: z.enum(['option','metafield']),
  name: z.string().min(1).max(255),
  value: z.string().max(2000),
  valueType: z.string().max(120).nullable(),
});
export type CatalogV1Attribute = z.infer<typeof attributeSchema>;

/** Product detail (by handle or stable reference). Curated + bounded. */
export const catalogV1ProductDetailSchema = z.strictObject({
  summary: catalogV1ProductSummarySchema,
  description: z.string(),
  options: z.array(z.strictObject({ name: z.string(), values: z.array(z.string()) })),
  variants: z.array(catalogV1VariantSchema),
  images: z.array(v1Image),
  mediaCount: z.strictObject({ image: z.number().int().min(0), video: z.number().int().min(0), externalVideo: z.number().int().min(0), model3d: z.number().int().min(0) }),
  attributes: z.array(attributeSchema),
  publishedAt: z.iso.datetime().nullable(),
});
export type CatalogV1ProductDetail = z.infer<typeof catalogV1ProductDetailSchema>;

export const catalogV1VariantDetailSchema = z.strictObject({
  variant: catalogV1VariantSchema,
  product: z.strictObject({ id: z.string().startsWith('gid://shopify/Product/'), handle: z.string(), title: z.string() }),
});
export type CatalogV1VariantDetail = z.infer<typeof catalogV1VariantDetailSchema>;

export const catalogV1CollectionSchema = z.strictObject({
  id: z.string().startsWith('gid://shopify/Collection/'),
  handle: z.string().min(1),
  title: z.string(),
  description: z.string(),
  image: v1Image.nullable(),
  updatedAt: z.iso.datetime(),
  productCount: z.number().int().min(0),
  provenance: provenanceSchema,
});
export type CatalogV1Collection = z.infer<typeof catalogV1CollectionSchema>;

/**
 * FL04: detail endpoints return the curated DTO spread with market freshness
 * (`{...dto, status, completedAt, generation}`) — these response schemas give
 * typed, strict validation of that exact wire shape for API clients.
 */
const detailFreshnessShape = {
  status: freshnessSchema,
  completedAt: z.iso.datetime().nullable(),
  generation: z.uuid().nullable(),
};
export const catalogV1ProductDetailResponseSchema = catalogV1ProductDetailSchema.extend(detailFreshnessShape);
export type CatalogV1ProductDetailResponse = z.infer<typeof catalogV1ProductDetailResponseSchema>;
export const catalogV1VariantDetailResponseSchema = catalogV1VariantDetailSchema.extend(detailFreshnessShape);
export type CatalogV1VariantDetailResponse = z.infer<typeof catalogV1VariantDetailResponseSchema>;
export const catalogV1CollectionResponseSchema = catalogV1CollectionSchema.extend(detailFreshnessShape);
export type CatalogV1CollectionResponse = z.infer<typeof catalogV1CollectionResponseSchema>;

/** Deterministic comparison: rows are the union of compared attribute names. */
export const catalogV1ComparisonSchema = z.strictObject({
  status: freshnessSchema,
  completedAt: z.iso.datetime().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  products: z.array(z.strictObject({ ref: z.string().min(1).max(300), summary: catalogV1ProductSummarySchema.nullable() })),
  rows: z.array(z.strictObject({ label: z.string().min(1).max(300), values: z.array(z.string().nullable()) })),
});
export type CatalogV1Comparison = z.infer<typeof catalogV1ComparisonSchema>;

export const catalogV1RelatedSchema = z.strictObject({
  status: freshnessSchema,
  completedAt: z.iso.datetime().nullable(),
  items: z.array(z.strictObject({ summary: catalogV1ProductSummarySchema, relation: z.enum(['collection','product_type']), provenance: z.string().min(1).max(300) })),
});
export type CatalogV1Related = z.infer<typeof catalogV1RelatedSchema>;

export const catalogV1ListSchema = z.strictObject({
  status: availabilitySchema,
  completedAt: z.iso.datetime().nullable(),
  sort: catalogV1SortSchema,
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  items: z.array(catalogV1ProductSummarySchema),
  nextCursor: z.string().max(500).nullable(),
});
export type CatalogV1List = z.infer<typeof catalogV1ListSchema>;

export const catalogV1CollectionsResponseSchema = z.strictObject({
  status: availabilitySchema,
  completedAt: z.iso.datetime().nullable(),
  items: z.array(catalogV1CollectionSchema),
  nextCursor: z.string().max(500).nullable(),
});
export type CatalogV1CollectionsResponse = z.infer<typeof catalogV1CollectionsResponseSchema>;

export const catalogV1SearchResponseSchema = z.strictObject({
  status: availabilitySchema,
  completedAt: z.iso.datetime().nullable(),
  query: z.string().min(1).max(200),
  items: z.array(catalogV1ProductSummarySchema),
  nextCursor: z.string().max(500).nullable(),
});
export type CatalogV1SearchResponse = z.infer<typeof catalogV1SearchResponseSchema>;

export const catalogV1FiltersSchema = z.strictObject({
  status: freshnessSchema,
  completedAt: z.iso.datetime().nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  priceRange: z.strictObject({ min: decimal.nullable(), max: decimal.nullable() }),
  productTypes: z.array(z.strictObject({ value: z.string(), count: z.number().int().min(0) })),
  vendors: z.array(z.strictObject({ value: z.string(), count: z.number().int().min(0) })),
  options: z.array(z.strictObject({ name: z.string(), values: z.array(z.strictObject({ value: z.string(), count: z.number().int().min(0) })) })),
  attributes: z.array(z.strictObject({ name: z.string(), values: z.array(z.strictObject({ value: z.string(), count: z.number().int().min(0) })) })),
});
export type CatalogV1Filters = z.infer<typeof catalogV1FiltersSchema>;

export const catalogV1StatusSchema = z.strictObject({
  status: z.enum(['NOT_CONFIGURED','NOT_SYNCED','IN_PROGRESS','STALE','FRESH']),
  completedAt: z.iso.datetime().nullable(),
  generation: z.uuid().nullable(),
});
export type CatalogV1Status = z.infer<typeof catalogV1StatusSchema>;

/**
 * Agent-readable knowledge result for configured personalization options.
 * Compatibility is NEVER inferred from names or descriptions: absent an
 * explicit configured declaration it stays UNKNOWN.
 */
export const catalogV1CompatibleOptionsSchema = z.strictObject({
  status: freshnessSchema,
  completedAt: z.iso.datetime().nullable(),
  product: z.strictObject({ id: z.string().startsWith('gid://shopify/Product/'), handle: z.string(), title: z.string() }),
  options: z.array(z.strictObject({ name: z.string(), values: z.array(z.string()) })),
  personalization: z.array(z.strictObject({ namespace: z.string(), key: z.string(), type: z.string(), value: z.string(), source: provenanceSchema })),
  compatibility: z.literal('UNKNOWN'),
});
export type CatalogV1CompatibleOptions = z.infer<typeof catalogV1CompatibleOptionsSchema>;

/** Stable product reference: Shopify gid or a validated handle. */
export const catalogV1ProductRefSchema = z.string().min(1).max(300);
export function isCatalogProductGid(ref: string): boolean {
  return /^gid:\/\/shopify\/Product\/\d{1,25}$/.test(ref);
}
export function isCatalogVariantGid(ref: string): boolean {
  return /^gid:\/\/shopify\/ProductVariant\/\d{1,25}$/.test(ref);
}
export function isCatalogCollectionGid(ref: string): boolean {
  return /^gid:\/\/shopify\/Collection\/\d{1,25}$/.test(ref);
}
