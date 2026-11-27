import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ConsentPurpose,
  ConsentSource,
  ConsentState,
  ConsentStateResponse,
  ConsentUpdateRequest,
  MerchantIdentity,
  TenantContext,
  VisitorSession,
} from '@vaarg/shared';
import {
  assertPurposeGranted,
  consentStateSchema,
  emptyConsentState,
  isPurposeGranted,
} from '@vaarg/shared';
import {
  createDb,
  scopedStoreTransaction,
  experienceCacheKey,
  getConsentMap,
  recordAudit,
  recordConsent,
  withStoreContext,
  type Purpose,
} from '@vaarg/persistence';
import { ValkeyClient } from '../infra/valkey-client.js';
import { DatabaseClient } from '../infra/database-client.js';

export type ConsentActor =
  | { kind: 'merchant'; identity: MerchantIdentity }
  | { kind: 'visitor'; session: VisitorSession }
  | { kind: 'anonymous' };

/**
 * Privacy and consent application service (FL02 TASK 5).
 *
 * Consent purposes reuse the existing persistence vocabulary. The acting
 * identity is always resolved server-side: a visitor may only manage the
 * customer linked to their own verified session, a merchant only within
 * their store and permission set. Append-only history and the effective
 * projection are written atomically in one store-scoped transaction.
 * Necessary session operations never depend on optional consent.
 */
@Injectable()
export class ConsentService {
  constructor(@Inject(DatabaseClient) private readonly database: DatabaseClient,
    @Inject(ValkeyClient) private readonly valkey: ValkeyClient) {}

  /** Read the effective consent state for the actor's target customer. */
  async get(
    tenant: Pick<TenantContext, 'storeId'>,
    actor: ConsentActor,
    customerIdQuery?: string,
  ): Promise<ConsentStateResponse> {
    if (actor.kind === 'merchant') {
      this.requirePermission(actor.identity, 'consents:read');
      if (!customerIdQuery) throw new BadRequestException('customerId is required');
      const consents = await this.readState(tenant.storeId, customerIdQuery);
      return { customerId: customerIdQuery, consents };
    }
    if (actor.kind === 'visitor' && actor.session.customerId) {
      const customerId = actor.session.customerId;
      if (customerIdQuery && customerIdQuery !== customerId) {
        throw new ForbiddenException('Cannot read another customer\'s consent');
      }
      const consents = await this.readState(tenant.storeId, customerId);
      return { customerId, consents };
    }
    // Anonymous or unlinked visitors see an undecided state; no rows are read
    // or written without a verified customer identity.
    return { customerId: null, consents: emptyConsentState() };
  }

  /** Explicit consent update or withdrawal (granted: false). */
  async update(
    tenant: Pick<TenantContext, 'storeId'>,
    actor: ConsentActor,
    body: ConsentUpdateRequest,
  ): Promise<ConsentStateResponse> {
    let targetCustomerId: string;
    let source: ConsentSource;
    let actorRef: string;
    if (actor.kind === 'merchant') {
      this.requirePermission(actor.identity, 'consents:write');
      if (!body.customerId) throw new BadRequestException('customerId is required');
      targetCustomerId = body.customerId;
      source = body.source ?? 'merchant_policy';
      actorRef = `merchant:${actor.identity.merchantUserId}`;
    } else if (actor.kind === 'visitor' && actor.session.customerId) {
      targetCustomerId = actor.session.customerId;
      if (body.customerId && body.customerId !== targetCustomerId) {
        throw new ForbiddenException('Cannot modify another customer\'s consent');
      }
      // Visitors' choices are always their own action — provenance is not
      // client-spoofable (no legal_basis/merchant_policy from the browser).
      source = 'user_action';
      actorRef = `visitor:${actor.session.sessionId}`;
    } else if (actor.kind === 'visitor') {
      throw new ForbiddenException('Verified customer identity required');
    } else {
      throw new UnauthorizedException();
    }

    const purpose = body.purpose as Purpose;
    await withStoreContext(createDb(this.database.getPool()), tenant.storeId, async (tx) => {
      await recordConsent(
        tx,
        tenant.storeId,
        targetCustomerId,
        purpose,
        body.granted,
        source,
        body.note,
      );
      await recordAudit(tx, tenant.storeId, actorRef, 'consent.updated', 'customer', targetCustomerId, {
        purpose,
        granted: body.granted,
        source,
      });
    });

    if (body.purpose === 'personalization' && !body.granted) {
      const sessions = await scopedStoreTransaction(this.database.getPool(), tenant.storeId, client =>
        client.query<{ session_id: string }>('SELECT session_id FROM visitor_sessions WHERE store_id=$1 AND customer_id=$2', [tenant.storeId, targetCustomerId]));
      for (const session of sessions.rows) await this.valkey.getClient().del(experienceCacheKey(tenant.storeId, session.session_id));
    }
    const consents = await this.readState(tenant.storeId, targetCustomerId);
    return { customerId: targetCustomerId, consents };
  }

  /**
   * Reusable purpose-based permission check for future memory and
   * marketing modules (dispatch-time gate).
   */
  async isPurposeAllowed(
    tenant: Pick<TenantContext, 'storeId'>,
    customerId: string,
    purpose: ConsentPurpose,
  ): Promise<boolean> {
    const state = await this.readState(tenant.storeId, customerId);
    return isPurposeGranted(state, purpose);
  }

  /** Throwing variant used by future dispatch boundaries. */
  async assertPurposeAllowed(
    tenant: Pick<TenantContext, 'storeId'>,
    customerId: string,
    purpose: ConsentPurpose,
  ): Promise<void> {
    const state = await this.readState(tenant.storeId, customerId);
    assertPurposeGranted(state, purpose);
  }

  private async readState(
    storeId: string,
    customerId: string,
  ): Promise<ConsentState> {
    const map = await withStoreContext(
      createDb(this.database.getPool()),
      storeId,
      (tx) => getConsentMap(tx, storeId, customerId),
    );
    const state = emptyConsentState();
    for (const key of Object.keys(state) as ConsentPurpose[]) {
      const value = map[key];
      if (typeof value === 'boolean') state[key] = value;
    }
    return consentStateSchema.parse(state);
  }

  private requirePermission(
    identity: MerchantIdentity,
    permission: (typeof identity.permissions)[number],
  ): void {
    if (!identity.permissions.includes(permission)) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }
}
