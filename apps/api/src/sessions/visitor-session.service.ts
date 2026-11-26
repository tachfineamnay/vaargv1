import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type {
  CreateSessionRequest,
  TenantContext,
  VisitorSession,
} from '@vaarg/shared';
import { visitorSessionSchema } from '@vaarg/shared';
import {
  SESSION_TTL_MS,
  VisitorSessionCache,
  createDb,
  createVisitorSession,
  hashToken,
  resolveVisitorSession,
  revokeVisitorSession,
  rotateVisitorSession,
  withStoreContext,
} from '@vaarg/persistence';
import { DatabaseClient } from '../infra/database-client.js';
import { ValkeyClient } from '../infra/valkey-client.js';

export interface IssuedVisitorSession {
  session: VisitorSession;
  token: string;
}

/**
 * Visitor session application service (FL02 TASK 4).
 *
 * PostgreSQL is the durable authority (opaque hashed tokens, expiry,
 * atomic rotation, store-scoped RLS transactions). Valkey holds derived
 * active-session state only: keys are store-scoped and keyed by the
 * hashed token, TTLs mirror `expires_at`, revocation deletes the key, and
 * invalid or expired entries are never served — they are re-read from
 * PostgreSQL instead.
 *
 * Anonymous sessions can never gain a customer identity here; verified
 * Shopify customer-account linking belongs to the later customer mission.
 */
@Injectable()
export class VisitorSessionService {
  constructor(
    @Inject(DatabaseClient) private readonly database: DatabaseClient,
    @Inject(ValkeyClient) private readonly valkey: ValkeyClient,
  ) {}

  /** Create an anonymous store-scoped session and cache it write-through. */
  async create(
    tenant: Pick<TenantContext, 'storeId'>,
    input: CreateSessionRequest = {},
  ): Promise<IssuedVisitorSession> {
    const ttlMs = input.ttlSeconds ? input.ttlSeconds * 1000 : SESSION_TTL_MS;
    const context = input.context ?? 'default';
    const record = await withStoreContext(
      createDb(this.database.getPool()),
      tenant.storeId,
      (tx) => createVisitorSession(tx, tenant.storeId, null, context, ttlMs),
    );
    const session = toVisitorSession({
      sessionId: record.sessionId,
      storeId: tenant.storeId,
      customerId: null,
      status: 'active',
      context,
      expiresAt: record.expiresAt,
      createdAt: new Date(),
    });
    await this.cache().set(tenant.storeId, hashToken(record.token), {
      sessionId: session.sessionId,
      storeId: session.storeId,
      customerId: null,
      status: 'active',
      context,
      expiresAt: record.expiresAt,
      createdAt: new Date(),
    });
    return { session, token: record.token };
  }

  /**
   * Resolve the current session from an opaque token. Cache hits are
   * validated (active, unexpired, store-matched); everything else is read
   * from PostgreSQL. Returns null when no valid session exists.
   */
  async current(
    tenant: Pick<TenantContext, 'storeId'>,
    token: string,
  ): Promise<VisitorSession | null> {
    const tokenHash = hashToken(token);
    const cached = await this.cache().get(tenant.storeId, tokenHash);
    if (cached) return toVisitorSession(cached);
    const record = await withStoreContext(
      createDb(this.database.getPool()),
      tenant.storeId,
      (tx) => resolveVisitorSession(tx, tenant.storeId, token),
    );
    if (!record) return null;
    const session = toVisitorSession(record);
    await this.cache().set(tenant.storeId, tokenHash, {
      sessionId: session.sessionId,
      storeId: session.storeId,
      customerId: session.customerId,
      status: record.status,
      context: record.context,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
    });
    return session;
  }

  /** Atomically rotate the token; the old token and its cache key die. */
  async rotate(
    tenant: Pick<TenantContext, 'storeId'>,
    token: string,
  ): Promise<IssuedVisitorSession> {
    const oldHash = hashToken(token);
    const rotated = await withStoreContext(
      createDb(this.database.getPool()),
      tenant.storeId,
      (tx) => rotateVisitorSession(tx, tenant.storeId, token),
    );
    if (!rotated) throw new UnauthorizedException();
    await this.cache().del(tenant.storeId, oldHash);
    const session = await this.current(tenant, rotated.token);
    if (!session) throw new UnauthorizedException();
    return { session, token: rotated.token };
  }

  /** Revoke the session behind the token (durable) and drop its cache key. */
  async revoke(
    tenant: Pick<TenantContext, 'storeId'>,
    token: string,
  ): Promise<VisitorSession> {
    const session = await this.current(tenant, token);
    if (!session) throw new UnauthorizedException();
    const revoked = await withStoreContext(
      createDb(this.database.getPool()),
      tenant.storeId,
      (tx) => revokeVisitorSession(tx, tenant.storeId, session.sessionId),
    );
    await this.cache().del(tenant.storeId, hashToken(token));
    if (!revoked) throw new UnauthorizedException();
    return { ...session, status: 'revoked' };
  }

  private cache(): VisitorSessionCache {
    return new VisitorSessionCache(this.valkey.getClient());
  }
}

interface SessionLikeRow {
  sessionId: string;
  storeId: string;
  customerId: string | null;
  status: string;
  context: string;
  expiresAt: Date;
  createdAt: Date;
}

function toVisitorSession(row: SessionLikeRow): VisitorSession {
  return visitorSessionSchema.parse({
    sessionId: row.sessionId,
    storeId: row.storeId,
    customerId: row.customerId,
    context: row.context,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  });
}
