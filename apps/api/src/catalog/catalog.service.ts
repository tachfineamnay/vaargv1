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
  merchantLoginResponseSchema,
  type CatalogResponse,
} from '@vaarg/shared';
import type { StorefrontBinding } from '@vaarg/persistence';
import { DatabaseClient } from '../infra/database-client.js';
import { ValkeyClient } from '../infra/valkey-client.js';
import { MerchantAuthService } from '../identity/merchant-auth.service.js';

@Injectable()
export class CatalogService {
  private readonly merchantAuth: MerchantAuthService;

  constructor(
    @Inject(DatabaseClient) private readonly database: DatabaseClient,
    @Inject('STOREFRONT_BINDINGS') private readonly bindings: StorefrontBinding[],
    @Inject(ValkeyClient) private readonly valkey: ValkeyClient,
  ) {
    // Same identity engine as the /v1 identity module — no second
    // authentication implementation for catalog operations.
    this.merchantAuth = new MerchantAuthService(database, bindings, valkey);
  }

  async list(query: unknown, host: unknown, kind: 'product' | 'collection', handle?: string): Promise<CatalogResponse> {
    const parsed = catalogHttpQuerySchema.safeParse(query ?? {});
    if (!parsed.success || (handle !== undefined && (!/^[a-z0-9][a-z0-9-]{0,254}$/.test(handle))) || (kind === 'collection' && (parsed.data?.available !== undefined || parsed.data?.collectionId !== undefined))) throw new BadRequestException('Invalid catalog query');
    if (!this.bindings.length) return catalogResponseSchema.parse({ status:'NOT_CONFIGURED', completedAt:null, items:[], nextCursor:null });
    const persistence = await import('@vaarg/persistence');
    const binding = persistence.resolveStorefront(this.bindings, host);
    if (!binding) throw new NotFoundException('Unknown storefront');
    if (!process.env[binding.tokenEnv]) return catalogResponseSchema.parse({ status:'NOT_CONFIGURED', completedAt:null, items:[], nextCursor:null });
    const response = await persistence.readCatalogProjection(this.database.getPool(), { storeId: binding.storeId, country: binding.country, language: binding.language }, { ...parsed.data, kind, maxAgeMs:3600000, ...(handle ? { handle } : {}) });
    if (response.items.some(item => item.kind === 'product' && item.data.variants.nodes.some(variant => variant.price.currencyCode !== binding.currency))) throw new ServiceUnavailableException('Catalog market mismatch');
    return catalogResponseSchema.parse(response);
  }

  async sync(host: unknown, authorization: unknown, action: 'start' | 'status' | 'step', signal?: AbortSignal) {
    if (signal?.aborted) throw new Error('CANCELLED');
    const { binding, persistence } = await this.authorize(host, authorization);
    const result = await persistence.executeCatalogStep(this.database.getPool(), this.valkey.getRateClient(), binding, process.env, action, signal);
    return catalogSyncResponseSchema.parse({ ...result, completedAt: result.completedAt?.toISOString() ?? null });
  }

  private async authorize(host: unknown, authorization: unknown) {
    const persistence = await import('@vaarg/persistence');
    const { binding, identity } = await this.merchantAuth.authorizeMerchant(
      host,
      typeof authorization === 'string' ? authorization : undefined,
    );
    return { binding, identity, persistence };
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
}
