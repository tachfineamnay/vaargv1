import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { consentStateResponseSchema, consentUpdateRequestSchema } from '@vaarg/shared';
import { uuidSchema } from '@vaarg/persistence';
import { ConsentService, type ConsentActor } from './consent.service.js';
import { MerchantAuthService } from '../identity/merchant-auth.service.js';
import { VisitorSessionService } from '../sessions/visitor-session.service.js';
import { TenantContextResolver } from '../tenant/tenant-context.resolver.js';
import { assertSafeCookieMutation } from '../common/csrf.js';
import {
  correlationIdOf,
  merchantCredential,
  visitorCredential,
} from '../common/request-context.js';

/**
 * Consent HTTP surface (PRD §10 POST /privacy/consents, FL02 TASK 5):
 * retrieval, explicit updates and withdrawal. The acting identity is
 * resolved server-side from the merchant credential or the visitor
 * session; cookie-authenticated mutations are CSRF-protected.
 */
@Controller('v1/privacy/consents')
export class ConsentController {
  constructor(
    @Inject(ConsentService) private readonly consents: ConsentService,
    @Inject(MerchantAuthService) private readonly auth: MerchantAuthService,
    @Inject(VisitorSessionService) private readonly sessions: VisitorSessionService,
    @Inject(TenantContextResolver) private readonly tenants: TenantContextResolver,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async get(@Query() query: Record<string, unknown>, @Req() request: FastifyRequest) {
    const tenant = await this.tenants.resolve(
      request.headers.host,
      correlationIdOf(request),
    );
    request.vaarg = { ...request.vaarg, tenant };
    const customerId = optionalCustomerId(query.customerId);
    const actor = await this.resolveActor(tenant, request);
    return consentStateResponseSchema.parse(
      await this.consents.get(tenant, actor, customerId),
    );
  }

  @Post()
  @Header('Cache-Control', 'private, no-store')
  async update(@Body() body: unknown, @Req() request: FastifyRequest) {
    const tenant = await this.tenants.resolve(
      request.headers.host,
      correlationIdOf(request),
    );
    request.vaarg = { ...request.vaarg, tenant };
    const parsed = consentUpdateRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid consent request');
    const actor = await this.resolveActor(tenant, request);
    if (this.usedCookieCredential(request)) {
      assertSafeCookieMutation(request, tenant.host);
    }
    return consentStateResponseSchema.parse(
      await this.consents.update(tenant, actor, parsed.data),
    );
  }

  /**
   * Server-side actor resolution: merchant credential first (verified
   * identity + permissions), then the visitor session bound to this store.
   * An invalid or expired credential falls through; anonymous callers get
   * the anonymous actor.
   */
  private async resolveActor(
    tenant: { storeId: string },
    request: FastifyRequest,
  ): Promise<ConsentActor> {
    const merchant = merchantCredential(request);
    if (merchant) {
      const identity = await this.auth.resolveIdentity(tenant, merchant.token);
      if (identity) return { kind: 'merchant', identity };
    }
    const visitor = visitorCredential(request);
    if (visitor) {
      const session = await this.sessions.current(tenant, visitor.token);
      if (session) return { kind: 'visitor', session };
    }
    return { kind: 'anonymous' };
  }

  private usedCookieCredential(request: FastifyRequest): boolean {
    const merchant = merchantCredential(request);
    if (merchant?.via === 'cookie') return true;
    const visitor = visitorCredential(request);
    return visitor?.via === 'cookie';
  }
}

function optionalCustomerId(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException('Invalid customerId');
  return parsed.data;
}
