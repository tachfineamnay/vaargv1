import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AppError,
  buildStoreMarketConcurrencyKey,
  operatorCatalogSyncRequestSchema,
  uuidParamSchema,
  type ConsentState,
  type TenantContext,
  type VisitorSession,
  type WorkflowOrchestrationPort,
} from '@vaarg/shared';
import { issueCatalogDelegation, type StorefrontBinding } from '@vaarg/persistence';
import { assertSafeCookieMutation } from '../common/csrf.js';
import {
  correlationIdOf,
  merchantCredential,
  visitorCredential,
} from '../common/request-context.js';
import { MerchantAuthService } from '../identity/merchant-auth.service.js';
import { ConsentService } from '../privacy/consent.service.js';
import { VisitorSessionService } from '../sessions/visitor-session.service.js';
import { TenantContextResolver } from '../tenant/tenant-context.resolver.js';
import { ConversationService } from './conversation.service.js';
import { WORKFLOW_ORCHESTRATION_PORT } from './intelligence.tokens.js';

@Controller('v1')
export class ConversationController {
  constructor(
    @Inject(ConversationService) private readonly conversations: ConversationService,
    @Inject(TenantContextResolver) private readonly tenants: TenantContextResolver,
    @Inject('STOREFRONT_BINDINGS') private readonly bindings: StorefrontBinding[],
    @Inject(VisitorSessionService) private readonly sessions: VisitorSessionService,
    @Inject(ConsentService) private readonly consents: ConsentService,
    @Inject(MerchantAuthService) private readonly merchantAuth: MerchantAuthService,
    @Inject(WORKFLOW_ORCHESTRATION_PORT)
    private readonly workflowOrchestration: WorkflowOrchestrationPort,
  ) {}

  @Post('conversations')
  @Header('Cache-Control', 'private, no-store')
  async createConversation(@Body() body: unknown, @Req() request: FastifyRequest) {
    const { tenant, session, consent } = await this.resolveVisitor(request);
    this.assertVisitorCsrf(request, tenant);
    const reuseActive =
      body !== null &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      (body as Record<string, unknown>).reuseActive === true;
    const conversation = await this.conversations.createConversation(
      tenant,
      session,
      consent,
      { reuseActive },
    );
    return { conversation };
  }

  @Get('conversations/active')
  @Header('Cache-Control', 'private, no-store')
  async getActiveConversation(@Req() request: FastifyRequest) {
    const { tenant, session, consent } = await this.resolveVisitor(request);
    return this.conversations.getActiveSessionConversation(tenant, session, consent);
  }

  @Get('conversations/:conversationId')
  @Header('Cache-Control', 'private, no-store')
  async getConversation(
    @Param('conversationId') conversationId: string,
    @Query('limit') limitRaw: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const idParsed = uuidParamSchema.safeParse(conversationId);
    if (!idParsed.success) throw new BadRequestException('Invalid conversationId');
    const { tenant, session, consent } = await this.resolveVisitor(request);
    const limit = limitRaw ? Math.min(50, Math.max(1, Number.parseInt(limitRaw, 10) || 20)) : 20;
    return this.conversations.getHistory(tenant, session, consent, idParsed.data, limit);
  }

  @Post('conversations/:conversationId/messages')
  @Header('Cache-Control', 'private, no-store')
  async submitMessage(
    @Param('conversationId') conversationId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    const idParsed = uuidParamSchema.safeParse(conversationId);
    if (!idParsed.success) throw new BadRequestException('Invalid conversationId');
    const { tenant, session, consent } = await this.resolveVisitor(request);
    this.assertVisitorCsrf(request, tenant);
    const headerKey =
      typeof request.headers['idempotency-key'] === 'string'
        ? request.headers['idempotency-key']
        : undefined;
    return this.conversations.submitMessage(
      tenant,
      session,
      consent,
      idParsed.data,
      body,
      headerKey,
    );
  }

  @Post('conversations/:conversationId/runs')
  @Header('Cache-Control', 'private, no-store')
  async startRun(
    @Param('conversationId') conversationId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    const idParsed = uuidParamSchema.safeParse(conversationId);
    if (!idParsed.success) throw new BadRequestException('Invalid conversationId');
    const { tenant, session, consent } = await this.resolveVisitor(request);
    this.assertVisitorCsrf(request, tenant);
    const headerKey =
      typeof request.headers['idempotency-key'] === 'string'
        ? request.headers['idempotency-key']
        : undefined;
    return this.conversations.startRun(
      tenant,
      session,
      consent,
      idParsed.data,
      body,
      headerKey,
    );
  }

