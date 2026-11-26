import { BadRequestException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { catalogDelegationRequestSchema, catalogDelegationResponseSchema, catalogHttpQuerySchema, catalogResponseSchema, catalogSyncResponseSchema, merchantLoginRequestSchema, merchantLoginResponseSchema, type CatalogResponse } from '@vaarg/shared';
import type { StorefrontBinding } from '@vaarg/persistence';
import { DatabaseClient } from '../infra/database-client.js';
import { ValkeyClient } from '../infra/valkey-client.js';

@Injectable()
export class CatalogService {
  constructor(@Inject(DatabaseClient) private readonly database: DatabaseClient, @Inject('STOREFRONT_BINDINGS') private readonly bindings: StorefrontBinding[], @Inject(ValkeyClient) private readonly valkey: ValkeyClient) {}

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
    const binding = persistence.resolveStorefront(this.bindings, host);
    if (!binding) throw new NotFoundException('Unknown storefront');
    const match = typeof authorization === 'string' ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization) : null;
    if (!match) throw new UnauthorizedException();
    const identity = await persistence.withStoreContext(persistence.createDb(this.database.getPool()), binding.storeId, tx => persistence.resolveMerchantSession(tx, binding.storeId, match[1]!));
    if (!identity || identity.storeId !== binding.storeId) throw new UnauthorizedException();
    if (!['owner', 'marketing'].includes(identity.role)) throw new ForbiddenException();
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

  async login(host: unknown, origin: unknown, body: unknown) {
    const parsed = merchantLoginRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid credentials');
    const persistence = await import('@vaarg/persistence');
    const binding = persistence.resolveStorefront(this.bindings, host);
    if (!binding) throw new NotFoundException('Unknown storefront');
    if (origin !== `https://${binding.host}`) throw new ForbiddenException();
    const digest = createHash('sha256').update(parsed.data.email.toLowerCase()).digest('hex');
    const key = `vaarg:{${binding.storeId}}:merchant-login:${digest}`;
    let attempts: unknown;
    try { attempts = await this.valkey.getRateClient().eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],300) end; return n", 1, key); }
    catch { throw new ServiceUnavailableException('Authentication unavailable'); }
    if (typeof attempts !== 'number' || !Number.isInteger(attempts)) throw new ServiceUnavailableException('Authentication unavailable');
    if (attempts > 5) throw new HttpException('Too many attempts', 429);
    const user = await persistence.withStoreContext(persistence.createDb(this.database.getPool()), binding.storeId, tx => persistence.authenticateMerchant(tx, binding.storeId, parsed.data.email, parsed.data.password));
    if (!user) throw new UnauthorizedException();
    return merchantLoginResponseSchema.parse({ token: user.token });
  }

  async logout(host: unknown, authorization: unknown) {
    const persistence = await import('@vaarg/persistence');
    const binding = persistence.resolveStorefront(this.bindings, host);
    if (!binding) throw new NotFoundException('Unknown storefront');
    const match = typeof authorization === 'string' ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization) : null;
    if (!match) throw new UnauthorizedException();
    const revoked = await persistence.withStoreContext(persistence.createDb(this.database.getPool()), binding.storeId, tx => persistence.revokeMerchantSession(tx, binding.storeId, match[1]!));
    if (!revoked) throw new UnauthorizedException();
    return { status: 'revoked' as const };
  }
}
