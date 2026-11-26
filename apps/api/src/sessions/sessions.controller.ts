import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  createSessionRequestSchema,
  sessionEnvelopeSchema,
  type SessionEnvelope,
  type VisitorSession,
} from '@vaarg/shared';
import { VisitorSessionService } from './visitor-session.service.js';
import { TenantContextResolver } from '../tenant/tenant-context.resolver.js';
import { VISITOR_SESSION_COOKIE, clearSessionCookie, setSessionCookie } from '../common/cookies.js';
import { assertSafeCookieMutation } from '../common/csrf.js';
import { correlationIdOf, visitorCredential } from '../common/request-context.js';

/**
 * Visitor session HTTP lifecycle (PRD §10 POST /sessions, FL02 TASK 4).
 * Opaque tokens in HttpOnly host-only cookies (or bearer for server-side
 * clients); the tenant is established from the Host header only. Session
 * operations never assign a customer identity.
 */
@Controller('v1/sessions')
export class SessionsController {
  constructor(
    @Inject(VisitorSessionService) private readonly sessions: VisitorSessionService,
    @Inject(TenantContextResolver) private readonly tenants: TenantContextResolver,
  ) {}

  @Post()
  @Header('Cache-Control', 'private, no-store')
  async create(
    @Body() body: unknown,
    @Query() query: Record<string, unknown>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionEnvelope> {
    if (Object.keys(query).length) throw new BadRequestException('Invalid request');
    const parsed = createSessionRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid session request');
    const tenant = await this.tenants.resolve(
      request.headers.host,
      correlationIdOf(request),
    );
    request.vaarg = { ...request.vaarg, tenant };
    // Idempotent bootstrap: a still-valid session cookie keeps its session.
    const existing = visitorCredential(request);
    if (existing) {
      const session = await this.sessions.current(tenant, existing.token);
      if (session) {
        this.writeCookie(reply, existing.token, session);
        return sessionEnvelopeSchema.parse({ session, tenant });
      }
    }
    const issued = await this.sessions.create(tenant, parsed.data);
    this.writeCookie(reply, issued.token, issued.session);
    return sessionEnvelopeSchema.parse({ session: issued.session, tenant });
  }

  @Get('current')
  @Header('Cache-Control', 'private, no-store')
  async current(
    @Query() query: Record<string, unknown>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionEnvelope> {
    if (Object.keys(query).length) throw new BadRequestException('Invalid request');
    const tenant = await this.tenants.resolve(
      request.headers.host,
      correlationIdOf(request),
    );
    request.vaarg = { ...request.vaarg, tenant };
    const credential = visitorCredential(request);
    if (!credential) throw new UnauthorizedException();
    const session = await this.sessions.current(tenant, credential.token);
    if (!session) throw new UnauthorizedException();
    if (credential.via === 'cookie') {
      this.writeCookie(reply, credential.token, session);
    }
    return sessionEnvelopeSchema.parse({ session, tenant });
  }

  @Post('rotate')
  @Header('Cache-Control', 'private, no-store')
  async rotate(
    @Query() query: Record<string, unknown>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionEnvelope> {
    if (Object.keys(query).length) throw new BadRequestException('Invalid request');
    const tenant = await this.tenants.resolve(
      request.headers.host,
      correlationIdOf(request),
    );
    request.vaarg = { ...request.vaarg, tenant };
    const credential = visitorCredential(request);
    if (!credential) throw new UnauthorizedException();
    if (credential.via === 'cookie') assertSafeCookieMutation(request, tenant.host);
    const rotated = await this.sessions.rotate(tenant, credential.token);
    this.writeCookie(reply, rotated.token, rotated.session);
    return sessionEnvelopeSchema.parse({ session: rotated.session, tenant });
  }

  @Delete('current')
  @Header('Cache-Control', 'private, no-store')
  async revoke(
    @Query() query: Record<string, unknown>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ status: 'revoked' }> {
    if (Object.keys(query).length) throw new BadRequestException('Invalid request');
    const tenant = await this.tenants.resolve(
      request.headers.host,
      correlationIdOf(request),
    );
    request.vaarg = { ...request.vaarg, tenant };
    const credential = visitorCredential(request);
    if (!credential) throw new UnauthorizedException();
    if (credential.via === 'cookie') assertSafeCookieMutation(request, tenant.host);
    await this.sessions.revoke(tenant, credential.token);
    clearSessionCookie(reply, VISITOR_SESSION_COOKIE);
    return { status: 'revoked' };
  }

  private writeCookie(reply: FastifyReply, token: string, session: VisitorSession): void {
    const ttlMs = new Date(session.expiresAt).getTime() - Date.now();
    setSessionCookie(reply, VISITOR_SESSION_COOKIE, token, Math.max(1000, ttlMs));
  }

}
