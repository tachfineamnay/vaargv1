import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_TOOL_CAPABILITIES,
  EventType,
  ROLE_DEFINITIONS,
  VAARG_AGUI_CUSTOM_EVENTS,
  buildVaargSurfaceId,
  emptyConsentState,
  emptyExplorationCriteria,
  experienceContextSchema,
  type AgentPort,
  type AgentRunRecord,
  type TenantContext,
  type VisitorSession,
  type WorkflowOrchestrationPort,
} from '@vaarg/shared';
import {
  ConfinementAttestationRegistry,
  ProviderPolicyRegistry,
  issueRunBridgeTicket,
  signRuntimeAttestationPayload,
} from '@vaarg/persistence';
import type { AbuseLimitService } from '../src/infra/abuse-limit.service.js';

const abuseLimitStub = { enforce: vi.fn(async () => undefined) } as unknown as AbuseLimitService;

const persistenceMocks = vi.hoisted(() => ({
  getOwnedAgentRun: vi.fn(),
  getConversationWithBoundedHistory: vi.fn(),
  listActionProposalsForRun: vi.fn(),
  updateActionProposalResolution: vi.fn(),
  finalizeMasterRunAndAcceptMessage: vi.fn(),
  markRunPublishedExperienceRevision: vi.fn(async () => undefined),
  appendAgentRunStreamEvent: vi.fn(),
  listAgentRunStreamEvents: vi.fn(),
  getCatalogProductV1: vi.fn(),
  getCatalogCollectionV1: vi.fn(),
  resolveProductSummaries: vi.fn(),
  compareCatalogProductsV1: vi.fn(),
  getOwnedActionProposalById: vi.fn(),
  reserveChildDelegationRun: vi.fn(),
}));

vi.mock('@vaarg/persistence', async (original) => ({
  ...(await original<typeof import('@vaarg/persistence')>()),
  getOwnedAgentRun: persistenceMocks.getOwnedAgentRun,
  getConversationWithBoundedHistory: persistenceMocks.getConversationWithBoundedHistory,
  listActionProposalsForRun: persistenceMocks.listActionProposalsForRun,
  updateActionProposalResolution: persistenceMocks.updateActionProposalResolution,
  finalizeMasterRunAndAcceptMessage: persistenceMocks.finalizeMasterRunAndAcceptMessage,
  markRunPublishedExperienceRevision: persistenceMocks.markRunPublishedExperienceRevision,
  appendAgentRunStreamEvent: persistenceMocks.appendAgentRunStreamEvent,
  listAgentRunStreamEvents: persistenceMocks.listAgentRunStreamEvents,
  getCatalogProductV1: persistenceMocks.getCatalogProductV1,
  getCatalogCollectionV1: persistenceMocks.getCatalogCollectionV1,
  resolveProductSummaries: persistenceMocks.resolveProductSummaries,
  compareCatalogProductsV1: persistenceMocks.compareCatalogProductsV1,
  getOwnedActionProposalById: persistenceMocks.getOwnedActionProposalById,
  reserveChildDelegationRun: persistenceMocks.reserveChildDelegationRun,
}));

import { ConversationController } from '../src/intelligence/conversation.controller.js';
import { ConversationService } from '../src/intelligence/conversation.service.js';
import { HermesBridgeController } from '../src/intelligence/hermes-bridge.controller.js';
import type { ToolBrokerService } from '../src/intelligence/tool-broker.service.js';
import type { DatabaseClient } from '../src/infra/database-client.js';
import type { ExperienceService } from '../src/experience/experience.service.js';

const BRIDGE_SECRET = 'bridge-secret-0123456789abcdef0123456789abcdef';
const storeId = '00000000-0000-4000-8000-000000000001';
const sessionId = '00000000-0000-4000-8000-0000000000aa';
const otherSessionId = '00000000-0000-4000-8000-0000000000bb';
const conversationId = '00000000-0000-4000-8000-0000000000cc';
const runId = '00000000-0000-4000-8000-0000000000dd';
const proposalId = '00000000-0000-4000-8000-0000000000ee';

