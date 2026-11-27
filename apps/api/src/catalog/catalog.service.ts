import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  catalogDelegationRequestSchema,
  catalogDelegationResponseSchema,
  catalogHttpQuerySchema,
  catalogResponseSchema,
  catalogSyncResponseSchema,
  catalogV1CollectionsQuerySchema,
  catalogV1CollectionsResponseSchema,
  catalogV1CompareQuerySchema,
  catalogV1ListSchema,
  catalogV1ProductsQuerySchema,
  catalogV1RelatedQuerySchema,
  catalogV1SearchQuerySchema,
  catalogV1SearchResponseSchema,
  catalogV1StatusSchema,
  merchantLoginResponseSchema,
  type CatalogResponse,
  type TenantContext,
} from '@vaarg/shared';
import {
  compareCatalogProductsV1,
  getCatalogProductV1,
  getCompatibleOptionsV1,
  getCatalogVariantV1,
  getCatalogCollectionV1,
  listCatalogCollectionsV1,
  listCatalogFiltersV1,
  listCatalogProductsV1,
  readCatalogStatusV1,
  relatedCatalogProductsV1,
  searchCatalogV1,
  type StorefrontBinding,
} from '@vaarg/persistence';
import { DatabaseClient } from '../infra/database-client.js';
import { ValkeyClient } from '../infra/valkey-client.js';
import { MerchantAuthService } from '../identity/merchant-auth.service.js';
import { TenantContextResolver } from '../tenant/tenant-context.resolver.js';

const FRESHNESS_MAX_AGE_MS = 3600000;

/** Numeric-only path reference resolves to the stable provider gid. */
function stableProductRef(ref: string): string {
  if (/^\d{1,25}$/.test(ref)) return `gid://shopify/Product/${ref}`;
  return ref;
}
function stableVariantRef(ref: string): string {
  if (/^\d{1,25}$/.test(ref)) return `gid://shopify/ProductVariant/${ref}`;
  return ref;
}
function stableCollectionRef(ref: string): string {
  if (/^\d{1,25}$/.test(ref)) return `gid://shopify/Collection/${ref}`;
  return ref;
}

