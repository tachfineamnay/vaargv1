import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { EventEncoder } from '@ag-ui/encoder';
import { Inject, Injectable } from '@nestjs/common';
import {
  AG_UI_PROTOCOL_VERSION,
  AppError,
  EventType,
  ROLE_DEFINITIONS,
  VAARG_AGUI_CUSTOM_EVENTS,
  adaptiveCompositionSchema,
  agentUiActionResponseSchema,
  compileCompositionToA2UiMessages,
  computeAgUiStateDelta,
  emptyExplorationCriteria,
  extractSurfaceOwnerSessionId,
  isPurposeGranted,
  isTerminalAgentRunStatus,
  masterOutputSchema,
  parseAgUiStreamCursor,
  publishRunCompositionInputSchema,
  publishRunCompositionResultSchema,
  redactSensitiveText,
  redactStructuredRecord,
  startConversationRunInputSchema,
  structuredMessagePayloadSchema,
  submitMessageInputSchema,
  vaargAgUiStateSnapshotSchema,
  validateControlledUiAction,
  validatedAgentRunResultSchema,
  withinCompositionLimits,
  type A2UiAgentToRendererMessage,
  type AGUIEvent,
  type AdaptiveComposition,
  type AgentHistoryTurn,
  type AgentPort,
  type AgentRunRecord,
  type AgentUiActionResponse,
  type ConsentState,
  type Conversation,
  type ConversationMessage,
  type ConversationSummary,
  type ExplorationCriteria,
  type PersistedAgUiStreamEnvelope,
  type PublishRunCompositionResult,
  type StructuredMessagePayload,
  type TenantContext,
  type VaargAgUiStateSnapshot,
  type ValidatedAgentRunResult,
  type VisitorSession,
} from '@vaarg/shared';
import {
  ProviderPolicyRegistry,
  appendAgentRunStreamEvent,
  appendUserConversationMessage,
  bindExternalHermesRunId,
  cancelAgentRunTree,
  compareCatalogProductsV1,
  createConversationRecord,
  createMasterAgentRunRecord,
  finalizeMasterRunAndAcceptMessage,
  getCatalogCollectionV1,
  getCatalogProductV1,
  getConversationWithBoundedHistory,
  getLatestActiveConversationForSession,
  getOwnedActionProposalById,
  getOwnedAgentRun,
  issueRunBridgeTicket,
  listActionProposalsForRun,
  listAgentRunStreamEvents,
  markProviderCallUnknown,
  markRunPublishedExperienceRevision,
  reconcileModelCallUsage,
  reserveModelCallBudget,
  resolveProductSummaries,
  supersedeActiveConversationRuns,
  syncRoleDefinitionsAndProviderPolicies,
  updateActionProposalResolution,
} from '@vaarg/persistence';
import { ExperienceService } from '../experience/experience.service.js';
import { DatabaseClient } from '../infra/database-client.js';
import {
  AGENT_PORT,
  HERMES_BRIDGE_SECRET_TOKEN,
  PROVIDER_POLICY_REGISTRY,
} from './intelligence.tokens.js';

