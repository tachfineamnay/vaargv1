import { Inject, Injectable } from '@nestjs/common';
import {
  AppError,
  ROLE_DEFINITIONS,
  adaptiveCompositionSchema,
  isPurposeGranted,
  isTerminalAgentRunStatus,
  masterOutputSchema,
  startConversationRunInputSchema,
  structuredMessagePayloadSchema,
  submitMessageInputSchema,
  validatedAgentRunResultSchema,
  withinCompositionLimits,
  type AdaptiveComposition,
  type AgentHistoryTurn,
  type AgentPort,
  type AgentRunRecord,
  type ConsentState,
  type Conversation,
  type ConversationMessage,
  type ConversationSummary,
  type StructuredMessagePayload,
  type TenantContext,
  type ValidatedAgentRunResult,
  type VisitorSession,
} from '@vaarg/shared';
import {
  ProviderPolicyRegistry,
  appendUserConversationMessage,
  bindExternalHermesRunId,
  cancelAgentRunTree,
  createConversationRecord,
  createMasterAgentRunRecord,
  finalizeMasterRunAndAcceptMessage,
  getConversationWithBoundedHistory,
  getOwnedAgentRun,
  issueRunBridgeTicket,
  listActionProposalsForRun,
  reconcileModelCallUsage,
  reserveModelCallBudget,
  supersedeActiveConversationRuns,
  syncRoleDefinitionsAndProviderPolicies,
  updateActionProposalResolution,
} from '@vaarg/persistence';
import { DatabaseClient } from '../infra/database-client.js';
import { ExperienceService } from '../experience/experience.service.js';
import {
  AGENT_PORT,
  HERMES_BRIDGE_SECRET_TOKEN,
  PROVIDER_POLICY_REGISTRY,
} from './intelligence.tokens.js';

function tryParseStructuredMasterOutput(rawText: string): {
  content: string;
  structured: StructuredMessagePayload;
  validatedOutput: Record<string, unknown>;
} {
  const trimmed = rawText.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsedJson = JSON.parse(trimmed) as unknown;
      const masterParsed = masterOutputSchema.safeParse(parsedJson);
      if (masterParsed.success) {
        return {
          content: masterParsed.data.responseMessage,
          structured: structuredMessagePayloadSchema.parse({
            groundedProductRefs: masterParsed.data.groundedProductRefs,
            groundedVariantRefs: masterParsed.data.groundedVariantRefs,
            proposalIds: masterParsed.data.proposalIds,
            clarificationPrompt: masterParsed.data.clarificationPrompt,
            confirmationRequired: masterParsed.data.confirmationRequired,
            experienceRevision: null,
          }),
          validatedOutput: masterParsed.data as unknown as Record<string, unknown>,
        };
      }
    } catch {
      // Treat as natural-language Master response
    }
  }
  return {
    content: trimmed,
    structured: structuredMessagePayloadSchema.parse({}),
    validatedOutput: { responseMessage: trimmed },
  };
}

@Injectable()
export class ConversationService {
  constructor(
    @Inject(DatabaseClient) private readonly database: DatabaseClient,
    @Inject(ExperienceService) private readonly experience: ExperienceService,
    @Inject(AGENT_PORT) private readonly agentPort: AgentPort,
    @Inject(PROVIDER_POLICY_REGISTRY) private readonly providerPolicies: ProviderPolicyRegistry,
    @Inject(HERMES_BRIDGE_SECRET_TOKEN) private readonly bridgeSecret: string | undefined,
  ) {}

  async createConversation(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
  ): Promise<Conversation> {
    const pool = this.database.getPool();
    await syncRoleDefinitionsAndProviderPolicies(
      pool,
      tenant.storeId,
      this.providerPolicies.listPolicies(),
    );
    const context = await this.experience.getContext(tenant, session, consent);
    return createConversationRecord(pool, {
      storeId: tenant.storeId,
      sessionId: session.sessionId,
      contextVersion: context.contextVersion,
    });
  }

  async getHistory(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
    conversationId: string,
    maxMessages = 20,
  ): Promise<{
    conversation: Conversation;
    messages: ConversationMessage[];
    summary: ConversationSummary | null;
  }> {
    return getConversationWithBoundedHistory(this.database.getPool(), {
      storeId: tenant.storeId,
      sessionId: session.sessionId,
      conversationId,
      personalizationGranted: isPurposeGranted(consent, 'personalization'),
      maxMessages,
    });
  }