/**
 * Catalog application boundary: projection reads, synchronization and
 * delegation. Authentication/authorization are injected from the identity
 * module (single shared engine — no second authentication implementation);
 * tenant identification and active-store verification reuse the tenant
 * context resolver. Provider configuration stays server-owned.
 */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(DatabaseClient) private readonly database: DatabaseClient,
    @Inject('STOREFRONT_BINDINGS') private readonly bindings: StorefrontBinding[],
    @Inject(TenantContextResolver) private readonly tenants: TenantContextResolver,
    @Inject(MerchantAuthService) private readonly merchantAuth: MerchantAuthService,
    @Inject(ValkeyClient) private readonly valkey: ValkeyClient,
  ) {}

  // -------------------------------------------------------------------------
  // Legacy /catalog contract (preserved behavior)
  // -------------------------------------------------------------------------

  async list(query: unknown, host: unknown, kind: 'product' | 'collection', handle?: string): Promise<CatalogResponse> {
    const parsed = catalogHttpQuerySchema.safeParse(query ?? {});
    if (!parsed.success || (handle !== undefined && (!/^[a-z0-9][a-z0-9-]{0,254}$/.test(handle))) || (kind === 'collection' && (parsed.data?.available !== undefined || parsed.data?.collectionId !== undefined))) throw new BadRequestException('Invalid catalog query');
    if (!this.bindings.length) return catalogResponseSchema.parse({ status:'NOT_CONFIGURED', completedAt:null, items:[], nextCursor:null });
    const binding = this.tenants.identify(host);
    if (!binding) throw new NotFoundException('Unknown storefront');
    if (!process.env[binding.tokenEnv]) return catalogResponseSchema.parse({ status:'NOT_CONFIGURED', completedAt:null, items:[], nextCursor:null });
    const response = await import('@vaarg/persistence').then((persistence) => persistence.readCatalogProjection(this.database.getPool(), { storeId: binding.storeId, country: binding.country, language: binding.language }, { ...parsed.data, kind, maxAgeMs: FRESHNESS_MAX_AGE_MS, ...(handle ? { handle } : {}) }));
    if (response.items.some(item => item.kind === 'product' && item.data.variants.nodes.some(variant => variant.price.currencyCode !== binding.currency))) throw new ServiceUnavailableException('Catalog market mismatch');
    return catalogResponseSchema.parse(response);
  }

  async sync(host: unknown, authorization: unknown, action: 'start' | 'status' | 'step', signal?: AbortSignal) {
    if (signal?.aborted) throw new Error('CANCELLED');
    const { binding, persistence } = await this.authorize(host, authorization);
    const result = await persistence.executeCatalogStep(this.database.getPool(), this.valkey.getRateClient(), binding, process.env, action, signal);
    return catalogSyncResponseSchema.parse({ ...result, completedAt: result.completedAt?.toISOString() ?? null });
  }

  async delegate(host: unknown, authorization: unknown, body: unknown) {
    const parsed = catalogDelegationRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid operation');
    const { binding, identity, persistence } = await this.authorize(host, authorization);
    const secret = process.env.CATALOG_JOB_SIGNING_SECRET;
    if (!secret || secret.length < 32) throw new ServiceUnavailableException('Catalog delegation unavailable');
    const jobId = randomUUID();
    const expiresAt = Date.now() + 5 * 60 * 1000;
    const ticket = persistence.issueCatalogDelegation({ host: binding.host, storeId: binding.storeId, merchantUserId: identity.merchantUserId, sessionId: identity.sessionId, jobId, action: parsed.data.action, expiresAt }, secret);
    return catalogDelegationResponseSchema.parse({ jobId, ticket, expiresAt: new Date(expiresAt).toISOString() });
  }

  /** Legacy login contract: same identity engine, bearer token response. */
  async login(host: unknown, origin: unknown, body: unknown) {
    const result = await this.merchantAuth.login(host, origin, body);
    return merchantLoginResponseSchema.parse({ token: result.token });
  }

  async logout(host: unknown, authorization: unknown) {
    return this.merchantAuth.logout(
      host,
      typeof authorization === 'string' ? authorization : undefined,
    );
  }

  private async authorize(host: unknown, authorization: unknown) {
    const persistence = await import('@vaarg/persistence');
    const { binding, identity } = await this.merchantAuth.authorizeMerchant(
      host,
      typeof authorization === 'string' ? authorization : undefined,
    );
    return { binding, identity, persistence };
  }

  // -------------------------------------------------------------------------
  // Versioned /v1/catalog application API (FL03)
  // -------------------------------------------------------------------------

  /** Verified tenant (active store) + server-owned provider configuration. */
  private async v1Context(host: unknown, correlationId: string): Promise<{ tenant: TenantContext; binding: StorefrontBinding | null; configured: boolean }> {
    const tenant = await this.tenants.resolve(host, correlationId);
    const binding = this.tenants.identify(host) ?? null;
    const configured = !!binding && !!process.env[binding.tokenEnv];
    return { tenant, binding, configured };
  }

  private marketOf(tenant: TenantContext) {
    return { storeId: tenant.storeId, country: tenant.country, language: tenant.language };
  }

  private requireConfigured(configured: boolean): void {
    if (!configured) throw new ServiceUnavailableException('Catalog provider is not configured');
  }

  private enforceMarketCurrency(tenant: TenantContext, requested: string | undefined): string | undefined {
    if (requested === undefined) return undefined;
    if (requested !== tenant.currency) throw new BadRequestException('Requested currency does not match this market');
    return requested;
  }

  /** Product listing with bounded cursor pagination and deterministic sort. */
  async listProductsV1(host: unknown, correlationId: string, rawQuery: unknown) {
    const query = catalogV1ProductsQuerySchema.safeParse(rawQuery ?? {});
    if (!query.success) throw new BadRequestException('Invalid catalog query');
    const { tenant, configured } = await this.v1Context(host, correlationId);
    this.enforceMarketCurrency(tenant, query.data.currency);
    if (!configured) return catalogV1ListSchema.parse({ status: 'NOT_CONFIGURED', completedAt: null, sort: query.data.sort, currency: null, items: [], nextCursor: null });
    const priceCurrency = query.data.priceMin !== undefined || query.data.priceMax !== undefined ? tenant.currency : query.data.currency;
    return listCatalogProductsV1(this.database.getPool(), this.marketOf(tenant), {
      limit: query.data.limit,
      ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
      sort: query.data.sort,
      ...(query.data.q ? { q: query.data.q } : {}),
      ...(query.data.collection ? { collection: query.data.collection } : {}),
      ...(query.data.productType !== undefined ? { productType: query.data.productType } : {}),
      ...(query.data.vendor !== undefined ? { vendor: query.data.vendor } : {}),
      ...(query.data.available !== undefined ? { available: query.data.available } : {}),
      ...(priceCurrency ? { currency: priceCurrency } : {}),
      ...(query.data.priceMin !== undefined ? { priceMin: query.data.priceMin } : {}),
      ...(query.data.priceMax !== undefined ? { priceMax: query.data.priceMax } : {}),
      ...(query.data.attribute ? { attribute: query.data.attribute } : {}),
    }, FRESHNESS_MAX_AGE_MS);
  }

  /** Product detail by handle or stable reference (numeric id resolves to gid). */
  async getProductV1(host: unknown, correlationId: string, ref: string) {
    const { tenant, configured } = await this.v1Context(host, correlationId);
    this.requireConfigured(configured);
    const product = await getCatalogProductV1(this.database.getPool(), this.marketOf(tenant), stableProductRef(ref), FRESHNESS_MAX_AGE_MS);
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  /** Collections listing. */
  async listCollectionsV1(host: unknown, correlationId: string, rawQuery: unknown) {
    const query = catalogV1CollectionsQuerySchema.safeParse(rawQuery ?? {});
    if (!query.success) throw new BadRequestException('Invalid catalog query');
    const { tenant, configured } = await this.v1Context(host, correlationId);
    if (!configured) return catalogV1CollectionsResponseSchema.parse({ status: 'NOT_CONFIGURED', completedAt: null, items: [], nextCursor: null });
    return listCatalogCollectionsV1(this.database.getPool(), this.marketOf(tenant), { limit: query.data.limit, ...(query.data.cursor ? { cursor: query.data.cursor } : {}), ...(query.data.q ? { q: query.data.q } : {}) }, FRESHNESS_MAX_AGE_MS);
  }

  /** Collection detail. */
  async getCollectionV1(host: unknown, correlationId: string, ref: string) {
    const { tenant, configured } = await this.v1Context(host, correlationId);
    this.requireConfigured(configured);
    const collection = await getCatalogCollectionV1(this.database.getPool(), this.marketOf(tenant), stableCollectionRef(ref), FRESHNESS_MAX_AGE_MS);
    if (!collection) throw new NotFoundException('Collection not found');
    return collection;
  }

  /** Collection products (collection filter applied server-side). */
  async listCollectionProductsV1(host: unknown, correlationId: string, ref: string, rawQuery: unknown) {
    const collection = await this.getCollectionV1(host, correlationId, ref);
    const query = catalogV1ProductsQuerySchema.safeParse(rawQuery ?? {});
    if (!query.success) throw new BadRequestException('Invalid catalog query');
    const { tenant, configured } = await this.v1Context(host, correlationId);
    this.enforceMarketCurrency(tenant, query.data.currency);
    if (!configured) return catalogV1ListSchema.parse({ status: 'NOT_CONFIGURED', completedAt: null, sort: query.data.sort, currency: null, items: [], nextCursor: null });
    if (query.data.collection && query.data.collection !== collection.handle && query.data.collection !== collection.id) throw new BadRequestException('Conflicting collection filter');
    const priceCurrency = query.data.priceMin !== undefined || query.data.priceMax !== undefined ? tenant.currency : query.data.currency;
    return listCatalogProductsV1(this.database.getPool(), this.marketOf(tenant), {
      limit: query.data.limit,
      ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
      sort: query.data.sort,
      ...(query.data.q ? { q: query.data.q } : {}),
      collection: collection.handle,
      ...(query.data.productType !== undefined ? { productType: query.data.productType } : {}),
      ...(query.data.vendor !== undefined ? { vendor: query.data.vendor } : {}),
      ...(query.data.available !== undefined ? { available: query.data.available } : {}),
      ...(priceCurrency ? { currency: priceCurrency } : {}),
      ...(query.data.priceMin !== undefined ? { priceMin: query.data.priceMin } : {}),
      ...(query.data.priceMax !== undefined ? { priceMax: query.data.priceMax } : {}),
      ...(query.data.attribute ? { attribute: query.data.attribute } : {}),
    }, FRESHNESS_MAX_AGE_MS);
  }

  /** Variant detail by stable reference. */
  async getVariantV1(host: unknown, correlationId: string, ref: string) {
    const { tenant, configured } = await this.v1Context(host, correlationId);
    this.requireConfigured(configured);
    const variant = await getCatalogVariantV1(this.database.getPool(), this.marketOf(tenant), stableVariantRef(ref), FRESHNESS_MAX_AGE_MS);
    if (!variant) throw new NotFoundException('Variant not found');
    return variant;
  }

  /** Available filters (verified facets only). */
  async listFiltersV1(host: unknown, correlationId: string, rawQuery: unknown) {
    // FL04 defect fix: `collection` is extracted before validating the rest —
    // the strict picked schema rejects unknown keys, so `?collection=…` used
    // to 400 before the separately-extracted collection was ever used.
    const record: Record<string, unknown> = typeof rawQuery === 'object' && rawQuery !== null && !Array.isArray(rawQuery) ? { ...(rawQuery as Record<string, unknown>) } : {};
    const collection = record.collection;
    delete record.collection;
    if (collection !== undefined && (typeof collection !== 'string' || !/^[a-z0-9][a-z0-9-]{0,254}$/.test(collection) && !/^gid:\/\/shopify\/Collection\/\d{1,25}$/.test(collection))) throw new BadRequestException('Invalid collection filter');
    const query = catalogV1CollectionsQuerySchema.pick({ q: true }).safeParse(record);
    if (!query.success) throw new BadRequestException('Invalid catalog query');
    const { tenant, configured } = await this.v1Context(host, correlationId);
    this.requireConfigured(configured);
    return listCatalogFiltersV1(this.database.getPool(), this.marketOf(tenant), collection ? { collection } : {}, FRESHNESS_MAX_AGE_MS);
  }

  /** Deterministic bounded product comparison. */
  async compareV1(host: unknown, correlationId: string, rawQuery: unknown) {
    const query = catalogV1CompareQuerySchema.safeParse(rawQuery ?? {});
    if (!query.success) throw new BadRequestException('Invalid comparison request');
    const refs = [...new Set(query.data.ids.split(',').map((ref) => ref.trim()).filter(Boolean))].slice(0, 4).map(stableProductRef);
    if (refs.length < 2) throw new BadRequestException('At least two products are required');
    const { tenant, configured } = await this.v1Context(host, correlationId);
    this.requireConfigured(configured);
    return compareCatalogProductsV1(this.database.getPool(), this.marketOf(tenant), refs, FRESHNESS_MAX_AGE_MS);
  }

  /** Related products with explicit provenance. */
  async relatedV1(host: unknown, correlationId: string, ref: string, rawQuery: unknown) {
    const query = catalogV1RelatedQuerySchema.safeParse(rawQuery ?? {});
    if (!query.success) throw new BadRequestException('Invalid related request');
    const { tenant, configured } = await this.v1Context(host, correlationId);
    this.requireConfigured(configured);
    return relatedCatalogProductsV1(this.database.getPool(), this.marketOf(tenant), stableProductRef(ref), query.data.limit, FRESHNESS_MAX_AGE_MS);
  }

  /** Deterministic lexical search over the normalized documents. */
  async searchV1(host: unknown, correlationId: string, rawQuery: unknown) {
    const query = catalogV1SearchQuerySchema.safeParse(rawQuery ?? {});
    if (!query.success) throw new BadRequestException('Invalid search query');
    const { tenant, configured } = await this.v1Context(host, correlationId);
    if (!configured) return catalogV1SearchResponseSchema.parse({ status: 'NOT_CONFIGURED', completedAt: null, query: query.data.q, items: [], nextCursor: null });
    return searchCatalogV1(this.database.getPool(), this.marketOf(tenant), { q: query.data.q, limit: query.data.limit, ...(query.data.cursor ? { cursor: query.data.cursor } : {}) }, FRESHNESS_MAX_AGE_MS);
  }

  /** Agent-readable configured personalization options (compatibility UNKNOWN). */
  async compatibleOptionsV1(host: unknown, correlationId: string, ref: string) {
    const { tenant, configured } = await this.v1Context(host, correlationId);
    this.requireConfigured(configured);
    const result = await getCompatibleOptionsV1(this.database.getPool(), this.marketOf(tenant), stableProductRef(ref), FRESHNESS_MAX_AGE_MS);
    if (!result) throw new NotFoundException('Product not found');
    return result;
  }

  /** Catalog synchronization status with explicit freshness state. */
  async statusV1(host: unknown, correlationId: string) {
    const { tenant, configured } = await this.v1Context(host, correlationId);
    if (!configured) return catalogV1StatusSchema.parse({ status: 'NOT_CONFIGURED', completedAt: null, generation: null });
    return readCatalogStatusV1(this.database.getPool(), this.marketOf(tenant), FRESHNESS_MAX_AGE_MS);
  }
}
