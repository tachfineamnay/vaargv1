import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  catalogV1CollectionSchema,
  catalogV1CollectionsResponseSchema,
  catalogV1CompatibleOptionsSchema,
  catalogV1ComparisonSchema,
  catalogV1FiltersSchema,
  catalogV1ListSchema,
  catalogV1ProductDetailSchema,
  catalogV1ProductSummarySchema,
  catalogV1RelatedSchema,
  catalogV1SearchResponseSchema,
  catalogV1StatusSchema,
  catalogV1VariantDetailSchema,
  isCatalogCollectionGid,
  isCatalogProductGid,
  type CatalogAttributeFilter,
  type CatalogV1Collection,
  type CatalogV1CollectionsResponse,
  type CatalogV1Comparison,
  type CatalogV1CompatibleOptions,
  type CatalogV1Filters,
  type CatalogV1List,
  type CatalogV1Price,
  type CatalogV1ProductDetail,
  type CatalogV1ProductSummary,
  type CatalogV1Related,
  type CatalogV1SearchResponse,
  type CatalogV1Sort,
  type CatalogV1Status,
  type CatalogV1Variant,
  type CatalogV1VariantDetail,
} from '@vaarg/shared';
import { normalizeText, type MarketScope } from './catalog-projection.js';
import { scopedCatalogTransaction } from './scope.js';

/**
 * FL03 catalog read model over the normalized projection. Store-scoped by
 * construction (RLS + explicit market columns); returns curated shared DTOs
 * only — never raw database rows, provider configuration, secrets or
 * unconfigured metafields. Every result carries freshness for the market
 * snapshot and per-item provenance for the provider evidence. Deterministic
 * ordering and bounded cursor pagination throughout.
 */

export const catalogReadScopeSchema = z.strictObject({
  storeId: z.uuid(),
  country: z.string().regex(/^[A-Z]{2}$/),
  language: z.string().regex(/^[A-Z]{2,3}$/),
});
export type CatalogReadScope = z.infer<typeof catalogReadScopeSchema>;

export type CatalogFreshnessState = 'NOT_SYNCED' | 'IN_PROGRESS' | 'STALE' | 'FRESH';
export interface CatalogFreshness { status: CatalogFreshnessState; completedAt: string | null; generation: string | null }

interface FreshnessRow { phase: string; completed_at: Date | null; generation: string }

async function freshness(client: PoolClient, scope: CatalogReadScope, maxAgeMs: number): Promise<CatalogFreshness> {
  const row = (await client.query<FreshnessRow>(
    'SELECT phase, completed_at, generation FROM catalog_imports WHERE store_id=$1 AND country=$2 AND language=$3',
    [scope.storeId, scope.country, scope.language],
  )).rows[0];
  if (!row) return { status: 'NOT_SYNCED', completedAt: null, generation: null };
  const status = row.phase !== 'complete' ? 'IN_PROGRESS' as const : !row.completed_at || Date.now() - row.completed_at.getTime() > maxAgeMs ? 'STALE' as const : 'FRESH' as const;
  return { status, completedAt: row.completed_at?.toISOString() ?? null, generation: row.generation };
}

/** Exact decimal formatting: trim to the smallest exact representation, min 2dp. */
function formatAmount(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error('INVALID_AMOUNT');
  const trimmed = numeric.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  const [whole = '0', decimals = ''] = trimmed.split('.');
  return `${whole}.${(decimals + '00').slice(0, Math.max(2, decimals.length))}`;
}

/** Bounded, deterministic cursor: base64url JSON, schema-validated on decode. */
const cursorSchema = z.tuple([z.string().max(400), z.string().max(300), z.number().min(0).max(1e15).nullable()]);
export function encodeCursor(key: string, gid: string, score: number | null = null): string {
  return Buffer.from(JSON.stringify([key, gid, score]), 'utf8').toString('base64url');
}
export function decodeCursor(cursor: string): { key: string; gid: string; score: number | null } {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    if (!parsed.success) throw new Error('INVALID_CURSOR');
    return { key: parsed.data[0], gid: parsed.data[1], score: parsed.data[2] };
  } catch {
    throw new Error('INVALID_CURSOR');
  }
}

export interface CatalogProductListQuery {
  limit: number;
  cursor?: string;
  sort?: CatalogV1Sort;
  q?: string;
  collection?: string;
  productType?: string;
  vendor?: string;
  available?: boolean;
  currency?: string;
  priceMin?: string;
  priceMax?: string;
  attribute?: CatalogAttributeFilter;
}

interface ProductRow {
  product_gid: string;
  handle: string;
  title: string;
  product_type: string;
  vendor: string;
  tags: string[];
  available_for_sale: boolean;
  provider_updated_at: Date;
  generation: string;
  observed_at: Date;
  price_min: string | null;
  price_max: string | null;
  currency: string | null;
  image_url: string | null;
  image_alt: string | null;
}

function price(amount: string | null, currency: string | null): CatalogV1Price | null {
  return amount && currency ? { amount: formatAmount(amount), currencyCode: currency } : null;
}

function summaryOf(row: ProductRow): CatalogV1ProductSummary {
  return catalogV1ProductSummarySchema.parse({
    id: row.product_gid,
    handle: row.handle,
    title: row.title,
    productType: row.product_type,
    vendor: row.vendor,
    tags: row.tags,
    availableForSale: row.available_for_sale,
    priceMin: price(row.price_min, row.currency),
    priceMax: price(row.price_max, row.currency),
    image: row.image_url ? { url: row.image_url, altText: row.image_alt } : null,
    updatedAt: row.provider_updated_at.toISOString(),
    provenance: { source: 'shopify', shopifyId: row.product_gid, generation: row.generation, observedAt: row.observed_at.toISOString() },
  });
}

