import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  merchantAuthResponseSchema,
  merchantIdentityResponseSchema,
  type MerchantIdentity,
} from '@vaarg/shared';
import { MERCHANT_SESSION_TTL_MS } from '@vaarg/persistence';
import { MerchantAuthService } from './merchant-auth.service.js';
import { MerchantAuthGuard } from './merchant-auth.guard.js';
import { PermissionsGuard } from './permissions.guard.js';
import { MerchantIdentityParam } from './identity.decorator.js';
import { TenantContextResolver } from '../tenant/tenant-context.resolver.js';
import {
  MERCHANT_SESSION_COOKIE,
  clearSessionCookie,
  setSessionCookie,
} from '../common/cookies.js';
import { assertSafeCookieMutation } from '../common/csrf.js';
import { correlationIdOf, merchantCredential } from '../common/request-context.js';

/**
 * Merchant identity HTTP lifecycle (FL02 TASK 3): login, logout, current
 * identity and session refresh/rotation under /v1. Browser clients use
 * secure HttpOnly host-only cookies with CSRF-protected mutations;
 * server-side clients keep bearer tokens.
 */
@Controller('v1/merchant/auth')
export class IdentityController {
  constructor(
    @Inject(MerchantAuthService) private readonly auth: MerchantAuthService,
    @Inject(TenantContextResolver) private readonly tenants: TenantContextResolver,
  ) {}

  @Post('login')
  @Header('Cache-Control', 'private, no-store')
  async login(
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (Object.keys(query).length) throw new BadRequestException('Invalid request');
    const result = await this.auth.login(
      request.headers.host,
      request.headers.origin,
      body,
      correlationIdOf(request),
    );
    setSessionCookie(reply, MERCHANT_SESSION_COOKIE, result.token, MERCHANT_SESSION_TTL_MS);
    return merchantAuthResponseSchema.parse(result);
  }

  @Post('logout')
  @Header('Cache-Control', 'private, no-store')
  async logout(
    @Query() query: Record<string, unknown>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (Object.keys(query).length) throw new BadRequestException('Invalid request');
    const credential = merchantCredential(request);
    if (!credential) throw new UnauthorizedException();
    if (credential.via === 'cookie') {
      const binding = this.tenants.identify(request.headers.host);
      if (!binding) throw new NotFoundException('Unknown storefront');
      assertSafeCookieMutation(request, binding.host);
    }
    const result = await this.auth.logout(request.headers.host, `Bearer ${credential.token}`);
    clearSessionCookie(reply, MERCHANT_SESSION_COOKIE);
    return result;
  }

  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(MerchantAuthGuard, PermissionsGuard)
  me(@MerchantIdentityParam() identity: MerchantIdentity) {
    return merchantIdentityResponseSchema.parse({ identity });
  }

  @Post('refresh')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(MerchantAuthGuard, PermissionsGuard)
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const credential = merchantCredential(request);
    if (!credential) throw new UnauthorizedException();
    if (credential.via === 'cookie') {
      const tenant = request.vaarg?.tenant;
      if (!tenant) throw new UnauthorizedException();
      assertSafeCookieMutation(request, tenant.host);
    }
    const result = await this.auth.refresh(
      request.headers.host,
      `Bearer ${credential.token}`,
      correlationIdOf(request),
    );
    setSessionCookie(reply, MERCHANT_SESSION_COOKIE, result.token, MERCHANT_SESSION_TTL_MS);
    return merchantAuthResponseSchema.parse(result);
  }
}
