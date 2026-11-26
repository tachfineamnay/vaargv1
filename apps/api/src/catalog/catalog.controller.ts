import { BadRequestException, Body, Controller, Get, Header, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CatalogService } from './catalog.service.js';
import { authorizationHeaderOf } from '../common/request-context.js';

@Controller('catalog')
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalogService: CatalogService) {}

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
    return this.catalogService.sync(request.headers.host, authorizationHeaderOf(request), 'start');
  }
  @Post('sync/step')
  @Header('Cache-Control', 'private, no-store')
  step(@Body() body: unknown, @Query() query: Record<string, unknown>, @Req() request: FastifyRequest, @Res({ passthrough:true }) reply: FastifyReply) {
    if (Object.keys(query).length || (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length))) throw new BadRequestException('Invalid request');
    const controller = new AbortController();
    request.raw.once('aborted', () => controller.abort());
    reply.raw.once('close', () => { if (!reply.raw.writableEnded) controller.abort(); });
    return this.catalogService.sync(request.headers.host, authorizationHeaderOf(request), 'step', controller.signal);
  }
  @Post('sync/delegation')
  @Header('Cache-Control', 'private, no-store')
  delegation(@Body() body: unknown, @Query() query: Record<string, unknown>, @Req() request: FastifyRequest) {
    if (Object.keys(query).length) throw new BadRequestException('Invalid request');
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