const SUMMARY_SELECT = `p.product_gid,p.handle,p.title,p.product_type,p.vendor,p.tags,p.available_for_sale,p.provider_updated_at,p.generation,p.observed_at,
  vp.price_min,vp.price_max,vp.currency,mi.url AS image_url,mi.alt AS image_alt`;

const SUMMARY_JOINS = `LEFT JOIN LATERAL (SELECT min(v.price_amount) AS price_min, max(v.price_amount) AS price_max, (array_agg(DISTINCT v.currency))[1] AS currency
    FROM catalog_variants v WHERE v.store_id=p.store_id AND v.country=p.country AND v.language=p.language AND v.product_gid=p.product_gid AND v.visible=true) vp ON true
  LEFT JOIN LATERAL (SELECT m.url, m.alt FROM catalog_product_media m WHERE m.store_id=p.store_id AND m.country=p.country AND m.language=p.language AND m.product_gid=p.product_gid AND m.media_type='IMAGE' ORDER BY m.ordinal, m.media_id LIMIT 1) mi ON true`;

const listQuerySchema = z.object({
  limit: z.number().int().min(1).max(50),
  cursor: z.string().min(1).max(500).optional(),
  sort: z.enum(['title-asc','title-desc','price-asc','price-desc','updated-desc','updated-asc']).default('title-asc'),
  q: z.string().min(1).max(200).optional(),
  collection: z.string().min(1).max(300).optional(),
  productType: z.string().max(200).optional(),
  vendor: z.string().max(200).optional(),
  available: z.boolean().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  priceMin: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/).optional(),
  priceMax: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/).optional(),
  attribute: z.strictObject({ name: z.string().min(1).max(255), value: z.string().min(1).max(255) }).optional(),
});

function filterSql(query: z.infer<typeof listQuerySchema>, next: unknown[]): string {
  const conditions: string[] = [];
  if (query.q) {
    next.push(`%${query.q.replace(/[\\%_]/g, '\\$&')}%`);
    const like = `$${next.length}`;
    next.push(normalizeText(query.q));
    const trgm = `$${next.length}`;
    conditions.push(`EXISTS (SELECT 1 FROM catalog_search_documents sd WHERE sd.store_id=p.store_id AND sd.country=p.country AND sd.language=p.language AND sd.product_gid=p.product_gid AND sd.visible=true AND (sd.title_normalized % ${trgm} OR sd.body_normalized % ${trgm} OR sd.title_normalized ILIKE ${like} OR sd.body_normalized ILIKE ${like}))`);
  }
  if (query.collection) {
    next.push(query.collection);
    const ref = `$${next.length}`;
    conditions.push(`EXISTS (SELECT 1 FROM catalog_collection_members cm JOIN catalog_collections c ON c.store_id=cm.store_id AND c.country=cm.country AND c.language=cm.language AND c.collection_gid=cm.collection_gid AND c.visible=true WHERE cm.store_id=p.store_id AND cm.country=p.country AND cm.language=p.language AND cm.product_gid=p.product_gid AND (c.handle=${ref} OR c.collection_gid=${ref}))`);
  }
  if (query.productType !== undefined) { next.push(query.productType); conditions.push(`p.product_type = $${next.length}`); }
  if (query.vendor !== undefined) { next.push(query.vendor); conditions.push(`p.vendor = $${next.length}`); }
  if (query.available !== undefined) { next.push(query.available); conditions.push(`p.available_for_sale = $${next.length}`); }
  if (query.priceMin !== undefined || query.priceMax !== undefined) {
    next.push(query.currency ?? '');
    const currency = `$${next.length}`;
    next.push(query.priceMin ?? '0');
    const min = `$${next.length}`;
    next.push(query.priceMax ?? '999999999999999');
    const max = `$${next.length}`;
    conditions.push(`EXISTS (SELECT 1 FROM catalog_variants pv WHERE pv.store_id=p.store_id AND pv.country=p.country AND pv.language=p.language AND pv.product_gid=p.product_gid AND pv.visible=true AND pv.currency=${currency} AND pv.price_amount BETWEEN ${min}::numeric AND ${max}::numeric)`);
  }
  if (query.attribute) {
    next.push(query.attribute.name);
    const name = `$${next.length}`;
    next.push(query.attribute.value);
    const value = `$${next.length}`;
    conditions.push(`EXISTS (SELECT 1 FROM catalog_product_attributes a WHERE a.store_id=p.store_id AND a.country=p.country AND a.language=p.language AND a.product_gid=p.product_gid AND a.name=${name} AND a.value=${value})`);
  }
  return conditions.length ? ` AND ${conditions.join(' AND ')}` : '';
}

interface SortSpec { order: string; cursorKey: (row: ProductRow) => string; comparison: string; requirePrice?: boolean }

