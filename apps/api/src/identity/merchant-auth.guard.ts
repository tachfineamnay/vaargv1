import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { TenantContextResolver } from '../tenant/tenant-context.resolver.js';
import { MerchantAuthService } from './merchant-auth.service.js';
import { correlationIdOf, merchantCredential } from '../common/request-context.js';

/**
 * Resolves the trusted tenant from the Host header and authenticates the
 * merchant credential (bearer or HttpOnly cookie). Attaches both to
 * `request.vaarg` for downstream handlers and permission checks.
 */
@Injectable()
export class MerchantAuthGuard implements CanActivate {
  constructor(
    @Inject(TenantContextResolver) private readonly tenants: TenantContextResolver,
    @Inject(MerchantAuthService) private readonly auth: MerchantAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const tenant = await this.tenants.resolve(
      request.headers.host,
      correlationIdOf(request),
    );
    const credential = merchantCredential(request);
    if (!credential) throw new UnauthorizedException();
    const identity = await this.auth.resolveIdentity(tenant, credential.token);
    if (!identity) throw new UnauthorizedException();
    request.vaarg = { ...request.vaarg, tenant, merchant: identity };
    return true;
  }
}