const tenant: TenantContext = {
  storeId,
  host: 'atelier.example.test',
  country: 'FR',
  language: 'FR',
  currency: 'EUR',
  correlationId: 'corr-fl07',
};

const activeSession: VisitorSession = {
  sessionId,
  storeId,
  customerId: null,
  status: 'active',
  context: 'storefront',
  expiresAt: '2026-12-01T00:00:00.000Z',
  createdAt: '2026-11-27T00:00:00.000Z',
};

const sampleContext = experienceContextSchema.parse({
  store: { storeId, market: { country: 'FR', language: 'FR', currency: 'EUR' } },
  session: { sessionId, status: 'active', customerId: null },
  customerId: null,
  market: { country: 'FR', language: 'FR', currency: 'EUR' },
  consent: emptyConsentState(),
  preferences: [],
  exploration: emptyExplorationCriteria(),
  recentlyViewed: [],
  intentSignals: [],
  conversationRef: { conversationId },
  cartRef: null,
  brandRevision: null,
  configurationRevision: null,
  contextVersion: 2,
  experienceRevision: 1,
});

const baseRun: AgentRunRecord = {
  runId,
  rootRunId: runId,
  parentRunId: null,
  storeId,
  conversationId,
  sessionId,
  customerId: null,
  triggerMessageId: null,
  role: 'master',
  depth: 0,
  status: 'completed',
  terminalReason: null,
  hermesRunId: 'hermes-run-fl07',
  hermesSessionId: 'hermes-sess-fl07',
  delegationId: null,
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  promptVersion: '1.0.0',
  policyKey: 'master:anthropic:claude-sonnet-4-5',
  contextVersion: 2,
  publishedExperienceRevision: null,
  correlationId: 'corr-fl07',
  idempotencyKey: null,
  budget: {
    ...ROLE_DEFINITIONS.master.defaultBudgetPolicy,
    reservedTokens: 0,
    consumedTokens: 120,
    consumedModelCalls: 1,
    consumedToolCalls: 1,
    reservedCostUsd: 0,
    consumedCostUsd: 0.001,
    activeChildren: 0,
    totalChildrenSpawned: 0,
    deadlineAt: '2026-11-27T13:00:00.000Z',
  },
  cancelRequestedAt: null,
  startedAt: '2026-11-27T12:00:00.000Z',
  completedAt: '2026-11-27T12:00:02.000Z',
  redactedTrace: {},
  validatedOutput: { responseMessage: 'Grounded response.' },
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-11-27T12:00:00.000Z',
  updatedAt: '2026-11-27T12:00:02.000Z',
};