  @Get('agent/runs/:runId')
  @Header('Cache-Control', 'private, no-store')
  async getRunStatus(@Param('runId') runId: string, @Req() request: FastifyRequest) {
    const idParsed = uuidParamSchema.safeParse(runId);
    if (!idParsed.success) throw new BadRequestException('Invalid runId');
    const { tenant, session, consent } = await this.resolveVisitor(request);
    const run = await this.conversations.getRunStatus(tenant, session, consent, idParsed.data);
    return { run };
  }

  @Get('agent/runs/:runId/events')
  async streamRunEvents(
    @Param('runId') runId: string,
    @Query('afterSeq') afterSeqQuery: string | undefined,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const idParsed = uuidParamSchema.safeParse(runId);
    if (!idParsed.success) throw new BadRequestException('Invalid runId');
    const { tenant, session, consent } = await this.resolveVisitor(request);
    const lastEventId =
      typeof request.headers['last-event-id'] === 'string'
        ? request.headers['last-event-id']
        : undefined;

    const abortController = new AbortController();
    request.raw.once('close', () => abortController.abort());

    reply.hijack();
    await this.conversations.streamRunAgUiEvents({
      tenant,
      session,
      consent,
      runId: idParsed.data,
      lastEventId,
      afterSeqQuery,
      rawResponse: reply.raw,
      abortSignal: abortController.signal,
    });
  }

  @Post('agent/runs/:runId/cancel')
  @Header('Cache-Control', 'private, no-store')
  async cancelRun(@Param('runId') runId: string, @Req() request: FastifyRequest) {
    const idParsed = uuidParamSchema.safeParse(runId);
    if (!idParsed.success) throw new BadRequestException('Invalid runId');
    const { tenant, session } = await this.resolveVisitor(request);
    this.assertVisitorCsrf(request, tenant);
    const run = await this.conversations.cancelRun(tenant, session, idParsed.data);
    return { run };
  }

  @Get('agent/runs/:runId/result')
  @Header('Cache-Control', 'private, no-store')
  async getRunResult(
    @Param('runId') runId: string,
    @Query('publish') publishRaw: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    const idParsed = uuidParamSchema.safeParse(runId);
    if (!idParsed.success) throw new BadRequestException('Invalid runId');
    if (publishRaw !== undefined) {
      throw new BadRequestException(
        'MUTATING_GET_FORBIDDEN: Publishing run compositions requires POST /v1/agent/runs/:runId/publish',
      );
    }
    const { tenant, session, consent } = await this.resolveVisitor(request);
    return this.conversations.getValidatedResult(tenant, session, consent, idParsed.data);
  }

  @Post('agent/runs/:runId/publish')
  @Header('Cache-Control', 'private, no-store')
  async publishRunComposition(
    @Param('runId') runId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    const idParsed = uuidParamSchema.safeParse(runId);
    if (!idParsed.success) throw new BadRequestException('Invalid runId');
    const { tenant, session, consent } = await this.resolveVisitor(request);
    this.assertVisitorCsrf(request, tenant);
    const headerKey =
      typeof request.headers['idempotency-key'] === 'string'
        ? request.headers['idempotency-key']
        : undefined;
    return this.conversations.publishRunComposition(
      tenant,
      session,
      consent,
      idParsed.data,
      body,
      headerKey,
    );
  }

  @Post('agent/actions')
  @Header('Cache-Control', 'private, no-store')
  async executeControlledUiAction(@Body() body: unknown, @Req() request: FastifyRequest) {
    const { tenant, session, consent } = await this.resolveVisitor(request);
    this.assertVisitorCsrf(request, tenant);
    const headerKey =
      typeof request.headers['idempotency-key'] === 'string'
        ? request.headers['idempotency-key']
        : undefined;
    return this.conversations.executeUiAction(tenant, session, consent, body, headerKey);
  }

  // -------------------------------------------------------------------------
  // Authenticated Merchant Operator Workflow Submission (never public)
  // -------------------------------------------------------------------------