  async submitMessage(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
    conversationId: string,
    rawInput: unknown,
    headerIdempotencyKey?: string,
  ): Promise<{ message: ConversationMessage; contextVersion: number; replayed: boolean }> {
    const parsed = submitMessageInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw AppError.badRequest(
        `INVALID_MESSAGE_INPUT: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      );
    }
    const idempotencyKey = parsed.data.idempotencyKey ?? headerIdempotencyKey;
    const pool = this.database.getPool();

    // Supersede any in-flight runs on this conversation before accepting a newer visitor turn
    const superseded = await supersedeActiveConversationRuns(pool, {
      storeId: tenant.storeId,
      conversationId,
    });
    await this.stopSupersededExternalRuns(superseded);

    const liveContext = await this.experience.getContext(tenant, session, consent);
    const appended = await appendUserConversationMessage(pool, {
      storeId: tenant.storeId,
      sessionId: session.sessionId,
      conversationId,
      content: parsed.data.content,
      contextVersion: liveContext.contextVersion,
      correlationId: tenant.correlationId,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });

    if (!appended.replayed) {
      const updatedContext = await this.experience.recordConversationMessageEvent({
        storeId: tenant.storeId,
        country: tenant.country,
        language: tenant.language,
        currency: tenant.currency,
        sessionId: session.sessionId,
        conversationId,
        messageId: appended.message.messageId,
      });
      return {
        message: appended.message,
        contextVersion: updatedContext.contextVersion,
        replayed: false,
      };
    }

    return {
      message: appended.message,
      contextVersion: liveContext.contextVersion,
      replayed: true,
    };
  }

  async startRun(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
    conversationId: string,
    rawInput: unknown,
    headerIdempotencyKey?: string,
  ): Promise<{
    run: AgentRunRecord;
    delegationStatus: 'ENABLED' | 'DISABLED_CAPABILITY_LIMITATION';
    delegationLimitationReason: string | null;
  }> {
    const parsed = startConversationRunInputSchema.safeParse(rawInput ?? {});
    if (!parsed.success) {
      throw AppError.badRequest(
        `INVALID_RUN_INPUT: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      );
    }
    const input = parsed.data;
    const idempotencyKey = input.idempotencyKey ?? headerIdempotencyKey;

    let triggerMessageId = input.triggerMessageId ?? null;
    if (input.message) {
      const msgResult = await this.submitMessage(
        tenant,
        session,
        consent,
        conversationId,
        {
          content: input.message,
          ...(idempotencyKey ? { idempotencyKey: `${idempotencyKey}:msg` } : {}),
        },
      );
      triggerMessageId = msgResult.message.messageId;
    }

    // 1. Validate direct provider + model policy BEFORE starting run (never simulate or fall back)
    const modelPolicy = this.providerPolicies.resolveForRole(
      'master',
      input.provider,
      input.model,
    );

    // 2. Inspect Hermes runtime capabilities & confinement
    const runtimeCaps = await this.agentPort.runtimeCapabilities();
    if (runtimeCaps.status === 'NOT_CONFIGURED') {
      throw AppError.unavailable(
        'AGENT_RUNTIME_NOT_CONFIGURED: Hermes runtime is not configured; conventional storefront and deterministic adaptive experience remain available',
      );
    }
    if (runtimeCaps.status === 'UNSAFE_CONFINEMENT') {
      throw AppError.forbidden(
        `UNSAFE_RUNTIME_CONFINEMENT: ${runtimeCaps.delegationLimitationReason ?? 'Forbidden tools detected on Hermes runtime'}`,
      );
    }
    if (runtimeCaps.status !== 'AVAILABLE' || !runtimeCaps.runSubmission) {
      throw AppError.unavailable(
        `AGENT_RUNTIME_UNAVAILABLE: ${runtimeCaps.delegationLimitationReason ?? 'Hermes runtime unavailable'}`,
      );
    }

    const pool = this.database.getPool();
    const personalizationGranted = isPurposeGranted(consent, 'personalization');
    const historyBundle = await getConversationWithBoundedHistory(pool, {
      storeId: tenant.storeId,
      sessionId: session.sessionId,
      conversationId,
      personalizationGranted,
      maxMessages: 16,
    });

    const latestUserMessage = [...historyBundle.messages]
      .reverse()
      .find((m) => m.role === 'user');
    if (!latestUserMessage) {
      throw AppError.badRequest('NO_USER_MESSAGE: Submit a visitor message before starting an agent run');
    }
    if (!triggerMessageId) {
      triggerMessageId = latestUserMessage.messageId;
    }

