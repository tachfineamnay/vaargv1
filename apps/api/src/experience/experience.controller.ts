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
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  adaptiveCompositionSchema,
  compileCompositionToA2UiMessages,
  experienceCompositionQuerySchema,
  experienceContextResponseSchema,
  experienceRecommendationsQuerySchema,
  experienceRefreshRequestSchema,
  experienceSearchQuerySchema,
  interactionIngestRequestSchema,
  interactionIngestResultSchema,
  searchResultSchema,
  type ConsentState,
  type TenantContext,
  type VisitorSession,
} from '@vaarg/shared';
import { ExperienceService } from './experience.service.js';
import { TenantContextResolver } from '../tenant/tenant-context.resolver.js';
import { VisitorSessionService } from '../sessions/visitor-session.service.js';
import { ConsentService } from '../privacy/consent.service.js';
import { assertSafeCookieMutation } from '../common/csrf.js';
import { correlationIdOf, visitorCredential } from '../common/request-context.js';

/**
 * Versioned /v1/experience endpoints (FL05 TASK 12): current experience
 * context, interaction ingestion, contextual search, recommendations,
 * current composition, adaptation refresh and exploration reset. Tenant,
 * session, authorization and consent boundaries are the existing FL02/FL04
 * ones — store and customer identity are resolved server-side only, and
 * cookie-authenticated mutations pass the shared CSRF Origin check.
 * All request/response bodies validate against shared Zod DTOs.
 */
@Controller('v1/experience')
export class ExperienceController {
  constructor(
    @Inject(ExperienceService) private readonly experience: ExperienceService,
    @Inject(TenantContextResolver) private readonly tenants: TenantContextResolver,
    @Inject(VisitorSessionService) private readonly sessions: VisitorSessionService,
    @Inject(ConsentService) private readonly consents: ConsentService,
  ) {}

  @Get('context')
  @Header('Cache-Control', 'private, no-store')
  async context(@Req() request: FastifyRequest) {
    const { tenant, session, consent } = await this.resolveViewer(request);
    const context = await this.experience.getContext(tenant, session, consent);
    return experienceContextResponseSchema.parse({ context });
  }

  @Post('events')
  @Header('Cache-Control', 'private, no-store')
  async events(@Body() body: unknown, @Req() request: FastifyRequest) {
    const { tenant, session, consent } = await this.resolveViewer(request);
    this.assertCookieCsrf(request, tenant);
    const parsed = interactionIngestRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid interaction events');
    const result = await this.experience.ingestEvents(tenant, session, consent, parsed.data);
    return interactionIngestResultSchema.parse(result);
  }

  @Get('catalog-search')
  @Header('Cache-Control', 'private, no-store')
  async catalogSearch(@Query() query: Record<string, unknown>, @Req() request: FastifyRequest) {
    const tenant = await this.tenants.resolve(request.headers.host, correlationIdOf(request));
    const mode = query.mode ?? 'lexical';
    if (mode !== 'lexical' && mode !== 'hybrid') throw new BadRequestException('Unsupported storefront retrieval mode');
    const parsed = experienceSearchQuerySchema.safeParse({ ...query, mode, currency: tenant.currency });
    if (!parsed.success) throw new BadRequestException('Invalid search query');
    return this.experience.storefrontSearch(tenant, parsed.data);
  }

  @Get('search')
  @Header('Cache-Control', 'private, no-store')
  async search(@Query() query: Record<string, unknown>, @Req() request: FastifyRequest) {
    const parsed = experienceSearchQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid search query');
    const { tenant, session, consent } = await this.resolveViewer(request);
    const result = await this.experience.contextualSearch(tenant, session, consent, parsed.data);
    return searchResultSchema.parse(result);
  }

  @Get('recommendations')
  @Header('Cache-Control', 'private, no-store')
  async recommendations(@Query() query: Record<string, unknown>, @Req() request: FastifyRequest) {
    const parsed = experienceRecommendationsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid recommendations query');
    const { tenant, session, consent } = await this.resolveViewer(request);
    return this.experience.recommendations(tenant, session, consent, {
      limit: parsed.data.limit,
      seedProductRef: parsed.data.seed,
    });
  }