const SORTS: Record<CatalogV1Sort, SortSpec> = {
  'title-asc': { order: 'ORDER BY p.title, p.product_gid', cursorKey: (row) => row.title, comparison: '(p.title, p.product_gid) > (:KEY, :GID)' },
  'title-desc': { order: 'ORDER BY p.title DESC, p.product_gid DESC', cursorKey: (row) => row.title, comparison: '(p.title, p.product_gid) < (:KEY, :GID)' },
  'price-asc': { order: 'ORDER BY vp.price_min, p.product_gid', cursorKey: (row) => row.price_min ?? '0', comparison: '(vp.price_min, p.product_gid) > (:KEY::numeric, :GID)', requirePrice: true },
  'price-desc': { order: 'ORDER BY vp.price_min DESC, p.product_gid DESC', cursorKey: (row) => row.price_min ?? '0', comparison: '(vp.price_min, p.product_gid) < (:KEY::numeric, :GID)', requirePrice: true },
  'updated-asc': { order: 'ORDER BY p.provider_updated_at, p.product_gid', cursorKey: (row) => row.provider_updated_at.toISOString(), comparison: '(p.provider_updated_at, p.product_gid) > (:KEY::timestamptz, :GID)' },
  'updated-desc': { order: 'ORDER BY p.provider_updated_at DESC, p.product_gid DESC', cursorKey: (row) => row.provider_updated_at.toISOString(), comparison: '(p.provider_updated_at, p.product_gid) < (:KEY::timestamptz, :GID)' },
};

/** Bounded cursor page of visible products, deterministic sort, curated DTOs. */
export async function listCatalogProductsV1(pool: Pool, rawScope: CatalogReadScope, query: CatalogProductListQuery, maxAgeMs = 3600000): Promise<CatalogV1List> {
  const scope = catalogReadScopeSchema.parse(rawScope);
  const parsed = listQuerySchema.parse(query);
  if ((parsed.priceMin !== undefined || parsed.priceMax !== undefined) && !parsed.currency) throw new Error('CURRENCY_REQUIRED');
  const sort = SORTS[parsed.sort];
  if (!sort) throw new Error('INVALID_SORT');
  const next: unknown[] = [scope.storeId, scope.country, scope.language];
  const where = filterSql(parsed, next);
  let cursorClause = '';
  if (parsed.cursor) {
    const cursor = decodeCursor(parsed.cursor);
    next.push(cursor.key);
    const key = `$${next.length}`;
    next.push(cursor.gid);
    const gid = `$${next.length}`;
    cursorClause = ` AND ${sort.comparison.replace(':KEY', key).replace(':GID', gid)}`;
  }
  next.push(parsed.limit + 1);
  const limit = `$${next.length}`;
  const priceFilter = sort.requirePrice ? ' AND vp.price_min IS NOT NULL' : '';
  return scopedCatalogTransaction(pool, scope, async (client) => {
    const fresh = await freshness(client, scope, maxAgeMs);
    const rows = (await client.query<ProductRow>(
      `SELECT ${SUMMARY_SELECT} FROM catalog_products p ${SUMMARY_JOINS}
       WHERE p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.visible=true${where}${priceFilter}${cursorClause}
       ${sort.order} LIMIT ${limit}`,
      next,
    )).rows;
    const hasMore = rows.length > parsed.limit;
    const page = rows.slice(0, parsed.limit);
    const last = page.at(-1);
    return catalogV1ListSchema.parse({
      status: fresh.status,
      completedAt: fresh.completedAt,
      sort: parsed.sort,
      currency: page[0]?.currency ?? parsed.currency ?? null,
      items: page.map(summaryOf),
      nextCursor: hasMore && last ? encodeCursor(sort.cursorKey(last), last.product_gid) : null,
    });
  });
}

export type CatalogProductRef = { handle: string } | { gid: string };

export function parseCatalogProductRef(ref: string): CatalogProductRef {
  if (isCatalogProductGid(ref)) return { gid: ref };
  if (/^[a-z0-9][a-z0-9-]{0,254}$/.test(ref)) return { handle: ref };
  throw new Error('INVALID_PRODUCT_REF');
}

export function parseCatalogCollectionRef(ref: string): CatalogProductRef {
  if (isCatalogCollectionGid(ref)) return { gid: ref.replace('gid://shopify/Collection/', 'gid://shopify/Collection/') };
  if (/^[a-z0-9][a-z0-9-]{0,254}$/.test(ref)) return { handle: ref };
  throw new Error('INVALID_COLLECTION_REF');
}

const variantRowSchema = z.object({
  variant_gid: z.string(),
  title: z.string(),
  sku: z.string().nullable(),
  selected_options: z.array(z.object({ name: z.string(), value: z.string() })),
  available_for_sale: z.boolean(),
  currently_not_in_stock: z.boolean(),
  quantity_available: z.number().int().min(0).nullable(),
  price_amount: z.string(),
  compare_at_amount: z.string().nullable(),
  currency: z.string(),
  image_url: z.string().nullable(),
  image_alt: z.string().nullable(),
  position: z.number().int().min(0),
});

type VariantRow = z.infer<typeof variantRowSchema>;

function variantDto(row: VariantRow): CatalogV1Variant {
  return {
    id: row.variant_gid,
    title: row.title,
    sku: row.sku,
    selectedOptions: row.selected_options,
    availableForSale: row.available_for_sale,
    quantityAvailable: row.quantity_available,
    currentlyNotInStock: row.currently_not_in_stock,
    price: { amount: formatAmount(row.price_amount), currencyCode: row.currency },
    compareAtPrice: row.compare_at_amount ? { amount: formatAmount(row.compare_at_amount), currencyCode: row.currency } : null,
    image: row.image_url ? { url: row.image_url, altText: row.image_alt } : null,
    position: row.position,
  };
}