describe('FL07 API — Non-Mutating GET, Confinement Attestation, Non-Gemini Delegation, AG-UI SSE & Controlled Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects ?publish=true on GET /v1/agent/runs/:runId/result and enforces CSRF on POST /v1/agent/runs/:runId/publish', async () => {
    const fakeConvService = {
      getValidatedResult: vi.fn(),
      publishRunComposition: vi.fn(),
    } as unknown as ConversationService;

    const controller = new ConversationController(
      fakeConvService,
      { resolve: vi.fn(async () => tenant) } as never,
      [],
      { current: vi.fn(async () => activeSession) } as never,
      { get: vi.fn(async () => ({ consents: emptyConsentState() })) } as never,
      { resolveIdentity: vi.fn() } as never,
      { readiness: vi.fn() } as unknown as WorkflowOrchestrationPort,
    );

    await expect(
      controller.getRunResult(runId, 'true', {
        headers: { host: tenant.host, cookie: 'vaarg_visitor_session=abc' },
      } as unknown as FastifyRequest),
    ).rejects.toThrow(/MUTATING_GET_FORBIDDEN/);
    expect(fakeConvService.getValidatedResult).not.toHaveBeenCalled();

    // Cross-origin cookie POST to /publish must be rejected by CSRF check
    await expect(
      controller.publishRunComposition(runId, {}, {
        headers: {
          host: tenant.host,
          origin: 'https://evil.example.test',
          cookie: 'vaarg_visitor_session=abc',
        },
      } as unknown as FastifyRequest),
    ).rejects.toThrow();
    expect(fakeConvService.publishRunComposition).not.toHaveBeenCalled();
  });

  it('verifies HMAC runtime attestation and enforces non-Gemini specialist provider policy on subagent-start', async () => {
    const attestationRegistry = new ConfinementAttestationRegistry();
    const deepseekPolicies = ProviderPolicyRegistry.fromEnv({
      DEEPSEEK_API_KEY: 'sk-deepseek-direct-verified-key-0123456789',
      VAARG_DEFAULT_MODEL_PROVIDER: 'deepseek',
      VAARG_DEFAULT_MODEL_NAME: 'deepseek-chat',
    });

    const bridgeController = new HermesBridgeController(
      { getPool: () => ({}) } as unknown as DatabaseClient,
      {} as unknown as ToolBrokerService,
      deepseekPolicies,
      BRIDGE_SECRET,
      attestationRegistry,
    );

    const nowMs = Date.now();
    const attestPayload = {
      runtimeInstanceId: 'hermes-prod-1',
      hermesVersion: '0.23.4',
      pluginVersion: '1.1.0',
      activeHooks: [
        'pre_tool_call',
        'pre_api_request',
        'post_api_request',
        'subagent_start',
        'subagent_stop',
      ],
      registeredCapabilities: [...ACTIVE_TOOL_CAPABILITIES],
      forbiddenToolsBlocked: true,
      timestampMs: nowMs,
    };

    const authReq = {
      headers: { authorization: `Bearer ${BRIDGE_SECRET}` },
    } as unknown as FastifyRequest;

    // 1. Rejects invalid signature
    await expect(
      bridgeController.attestRuntimeConfinement(
        { ...attestPayload, signature: 'a'.repeat(64) },
        authReq,
      ),
    ).rejects.toThrow();
    expect(attestationRegistry.hasFreshAttestation()).toBe(false);

    // 2. Accepts valid HMAC signature and certifies registry
    const validSig = signRuntimeAttestationPayload(BRIDGE_SECRET, attestPayload);
    const attestOut = await bridgeController.attestRuntimeConfinement(
      { ...attestPayload, signature: validSig },
      authReq,
    );
    expect(attestOut.preventiveHooksVerified).toBe(true);
    expect(attestationRegistry.hasFreshAttestation()).toBe(true);

    // 3. Subagent start returns verified Anthropic provider + model (zero Gemini fallback!)
    const ticket = issueRunBridgeTicket(BRIDGE_SECRET, {
      storeId,
      rootRunId: runId,
      conversationId,
      sessionId,
      preventiveHooksVerified: true,
      ttlMs: 60_000,
    });
    persistenceMocks.reserveChildDelegationRun.mockResolvedValueOnce({
      runId: '00000000-0000-4000-8000-000000000099',
      role: 'discovery',
      depth: 1,
    });

    const childOut = await bridgeController.registerSubagentStart(
      {
        bridgeTicket: ticket,
        parentHermesSessionId: 'hermes-sess-fl07',
        childHermesSessionId: 'hermes-child-1',
        delegationId: 'del-1',
        role: 'discovery',
        depth: 1,
      },
      authReq,
    );
    expect(childOut).toEqual({
      allowed: true,
      childRunId: '00000000-0000-4000-8000-000000000099',
      role: 'discovery',
      depth: 1,
      provider: 'deepseek',
      model: 'deepseek-chat',
    });

    // 4. Forbidden provider (OpenRouter) is rejected at strict Zod schema boundary
    await expect(
      bridgeController.registerSubagentStart(
        {
          bridgeTicket: ticket,
          parentHermesSessionId: 'hermes-sess-fl07',
          childHermesSessionId: 'hermes-child-2',
          delegationId: 'del-2',
          role: 'discovery',
          depth: 1,
          provider: 'openrouter',
          model: 'deepseek/deepseek-chat',
        },
        authReq,
      ),
    ).rejects.toThrow(/Invalid subagent-start payload/);

    // 5. Unconfigured provider (Gemini without GEMINI_API_KEY) fails closed without fallback
    await expect(
      bridgeController.registerSubagentStart(
        {
          bridgeTicket: ticket,
          parentHermesSessionId: 'hermes-sess-fl07',
          childHermesSessionId: 'hermes-child-3',
          delegationId: 'del-3',
          role: 'discovery',
          depth: 1,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
        },
        authReq,
      ),
    ).rejects.toThrow(/MODEL_PROVIDER_NOT_CONFIGURED/);
  });

  it('streams official AG-UI 1.0.5 SSE frames with Last-Event-ID replay and resync_required recovery', async () => {
    const expMock = {
      getContext: vi.fn(async () => sampleContext),
    } as unknown as ExperienceService;
    const agentPortMock = {
      runtimeCapabilities: vi.fn(),
    } as unknown as AgentPort;

    const service = new ConversationService(
      { getPool: () => ({}) } as unknown as DatabaseClient,
      expMock,
      agentPortMock,
      ProviderPolicyRegistry.fromEnv({}),
      BRIDGE_SECRET,
      abuseLimitStub,
    );

    persistenceMocks.getOwnedAgentRun.mockResolvedValue(baseRun);
    persistenceMocks.listAgentRunStreamEvents.mockResolvedValueOnce({
      events: [
        {
          eventSeq: 5,
          eventId: `${runId}:5`,
          runId,
          event: {
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: 'm1',
            delta: 'Grounded Signet Ring.',
            timestamp: Date.now(),
          },
        },
        {
          eventSeq: 6,
          eventId: `${runId}:6`,
          runId,
          event: {
            type: EventType.RUN_FINISHED,
            threadId: conversationId,
            runId,
            outcome: { type: 'success' },
            timestamp: Date.now(),
          },
        },
      ],
      minRetainedSeq: 5,
      latestEventSeq: 6,
      resyncRequired: true,
    });

    const chunks: string[] = [];
    const fakeRes = Object.assign(new EventEmitter(), {
      writableEnded: false,
      destroyed: false,
      writeHead: vi.fn(),
      write: vi.fn((chunk: string) => {
        chunks.push(chunk);
        return true;
      }),
      end: vi.fn(function (this: { writableEnded: boolean }) {
        this.writableEnded = true;
      }),
    }) as unknown as ServerResponse;

    await service.streamRunAgUiEvents({
      tenant,
      session: activeSession,
      consent: emptyConsentState(),
      runId,
      lastEventId: `${runId}:2`,
      afterSeqQuery: undefined,
      rawResponse: fakeRes,
      abortSignal: new AbortController().signal,
    });

    const fullWire = chunks.join('');
    expect(fullWire).toContain(VAARG_AGUI_CUSTOM_EVENTS.RESYNC_REQUIRED);
    expect(fullWire).toContain(EventType.STATE_SNAPSHOT);
    expect(fullWire).toContain(`id: ${runId}:5`);
    expect(fullWire).toContain(`id: ${runId}:6`);
    expect(fullWire).toContain(EventType.RUN_FINISHED);

    // Rejects mismatched runId in Last-Event-ID
    await expect(
      service.streamRunAgUiEvents({
        tenant,
        session: activeSession,
        consent: emptyConsentState(),
        runId,
        lastEventId: `${proposalId}:2`,
        afterSeqQuery: undefined,
        rawResponse: fakeRes,
        abortSignal: new AbortController().signal,
      }),
    ).rejects.toThrow(/CURSOR_RUN_MISMATCH/);
  });

  it('enforces session surface ownership, catalog grounding, idempotency, and future-phase non-execution on POST /v1/agent/actions', async () => {
    const ingestSpy = vi.fn(async () => ({
      accepted: 1,
      duplicates: 0,
      rejected: 0,
      contextVersion: 3,
      experienceRevision: 1,
    }));
    const expMock = {
      getContext: vi.fn(async () => sampleContext),
      ingestEvents: ingestSpy,
    } as unknown as ExperienceService;

    const service = new ConversationService(
      { getPool: () => ({}) } as unknown as DatabaseClient,
      expMock,
      { runtimeCapabilities: vi.fn() } as unknown as AgentPort,
      ProviderPolicyRegistry.fromEnv({}),
      BRIDGE_SECRET,
      abuseLimitStub,
    );

    const ownedSurface = buildVaargSurfaceId(sessionId, 'shopper', conversationId);
    const foreignSurface = buildVaargSurfaceId(otherSessionId, 'shopper', conversationId);

    // 1. Cross-session surfaceId rejected fail-closed
    await expect(
      service.executeUiAction(tenant, activeSession, emptyConsentState(), {
        version: '1.0',
        action: {
          name: 'view_product',
          surfaceId: foreignSurface,
          sourceComponentId: 'sec-1',
          timestamp: '2026-11-27T12:00:00.000Z',
          context: { handle: 'signet-ring' },
        },
      }),
    ).rejects.toThrow(/SURFACE_SESSION_MISMATCH/);

    // 2. Ungrounded product handle rejected (404)
    persistenceMocks.getCatalogProductV1.mockResolvedValueOnce(null);
    await expect(
      service.executeUiAction(tenant, activeSession, emptyConsentState(), {
        version: '1.0',
        action: {
          name: 'view_product',
          surfaceId: ownedSurface,
          sourceComponentId: 'sec-1',
          timestamp: '2026-11-27T12:00:00.000Z',
          context: { handle: 'hallucinated-ring' },
        },
      }),
    ).rejects.toThrow(/UNGROUNDED_PRODUCT_ACTION/);

    // 3. Verified product view executes and replays idempotently
    persistenceMocks.getCatalogProductV1.mockResolvedValueOnce({
      summary: {
        id: 'gid://shopify/Product/1001',
        handle: 'signet-ring',
      },
    });
    const validEnvelope = {
      version: '1.0' as const,
      action: {
        name: 'view_product',
        surfaceId: ownedSurface,
        sourceComponentId: 'sec-1',
        timestamp: '2026-11-27T12:00:00.000Z',
        context: { handle: 'signet-ring', productId: 'gid://shopify/Product/1001' },
      },
    };
    const first = await service.executeUiAction(
      tenant,
      activeSession,
      emptyConsentState(),
      validEnvelope,
      'idem-action-1',
    );
    const second = await service.executeUiAction(
      tenant,
      activeSession,
      emptyConsentState(),
      validEnvelope,
      'idem-action-1',
    );
    expect(first).toEqual(second);
    expect(ingestSpy).toHaveBeenCalledTimes(1);
    if (first.status === 'APPLIED') {
      expect(first.navigationHref).toBe('/products/signet-ring');
    }

    // 4. Future-phase commercial action (`add_to_cart`) never executes a mutation
    persistenceMocks.getOwnedActionProposalById.mockResolvedValueOnce({
      proposalId,
      status: 'proposed',
    });
    const futureOut = await service.executeUiAction(
      tenant,
      activeSession,
      emptyConsentState(),
      {
        version: '1.0',
        action: {
          name: 'add_to_cart',
          surfaceId: ownedSurface,
          sourceComponentId: 'sec-1',
          timestamp: '2026-11-27T12:00:00.000Z',
          context: { proposalId },
        },
      },
    );
    expect(futureOut).toMatchObject({
      status: 'UNAVAILABLE_IN_CURRENT_PHASE',
      executed: false,
      actionName: 'add_to_cart',
      availableIn: 'FL08',
      proposalStatus: 'verified_non_executing',
    });
  });
});