    const liveContext = await this.experience.getContext(tenant, session, consent);
    const masterDef = ROLE_DEFINITIONS.master;
    const delegationEnabled =
      masterDef.delegationEnabled &&
      runtimeCaps.delegationSupported &&
      runtimeCaps.preventiveHooksVerified;
    const delegationStatus: 'ENABLED' | 'DISABLED_CAPABILITY_LIMITATION' = delegationEnabled
      ? 'ENABLED'
      : 'DISABLED_CAPABILITY_LIMITATION';

    const effectiveBudgetPolicy = {
      ...masterDef.defaultBudgetPolicy,
      delegationEnabled,
      maxConcurrentChildren: delegationEnabled
        ? masterDef.defaultBudgetPolicy.maxConcurrentChildren
        : 0,
      maxDelegationDepth: delegationEnabled ? 1 : 0,
      maxTotalChildren: delegationEnabled ? masterDef.defaultBudgetPolicy.maxTotalChildren : 0,
    };

    const created = await createMasterAgentRunRecord(pool, {
      storeId: tenant.storeId,
      sessionId: session.sessionId,
      conversationId,
      triggerMessageId,
      provider: modelPolicy.provider,
      model: modelPolicy.model,
      promptVersion: masterDef.version,
      budgetPolicy: effectiveBudgetPolicy,
      contextVersion: liveContext.contextVersion,
      correlationId: tenant.correlationId,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      payloadForHash: {
        conversationId,
        triggerMessageId,
        provider: modelPolicy.provider,
        model: modelPolicy.model,
      },
    });

    if (created.replayed && created.run.hermesRunId) {
      return {
        run: created.run,
        delegationStatus,
        delegationLimitationReason: runtimeCaps.delegationLimitationReason,
      };
    }

    // Supersede any older active runs on this conversation excluding our newly created run
    const superseded = await supersedeActiveConversationRuns(pool, {
      storeId: tenant.storeId,
      conversationId,
      excludeRunId: created.run.runId,
    });
    await this.stopSupersededExternalRuns(superseded);

    // Preventive initial reservation before submitting to Hermes
    const initialEstimate = this.providerPolicies.estimateReservationCostUsd(
      modelPolicy,
      Math.max(512, Math.ceil(latestUserMessage.content.length / 3) + 1024),
      modelPolicy.maxOutputTokens,
    );
    const { reservationId } = await reserveModelCallBudget(pool, {
      storeId: tenant.storeId,
      rootRunId: created.run.runId,
      runId: created.run.runId,
      provider: modelPolicy.provider,
      model: modelPolicy.model,
      reservedTokens: initialEstimate.reservedTokens,
      reservedCostUsd: initialEstimate.reservedCostUsd,
    });

    const bridgeTicket = issueRunBridgeTicket(this.bridgeSecret ?? '', {
      storeId: tenant.storeId,
      rootRunId: created.run.runId,
      conversationId,
      sessionId: session.sessionId,
      preventiveHooksVerified: runtimeCaps.preventiveHooksVerified,
      ttlMs: effectiveBudgetPolicy.maxDurationMs,
    });

    const priorTurns: AgentHistoryTurn[] = historyBundle.messages
      .filter((m) => m.messageId !== latestUserMessage.messageId)
      .map((m) => ({ role: m.role, content: m.content }));

    const instructions = this.buildMasterInstructions({
      tenant,
      contextVersion: liveContext.contextVersion,
      personalizationGranted,
      delegationEnabled,
      summary: historyBundle.summary,
    });

    const handle = await this.agentPort.startRun({
      internalRunId: created.run.runId,
      storeId: tenant.storeId,
      sessionId: session.sessionId,
      conversationId,
      hermesSessionId: historyBundle.conversation.hermesSessionId,
      hermesSessionKey: `vaarg:${tenant.storeId}:${session.sessionId}:${conversationId}`,
      idempotencyKey: idempotencyKey ?? `vaarg-run-${created.run.runId}`,
      correlationId: tenant.correlationId,
      input: latestUserMessage.content,
      instructions,
      conversationHistory: priorTurns,
      provider: modelPolicy.provider,
      model: modelPolicy.model,
      maxOutputTokens: modelPolicy.maxOutputTokens,
      timeoutMs: modelPolicy.timeoutMs,
      bridgeMetadata: {
        'X-Vaarg-Bridge-Ticket': bridgeTicket,
        'X-Vaarg-Initial-Reservation': reservationId,
      },
    });

    const bound = await bindExternalHermesRunId(pool, {
      storeId: tenant.storeId,
      runId: created.run.runId,
      hermesRunId: handle.externalRunId,
      status: handle.status,
    });