async function loadDetail(client: PoolClient, scope: CatalogReadScope, ref: CatalogProductRef, maxAgeMs: number): Promise<{ fresh: CatalogFreshness; product: CatalogV1ProductDetail | null }> {
  const fresh = await freshness(client, scope, maxAgeMs);
  const predicate = 'handle' in ref ? 'p.handle=$4' : 'p.product_gid=$4';
  const refValue = 'handle' in ref ? ref.handle : ref.gid;
  const row = (await client.query<ProductRow & { description: string; options: unknown; published_at: Date | null }>(
    `SELECT ${SUMMARY_SELECT},p.description,p.options,p.published_at FROM catalog_products p ${SUMMARY_JOINS}
     WHERE p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.visible=true AND ${predicate} LIMIT 1`,
    [scope.storeId, scope.country, scope.language, refValue],
  )).rows[0];
  if (!row) return { fresh, product: null };
  const variants = variantRowSchema.array().parse((await client.query(
    `SELECT variant_gid,title,sku,selected_options,available_for_sale,currently_not_in_stock,quantity_available,price_amount::text AS price_amount,compare_at_amount::text AS compare_at_amount,currency,image_url,image_alt,position
     FROM catalog_variants WHERE store_id=$1 AND country=$2 AND language=$3 AND product_gid=$4 AND visible=true ORDER BY position,variant_gid`,
    [scope.storeId, scope.country, scope.language, row.product_gid],
  )).rows);
  const media = (await client.query<{ media_id: string; media_type: string; ordinal: number; url: string; alt: string | null }>(
    `SELECT media_id,media_type,ordinal,url,alt FROM catalog_product_media WHERE store_id=$1 AND country=$2 AND language=$3 AND product_gid=$4 ORDER BY ordinal,media_id`,
    [scope.storeId, scope.country, scope.language, row.product_gid],
  )).rows;
  const attributes = (await client.query<{ source: string; name: string; value: string; value_type: string | null }>(
    `SELECT source,name,value,value_type FROM catalog_product_attributes WHERE store_id=$1 AND country=$2 AND language=$3 AND product_gid=$4 ORDER BY source,name,value`,
    [scope.storeId, scope.country, scope.language, row.product_gid],
  )).rows;
  const options = z.array(z.object({ name: z.string(), values: z.array(z.string()) })).parse(row.options ?? []);
  const count = (type: string) => media.filter((entry) => entry.media_type === type).length;
  const product = catalogV1ProductDetailSchema.parse({
    summary: summaryOf(row),
    description: row.description,
    options,
    variants: variants.map(variantDto),
    images: media.filter((entry) => entry.media_type === 'IMAGE').map((entry) => ({ url: entry.url, altText: entry.alt })),
    mediaCount: { image: count('IMAGE'), video: count('VIDEO'), externalVideo: count('EXTERNAL_VIDEO'), model3d: count('MODEL_3D') },
    attributes: attributes.map((attribute) => ({ source: attribute.source === 'option' ? 'option' as const : 'metafield' as const, name: attribute.name, value: attribute.value, valueType: attribute.value_type })),
    publishedAt: row.published_at?.toISOString() ?? null,
  });
  return { fresh, product };
}

/** Product detail by handle or stable gid; null when not visible in this market. */
export async function getCatalogProductV1(pool: Pool, rawScope: CatalogReadScope, ref: string, maxAgeMs = 3600000): Promise<(CatalogV1ProductDetail & CatalogFreshness) | null> {
  const scope = catalogReadScopeSchema.parse(rawScope);
  const parsedRef = parseCatalogProductRef(ref);
  return scopedCatalogTransaction(pool, scope, async (client) => {
    const { fresh, product } = await loadDetail(client, scope, parsedRef, maxAgeMs);
    return product ? { ...product, ...fresh } : null;
  });
}

/** Variant detail with its parent product reference (stable ids only). */
export async function getCatalogVariantV1(pool: Pool, rawScope: CatalogReadScope, variantGid: string, maxAgeMs = 3600000): Promise<(CatalogV1VariantDetail & CatalogFreshness) | null> {
  const scope = catalogReadScopeSchema.parse(rawScope);
  if (!/^gid:\/\/shopify\/ProductVariant\/\d{1,25}$/.test(variantGid)) throw new Error('INVALID_VARIANT_REF');
  return scopedCatalogTransaction(pool, scope, async (client) => {
    const fresh = await freshness(client, scope, maxAgeMs);
    const row = variantRowSchema.extend({ product_gid: z.string(), handle: z.string(), product_title: z.string() }).parse(
      (await client.query(
        `SELECT v.variant_gid,v.product_gid,p.handle,p.title AS product_title,v.title,v.sku,v.selected_options,v.available_for_sale,v.currently_not_in_stock,v.quantity_available,v.price_amount::text AS price_amount,v.compare_at_amount::text AS compare_at_amount,v.currency,v.image_url,v.image_alt,v.position
         FROM catalog_variants v JOIN catalog_products p ON p.store_id=v.store_id AND p.country=v.country AND p.language=v.language AND p.product_gid=v.product_gid
         WHERE v.store_id=$1 AND v.country=$2 AND v.language=$3 AND v.variant_gid=$4 AND v.visible=true AND p.visible=true LIMIT 1`,
        [scope.storeId, scope.country, scope.language, variantGid],
      )).rows[0],
    );
    const dto = catalogV1VariantDetailSchema.parse({
      variant: variantDto(row),
      product: { id: row.product_gid, handle: row.handle, title: row.product_title },
    });
    return { ...dto, ...fresh };
  });
}