  @Get('composition')
  @Header('Cache-Control', 'private, no-store')
  async composition(@Query() query: Record<string, unknown>, @Req() request: FastifyRequest) {
    const parsed = experienceCompositionQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid composition query');
    const { tenant, session, consent } = await this.resolveViewer(request);
    const comparisonRefs = parseCompareList(parsed.data.compare);
    const proposal = await this.experience.composition(tenant, session, consent, {
      comparisonRefs,
      publish: false,
    });
    return adaptiveCompositionSchema.parse(proposal);
  }

  @Get('a2ui')
  @Header('Cache-Control', 'private, no-store')
  async compositionA2Ui(@Query() query: Record<string, unknown>, @Req() request: FastifyRequest) {
    const parsed = experienceCompositionQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid composition query');
    const { tenant, session, consent } = await this.resolveViewer(request);
    const comparisonRefs = parseCompareList(parsed.data.compare);
    const proposal = await this.experience.composition(tenant, session, consent, {
      comparisonRefs,
      publish: false,
    });
    const compiled = compileCompositionToA2UiMessages({
      composition: proposal,
      surfaceKind: 'adaptive',
    });
    return {
      surfaceId: compiled.surfaceId,
      catalogId: compiled.catalogId,
      composition: proposal,
      messages: compiled.messages,
    };
  }

  @Post('refresh')
  @Header('Cache-Control', 'private, no-store')
  async refresh(@Body() body: unknown, @Req() request: FastifyRequest) {
    const { tenant, session, consent } = await this.resolveViewer(request);
    this.assertCookieCsrf(request, tenant);
    const parsed = experienceRefreshRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid refresh request');
    const composition = await this.experience.refresh(tenant, session, consent, {
      expectedContextVersion: parsed.data.expectedContextVersion,
      comparisonRefs: parseCompareList(parsed.data.compare?.join(',')),
    });
    return adaptiveCompositionSchema.parse(composition);
  }

  @Post('reset')
  @Header('Cache-Control', 'private, no-store')
  async reset(@Body() body: unknown, @Query() query: Record<string, unknown>, @Req() request: FastifyRequest) {
    if (Object.keys(query ?? {}).length || (body !== undefined && body !== null && typeof body === 'object' && Object.keys(body as object).length)) {
      throw new BadRequestException('Invalid request');
    }
    const { tenant, session, consent } = await this.resolveViewer(request);
    this.assertCookieCsrf(request, tenant);
    const result = await this.experience.resetExploration(tenant, session, consent);
    return interactionIngestResultSchema.parse(result);
  }

  // -------------------------------------------------------------------------

  /** Tenant + session + consent resolved entirely server-side. */
  private async resolveViewer(
    request: FastifyRequest,
  ): Promise<{ tenant: TenantContext; session: VisitorSession; consent: ConsentState }> {
    const tenant = await this.tenants.resolve(request.headers.host, correlationIdOf(request));
    request.vaarg = { ...request.vaarg, tenant };
    const credential = visitorCredential(request);
    if (!credential) throw new UnauthorizedException('Visitor session required');
    const session = await this.sessions.current(tenant, credential.token);
    if (!session || session.status !== 'active') throw new UnauthorizedException('Visitor session required');
    const consent = await this.consents.get(tenant, { kind: 'visitor', session });
    return { tenant, session, consent: consent.consents };
  }

  private assertCookieCsrf(request: FastifyRequest, tenant: TenantContext): void {
    const credential = visitorCredential(request);
    if (credential?.via !== 'cookie') return;
    assertSafeCookieMutation(request, tenant.host);
  }
}

function parseCompareList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const refs = raw
    .split(',')
    .map((ref) => ref.trim())
    .filter((ref) => ref.startsWith('gid://shopify/Product/'))
    .slice(0, 4);
  return refs.length >= 2 ? refs : undefined;
}
