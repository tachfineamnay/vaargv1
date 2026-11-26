import { BadRequestException, Body, Controller, Get, Header, Inject, NotFoundException, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CatalogService } from './catalog.service.js';
import { authorizationHeaderOf, merchantCredential } from '../common/request-context.js';
import { assertSafeCookieMutation } from '../common/csrf.js';
import { TenantContextResolver } from '../tenant/tenant-context.resolver.js';

/**
 * Catalog mutations accept cookie-authenticated sessions (legacy bearer
 * contract preserved through the shared authorization fallback); any cookie
 * authenticated mutation must pass the same Origin CSRF check as the identity
 * module. Bearer (server-side) callers are unaffected.
 */
export function assertCatalogCookieCsrf(request: FastifyRequest, tenants: TenantContextResolver): void {
  const credential = merchantCredential(request);
  if (credential?.via !== 'cookie') return;
  const binding = tenants.identify(request.headers.host);
  if (!binding) throw new NotFoundException('Unknown storefront');
  assertSafeCookieMutation(request, binding.host);
}

@Controller('catalog')
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalogService: CatalogService,
    @Inject(TenantContextResolver) private readonly tenants: TenantContextResolver,
  ) {}

  @Post('merchant/session')
  @Header('Cache-Control', 'private, no-store')
  login(@Body() body: unknown, @Query() query: Record<string, unknown>, @Req() request: FastifyRequest) {
    if (Object.keys(query).length) throw new BadRequestException('Invalid request');
    return this.catalogService.login(request.headers.host, request.headers.origin, body);
  }
  @Post('merchant/logout')
  @Header('Cache-Control', 'private, no-store')
  logout(@Query() query: Record<string, unknown>, @Req() request: FastifyRequest) {
    if (Object.keys(query).length) throw new BadRequestException('Invalid request');
    assertCatalogCookieCsrf(request, this.tenants);
    return this.catalogService.logout(request.headers.host, authorizationHeaderOf(request));
  }

  @Get('sync')
  @Header('Cache-Control', 'private, no-store')
  status(@Query() query: Record<string, unknown>, @Req() request: FastifyRequest) {
    if (Object.keys(query).length) throw new BadRequestException('Invalid query');
    return this.catalogService.sync(request.headers.host, authorizationHeaderOf(request), 'status');
  }
  @Post('sync')
  @Header('Cache-Control', 'private, no-store')
  start(@Body() body: unknown, @Query() query: Record<string, unknown>, @Req() request: FastifyRequest) {
    if (Object.keys(query).length || (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length))) throw new BadRequestException('Invalid request');
    assertCatalogCookieCsrf(request, this.tenants);
    return this.catalogService.sync(request.headers.host, authorizationHeaderOf(request), 'start');
  }
  @Post('sync/step')
  @Header('Cache-Control', 'private, no-store')
  step(@Body() body: unknown, @Query() query: Record<string, unknown>, @Req() request: FastifyRequest, @Res({ passthrough:true }) reply: FastifyReply) {
    if (Object.keys(query).length || (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length))) throw new BadRequestException('Invalid request');
    assertCatalogCookieCsrf(request, this.tenants);
    const controller = new AbortController();
    request.raw.once('aborted', () => controller.abort());
    reply.raw.once('close', () => { if (!reply.raw.writableEnded) controller.abort(); });
    return this.catalogService.sync(request.headers.host, authorizationHeaderOf(request), 'step', controller.signal);
  }
  @Post('sync/delegation')
  @Header('Cache-Control', 'private, no-store')
  delegation(@Body() body: unknown, @Query() query: Record<string, unknown>, @Req() request: FastifyRequest) {
    if (Object.keys(query).length) throw new BadRequestException('Invalid request');
    assertCatalogCookieCsrf(request, this.tenants);
    return this.catalogService.delegate(request.headers.host, authorizationHeaderOf(request), body);
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.catalogService.list(query, request.headers.host, 'product');
  }
  @Get('products')
  @Header('Cache-Control', 'private, no-store')
  products(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.catalogService.list(query, request.headers.host, 'product');
  }
  @Get('products/:handle')
  @Header('Cache-Control', 'private, no-store')
  product(@Param('handle') handle: string, @Query() query: unknown, @Req() request: FastifyRequest) {
    return this.catalogService.list(query, request.headers.host, 'product', handle);
  }
  @Get('collections')
  @Header('Cache-Control', 'private, no-store')
  collections(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.catalogService.list(query, request.headers.host, 'collection');
  }
  @Get('collections/:handle')
  @Header('Cache-Control', 'private, no-store')
  collection(@Param('handle') handle: string, @Query() query: unknown, @Req() request: FastifyRequest) {
    return this.catalogService.list(query, request.headers.host, 'collection', handle);
  }
}