/** Collections page (bounded, deterministic, market-scoped). */
export async function listCatalogCollectionsV1(pool: Pool, rawScope: CatalogReadScope, query: { limit: number; cursor?: string; q?: string }, maxAgeMs = 3600000): Promise<CatalogV1CollectionsResponse> {
  const scope = catalogReadScopeSchema.parse(rawScope);
  const parsed = z.object({ limit: z.number().int().min(1).max(50), cursor: z.string().min(1).max(500).optional(), q: z.string().min(1).max(200).optional() }).parse(query);
  const next: unknown[] = [scope.storeId, scope.country, scope.language];
  let qClause = '';
  if (parsed.q) {
    next.push(`%${parsed.q.replace(/[\\%_]/g, '\\$&')}%`);
    qClause = ` AND (c.title ILIKE $${next.length} OR c.description ILIKE $${next.length})`;
  }
  let cursorClause = '';
  if (parsed.cursor) {
    const cursor = decodeCursor(parsed.cursor);
    next.push(cursor.key);
    const key = `$${next.length}`;
    next.push(cursor.gid);
    const gid = `$${next.length}`;
    cursorClause = ` AND (c.title, c.collection_gid) > (${key}, ${gid})`;
  }
  next.push(parsed.limit + 1);
  const limit = `$${next.length}`;
  return scopedCatalogTransaction(pool, scope, async (client) => {
    const fresh = await freshness(client, scope, maxAgeMs);
    const rows = (await client.query<{ collection_gid: string; handle: string; title: string; description: string; image_url: string | null; image_alt: string | null; provider_updated_at: Date; generation: string; observed_at: Date; product_count: string }>(
      `SELECT c.collection_gid,c.handle,c.title,c.description,c.image_url,c.image_alt,c.observed_at AS provider_updated_at,c.generation,c.observed_at,
        (SELECT count(*) FROM catalog_collection_members cm JOIN catalog_products p ON p.store_id=cm.store_id AND p.country=cm.country AND p.language=cm.language AND p.product_gid=cm.product_gid AND p.visible=true WHERE cm.store_id=c.store_id AND cm.country=c.country AND cm.language=c.language AND cm.collection_gid=c.collection_gid) AS product_count
       FROM catalog_collections c WHERE c.store_id=$1 AND c.country=$2 AND c.language=$3 AND c.visible=true${qClause}${cursorClause}
       ORDER BY c.title, c.collection_gid LIMIT ${limit}`,
      next,
    )).rows;
    const hasMore = rows.length > parsed.limit;
    const page = rows.slice(0, parsed.limit);
    const last = page.at(-1);
    const items: CatalogV1Collection[] = page.map((row) => catalogV1CollectionSchema.parse({
      id: row.collection_gid,
      handle: row.handle,
      title: row.title,
      description: row.description,
      image: row.image_url ? { url: row.image_url, altText: row.image_alt } : null,
      updatedAt: row.provider_updated_at.toISOString(),
      productCount: Number(row.product_count),
      provenance: { source: 'shopify', shopifyId: row.collection_gid, generation: row.generation, observedAt: row.observed_at.toISOString() },
    }));
    return catalogV1CollectionsResponseSchema.parse({
      status: fresh.status,
      completedAt: fresh.completedAt,
      items,
      nextCursor: hasMore && last ? encodeCursor(last.title, last.collection_gid) : null,
    });
  });
}

/** Collection detail by handle or stable gid; null when not visible. */
export async function getCatalogCollectionV1(pool: Pool, rawScope: CatalogReadScope, ref: string, maxAgeMs = 3600000): Promise<(CatalogV1Collection & CatalogFreshness) | null> {
  const scope = catalogReadScopeSchema.parse(rawScope);
  const parsedRef = parseCatalogCollectionRef(ref);
  const predicate = 'handle' in parsedRef ? 'c.handle=$4' : 'c.collection_gid=$4';
  const refValue = 'handle' in parsedRef ? parsedRef.handle : parsedRef.gid;
  return scopedCatalogTransaction(pool, scope, async (client) => {
    const fresh = await freshness(client, scope, maxAgeMs);
    const row = (await client.query<{ collection_gid: string; handle: string; title: string; description: string; image_url: string | null; image_alt: string | null; generation: string; observed_at: Date; product_count: string }>(
      `SELECT c.collection_gid,c.handle,c.title,c.description,c.image_url,c.image_alt,c.generation,c.observed_at,
        (SELECT count(*) FROM catalog_collection_members cm JOIN catalog_products p ON p.store_id=cm.store_id AND p.country=cm.country AND p.language=cm.language AND p.product_gid=cm.product_gid AND p.visible=true WHERE cm.store_id=c.store_id AND cm.country=c.country AND cm.language=c.language AND cm.collection_gid=c.collection_gid) AS product_count
       FROM catalog_collections c WHERE c.store_id=$1 AND c.country=$2 AND c.language=$3 AND c.visible=true AND ${predicate} LIMIT 1`,
      [scope.storeId, scope.country, scope.language, refValue],
    )).rows[0];
    if (!row) return null;
    const collection = catalogV1CollectionSchema.parse({
      id: row.collection_gid,
      handle: row.handle,
      title: row.title,
      description: row.description,
      image: row.image_url ? { url: row.image_url, altText: row.image_alt } : null,
      updatedAt: row.observed_at.toISOString(),
      productCount: Number(row.product_count),
      provenance: { source: 'shopify', shopifyId: row.collection_gid, generation: row.generation, observedAt: row.observed_at.toISOString() },
    });
    return { ...collection, ...fresh };
  });
}

