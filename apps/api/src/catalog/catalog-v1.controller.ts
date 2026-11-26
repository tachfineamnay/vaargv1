import { BadRequestException, Body, Controller, Get, Header, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CatalogService } from './catalog.service.js';
import { assertCatalogCookieCsrf } from './catalog.controller.js';
import { authorizationHeaderOf, correlationIdOf } from '../common/request-context.js';
import { TenantContextResolver } from '../tenant/tenant-context.resolver.js';

/**
 * Versioned /v1/catalog application API (FL03): curated read endpoints for
 * storefront navigation, discovery, comparison and future agents, plus
 * authorized merchant synchronization commands with the same identity engine
 * and CSRF rules as the legacy boundary. Responses are shared Zod DTOs —
 * never raw database entities, provider configuration or secrets.
 */
@Controller('v1/catalog')
export class CatalogV1Controller {
  constructor(
    @Inject(CatalogService) private readonly catalogService: CatalogService,
    @Inject(TenantContextResolver) private readonly tenants: TenantContextResolver,
  ) {}

  @Get('products')
  @Header('Cache-Control', 'private, no-store')
  products(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.catalogService.listProductsV1(request.headers.host, correlationIdOf(request), query);
  }

  @Get('products/:ref')
  @Header('Cache-Control', 'private, no-store')
  product(@Param('ref') ref: string, @Query() query: unknown, @Req() request: FastifyRequest) {
    if (Object.keys(query ?? {}).length) throw new BadRequestException('Invalid query');
    return this.catalogService.getProductV1(request.headers.host, correlationIdOf(request), ref);
  }

  @Get('products/:ref/related')
  @Header('Cache-Control', 'private, no-store')
  related(@Param('ref') ref: string, @Query() query: unknown, @Req() request: FastifyRequest) {
    return this.catalogService.relatedV1(request.headers.host, correlationIdOf(request), ref, query);
  }

  @Get('products/:ref/compatible-options')
  @Header('Cache-Control', 'private, no-store')
  compatibleOptions(@Param('ref') ref: string, @Query() query: unknown, @Req() request: FastifyRequest) {
    if (Object.keys(query ?? {}).length) throw new BadRequestException('Invalid query');
    return this.catalogService.compatibleOptionsV1(request.headers.host, correlationIdOf(request), ref);
  }

  @Get('variants/:ref')
  @Header('Cache-Control', 'private, no-store')
  variant(@Param('ref') ref: string, @Query() query: unknown, @Req() request: FastifyRequest) {
    if (Object.keys(query ?? {}).length) throw new BadRequestException('Invalid query');
    return this.catalogService.getVariantV1(request.headers.host, correlationIdOf(request), ref);
  }

  @Get('collections')
  @Header('Cache-Control', 'private, no-store')
  collections(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.catalogService.listCollectionsV1(request.headers.host, correlationIdOf(request), query);
  }

  @Get('collections/:ref')
  @Header('Cache-Control', 'private, no-store')
  collection(@Param('ref') ref: string, @Query() query: unknown, @Req() request: FastifyRequest) {
    if (Object.keys(query ?? {}).length) throw new BadRequestException('Invalid query');
    return this.catalogService.getCollectionV1(request.headers.host, correlationIdOf(request), ref);
  }

  @Get('collections/:ref/products')
  @Header('Cache-Control', 'private, no-store')
  collectionProducts(@Param('ref') ref: string, @Query() query: unknown, @Req() request: FastifyRequest) {
    return this.catalogService.listCollectionProductsV1(request.headers.host, correlationIdOf(request), ref, query);
  }

  @Get('filters')
  @Header('Cache-Control', 'private, no-store')
  filters(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.catalogService.listFiltersV1(request.headers.host, correlationIdOf(request), query);
  }

  @Get('compare')
  @Header('Cache-Control', 'private, no-store')
  compare(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.catalogService.compareV1(request.headers.host, correlationIdOf(request), query);
  }

  @Get('search')
  @Header('Cache-Control', 'private, no-store')
  search(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.catalogService.searchV1(request.headers.host, correlationIdOf(request), query);
  }

  @Get('status')
  @Header('Cache-Control', 'private, no-store')
  status(@Req() request: FastifyRequest) {
    return this.catalogService.statusV1(request.headers.host, correlationIdOf(request));
  }

  @Get('sync')
  @Header('Cache-Control', 'private, no-store')
  syncStatus(@Query() query: Record<string, unknown>, @Req() request: FastifyRequest) {
    if (Object.keys(query).length) throw new BadRequestException('Invalid query');
    return this.catalogService.sync(request.headers.host, authorizationHeaderOf(request), 'status');
  }
  @Post('sync')
  @Header('Cache-Control', 'private, no-store')
  syncStart(@Body() body: unknown, @Query() query: Record<string, unknown>, @Req() request: FastifyRequest) {
    if (Object.keys(query).length || (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length))) throw new BadRequestException('Invalid request');
    assertCatalogCookieCsrf(request, this.tenants);
    return this.catalogService.sync(request.headers.host, authorizationHeaderOf(request), 'start');
  }
  @Post('sync/step')
  @Header('Cache-Control', 'private, no-store')
  syncStep(@Body() body: unknown, @Query() query: Record<string, unknown>, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    if (Object.keys(query).length || (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length))) throw new BadRequestException('Invalid request');
    assertCatalogCookieCsrf(request, this.tenants);
    const controller = new AbortController();
    request.raw.once('aborted', () => controller.abort());
    reply.raw.once('close', () => { if (!reply.raw.writableEnded) controller.abort(); });
    return this.catalogService.sync(request.headers.host, authorizationHeaderOf(request), 'step', controller.signal);
  }
  @Post('sync/delegation')
  @Header('Cache-Control', 'private, no-store')
  syncDelegation(@Body() body: unknown, @Query() query: Record<string, unknown>, @Req() request: FastifyRequest) {
    if (Object.keys(query).length) throw new BadRequestException('Invalid request');
    assertCatalogCookieCsrf(request, this.tenants);
    return this.catalogService.delegate(request.headers.host, authorizationHeaderOf(request), body);
  }
}