  @Post('workflows/catalog-sync')
  @Header('Cache-Control', 'private, no-store')
  async submitOperatorCatalogSync(@Body() body: unknown, @Req() request: FastifyRequest) {
    const tenant = await this.tenants.resolve(request.headers.host, correlationIdOf(request));
    const merchantCred = merchantCredential(request);
    if (!merchantCred) {
      throw new UnauthorizedException('Merchant authentication required');
    }
    if (merchantCred.via === 'cookie') {
      assertSafeCookieMutation(request, tenant.host);
    }
    const principal = await this.merchantAuth.resolveIdentity(tenant, merchantCred.token);
    if (!principal || !['owner', 'marketing'].includes(principal.role)) {
      throw new ForbiddenException('Merchant owner or marketing role required');
    }

    const parsed = operatorCatalogSyncRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.badRequest('Invalid catalog sync workflow request');
    }
    const delegationSecret = process.env.CATALOG_JOB_SIGNING_SECRET;
    if (!delegationSecret || delegationSecret.length < 32) {
      throw AppError.unavailable('CATALOG_JOB_SIGNING_SECRET is not configured');
    }

    const ticket = issueCatalogDelegation(
      {
        host: tenant.host,
        storeId: tenant.storeId,
        merchantUserId: principal.merchantUserId,
        sessionId: principal.sessionId,
        jobId: randomUUID(),
        action: parsed.data.initiateNewSweep ? 'start' : 'step',
        expiresAt: Date.now() + 14 * 60 * 1000,
      },
      delegationSecret,
    );

    const binding = this.bindings.find((entry) => entry.storeId === tenant.storeId);
    if (!binding) {
      throw AppError.unavailable('Storefront binding missing for active store');
    }

    const execution = await this.workflowOrchestration.submitWorkflow('vaarg.catalog.sync', {
      storeId: tenant.storeId,
      country: tenant.country,
      language: tenant.language,
      currency: tenant.currency,
      shopifyDomain: binding.shopifyDomain,
      tokenEnv: binding.tokenEnv,
      delegationTicket: ticket,
      idempotencyKey: parsed.data.idempotencyKey,
      correlationId: tenant.correlationId,
      concurrencyKey: buildStoreMarketConcurrencyKey(
        tenant.storeId,
        tenant.country,
        tenant.language,
      ),
      initiateNewSweep: parsed.data.initiateNewSweep,
      maxPages: parsed.data.maxPages,
    });

    return { execution };
  }

  @Get('workflows/:executionId')
  @Header('Cache-Control', 'private, no-store')
  async getOperatorWorkflowStatus(
    @Param('executionId') executionId: string,
    @Req() request: FastifyRequest,
  ) {
    const idParsed = uuidParamSchema.safeParse(executionId);
    if (!idParsed.success) throw new BadRequestException('Invalid executionId');
    const tenant = await this.tenants.resolve(request.headers.host, correlationIdOf(request));
    const merchantCred = merchantCredential(request);
    if (!merchantCred) throw new UnauthorizedException('Merchant authentication required');
    const principal = await this.merchantAuth.resolveIdentity(tenant, merchantCred.token);
    if (!principal) throw new UnauthorizedException('Merchant authentication required');

    const execution = await this.workflowOrchestration.getWorkflowExecution(
      tenant.storeId,
      idParsed.data,
    );
    if (!execution) {
      throw AppError.notFound('Workflow execution not found');
    }
    return { execution };
  }

  private async resolveVisitor(
    request: FastifyRequest,
  ): Promise<{ tenant: TenantContext; session: VisitorSession; consent: ConsentState }> {
    const tenant = await this.tenants.resolve(request.headers.host, correlationIdOf(request));
    request.vaarg = { ...request.vaarg, tenant };
    const credential = visitorCredential(request);
    if (!credential) throw new UnauthorizedException('Visitor session required');
    const session = await this.sessions.current(tenant, credential.token);
    if (!session || session.status !== 'active') {
      throw new UnauthorizedException('Visitor session required');
    }
    const consent = await this.consents.get(tenant, { kind: 'visitor', session });
    return { tenant, session, consent: consent.consents };
  }

  private assertVisitorCsrf(request: FastifyRequest, tenant: TenantContext): void {
    const credential = visitorCredential(request);
    if (credential?.via !== 'cookie') return;
    assertSafeCookieMutation(request, tenant.host);
  }
}