/** Available filter facets (verified projection data only, bounded). */
export async function listCatalogFiltersV1(pool: Pool, rawScope: CatalogReadScope, query: { collection?: string } = {}, maxAgeMs = 3600000): Promise<CatalogV1Filters> {
  const scope = catalogReadScopeSchema.parse(rawScope);
  const parsed = z.object({ collection: z.string().max(300).optional() }).parse(query);
  const collectionClause = parsed.collection
    ? ` AND EXISTS (SELECT 1 FROM catalog_collection_members cm JOIN catalog_collections cc ON cc.store_id=cm.store_id AND cc.country=cm.country AND cc.language=cm.language AND cc.collection_gid=cm.collection_gid AND cc.visible=true WHERE cm.store_id=p.store_id AND cm.country=p.country AND cm.language=p.language AND cm.product_gid=p.product_gid AND (cc.handle=$4 OR cc.collection_gid=$4))`
    : '';
  const baseArgs = parsed.collection ? [scope.storeId, scope.country, scope.language, parsed.collection] : [scope.storeId, scope.country, scope.language];
  return scopedCatalogTransaction(pool, scope, async (client) => {
    const fresh = await freshness(client, scope, maxAgeMs);
    const productTypes = (await client.query<{ value: string; count: string }>(
      `SELECT p.product_type AS value, count(*) AS count FROM catalog_products p WHERE p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.visible=true AND p.product_type<>''${collectionClause}
       GROUP BY p.product_type ORDER BY p.product_type LIMIT 50`,
      baseArgs,
    )).rows;
    const vendors = (await client.query<{ value: string; count: string }>(
      `SELECT p.vendor AS value, count(*) AS count FROM catalog_products p WHERE p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.visible=true AND p.vendor<>''${collectionClause}
       GROUP BY p.vendor ORDER BY p.vendor LIMIT 50`,
      baseArgs,
    )).rows;
    const sourceParam = parsed.collection ? '$5' : '$4';
    const attributeFacet = async (source: 'option' | 'metafield') => (await client.query<{ name: string; value: string; count: string }>(
      `SELECT a.name, a.value, count(*) AS count FROM catalog_product_attributes a JOIN catalog_products p ON p.store_id=a.store_id AND p.country=a.country AND p.language=a.language AND p.product_gid=a.product_gid AND p.visible=true
       WHERE a.store_id=$1 AND a.country=$2 AND a.language=$3 AND a.source=${sourceParam}${collectionClause}
       GROUP BY a.name, a.value ORDER BY a.name, a.value LIMIT 500`,
      parsed.collection ? [...baseArgs, source] : [scope.storeId, scope.country, scope.language, source],
    )).rows;
    const [options, metafields] = await Promise.all([attributeFacet('option'), attributeFacet('metafield')]);
    const priceRange = (await client.query<{ min_amount: string | null; max_amount: string | null; currency: string | null }>(
      `SELECT min(v.price_amount)::text AS min_amount, max(v.price_amount)::text AS max_amount, (array_agg(DISTINCT v.currency))[1] AS currency
       FROM catalog_variants v JOIN catalog_products p ON p.store_id=v.store_id AND p.country=v.country AND p.language=v.language AND p.product_gid=v.product_gid AND p.visible=true
       WHERE v.store_id=$1 AND v.country=$2 AND v.language=$3 AND v.visible=true`,
      [scope.storeId, scope.country, scope.language],
    )).rows[0];
    const group = (rows: { name: string; value: string; count: string }[]) => {
      const map = new Map<string, { name: string; values: { value: string; count: number }[] }>();
      for (const row of rows) {
        const entry = map.get(row.name) ?? { name: row.name, values: [] };
        entry.values.push({ value: row.value, count: Number(row.count) });
        map.set(row.name, entry);
      }
      return [...map.values()];
    };
    return catalogV1FiltersSchema.parse({
      status: fresh.status,
      completedAt: fresh.completedAt,
      currency: priceRange?.currency ?? null,
      priceRange: { min: priceRange?.min_amount ? formatAmount(priceRange.min_amount) : null, max: priceRange?.max_amount ? formatAmount(priceRange.max_amount) : null },
      productTypes: productTypes.map((row) => ({ value: row.value, count: Number(row.count) })),
      vendors: vendors.map((row) => ({ value: row.value, count: Number(row.count) })),
      options: group(options),
      attributes: group(metafields),
    });
  });
}