    return {
      run: bound,
      delegationStatus,
      delegationLimitationReason: runtimeCaps.delegationLimitationReason,
    };
  }

  async getRunStatus(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
    runId: string,
    publishIfCompleted = false,
  ): Promise<AgentRunRecord> {
    const synced = await this.synchronizeActiveRun(
      tenant,
      session,
      consent,
      runId,
      publishIfCompleted,
    );
    return synced.run;
  }

  async cancelRun(
    tenant: TenantContext,
    session: VisitorSession,
    runId: string,
  ): Promise<AgentRunRecord> {
    const cancelled = await cancelAgentRunTree(this.database.getPool(), {
      storeId: tenant.storeId,
      sessionId: session.sessionId,
      runId,
      reason: 'visitor_cancelled',
    });

    if (cancelled.hermesRunId) {
      await this.agentPort
        .cancelRun({
          internalRunId: cancelled.rootRun.runId,
          externalRunId: cancelled.hermesRunId,
        })
        .catch(() => undefined);
    }
    return cancelled.rootRun;
  }

  async getValidatedResult(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
    runId: string,
    publishComposition = false,
  ): Promise<ValidatedAgentRunResult> {
    const synced = await this.synchronizeActiveRun(
      tenant,
      session,
      consent,
      runId,
      publishComposition,
    );
    const pool = this.database.getPool();
    const proposals = await listActionProposalsForRun(pool, tenant.storeId, synced.run.runId);

    let compositionProposal: AdaptiveComposition | null = null;
    const latestCompProposal = [...proposals]
      .reverse()
      .find(
        (p) =>
          p.proposalType === 'experience_composition' &&
          (p.status === 'proposed' || p.status === 'applied'),
      );
    if (latestCompProposal) {
      const parsedComp = adaptiveCompositionSchema.safeParse(latestCompProposal.payload);
      if (parsedComp.success && withinCompositionLimits(parsedComp.data)) {
        compositionProposal = parsedComp.data;
      }
    }

    const runtimeCaps = await this.agentPort.runtimeCapabilities();
    const delegationStatus = runtimeCaps.delegationSupported
      ? 'ENABLED'
      : 'DISABLED_CAPABILITY_LIMITATION';

    return validatedAgentRunResultSchema.parse({
      runId: synced.run.runId,
      conversationId: synced.run.conversationId,
      status: synced.run.status,
      contextVersion: synced.run.contextVersion,
      stale: synced.staleBlocked,
      assistantMessage: synced.assistantMessage,
      proposals,
      compositionProposal: synced.staleBlocked ? null : compositionProposal,
      criteriaUpdated: null,
      consentSnapshot: consent,
      delegationStatus,
      errorCode: synced.run.errorCode,
      errorMessage: synced.run.errorMessage,
    });
  }

  private async synchronizeActiveRun(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
    runId: string,
    publishComposition: boolean,
  ): Promise<{
    run: AgentRunRecord;
    assistantMessage: ConversationMessage | null;
    staleBlocked: boolean;
  }> {
    const pool = this.database.getPool();
    const current = await getOwnedAgentRun(pool, {
      storeId: tenant.storeId,
      sessionId: session.sessionId,
      runId,
    });
    const liveContext = await this.experience.getContext(tenant, session, consent);

    if (isTerminalAgentRunStatus(current.status) || !current.hermesRunId) {
      const history = await getConversationWithBoundedHistory(pool, {
        storeId: tenant.storeId,
        sessionId: session.sessionId,
        conversationId: current.conversationId,
        personalizationGranted: isPurposeGranted(consent, 'personalization'),
        maxMessages: 20,
      });
      const assistantMessage =
        history.messages.find((m) => m.runId === current.runId && m.role === 'assistant') ?? null;
      return {
        run: current,
        assistantMessage,
        staleBlocked:
          current.status === 'superseded' || liveContext.contextVersion > current.contextVersion,
      };
    }

    const snapshot = await this.agentPort.getRun({
      internalRunId: current.runId,
      externalRunId: current.hermesRunId,
    });

    const expectedPolicy = this.providerPolicies.resolveForRole(
      'master',
      current.provider,
      current.model,
    );
    this.providerPolicies.verifyServedRuntimeRoute(expectedPolicy, snapshot.runtime);

    if (!isTerminalAgentRunStatus(snapshot.status)) {
      return {
        run: current,
        assistantMessage: null,
        staleBlocked: liveContext.contextVersion > current.contextVersion,
      };
    }

    if (snapshot.usage && current.budget.consumedModelCalls === 0) {
      const measuredCost = this.providerPolicies.computeMeasuredCostUsd(expectedPolicy, {
        inputTokens: snapshot.usage.inputTokens,
        outputTokens: snapshot.usage.outputTokens,
        cacheReadTokens: snapshot.usage.cacheReadTokens,
        cacheWriteTokens: snapshot.usage.cacheWriteTokens,
      });
      await reconcileModelCallUsage(pool, {
        storeId: tenant.storeId,
        rootRunId: current.rootRunId,
        runId: current.runId,
        provider: expectedPolicy.provider,
        model: expectedPolicy.model,
        inputTokens: snapshot.usage.inputTokens,
        outputTokens: snapshot.usage.outputTokens,
        cacheReadTokens: snapshot.usage.cacheReadTokens,
        cacheWriteTokens: snapshot.usage.cacheWriteTokens,
        measuredCostUsd: measuredCost,
        ...(snapshot.runtime?.routeSource ? { routeSource: snapshot.runtime.routeSource } : {}),
      });
    }

    const parsedOutput =
      snapshot.status === 'completed' && snapshot.output
        ? tryParseStructuredMasterOutput(snapshot.output)
        : null;

    let publishedRevision: number | null = null;
    if (
      publishComposition &&
      snapshot.status === 'completed' &&
      liveContext.contextVersion === current.contextVersion
    ) {
      const proposals = await listActionProposalsForRun(pool, tenant.storeId, current.runId);
      const compProp = [...proposals]
        .reverse()
        .find((p) => p.proposalType === 'experience_composition' && p.status === 'proposed');
      if (compProp) {
        const compParsed = adaptiveCompositionSchema.safeParse(compProp.payload);
        if (compParsed.success) {
          publishedRevision = await this.experience.tryPublishCompositionProposal({
            storeId: tenant.storeId,
            country: tenant.country,
            language: tenant.language,
            currency: tenant.currency,
            sessionId: session.sessionId,
            expectedContextVersion: current.contextVersion,
            composition: compParsed.data,
          });
          if (publishedRevision !== null) {
            await updateActionProposalResolution(pool, {
              storeId: tenant.storeId,
              proposalId: compProp.proposalId,
              status: 'applied',
              appliedExperienceRevision: publishedRevision,
            });
          }
        }
      }
    }

    const terminalStatus = snapshot.status as Extract<
      typeof snapshot.status,
      'completed' | 'failed' | 'cancelled' | 'unknown'
    >;

    return finalizeMasterRunAndAcceptMessage(pool, {
      storeId: tenant.storeId,
      runId: current.runId,
      status: terminalStatus,
      assistantContent: parsedOutput?.content ?? null,
      ...(parsedOutput
        ? {
            structuredPayload: {
              ...parsedOutput.structured,
              experienceRevision: publishedRevision,
            },
            validatedOutput: parsedOutput.validatedOutput,
          }
        : {}),
      redactedTrace: {
        externalRunId: snapshot.externalRunId,
        turnExitReason: snapshot.turnExitReason,
        partial: snapshot.partial,
        runtimeProvider: snapshot.runtime?.provider ?? current.provider,
        runtimeModel: snapshot.runtime?.model ?? current.model,
      },
      publishedExperienceRevision: publishedRevision,
      errorCode: snapshot.status === 'failed' ? 'HERMES_RUN_FAILED' : null,
      errorMessage: snapshot.error,
      liveSessionContextVersion: liveContext.contextVersion,
    });
  }

  private async stopSupersededExternalRuns(
    superseded: Array<{ runId: string; hermesRunId: string | null }>,
  ): Promise<void> {
    await Promise.all(
      superseded
        .filter((r) => Boolean(r.hermesRunId))
        .map((r) =>
          this.agentPort
            .cancelRun({ internalRunId: r.runId, externalRunId: r.hermesRunId! })
            .catch(() => undefined),
        ),
    );
  }

  private buildMasterInstructions(params: {
    tenant: TenantContext;
    contextVersion: number;
    personalizationGranted: boolean;
    delegationEnabled: boolean;
    summary: ConversationSummary | null;
  }): string {
    const lines = [
      ROLE_DEFINITIONS.master.templateText,
      '',
      `ACTIVE_MARKET: country=${params.tenant.country} language=${params.tenant.language} currency=${params.tenant.currency}`,
      `CONTEXT_VERSION: ${params.contextVersion}`,
      `PERSONALIZATION_CONSENT: ${params.personalizationGranted ? 'GRANTED' : 'NOT_GRANTED (use current-session explicit criteria only)'}`,
      `DELEGATION_POLICY: ${params.delegationEnabled ? 'ENABLED (max 3 concurrent specialists, max depth 1)' : 'DISABLED (answer directly using your own tools)'}`,
    ];
    if (params.summary) {
      lines.push('', `PRIOR_CONVERSATION_SUMMARY: ${params.summary.summaryText}`);
    }
    return lines.join('\n');
  }
}