function deterministicUuid(namespace: string, key: string): string {
  const hex = createHash('sha256').update(`${namespace}:${key}`, 'utf8').digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

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
  private readonly activeRunPumps = new Map<string, Promise<void>>();
  private readonly runEventBus = new EventEmitter();
  private readonly actionReplayCache = new Map<
    string,
    { payloadHash: string; response: AgentUiActionResponse; expiresAt: number }
  >();

  constructor(
    @Inject(DatabaseClient) private readonly database: DatabaseClient,
    @Inject(ExperienceService) private readonly experience: ExperienceService,
    @Inject(AGENT_PORT) private readonly agentPort: AgentPort,
    @Inject(PROVIDER_POLICY_REGISTRY) private readonly providerPolicies: ProviderPolicyRegistry,
    @Inject(HERMES_BRIDGE_SECRET_TOKEN) private readonly bridgeSecret: string | undefined,
  ) {
    this.runEventBus.setMaxListeners(200);
  }

  async createConversation(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
    options?: { reuseActive?: boolean },
  ): Promise<Conversation> {
    const pool = this.database.getPool();
    await syncRoleDefinitionsAndProviderPolicies(
      pool,
      tenant.storeId,
      this.providerPolicies.listPolicies(),
    );
    if (options?.reuseActive) {
      const existing = await getLatestActiveConversationForSession(pool, {
        storeId: tenant.storeId,
        sessionId: session.sessionId,
      });
      if (existing) {
        return existing;
      }
    }
    const context = await this.experience.getContext(tenant, session, consent);
    return createConversationRecord(pool, {
      storeId: tenant.storeId,
      sessionId: session.sessionId,
      contextVersion: context.contextVersion,
    });
  }

  /**
   * Read-only active session conversation lookup for persistent shopper drawer
   * restoration across route transitions and reloads. Performs zero writes.
   */
  async getActiveSessionConversation(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
  ): Promise<{
    conversation: Conversation | null;
    messages: ConversationMessage[];
    summary: ConversationSummary | null;
    a2uiMessages: A2UiAgentToRendererMessage[];
  }> {
    const pool = this.database.getPool();
    const active = await getLatestActiveConversationForSession(pool, {
      storeId: tenant.storeId,
      sessionId: session.sessionId,
    });
    if (!active) {
      return {
        conversation: null,
        messages: [],
        summary: null,
        a2uiMessages: [],
      };
    }
    const history = await getConversationWithBoundedHistory(pool, {
      storeId: tenant.storeId,
      sessionId: session.sessionId,
      conversationId: active.conversationId,
      personalizationGranted: isPurposeGranted(consent, 'personalization'),
      maxMessages: 24,
    });
    const latestAssistantWithRun = [...history.messages]
      .reverse()
      .find((m) => m.role === 'assistant' && m.runId !== null);
    const a2uiMessages = latestAssistantWithRun?.runId
      ? await this.compileGroundedRunA2UiMessages(
          tenant,
          session,
          consent,
          latestAssistantWithRun.runId,
          active.conversationId,
          latestAssistantWithRun.structuredPayload,
        ).catch(() => [])
      : [];

    return {
      conversation: history.conversation,
      messages: history.messages,
      summary: history.summary,
      a2uiMessages,
    };
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
      const msgResult = await this.submitMessage(tenant, session, consent, conversationId, {
        content: input.message,
        ...(idempotencyKey ? { idempotencyKey: `${idempotencyKey}:msg` } : {}),
      });
      triggerMessageId = msgResult.message.messageId;
    }

    // Task 0.2: Resolve operator-configured direct provider + model on the server (never visitor-supplied)
    const modelPolicy = this.providerPolicies.resolveForRole('master');

    // Task 0.4: Inspect cryptographically attested Hermes runtime capabilities & confinement
    const runtimeCaps = await this.agentPort.runtimeCapabilities();
    if (runtimeCaps.status === 'NOT_CONFIGURED') {
      throw AppError.unavailable(
        'AGENT_RUNTIME_NOT_CONFIGURED: Hermes runtime is not configured; conventional storefront and deterministic adaptive experience remain available',
      );
    }
    if (runtimeCaps.status === 'UNSAFE_CONFINEMENT') {
      throw AppError.forbidden(
        `UNSAFE_RUNTIME_CONFINEMENT: ${runtimeCaps.delegationLimitationReason ?? 'Forbidden tools or unattested confinement detected on Hermes runtime'}`,
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

    const latestUserMessage = [...historyBundle.messages].reverse().find((m) => m.role === 'user');
    if (!latestUserMessage) {
      throw AppError.badRequest(
        'NO_USER_MESSAGE: Submit a visitor message before starting an agent run',
      );
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

    const superseded = await supersedeActiveConversationRuns(pool, {
      storeId: tenant.storeId,
      conversationId,
      excludeRunId: created.run.runId,
    });
    await this.stopSupersededExternalRuns(superseded);

    const initialEstimate = this.providerPolicies.estimateReservationCostUsd(
      modelPolicy,
      Math.max(512, Math.ceil(latestUserMessage.content.length / 3) + 1024),
      modelPolicy.maxOutputTokens,
    );
    // FIX04: stable logical provider-call identity. Hermes echoes this id, so
    // the pre-request hook reservation dedupes to the SAME reservation instead
    // of double-reserving (one reservation per logical provider call).
    const initialProviderCallId = `vaarg-call:${created.run.runId}`;
    const { reservationId } = await reserveModelCallBudget(pool, {
      storeId: tenant.storeId,
      rootRunId: created.run.runId,
      runId: created.run.runId,
      provider: modelPolicy.provider,
      model: modelPolicy.model,
      reservedTokens: initialEstimate.reservedTokens,
      reservedCostUsd: initialEstimate.reservedCostUsd,
      providerCallId: initialProviderCallId,
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
        'X-Vaarg-Provider-Call-Id': initialProviderCallId,
        'X-Vaarg-Run-Provider': modelPolicy.provider,
        'X-Vaarg-Run-Model': modelPolicy.model,
      },
    });

    const bound = await bindExternalHermesRunId(pool, {
      storeId: tenant.storeId,
      runId: created.run.runId,
      hermesRunId: handle.externalRunId,
      status: handle.status,
    });

    const initialState = this.buildAgUiStateSnapshot({
      sessionId: session.sessionId,
      conversationId,
      runId: bound.runId,
      contextVersion: liveContext.contextVersion,
      experienceRevision: liveContext.experienceRevision,
      market: {
        country: tenant.country,
        language: tenant.language,
        currency: tenant.currency,
      },
      exploration: liveContext.exploration,
      personalizationGranted,
      delegationStatus,
      activeProposalIds: [],
      publishedExperienceRevision: bound.publishedExperienceRevision,
      stale: false,
    });

    await this.recordAndBroadcastAgUiEvent(tenant.storeId, bound.runId, 'lifecycle:run_started', {
      type: EventType.RUN_STARTED,
      threadId: conversationId,
      runId: bound.runId,
      protocolVersion: AG_UI_PROTOCOL_VERSION,
      timestamp: Date.now(),
    } as unknown as AGUIEvent);

    await this.recordAndBroadcastAgUiEvent(tenant.storeId, bound.runId, 'state:initial', {
      type: EventType.STATE_SNAPSHOT,
      snapshot: initialState,
      timestamp: Date.now(),
    } as unknown as AGUIEvent);

    // Launch background single-flight stream & completion reconciliation pump
    void this.ensureRunStreamPump(tenant, session, consent, bound, delegationStatus, initialState);

    return {
      run: bound,
      delegationStatus,
      delegationLimitationReason: runtimeCaps.delegationLimitationReason,
    };
  }

  /**
   * Task 0.1 — Pure read-only run status query (`GET /v1/agent/runs/:runId`).
   * Never mutates `agent_runs`, `messages`, `action_proposals`, or `experience_revisions`.
   */
  async getRunStatus(
    tenant: TenantContext,
    session: VisitorSession,
    _consent: ConsentState,
    runId: string,
  ): Promise<AgentRunRecord> {
    return getOwnedAgentRun(this.database.getPool(), {
      storeId: tenant.storeId,
      sessionId: session.sessionId,
      runId,
    });
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

    await this.recordAndBroadcastAgUiEvent(
      tenant.storeId,
      cancelled.rootRun.runId,
      'lifecycle:run_cancelled',
      {
        type: EventType.RUN_FINISHED,
        threadId: cancelled.rootRun.conversationId,
        runId: cancelled.rootRun.runId,
        outcome: { type: 'cancelled' },
        timestamp: Date.now(),
      } as unknown as AGUIEvent,
    );

    return cancelled.rootRun;
  }

  /**
   * Task 0.1 — Pure read-only validated run result (`GET /v1/agent/runs/:runId/result`).
   * Performs ZERO database writes and NEVER publishes experience revisions on GET.
   */
  async getValidatedResult(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
    runId: string,
  ): Promise<ValidatedAgentRunResult & { a2uiMessages?: A2UiAgentToRendererMessage[] }> {
    const pool = this.database.getPool();
    const current = await getOwnedAgentRun(pool, {
      storeId: tenant.storeId,
      sessionId: session.sessionId,
      runId,
    });
    const liveContext = await this.experience.getContext(tenant, session, consent);
    const history = await getConversationWithBoundedHistory(pool, {
      storeId: tenant.storeId,
      sessionId: session.sessionId,
      conversationId: current.conversationId,
      personalizationGranted: isPurposeGranted(consent, 'personalization'),
      maxMessages: 20,
    });
    const assistantMessage =
      history.messages.find((m) => m.runId === current.runId && m.role === 'assistant') ?? null;

    const proposals = await listActionProposalsForRun(pool, tenant.storeId, current.runId);
    const staleBlocked =
      current.status === 'superseded' || liveContext.contextVersion > current.contextVersion;

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

    const validated = validatedAgentRunResultSchema.parse({
      runId: current.runId,
      conversationId: current.conversationId,
      status: current.status,
      contextVersion: current.contextVersion,
      stale: staleBlocked,
      assistantMessage,
      proposals,
      compositionProposal: staleBlocked ? null : compositionProposal,
      criteriaUpdated: null,
      consentSnapshot: consent,
      delegationStatus,
      errorCode: current.errorCode,
      errorMessage: current.errorMessage,
    });

    const a2uiMessages =
      !staleBlocked && compositionProposal
        ? compileCompositionToA2UiMessages({
            composition: compositionProposal,
            surfaceKind: 'shopper',
            surfaceSubKey: current.conversationId,
            runId: current.runId,
            conversationId: current.conversationId,
          }).messages
        : [];

    return {
      ...validated,
      ...(a2uiMessages.length > 0 ? { a2uiMessages } : {}),
    };
  }

  /**
   * Task 0.1 — Explicit CSRF-protected, idempotent POST action (`POST /v1/agent/runs/:runId/publish`)
   * that settles an active run (if needed) and publishes its validated composition proposal via CAS.
   */
  async publishRunComposition(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
    runId: string,
    rawInput: unknown = {},
    headerIdempotencyKey?: string,
  ): Promise<PublishRunCompositionResult> {
    const parsedInput = publishRunCompositionInputSchema.safeParse(rawInput ?? {});
    if (!parsedInput.success) {
      throw AppError.badRequest(
        `INVALID_PUBLISH_INPUT: ${parsedInput.error.issues.map((i) => i.message).join('; ')}`,
      );
    }
    const input = parsedInput.data;
    void headerIdempotencyKey;

    const synced = await this.reconcileAndSettleRun(tenant, session, consent, runId);
    const pool = this.database.getPool();
    const proposals = await listActionProposalsForRun(pool, tenant.storeId, synced.run.runId);

    const targetProposal = input.proposalId
      ? proposals.find(
          (p) => p.proposalId === input.proposalId && p.proposalType === 'experience_composition',
        )
      : [...proposals].reverse().find((p) => p.proposalType === 'experience_composition');

    if (!targetProposal) {
      throw AppError.notFound('COMPOSITION_PROPOSAL_NOT_FOUND: Run has no composition proposal');
    }

    const compParsed = adaptiveCompositionSchema.safeParse(targetProposal.payload);
    if (!compParsed.success || !withinCompositionLimits(compParsed.data)) {
      throw AppError.unprocessable('INVALID_COMPOSITION_PROPOSAL');
    }
    const comp = compParsed.data;

    if (targetProposal.status === 'applied' && targetProposal.appliedExperienceRevision !== null) {
      return publishRunCompositionResultSchema.parse({
        published: true,
        replayed: true,
        runId: synced.run.runId,
        proposalId: targetProposal.proposalId,
        contextVersion: comp.contextVersion,
        experienceRevision: targetProposal.appliedExperienceRevision,
        composition: {
          ...comp,
          experienceRevision: targetProposal.appliedExperienceRevision,
        },
      });
    }

    const liveContext = await this.experience.getContext(tenant, session, consent);
    const expectedContextVersion = input.expectedContextVersion ?? synced.run.contextVersion;

    if (
      synced.run.status === 'superseded' ||
      liveContext.contextVersion !== expectedContextVersion ||
      comp.contextVersion !== liveContext.contextVersion
    ) {
      await updateActionProposalResolution(pool, {
        storeId: tenant.storeId,
        proposalId: targetProposal.proposalId,
        status: 'stale',
      });
      if (
        input.expectedContextVersion !== undefined &&
        liveContext.contextVersion !== input.expectedContextVersion
      ) {
        throw AppError.conflict(
          'STALE_COMPOSITION_PROPOSAL: Visitor context advanced; refresh before publishing',
        );
      }
      return publishRunCompositionResultSchema.parse({
        published: false,
        replayed: false,
        runId: synced.run.runId,
        proposalId: targetProposal.proposalId,
        contextVersion: liveContext.contextVersion,
        experienceRevision: liveContext.experienceRevision,
        composition: comp,
      });
    }

    const publishedRevision = await this.experience.tryPublishCompositionProposal({
      storeId: tenant.storeId,
      country: tenant.country,
      language: tenant.language,
      currency: tenant.currency,
      sessionId: session.sessionId,
      expectedContextVersion: synced.run.contextVersion,
      composition: comp,
    });

    if (publishedRevision === null) {
      await updateActionProposalResolution(pool, {
        storeId: tenant.storeId,
        proposalId: targetProposal.proposalId,
        status: 'stale',
      });
      return publishRunCompositionResultSchema.parse({
        published: false,
        replayed: false,
        runId: synced.run.runId,
        proposalId: targetProposal.proposalId,
        contextVersion: liveContext.contextVersion,
        experienceRevision: liveContext.experienceRevision,
        composition: comp,
      });
    }

    await updateActionProposalResolution(pool, {
      storeId: tenant.storeId,
      proposalId: targetProposal.proposalId,
      status: 'applied',
      appliedExperienceRevision: publishedRevision,
    });
    await markRunPublishedExperienceRevision(pool, {
      storeId: tenant.storeId,
      runId: synced.run.runId,
      proposalId: targetProposal.proposalId,
      experienceRevision: publishedRevision,
    }).catch(() => undefined);

    await this.recordAndBroadcastAgUiEvent(
      tenant.storeId,
      synced.run.runId,
      `publish:${targetProposal.proposalId}:${publishedRevision}`,
      {
        type: EventType.CUSTOM,
        name: VAARG_AGUI_CUSTOM_EVENTS.CONTEXT_SYNC,
        value: {
          runId: synced.run.runId,
          proposalId: targetProposal.proposalId,
          contextVersion: comp.contextVersion,
          experienceRevision: publishedRevision,
        },
        timestamp: Date.now(),
      } as unknown as AGUIEvent,
    );

    return publishRunCompositionResultSchema.parse({
      published: true,
      replayed: false,
      runId: synced.run.runId,
      proposalId: targetProposal.proposalId,
      contextVersion: comp.contextVersion,
      experienceRevision: publishedRevision,
      composition: {
        ...comp,
        experienceRevision: publishedRevision,
      },
    });
  }

  /**
   * Task 2 & Task 8 — Official AG-UI 1.0.5 Server-Sent Events stream with
   * `Last-Event-ID` cursor replay, resync-required state snapshot recovery,
   * and live single-flight forwarding.
   */
  async streamRunAgUiEvents(params: {
    tenant: TenantContext;
    session: VisitorSession;
    consent: ConsentState;
    runId: string;
    lastEventId: string | undefined;
    afterSeqQuery: string | undefined;
    rawResponse: ServerResponse;
    abortSignal: AbortSignal;
  }): Promise<void> {
    const { tenant, session, consent, runId, rawResponse, abortSignal } = params;
    const pool = this.database.getPool();
    const run = await getOwnedAgentRun(pool, {
      storeId: tenant.storeId,
      sessionId: session.sessionId,
      runId,
    });

    const rawCursor = params.lastEventId ?? params.afterSeqQuery;
    if (rawCursor && rawCursor.includes(':')) {
      const prefix = rawCursor.slice(0, rawCursor.lastIndexOf(':'));
      if (prefix && prefix !== runId) {
        throw AppError.badRequest('CURSOR_RUN_MISMATCH: Last-Event-ID belongs to a different run');
      }
    }
    const afterSeq = parseAgUiStreamCursor(rawCursor, runId);

    const encoder = new EventEncoder();
    rawResponse.writeHead(200, {
      'content-type': `${encoder.getContentType()}; charset=utf-8`,
      'cache-control': 'private, no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const writeEnvelope = (env: PersistedAgUiStreamEnvelope): boolean => {
      if (rawResponse.writableEnded || rawResponse.destroyed) return false;
      rawResponse.write(`id: ${env.eventId}\n${encoder.encodeSSE(env.event)}`);
      return env.event.type === EventType.RUN_FINISHED || env.event.type === EventType.RUN_ERROR;
    };

    const writeEphemeralEvent = (event: AGUIEvent) => {
      if (rawResponse.writableEnded || rawResponse.destroyed) return;
      rawResponse.write(encoder.encodeSSE(event));
    };

    let lastSentSeq = afterSeq;
    const backlog = await listAgentRunStreamEvents(pool, {
      storeId: tenant.storeId,
      sessionId: session.sessionId,
      runId,
      afterSeq,
      limit: 400,
    });

    if (backlog.resyncRequired) {
      const liveContext = await this.experience.getContext(tenant, session, consent);
      const snapshot = this.buildAgUiStateSnapshot({
        sessionId: session.sessionId,
        conversationId: run.conversationId,
        runId: run.runId,
        contextVersion: liveContext.contextVersion,
        experienceRevision: liveContext.experienceRevision,
        market: {
          country: tenant.country,
          language: tenant.language,
          currency: tenant.currency,
        },
        exploration: liveContext.exploration,
        personalizationGranted: isPurposeGranted(consent, 'personalization'),
        delegationStatus: 'NOT_REQUESTED',
        activeProposalIds: [],
        publishedExperienceRevision: run.publishedExperienceRevision,
        stale: liveContext.contextVersion > run.contextVersion,
      });

      writeEphemeralEvent({
        type: EventType.CUSTOM,
        name: VAARG_AGUI_CUSTOM_EVENTS.RESYNC_REQUIRED,
        value: {
          runId,
          requestedAfterSeq: afterSeq,
          minRetainedSeq: backlog.minRetainedSeq,
          latestEventSeq: backlog.latestEventSeq,
        },
        timestamp: Date.now(),
      } as unknown as AGUIEvent);

      writeEphemeralEvent({
        type: EventType.STATE_SNAPSHOT,
        snapshot,
        timestamp: Date.now(),
      } as unknown as AGUIEvent);
    }

    for (const env of backlog.events) {
      lastSentSeq = Math.max(lastSentSeq, env.eventSeq);
      const sawTerminal = writeEnvelope(env);
      if (sawTerminal) {
        rawResponse.end();
        return;
      }
    }

    if (isTerminalAgentRunStatus(run.status)) {
      if (lastSentSeq === 0) {
        // Synthesize deterministic terminal replay for runs completed prior to stream attach
        const outcomeType = run.status === 'cancelled' ? 'cancelled' : 'success';
        if (run.status === 'completed' || run.status === 'cancelled') {
          writeEphemeralEvent({
            type: EventType.RUN_FINISHED,
            threadId: run.conversationId,
            runId: run.runId,
            outcome: { type: outcomeType },
            timestamp: Date.now(),
          } as unknown as AGUIEvent);
        } else {
          writeEphemeralEvent({
            type: EventType.RUN_ERROR,
            message: redactSensitiveText(run.errorMessage ?? 'Agent run ended with an error', 300),
            code: run.errorCode ?? run.status.toUpperCase(),
            timestamp: Date.now(),
          } as unknown as AGUIEvent);
        }
      }
      rawResponse.end();
      return;
    }

    // Ensure background single-flight pump is active for non-terminal run
    const liveContext = await this.experience.getContext(tenant, session, consent);
    const snap = this.buildAgUiStateSnapshot({
      sessionId: session.sessionId,
      conversationId: run.conversationId,
      runId: run.runId,
      contextVersion: liveContext.contextVersion,
      experienceRevision: liveContext.experienceRevision,
      market: {
        country: tenant.country,
        language: tenant.language,
        currency: tenant.currency,
      },
      exploration: liveContext.exploration,
      personalizationGranted: isPurposeGranted(consent, 'personalization'),
      delegationStatus: 'NOT_REQUESTED',
      activeProposalIds: [],
      publishedExperienceRevision: run.publishedExperienceRevision,
      stale: liveContext.contextVersion > run.contextVersion,
    });
    void this.ensureRunStreamPump(tenant, session, consent, run, 'NOT_REQUESTED', snap);

    await new Promise<void>((resolve) => {
      const channel = `run:${runId}`;
      const cleanup = () => {
        clearInterval(heartbeat);
        this.runEventBus.off(channel, onEvent);
        abortSignal.removeEventListener('abort', onAbort);
        if (!rawResponse.writableEnded && !rawResponse.destroyed) {
          rawResponse.end();
        }
        resolve();
      };

      const onAbort = () => cleanup();
      const onEvent = (env: PersistedAgUiStreamEnvelope) => {
        if (env.eventSeq <= lastSentSeq) return;
        lastSentSeq = env.eventSeq;
        const terminal = writeEnvelope(env);
        if (terminal) {
          cleanup();
        }
      };

      const heartbeat = setInterval(() => {
        if (rawResponse.writableEnded || rawResponse.destroyed) {
          cleanup();
          return;
        }
        rawResponse.write(`: keepalive ${Date.now()}\n\n`);
      }, 15_000);

      this.runEventBus.on(channel, onEvent);
      abortSignal.addEventListener('abort', onAbort, { once: true });
      rawResponse.once('close', onAbort);
    });
  }

  /**
   * Task 9 — Validated, session-bound, idempotent controlled UI action handler
   * (`POST /v1/agent/actions`) for A2UI 1.0 `renderer_to_agent.json` `action` envelopes.
   */
  async executeUiAction(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
    rawBody: unknown,
    headerIdempotencyKey?: string,
  ): Promise<AgentUiActionResponse> {
    const validated = validateControlledUiAction(rawBody);
    if (validated.kind === 'rejected') {
      throw AppError.badRequest(`${validated.code}: ${validated.message}`);
    }

    const ownerSessionId = extractSurfaceOwnerSessionId(validated.surfaceId);
    if (!ownerSessionId || ownerSessionId !== session.sessionId) {
      throw AppError.forbidden(
        'SURFACE_SESSION_MISMATCH: A2UI action surfaceId does not belong to the active visitor session',
      );
    }

    const replayKey = headerIdempotencyKey
      ? `${tenant.storeId}:${session.sessionId}:${headerIdempotencyKey}`
      : null;
    const bodyHash = createHash('sha256').update(JSON.stringify(rawBody), 'utf8').digest('hex');

    if (replayKey) {
      const cached = this.actionReplayCache.get(replayKey);
      if (cached && cached.expiresAt > Date.now()) {
        if (cached.payloadHash !== bodyHash) {
          throw AppError.conflict('IDEMPOTENCY_KEY_CONFLICT: Payload differs for idempotency key');
        }
        return cached.response;
      }
    }

    const pool = this.database.getPool();
    const marketScope = {
      storeId: tenant.storeId,
      country: tenant.country,
      language: tenant.language,
    };

    if (validated.kind === 'future_unavailable') {
      let proposalStatus: 'verified_non_executing' | 'not_found' | 'none' = 'none';
      if (validated.proposalId) {
        const proposal = await getOwnedActionProposalById(pool, {
          storeId: tenant.storeId,
          sessionId: session.sessionId,
          proposalId: validated.proposalId,
        });
        proposalStatus = proposal ? 'verified_non_executing' : 'not_found';
      }
      const response = agentUiActionResponseSchema.parse({
        status: 'UNAVAILABLE_IN_CURRENT_PHASE',
        executed: false,
        actionName: validated.name,
        availableIn: validated.availableIn,
        proposalId: validated.proposalId,
        proposalStatus,
        message: `Action "${validated.name}" is proposal-only in FL07 and becomes executable in ${validated.availableIn}; no commercial, support, memory, or campaign mutation was performed.`,
      });
      if (replayKey) {
        this.actionReplayCache.set(replayKey, {
          payloadHash: bodyHash,
          response,
          expiresAt: Date.now() + 10 * 60 * 1000,
        });
      }
      return response;
    }

    const eventSeed =
      headerIdempotencyKey ??
      `${validated.surfaceId}:${validated.sourceComponentId}:${validated.name}:${validated.timestamp}`;
    const eventId = deterministicUuid(session.sessionId, eventSeed);

    let navigationHref: string | null = null;
    let compareProductIds: string[] | undefined;
    let submittedMessageId: string | null | undefined = null;
    let a2uiMessages: A2UiAgentToRendererMessage[] | undefined;
    let contextVersion = 0;
    let experienceRevision = 0;

    switch (validated.name) {
      case 'view_product': {
        const ctx = validated.context as { handle: string; productId?: string };
        const detail = await getCatalogProductV1(pool, marketScope, ctx.handle);
        if (!detail || (ctx.productId && detail.summary.id !== ctx.productId)) {
          throw AppError.notFound('UNGROUNDED_PRODUCT_ACTION: Product not found in active market');
        }
        const ingested = await this.experience.ingestEvents(tenant, session, consent, {
          events: [{ eventId, type: 'product_viewed', productRef: detail.summary.id }],
        });
        contextVersion = ingested.contextVersion;
        experienceRevision = ingested.experienceRevision;
        navigationHref = `/products/${encodeURIComponent(detail.summary.handle)}`;
        break;
      }

      case 'view_collection': {
        const ctx = validated.context as { handle: string };
        const collection = await getCatalogCollectionV1(pool, marketScope, ctx.handle);
        if (!collection) {
          throw AppError.notFound(
            'UNGROUNDED_COLLECTION_ACTION: Collection not found in active market',
          );
        }
        const ingested = await this.experience.ingestEvents(tenant, session, consent, {
          events: [{ eventId, type: 'collection_viewed', collection: collection.handle }],
        });
        contextVersion = ingested.contextVersion;
        experienceRevision = ingested.experienceRevision;
        navigationHref = `/collections/${encodeURIComponent(collection.handle)}`;
        break;
      }

      case 'refine_search': {
        const ctx = validated.context as { query: string };
        const ingested = await this.experience.ingestEvents(tenant, session, consent, {
          events: [{ eventId, type: 'search_submitted', query: ctx.query }],
        });
        contextVersion = ingested.contextVersion;
        experienceRevision = ingested.experienceRevision;
        navigationHref = `/search?q=${encodeURIComponent(ctx.query)}`;
        const comp = await this.experience.composition(tenant, session, consent, {
          publish: false,
        });
        a2uiMessages = compileCompositionToA2UiMessages({
          composition: comp,
          surfaceKind: 'adaptive',
        }).messages;
        break;
      }

      case 'update_explicit_criteria': {
        const ctx = validated.context as {
          criteria: Partial<ExplorationCriteria>;
          expectedContextVersion?: number;
        };
        const liveCtx = await this.experience.getContext(tenant, session, consent);
        const merged: ExplorationCriteria = {
          ...emptyExplorationCriteria(),
          ...liveCtx.exploration,
          ...ctx.criteria,
          currency:
            ctx.criteria.currency !== undefined
              ? ctx.criteria.currency
              : (liveCtx.exploration.currency ?? tenant.currency),
          attributes: ctx.criteria.attributes ?? liveCtx.exploration.attributes,
        };
        const ingested = await this.experience.ingestEvents(tenant, session, consent, {
          events: [{ eventId, type: 'filter_changed', filters: merged }],
          ...(ctx.expectedContextVersion !== undefined
            ? { expectedContextVersion: ctx.expectedContextVersion }
            : {}),
        });
        contextVersion = ingested.contextVersion;
        experienceRevision = ingested.experienceRevision;
        const comp = await this.experience.composition(tenant, session, consent, {
          publish: false,
        });
        a2uiMessages = compileCompositionToA2UiMessages({
          composition: comp,
          surfaceKind: 'adaptive',
        }).messages;
        break;
      }

      case 'compare_products': {
        const ctx = validated.context as { productIds: string[]; navigate: boolean };
        const summaryMap = await resolveProductSummaries(pool, marketScope, ctx.productIds);
        const summaries = Array.from(summaryMap.values());
        if (summaries.length < 2) {
          throw AppError.unprocessable(
            'UNGROUNDED_COMPARISON_ACTION: At least two verified active-market products are required',
          );
        }
        const verifiedIds = summaries.map((s) => s.id);
        const ingested = await this.experience.ingestEvents(tenant, session, consent, {
          events: [{ eventId, type: 'comparison_changed', added: verifiedIds, removed: [] }],
        });
        contextVersion = ingested.contextVersion;
        experienceRevision = ingested.experienceRevision;
        compareProductIds = verifiedIds;
        if (ctx.navigate) {
          navigationHref = `/search?compare=${encodeURIComponent(verifiedIds.join(','))}`;
        }
        const [comp, comparisonDetail] = await Promise.all([
          this.experience.composition(tenant, session, consent, {
            comparisonRefs: verifiedIds,
            publish: false,
          }),
          compareCatalogProductsV1(pool, marketScope, verifiedIds),
        ]);
        a2uiMessages = compileCompositionToA2UiMessages({
          composition: comp,
          surfaceKind: 'adaptive',
          comparisonDetail,
        }).messages;
        break;
      }

      case 'answer_guided_question': {
        const ctx = validated.context as {
          questionId: string;
          optionId: string;
          label: string;
          conversationId?: string;
          criteriaPatch?: Partial<ExplorationCriteria>;
          submitReply: boolean;
        };
        const liveCtx = await this.experience.getContext(tenant, session, consent);
        contextVersion = liveCtx.contextVersion;
        experienceRevision = liveCtx.experienceRevision;

        if (ctx.criteriaPatch) {
          const merged: ExplorationCriteria = {
            ...emptyExplorationCriteria(),
            ...liveCtx.exploration,
            ...ctx.criteriaPatch,
            currency:
              ctx.criteriaPatch.currency !== undefined
                ? ctx.criteriaPatch.currency
                : (liveCtx.exploration.currency ?? tenant.currency),
            attributes: ctx.criteriaPatch.attributes ?? liveCtx.exploration.attributes,
          };
          const ingested = await this.experience.ingestEvents(tenant, session, consent, {
            events: [{ eventId, type: 'filter_changed', filters: merged }],
          });
          contextVersion = ingested.contextVersion;
          experienceRevision = ingested.experienceRevision;
        }

        if (ctx.submitReply && ctx.conversationId) {
          const submitted = await this.submitMessage(tenant, session, consent, ctx.conversationId, {
            content: ctx.label,
            idempotencyKey: `guided:${ctx.questionId}:${ctx.optionId}:${eventId}`,
          });
          submittedMessageId = submitted.message.messageId;
          contextVersion = submitted.contextVersion;
        }
        break;
      }

      case 'request_composition': {
        const ctx = validated.context as {
          compareProductIds?: string[];
          expectedContextVersion?: number;
        };
        const refreshed = await this.experience.refresh(tenant, session, consent, {
          ...(ctx.expectedContextVersion !== undefined
            ? { expectedContextVersion: ctx.expectedContextVersion }
            : {}),
          ...(ctx.compareProductIds ? { comparisonRefs: ctx.compareProductIds } : {}),
        });
        contextVersion = refreshed.contextVersion;
        experienceRevision = refreshed.experienceRevision;
        a2uiMessages = compileCompositionToA2UiMessages({
          composition: refreshed,
          surfaceKind: 'adaptive',
        }).messages;
        break;
      }

      case 'return_to_general_exploration': {
        const resetRes = await this.experience.resetExploration(tenant, session, consent);
        contextVersion = resetRes.contextVersion;
        experienceRevision = resetRes.experienceRevision;
        const comp = await this.experience.composition(tenant, session, consent, {
          publish: false,
        });
        a2uiMessages = compileCompositionToA2UiMessages({
          composition: comp,
          surfaceKind: 'adaptive',
        }).messages;
        break;
      }
    }

    const response = agentUiActionResponseSchema.parse({
      status: 'APPLIED',
      actionName: validated.name,
      navigationHref,
      contextVersion,
      experienceRevision,
      ...(compareProductIds ? { compareProductIds } : {}),
      submittedMessageId,
      ...(a2uiMessages
        ? { a2uiMessages: a2uiMessages as unknown as Array<Record<string, unknown>> }
        : {}),
    });

    if (replayKey) {
      this.actionReplayCache.set(replayKey, {
        payloadHash: bodyHash,
        response,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
    }
    return response;
  }

  // =========================================================================
  // Internal Single-Flight AG-UI Stream & Reconciliation Pump
  // =========================================================================

  private ensureRunStreamPump(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
    run: AgentRunRecord,
    delegationStatus: 'ENABLED' | 'DISABLED_CAPABILITY_LIMITATION' | 'NOT_REQUESTED',
    initialState: VaargAgUiStateSnapshot,
  ): Promise<void> {
    const existing = this.activeRunPumps.get(run.runId);
    if (existing) return existing;

    if (
      !run.hermesRunId ||
      typeof (this.agentPort as Partial<AgentPort>).observeRun !== 'function'
    ) {
      return Promise.resolve();
    }

    const pump = this.pumpRunEventsAndSettle(
      tenant,
      session,
      consent,
      run,
      delegationStatus,
      initialState,
    ).finally(() => {
      this.activeRunPumps.delete(run.runId);
    });
    this.activeRunPumps.set(run.runId, pump);
    return pump;
  }

  private async pumpRunEventsAndSettle(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
    run: AgentRunRecord,
    delegationStatus: 'ENABLED' | 'DISABLED_CAPABILITY_LIMITATION' | 'NOT_REQUESTED',
    initialState: VaargAgUiStateSnapshot,
  ): Promise<void> {
    const messageStreamId = `msg-${run.runId}`;
    let messageStarted = false;
    let deltaIdx = 0;
    let toolIdx = 0;
    let currentState = initialState;
    const abortController = new AbortController();
    const deadlineMs = Date.parse(run.budget.deadlineAt);
    const remainingMs = Number.isFinite(deadlineMs) ? deadlineMs - Date.now() : 60_000;
    const maxWallMs = Math.min(120_000, Math.max(5_000, remainingMs));
    const timeoutHandle = setTimeout(() => abortController.abort(), maxWallMs);

    try {
      for await (const item of this.agentPort.observeRun({
        internalRunId: run.runId,
        externalRunId: run.hermesRunId!,
        signal: abortController.signal,
      })) {
        if (item.type === 'message.delta' && item.delta) {
          if (!messageStarted) {
            messageStarted = true;
            await this.recordAndBroadcastAgUiEvent(tenant.storeId, run.runId, 'msg:start', {
              type: EventType.TEXT_MESSAGE_START,
              messageId: messageStreamId,
              role: 'assistant',
              timestamp: Date.now(),
            } as unknown as AGUIEvent);
          }
          deltaIdx += 1;
          await this.recordAndBroadcastAgUiEvent(
            tenant.storeId,
            run.runId,
            `msg:delta:${deltaIdx}`,
            {
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId: messageStreamId,
              delta: item.delta,
              timestamp: Date.now(),
            } as unknown as AGUIEvent,
          );
          continue;
        }

        if (item.type === 'tool.started') {
          toolIdx += 1;
          const callId = item.toolCallId ?? `${run.runId}:tc:${toolIdx}`;
          const stepName = `tool:${item.tool}`;
          await this.recordAndBroadcastAgUiEvent(
            tenant.storeId,
            run.runId,
            `step:start:${callId}`,
            {
              type: EventType.STEP_STARTED,
              stepName,
              timestamp: Date.now(),
            } as unknown as AGUIEvent,
          );
          await this.recordAndBroadcastAgUiEvent(tenant.storeId, run.runId, `tc:start:${callId}`, {
            type: EventType.TOOL_CALL_START,
            toolCallId: callId,
            toolCallName: item.tool,
            ...(messageStarted ? { parentMessageId: messageStreamId } : {}),
            timestamp: Date.now(),
          } as unknown as AGUIEvent);
          continue;
        }

        if (item.type === 'tool.completed') {
          const callId = item.toolCallId ?? `${run.runId}:tc:${Math.max(1, toolIdx)}`;
          const stepName = `tool:${item.tool}`;
          const statusLabel = item.failed ? 'failed' : 'succeeded';
          await this.recordAndBroadcastAgUiEvent(
            tenant.storeId,
            run.runId,
            `tc:end:${callId}:${statusLabel}`,
            {
              type: EventType.TOOL_CALL_END,
              toolCallId: callId,
              timestamp: Date.now(),
            } as unknown as AGUIEvent,
          );
          await this.recordAndBroadcastAgUiEvent(
            tenant.storeId,
            run.runId,
            `tc:res:${callId}:${statusLabel}`,
            {
              type: EventType.TOOL_CALL_RESULT,
              messageId: `toolmsg-${callId}`,
              toolCallId: callId,
              role: 'tool',
              content: JSON.stringify(
                redactStructuredRecord({
                  tool: item.tool,
                  status: statusLabel,
                  durationMs: item.durationMs,
                }),
              ),
              timestamp: Date.now(),
            } as unknown as AGUIEvent,
          );
          await this.recordAndBroadcastAgUiEvent(
            tenant.storeId,
            run.runId,
            `step:end:${callId}:${statusLabel}`,
            {
              type: EventType.STEP_FINISHED,
              stepName,
              timestamp: Date.now(),
            } as unknown as AGUIEvent,
          );
          continue;
        }

        if (item.type === 'subagent.start') {
          await this.recordAndBroadcastAgUiEvent(
            tenant.storeId,
            run.runId,
            `subagent:start:${item.subagentId}`,
            {
              type: EventType.STEP_STARTED,
              stepName: `specialist:${item.subagentId}`,
              timestamp: Date.now(),
            } as unknown as AGUIEvent,
          );
          continue;
        }

        if (item.type === 'subagent.complete') {
          await this.recordAndBroadcastAgUiEvent(
            tenant.storeId,
            run.runId,
            `subagent:end:${item.subagentId}`,
            {
              type: EventType.STEP_FINISHED,
              stepName: `specialist:${item.subagentId}`,
              timestamp: Date.now(),
            } as unknown as AGUIEvent,
          );
          continue;
        }
      }
    } catch {
      // Upstream stream ended or timed out; reconcile authoritative state below
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (messageStarted) {
      await this.recordAndBroadcastAgUiEvent(tenant.storeId, run.runId, 'msg:end', {
        type: EventType.TEXT_MESSAGE_END,
        messageId: messageStreamId,
        timestamp: Date.now(),
      } as unknown as AGUIEvent);
    }

    try {
      const settled = await this.reconcileAndSettleRun(tenant, session, consent, run.runId);
      const pool = this.database.getPool();
      const proposals = await listActionProposalsForRun(
        pool,
        tenant.storeId,
        settled.run.runId,
      ).catch(() => []);
      const liveContext = await this.experience.getContext(tenant, session, consent);

      // Emit grounded A2UI 1.0 surfaces compiled from verified proposals or product refs
      const a2uiMessages = await this.compileGroundedRunA2UiMessages(
        tenant,
        session,
        consent,
        settled.run.runId,
        settled.run.conversationId,
        settled.assistantMessage?.structuredPayload ?? null,
      ).catch(() => []);

      for (let idx = 0; idx < a2uiMessages.length; idx += 1) {
        await this.recordAndBroadcastAgUiEvent(
          tenant.storeId,
          settled.run.runId,
          `a2ui:final:${idx}`,
          {
            type: EventType.CUSTOM,
            name: VAARG_AGUI_CUSTOM_EVENTS.A2UI_MESSAGE,
            value: a2uiMessages[idx],
            timestamp: Date.now(),
          } as unknown as AGUIEvent,
        );
      }

      for (const prop of proposals) {
        await this.recordAndBroadcastAgUiEvent(
          tenant.storeId,
          settled.run.runId,
          `proposal:${prop.proposalId}`,
          {
            type: EventType.CUSTOM,
            name: VAARG_AGUI_CUSTOM_EVENTS.PROPOSAL_READY,
            value: {
              proposalId: prop.proposalId,
              proposalType: prop.proposalType,
              status: prop.status,
              requiresConfirmation: prop.requiresConfirmation,
              contextVersion: prop.contextVersion,
            },
            timestamp: Date.now(),
          } as unknown as AGUIEvent,
        );
      }

      const nextState = this.buildAgUiStateSnapshot({
        sessionId: session.sessionId,
        conversationId: settled.run.conversationId,
        runId: settled.run.runId,
        contextVersion: liveContext.contextVersion,
        experienceRevision: liveContext.experienceRevision,
        market: {
          country: tenant.country,
          language: tenant.language,
          currency: tenant.currency,
        },
        exploration: liveContext.exploration,
        personalizationGranted: isPurposeGranted(consent, 'personalization'),
        delegationStatus,
        activeProposalIds: proposals.map((p) => p.proposalId).slice(0, 20),
        publishedExperienceRevision: settled.run.publishedExperienceRevision,
        stale: settled.staleBlocked,
      });

      const delta = computeAgUiStateDelta(currentState, nextState);
      currentState = nextState;
      if (delta.length > 0) {
        await this.recordAndBroadcastAgUiEvent(
          tenant.storeId,
          settled.run.runId,
          'state:final_delta',
          {
            type: EventType.STATE_DELTA,
            delta,
            timestamp: Date.now(),
          } as unknown as AGUIEvent,
        );
      }

      if (settled.run.status === 'completed' || settled.run.status === 'cancelled') {
        await this.recordAndBroadcastAgUiEvent(
          tenant.storeId,
          settled.run.runId,
          `lifecycle:finished:${settled.run.status}`,
          {
            type: EventType.RUN_FINISHED,
            threadId: settled.run.conversationId,
            runId: settled.run.runId,
            outcome: {
              type: settled.run.status === 'cancelled' ? 'cancelled' : 'success',
            },
            timestamp: Date.now(),
          } as unknown as AGUIEvent,
        );
      } else {
        await this.recordAndBroadcastAgUiEvent(
          tenant.storeId,
          settled.run.runId,
          `lifecycle:error:${settled.run.status}`,
          {
            type: EventType.RUN_ERROR,
            message: redactSensitiveText(
              settled.run.errorMessage ?? 'Agent run terminated with an error',
              300,
            ),
            code: settled.run.errorCode ?? settled.run.status.toUpperCase(),
            timestamp: Date.now(),
          } as unknown as AGUIEvent,
        );
      }
    } catch (err) {
      await this.recordAndBroadcastAgUiEvent(
        tenant.storeId,
        run.runId,
        'lifecycle:error:reconcile',
        {
          type: EventType.RUN_ERROR,
          message: redactSensitiveText(
            err instanceof Error ? err.message : 'Agent stream reconciliation failed',
            300,
          ),
          code: 'STREAM_RECONCILIATION_FAILED',
          timestamp: Date.now(),
        } as unknown as AGUIEvent,
      );
    }
  }

  private async compileGroundedRunA2UiMessages(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
    runId: string,
    conversationId: string,
    structuredPayload: StructuredMessagePayload | null,
  ): Promise<A2UiAgentToRendererMessage[]> {
    const pool = this.database.getPool();
    const proposals = await listActionProposalsForRun(pool, tenant.storeId, runId);
    const compProp = [...proposals]
      .reverse()
      .find(
        (p) =>
          p.proposalType === 'experience_composition' &&
          (p.status === 'proposed' || p.status === 'applied'),
      );

    if (compProp) {
      const parsed = adaptiveCompositionSchema.safeParse(compProp.payload);
      if (parsed.success && withinCompositionLimits(parsed.data)) {
        return compileCompositionToA2UiMessages({
          composition: parsed.data,
          surfaceKind: 'shopper',
          surfaceSubKey: conversationId,
          runId,
          conversationId,
        }).messages;
      }
    }

    if (structuredPayload && structuredPayload.groundedProductRefs.length > 0) {
      const summaryMap = await resolveProductSummaries(
        pool,
        {
          storeId: tenant.storeId,
          country: tenant.country,
          language: tenant.language,
        },
        structuredPayload.groundedProductRefs,
      );
      const summaries = Array.from(summaryMap.values());
      if (summaries.length > 0) {
        const liveContext = await this.experience.getContext(tenant, session, consent);
        const groundedComposition = adaptiveCompositionSchema.parse({
          sessionId: session.sessionId,
          contextVersion: liveContext.contextVersion,
          experienceRevision: liveContext.experienceRevision,
          mode: isPurposeGranted(consent, 'personalization') ? 'adaptive' : 'baseline',
          adaptationReason: 'product_signal',
          freshness: new Date().toISOString(),
          sections: [
            {
              id: 'grounded-matches',
              component: 'ProductGrid',
              title: 'Grounded Matches',
              products: summaries.slice(0, 8),
            },
          ],
        });
        return compileCompositionToA2UiMessages({
          composition: groundedComposition,
          surfaceKind: 'shopper',
          surfaceSubKey: conversationId,
          runId,
          conversationId,
          verifiedProductIds: new Set(summaries.map((s) => s.id)),
        }).messages;
      }
    }

    return [];
  }

  private buildAgUiStateSnapshot(params: {
    sessionId: string;
    conversationId: string;
    runId: string;
    contextVersion: number;
    experienceRevision: number;
    market: { country: string; language: string; currency: string };
    exploration: ExplorationCriteria;
    personalizationGranted: boolean;
    delegationStatus: 'ENABLED' | 'DISABLED_CAPABILITY_LIMITATION' | 'NOT_REQUESTED';
    activeProposalIds: string[];
    publishedExperienceRevision: number | null;
    stale: boolean;
  }): VaargAgUiStateSnapshot {
    return vaargAgUiStateSnapshotSchema.parse({
      sessionId: params.sessionId,
      conversationId: params.conversationId,
      runId: params.runId,
      contextVersion: params.contextVersion,
      experienceRevision: params.experienceRevision,
      market: params.market,
      exploration: params.exploration,
      comparisonProductIds: [],
      personalizationGranted: params.personalizationGranted,
      delegationStatus: params.delegationStatus,
      activeProposalIds: params.activeProposalIds,
      publishedExperienceRevision: params.publishedExperienceRevision,
      stale: params.stale,
    });
  }

  /** FIX06: number of AG-UI events whose persistence/broadcast failed. */
  private agUiEventFailures = 0;

  /** FIX06: expose stream-event persistence failures instead of swallowing. */
  getAgUiEventFailureCount(): number {
    return this.agUiEventFailures;
  }

  private async recordAndBroadcastAgUiEvent(
    storeId: string,
    runId: string,
    sourceKey: string,
    event: AGUIEvent,
  ): Promise<boolean> {
    try {
      const persisted = await appendAgentRunStreamEvent(this.database.getPool(), {
        storeId,
        runId,
        event,
        sourceKey,
      });
      if (persisted) {
        this.runEventBus.emit(`run:${runId}`, persisted);
      }
      return true;
    } catch (err) {
      // FIX06: never silently drop a stream event failure. Surface it with a
      // redacted, bounded log line and a counter so the failure is observable
      // without tearing down an in-flight stream.
      this.agUiEventFailures += 1;
      const reason =
        err instanceof Error
          ? err.message.slice(0, 200)
          : String(err).slice(0, 200);
      console.error(
        `[vaarg] AG-UI event persistence failed store=${storeId} run=${runId} source=${sourceKey}: ${reason}`,
      );
      return false;
    }
  }

  /**
   * Internal mutating settlement helper — ONLY invoked by the background stream pump
   * or explicit `POST /v1/agent/runs/:runId/publish` (NEVER from any GET handler!).
   */
  private async reconcileAndSettleRun(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
    runId: string,
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
        providerCallId: `vaarg-call:${current.runId}`,
        inputTokens: snapshot.usage.inputTokens,
        outputTokens: snapshot.usage.outputTokens,
        cacheReadTokens: snapshot.usage.cacheReadTokens,
        cacheWriteTokens: snapshot.usage.cacheWriteTokens,
        measuredCostUsd: measuredCost,
        ...(snapshot.runtime?.routeSource ? { routeSource: snapshot.runtime.routeSource } : {}),
      });
    } else if (!snapshot.usage && current.budget.reservedModelCalls > 0) {
      // FIX04: provider usage evidence is missing — explicitly record UNKNOWN
      // rather than silently reporting zero usage or leaking the reservation.
      await markProviderCallUnknown(pool, {
        storeId: tenant.storeId,
        rootRunId: current.rootRunId,
        providerCallId: `vaarg-call:${current.runId}`,
        reason: 'provider_usage_unavailable_at_settlement',
      });
    }

    const parsedOutput =
      snapshot.status === 'completed' && snapshot.output
        ? tryParseStructuredMasterOutput(snapshot.output)
        : null;

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
              experienceRevision: null,
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
      publishedExperienceRevision: null,
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