/** Deterministic lexical search over normalized documents (pg_trgm). */
export async function searchCatalogV1(pool: Pool, rawScope: CatalogReadScope, query: { q: string; limit: number; cursor?: string }, maxAgeMs = 3600000): Promise<CatalogV1SearchResponse> {
  const scope = catalogReadScopeSchema.parse(rawScope);
  const parsed = z.object({ q: z.string().min(1).max(200), limit: z.number().int().min(1).max(50), cursor: z.string().min(1).max(500).optional() }).parse(query);
  const normalized = normalizeText(parsed.q);
  if (!normalized) throw new Error('INVALID_QUERY');
  const next: unknown[] = [scope.storeId, scope.country, scope.language, normalized];
  let cursorClause = '';
  if (parsed.cursor) {
    const cursor = decodeCursor(parsed.cursor);
    next.push(String(cursor.score ?? 0));
    const score = `$${next.length}`;
    next.push(cursor.key);
    const handle = `$${next.length}`;
    next.push(cursor.gid);
    const gid = `$${next.length}`;
    cursorClause = ` AND (scored.score, p.handle, p.product_gid) < (${score}::numeric, ${handle}, ${gid})`;
  }
  next.push(parsed.limit + 1);
  const limit = `$${next.length}`;
  return scopedCatalogTransaction(pool, scope, async (client) => {
    const fresh = await freshness(client, scope, maxAgeMs);
    const rows = (await client.query<ProductRow & { score: string }>(
      `WITH scored AS (
         SELECT sd.product_gid,
           round((3 * similarity(sd.title_normalized, $4) + similarity(sd.body_normalized, $4) + CASE WHEN $4 = ANY(sd.tags_normalized) THEN 1 ELSE 0 END)::numeric, 8) AS score
         FROM catalog_search_documents sd
         WHERE sd.store_id=$1 AND sd.country=$2 AND sd.language=$3 AND sd.visible=true
           AND (sd.title_normalized % $4 OR sd.body_normalized % $4 OR sd.title_normalized ILIKE '%'||$4||'%' OR sd.body_normalized ILIKE '%'||$4||'%')
       )
       SELECT ${SUMMARY_SELECT}, scored.score FROM scored
       JOIN catalog_products p ON p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.product_gid=scored.product_gid AND p.visible=true
       ${SUMMARY_JOINS}
       WHERE true${cursorClause} ORDER BY scored.score DESC, p.handle, p.product_gid LIMIT ${limit}`,
      next,
    )).rows;
    const hasMore = rows.length > parsed.limit;
    const page = rows.slice(0, parsed.limit);
    const last = page.at(-1);
    return catalogV1SearchResponseSchema.parse({
      status: fresh.status,
      completedAt: fresh.completedAt,
      query: parsed.q,
      items: page.map(summaryOf),
      nextCursor: hasMore && last ? encodeCursor(last.handle, last.product_gid, Number(last.score)) : null,
    });
  });
}

const COMPARE_CORE_LABELS = ['Availability', 'Price', 'Vendor', 'Product type'] as const;

/** Deterministic bounded comparison over verified attributes only. */
export async function compareCatalogProductsV1(pool: Pool, rawScope: CatalogReadScope, refs: string[], maxAgeMs = 3600000): Promise<CatalogV1Comparison> {
  const scope = catalogReadScopeSchema.parse(rawScope);
  const parsed = z.array(z.string().min(1).max(300)).min(2).max(4).parse(refs);
  const parsedRefs = parsed.map(parseCatalogProductRef);
  return scopedCatalogTransaction(pool, scope, async (client) => {
    const fresh = await freshness(client, scope, maxAgeMs);
    const details: (CatalogV1ProductDetail | null)[] = [];
    for (const ref of parsedRefs) {
      const { product } = await loadDetail(client, scope, ref, maxAgeMs);
      details.push(product);
    }
    const currency = details.map((detail) => detail?.summary.priceMin?.currencyCode).find((value) => value) ?? null;
    const rowMap = new Map<string, (string | null)[]>();
    rowMap.set('Availability', details.map((detail) => (detail ? (detail.summary.availableForSale ? 'Available' : 'Unavailable') : null)));
    rowMap.set('Price', details.map((detail) => (detail?.summary.priceMin ? `${detail.summary.priceMin.amount} ${detail.summary.priceMin.currencyCode}` : null)));
    rowMap.set('Vendor', details.map((detail) => detail?.summary.vendor || null));
    rowMap.set('Product type', details.map((detail) => detail?.summary.productType || null));
    const labels = new Set<string>();
    for (const detail of details) {
      if (!detail) continue;
      for (const option of detail.options) labels.add(option.name);
      for (const attribute of detail.attributes) labels.add(attribute.name);
    }
    for (const label of [...labels].sort((a, b) => a.localeCompare(b))) {
      rowMap.set(label, details.map((detail) => {
        if (!detail) return null;
        const option = detail.options.find((entry) => entry.name === label);
        if (option) return option.values.join(' / ') || null;
        const matches = detail.attributes.filter((attribute) => attribute.name === label);
        return matches.length ? [...new Set(matches.map((match) => match.value))].join(' / ') : null;
      }));
    }
    const ordered = [
      ...COMPARE_CORE_LABELS.filter((label) => rowMap.has(label)).map((label) => [label, rowMap.get(label)!] as const),
      ...[...rowMap.entries()].filter(([label]) => !(COMPARE_CORE_LABELS as readonly string[]).includes(label)).sort(([a], [b]) => a.localeCompare(b)),
    ];
    return catalogV1ComparisonSchema.parse({
      status: fresh.status,
      completedAt: fresh.completedAt,
      currency,
      products: parsed.map((ref, index) => ({ ref, summary: details[index]?.summary ?? null })),
      rows: ordered.map(([label, values]) => ({ label, values })),
    });
  });
}

/**
 * Related products with explicit provenance. Primary relation: shared
 * collection membership (provenance = collection gid). Fallback when the
 * product has no collection relations: same verified product type (provenance
 * = the type value). Nothing is inferred from names or descriptions.
 */
