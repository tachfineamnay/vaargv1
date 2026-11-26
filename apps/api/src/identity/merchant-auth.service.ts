import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  merchantLoginV1RequestSchema,
  merchantRoleSchema,
  permissionsForRole,
  type MerchantIdentity,
} from '@vaarg/shared';
import type { MerchantIdentity as MerchantSessionRecord, StorefrontBinding } from '@vaarg/persistence';
import {
  MERCHANT_SESSION_TTL_MS,
  createDb,
  resolveMerchantSession,
  revokeMerchantSession,
  rotateMerchantSession,
  withStoreContext,
} from '@vaarg/persistence';
import { DatabaseClient } from '../infra/database-client.js';
import { ValkeyClient } from '../infra/valkey-client.js';
import { TenantContextResolver } from '../tenant/tenant-context.resolver.js';

export interface MerchantLoginResult {
  identity: MerchantIdentity;
  token: string;
  expiresAt: Date;
}

/**
 * Merchant authentication and authorization application service (FL02
 * TASK 3). Single authentication engine: argon2id verification, hashed
 * opaque session tokens, expiry, atomic rotation, revocation and
 * per-request account/membership revalidation. Reused by the identity
 * HTTP module and the existing catalog boundaries.
 */
@Injectable()
export class MerchantAuthService {
  private readonly tenants: TenantContextResolver;

  constructor(
    @Inject(DatabaseClient) private readonly database: DatabaseClient,
    @Inject('STOREFRONT_BINDINGS') bindings: StorefrontBinding[],
    @Inject(ValkeyClient) private readonly valkey: ValkeyClient,
  ) {
    this.tenants = new TenantContextResolver(database, bindings);
  }

  /** Host-only storefront identification (shared tenant boundary). */
  identify(host: unknown): StorefrontBinding {
    const binding = this.tenants.identify(host);
    if (!binding) throw new NotFoundException('Unknown storefront');
    return binding;
  }

  /**
   * Login: validated credentials → argon2id verify → opaque session token
   * (hashed at rest) → safe identity DTO. Rate-limited per store + email.
   * The tenant is resolved server-side from the Host header; unknown hosts
   * and inactive stores are rejected before any credential check.
   */
  async login(
    host: unknown,
    origin: unknown,
    body: unknown,
    correlationId?: string,
  ): Promise<MerchantLoginResult> {
    const parsed = merchantLoginV1RequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid credentials');
    const tenant = await this.tenants.resolve(host, correlationId ?? fallbackCorrelationId());
    if (origin !== `https://${tenant.host}`) throw new ForbiddenException();
    await this.enforceRateLimit(tenant.storeId, parsed.data.email);
    const persistence = await import('@vaarg/persistence');
    const auth = await persistence.withStoreContext(
      persistence.createDb(this.database.getPool()),
      tenant.storeId,
      (tx) =>
        persistence.authenticateMerchant(
          tx,
          tenant.storeId,
          parsed.data.email,
          parsed.data.password,
        ),
    );
    if (!auth) throw new UnauthorizedException();
    const record = await this.resolveSessionRecord(tenant.storeId, auth.token);
    if (!record) throw new UnauthorizedException();
    return {
      identity: this.toDto(record),
      token: auth.token,
      expiresAt: new Date(Date.now() + MERCHANT_SESSION_TTL_MS),
    };
  }

  /** Revoke the session behind a bearer credential within the host scope. */
  async logout(
    host: unknown,
    authorization: string | undefined,
  ): Promise<{ status: 'revoked' }> {
    const binding = this.identify(host);
    const token = bearerOf(authorization);
    if (!token) throw new UnauthorizedException();
    const revoked = await withStoreContext(
      createDb(this.database.getPool()),
      binding.storeId,
      (tx) => revokeMerchantSession(tx, binding.storeId, token),
    );
    if (!revoked) throw new UnauthorizedException();
    return { status: 'revoked' };
  }

  /**
   * Resolve the current identity from a credential within the verified
   * tenant. Revalidates account status and active membership on every use.
   */
  async resolveIdentity(
    tenant: { storeId: string },
    token: string,
  ): Promise<MerchantIdentity | null> {
    const record = await this.resolveSessionRecord(tenant.storeId, token);
    if (!record || record.storeId !== tenant.storeId) return null;
    return this.toDto(record);
  }

  /**
   * Catalog authorization boundary: host identification + bearer session
   * resolution + role check (owner/marketing). Preserves the existing
   * contract used by sync/delegation routes.
   */
  async authorizeMerchant(
    host: unknown,
    authorization: string | undefined,
  ): Promise<{ binding: StorefrontBinding; identity: MerchantSessionRecord }> {
    const binding = this.identify(host);
    const token = bearerOf(authorization);
    if (!token) throw new UnauthorizedException();
    const identity = await this.resolveSessionRecord(binding.storeId, token);
    if (!identity || identity.storeId !== binding.storeId) {
      throw new UnauthorizedException();
    }
    if (!['owner', 'marketing'].includes(identity.role)) {
      throw new ForbiddenException();
    }
    return { binding, identity };
  }

  /** Atomically rotate the session behind the presented credential. */
  async refresh(
    host: unknown,
    authorization: string | undefined,
    correlationId?: string,
  ): Promise<MerchantLoginResult> {
    const token = bearerOf(authorization);
    if (!token) throw new UnauthorizedException();
    const tenant = await this.tenants.resolve(host, correlationId ?? fallbackCorrelationId());
    const current = await this.resolveSessionRecord(tenant.storeId, token);
    if (!current) throw new UnauthorizedException();
    const rotated = await withStoreContext(
      createDb(this.database.getPool()),
      tenant.storeId,
      (tx) => rotateMerchantSession(tx, tenant.storeId, token),
    );
    if (!rotated) throw new UnauthorizedException();
    const record = await this.resolveSessionRecord(tenant.storeId, rotated.token);
    if (!record) throw new UnauthorizedException();
    return {
      identity: this.toDto(record),
      token: rotated.token,
      expiresAt: rotated.expiresAt,
    };
  }

  private async resolveSessionRecord(
    storeId: string,
    token: string,
  ): Promise<MerchantSessionRecord | null> {
    return withStoreContext(createDb(this.database.getPool()), storeId, (tx) =>
      resolveMerchantSession(tx, storeId, token),
    );
  }

  private toDto(record: MerchantSessionRecord): MerchantIdentity {
    const role = merchantRoleSchema.parse(record.role);
    return {
      sessionId: record.sessionId,
      merchantUserId: record.merchantUserId,
      storeId: record.storeId,
      email: record.email,
      role,
      permissions: permissionsForRole(role),
    };
  }

  /** Per-store, per-email attempt counter in Valkey (5 attempts / 300s). */
  private async enforceRateLimit(storeId: string, email: string): Promise<void> {
    const digest = createHash('sha256').update(email.toLowerCase()).digest('hex');
    const key = `vaarg:{${storeId}}:merchant-login:${digest}`;
    let attempts: unknown;
    try {
      attempts = await this.valkey.getRateClient().eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],300) end; return n",
        1,
        key,
      );
    } catch {
      throw new ServiceUnavailableException('Authentication unavailable');
    }
    if (typeof attempts !== 'number' || !Number.isInteger(attempts)) {
      throw new ServiceUnavailableException('Authentication unavailable');
    }
    if (attempts > 5) throw new HttpException('Too many attempts', 429);
  }
}

function bearerOf(authorization: string | undefined): string | null {
  const match =
    typeof authorization === 'string' ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization) : null;
  return match ? match[1]! : null;
}

function fallbackCorrelationId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