export async function relatedCatalogProductsV1(pool: Pool, rawScope: CatalogReadScope, ref: string, limit = 6, maxAgeMs = 3600000): Promise<CatalogV1Related> {
  const scope = catalogReadScopeSchema.parse(rawScope);
  const parsedRef = parseCatalogProductRef(ref);
  const parsedLimit = z.number().int().min(1).max(12).parse(limit);
  return scopedCatalogTransaction(pool, scope, async (client) => {
    const fresh = await freshness(client, scope, maxAgeMs);
    const refPredicate = 'handle' in parsedRef ? 'p0.handle=$4' : 'p0.product_gid=$4';
    const refValue = 'handle' in parsedRef ? parsedRef.handle : parsedRef.gid;
    const collectionRows = (await client.query<ProductRow & { via: string }>(
      `WITH related AS (
         SELECT m2.product_gid AS related_gid, min(m2.collection_gid) AS via, count(DISTINCT m2.collection_gid) AS shared
         FROM catalog_collection_members m1
         JOIN catalog_collection_members m2 ON m2.store_id=m1.store_id AND m2.country=m1.country AND m2.language=m1.language AND m2.collection_gid=m1.collection_gid AND m2.product_gid<>m1.product_gid
         JOIN catalog_collections c ON c.store_id=m2.store_id AND c.country=m2.country AND c.language=m2.language AND c.collection_gid=m2.collection_gid AND c.visible=true
         WHERE m1.store_id=$1 AND m1.country=$2 AND m1.language=$3 AND m1.product_gid=(SELECT p0.product_gid FROM catalog_products p0 WHERE p0.store_id=$1 AND p0.country=$2 AND p0.language=$3 AND p0.visible=true AND ${refPredicate})
         GROUP BY m2.product_gid ORDER BY shared DESC, m2.product_gid LIMIT $5
       )
       SELECT ${SUMMARY_SELECT}, related.via FROM related
       JOIN catalog_products p ON p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.product_gid=related.related_gid AND p.visible=true
       ${SUMMARY_JOINS} ORDER BY related.via, p.handle`,
      [scope.storeId, scope.country, scope.language, refValue, parsedLimit],
    )).rows;
    if (collectionRows.length) {
      return catalogV1RelatedSchema.parse({
        status: fresh.status,
        completedAt: fresh.completedAt,
        items: collectionRows.map((row) => ({ summary: summaryOf(row), relation: 'collection' as const, provenance: row.via })),
      });
    }
    const typeRows = (await client.query<ProductRow>(
      `SELECT ${SUMMARY_SELECT} FROM catalog_products p0
       JOIN catalog_products p ON p.store_id=p0.store_id AND p.country=p0.country AND p.language=p0.language AND p.product_type=p0.product_type AND p.product_gid<>p0.product_gid AND p.visible=true
       ${SUMMARY_JOINS}
       WHERE p0.store_id=$1 AND p0.country=$2 AND p0.language=$3 AND p0.visible=true AND ${refPredicate} AND p0.product_type<>''
       ORDER BY p.handle LIMIT $4`,
      [scope.storeId, scope.country, scope.language, refValue, parsedLimit],
    )).rows;
    return catalogV1RelatedSchema.parse({
      status: fresh.status,
      completedAt: fresh.completedAt,
      items: typeRows.map((row) => ({ summary: summaryOf(row), relation: 'product_type' as const, provenance: row.product_type })),
    });
  });
}

/**
 * Agent-readable configured personalization options. Compatibility is NEVER
 * inferred from names, descriptions or tags: absent an explicit configured
 * declaration it stays UNKNOWN. Descriptions and metafield values are
 * untrusted content, returned as data only.
 */
export async function getCompatibleOptionsV1(pool: Pool, rawScope: CatalogReadScope, ref: string, maxAgeMs = 3600000): Promise<CatalogV1CompatibleOptions | null> {
  const scope = catalogReadScopeSchema.parse(rawScope);
  const parsedRef = parseCatalogProductRef(ref);
  return scopedCatalogTransaction(pool, scope, async (client) => {
    const { fresh, product } = await loadDetail(client, scope, parsedRef, maxAgeMs);
    if (!product) return null;
    const provenance = product.summary.provenance;
    return catalogV1CompatibleOptionsSchema.parse({
      status: fresh.status,
      completedAt: fresh.completedAt,
      product: { id: product.summary.id, handle: product.summary.handle, title: product.summary.title },
      options: product.options,
      personalization: product.attributes
        .filter((attribute) => attribute.source === 'metafield')
        .map((attribute) => ({
          namespace: attribute.name.split('.')[0] ?? attribute.name,
          key: attribute.name.split('.').slice(1).join('.'),
          type: attribute.valueType ?? 'string',
          value: attribute.value,
          source: provenance,
        })),
      compatibility: 'UNKNOWN',
    });
  });
}

/** Synchronization status for the market (explicit freshness states). */
export async function readCatalogStatusV1(pool: Pool, rawScope: CatalogReadScope, maxAgeMs = 3600000): Promise<CatalogV1Status> {
  const scope = catalogReadScopeSchema.parse(rawScope);
  return scopedCatalogTransaction(pool, scope, async (client) => {
    const fresh = await freshness(client, scope, maxAgeMs);
    return catalogV1StatusSchema.parse({ status: fresh.status, completedAt: fresh.completedAt, generation: fresh.generation });
  });
}

export type { MarketScope };
