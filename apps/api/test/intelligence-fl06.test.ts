import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import {
  ROLE_DEFINITIONS,
  emptyConsentState,
  emptyExplorationCriteria,
  experienceContextSchema,
  type AdaptiveComposition,
  type AgentPort,
  type AgentRunRecord,
  type TenantContext,
  type VisitorSession,
  type WorkflowOrchestrationPort,
} from '@vaarg/shared';
import {
  ProviderPolicyRegistry,
  issueRunBridgeTicket,
  verifyCatalogDelegation,
  type StorefrontBinding,
} from '@vaarg/persistence';

const persistenceMocks = vi.hoisted(() => ({
  getProduct: vi.fn(),
  getVariant: vi.fn(),
  compareProducts: vi.fn(),
  getCompatibleOptions: vi.fn(),
  getRelatedProducts: vi.fn(),
  beginToolInvocationAudit: vi.fn(),
  finalizeToolInvocationAudit: vi.fn(),
  recordDeniedToolInvocation: vi.fn(),
  recordActionProposalRecord: vi.fn(),
  advanceRunContextVersion: vi.fn(),
  resolveRunIdentityForHermesSession: vi.fn(),
  reserveModelCallBudget: vi.fn(),
  reconcileModelCallUsage: vi.fn(),
  reserveChildDelegationRun: vi.fn(),
  completeChildDelegationRun: vi.fn(),
  syncRoleDefinitionsAndProviderPolicies: vi.fn(),
  createConversationRecord: vi.fn(),
  getConversationWithBoundedHistory: vi.fn(),
  appendUserConversationMessage: vi.fn(),
  supersedeActiveConversationRuns: vi.fn(),
  createMasterAgentRunRecord: vi.fn(),
  bindExternalHermesRunId: vi.fn(),
  getOwnedAgentRun: vi.fn(),
  listActionProposalsForRun: vi.fn(),
  updateActionProposalResolution: vi.fn(),
  finalizeMasterRunAndAcceptMessage: vi.fn(),
  cancelAgentRunTree: vi.fn(),
}));

vi.mock('@vaarg/persistence', async (original) => ({
  ...(await original<typeof import('@vaarg/persistence')>()),
  getProduct: persistenceMocks.getProduct,
  getVariant: persistenceMocks.getVariant,
  compareProducts: persistenceMocks.compareProducts,
  getCompatibleOptions: persistenceMocks.getCompatibleOptions,
  getRelatedProducts: persistenceMocks.getRelatedProducts,
  beginToolInvocationAudit: persistenceMocks.beginToolInvocationAudit,
  finalizeToolInvocationAudit: persistenceMocks.finalizeToolInvocationAudit,
  recordDeniedToolInvocation: persistenceMocks.recordDeniedToolInvocation,
  recordActionProposalRecord: persistenceMocks.recordActionProposalRecord,
  advanceRunContextVersion: persistenceMocks.advanceRunContextVersion,
  resolveRunIdentityForHermesSession: persistenceMocks.resolveRunIdentityForHermesSession,
  reserveModelCallBudget: persistenceMocks.reserveModelCallBudget,
  reconcileModelCallUsage: persistenceMocks.reconcileModelCallUsage,
  reserveChildDelegationRun: persistenceMocks.reserveChildDelegationRun,
  completeChildDelegationRun: persistenceMocks.completeChildDelegationRun,
  syncRoleDefinitionsAndProviderPolicies: persistenceMocks.syncRoleDefinitionsAndProviderPolicies,
  createConversationRecord: persistenceMocks.createConversationRecord,
  getConversationWithBoundedHistory: persistenceMocks.getConversationWithBoundedHistory,
  appendUserConversationMessage: persistenceMocks.appendUserConversationMessage,
  supersedeActiveConversationRuns: persistenceMocks.supersedeActiveConversationRuns,
  createMasterAgentRunRecord: persistenceMocks.createMasterAgentRunRecord,
  bindExternalHermesRunId: persistenceMocks.bindExternalHermesRunId,
  getOwnedAgentRun: persistenceMocks.getOwnedAgentRun,
  listActionProposalsForRun: persistenceMocks.listActionProposalsForRun,
  updateActionProposalResolution: persistenceMocks.updateActionProposalResolution,
  finalizeMasterRunAndAcceptMessage: persistenceMocks.finalizeMasterRunAndAcceptMessage,
  cancelAgentRunTree: persistenceMocks.cancelAgentRunTree,
}));

import { ToolBrokerService } from '../src/intelligence/tool-broker.service.js';
import { HermesBridgeController } from '../src/intelligence/hermes-bridge.controller.js';
import { ConversationService } from '../src/intelligence/conversation.service.js';
import { ConversationController } from '../src/intelligence/conversation.controller.js';
import type { DatabaseClient } from '../src/infra/database-client.js';
import type { ExperienceService } from '../src/experience/experience.service.js';
import type { ConsentService } from '../src/privacy/consent.service.js';
import type { VisitorSessionService } from '../src/sessions/visitor-session.service.js';
import type { TenantContextResolver } from '../src/tenant/tenant-context.resolver.js';
import type { MerchantAuthService } from '../src/identity/merchant-auth.service.js';

const BRIDGE_SECRET = 'synthetic-hermes-bridge-secret-minimum-32-chars!!';
const CATALOG_SECRET = 'synthetic-catalog-signing-secret-min-32-bytes!!';
const storeId = '00000000-0000-4000-8000-000000000001';
const sessionId = '00000000-0000-4000-8000-000000000002';
const conversationId = '00000000-0000-4000-8000-000000000003';
const runId = '00000000-0000-4000-8000-000000000004';
const proposalId = '00000000-0000-4000-8000-000000000005';

const binding: StorefrontBinding = {
  host: 'industrial.example',
  storeId,
  country: 'FR',
  language: 'FR',
  currency: 'EUR',
  shopifyDomain: 'industrial.myshopify.com',
  tokenEnv: 'SHOPIFY_INDUSTRIAL_TOKEN',
};

const tenant: TenantContext = {
  storeId,
  host: binding.host,
  country: 'FR',
  language: 'FR',
  currency: 'EUR',
  storeStatus: 'active',
  correlationId: 'corr-fl06-test',
};

const activeSession: VisitorSession = {
  sessionId,
  storeId,
  customerId: null,
  status: 'active',
  context: 'default',
  expiresAt: '2026-11-28T00:00:00.000Z',
  createdAt: '2026-11-27T00:00:00.000Z',
};

const sampleContext = experienceContextSchema.parse({
  store: { storeId, market: { country: 'FR', language: 'FR', currency: 'EUR' } },
  market: { country: 'FR', language: 'FR', currency: 'EUR' },
  session: { sessionId, customerId: null, status: 'active' },
  customerId: null,
  consent: emptyConsentState(),
  exploration: emptyExplorationCriteria(),
  preferences: [],
  intentSignals: [],
  recentlyViewed: [],
  conversationRef: null,
  cartRef: null,
  brandRevision: null,
  configurationRevision: null,
  contextVersion: 4,
  experienceRevision: 1,
});

const sampleComposition: AdaptiveComposition = {
  sessionId,
  contextVersion: 4,
  experienceRevision: 1,
  mode: 'ssr',
  adaptationReason: 'explicit_criteria',
  freshness: '2026-11-27T12:00:00.000Z',
  sections: [
    {
      id: 'chips-valves',
      component: 'SuggestionChips',
      chips: [{ label: 'DN50 Valves', href: '/collections/valves' }],
    },
  ],
};

describe('FL06 API: ToolBrokerService, HermesBridgeController (HTTP+MCP), ConversationService & Operator Workflow Trigger', () => {
  const database = { getPool: () => ({}) } as unknown as DatabaseClient;
  const policyRegistry = ProviderPolicyRegistry.fromEnv({
    GEMINI_API_KEY: 'synthetic-gemini-api-key-valid',
  });

  const expCapabilities = {
    searchCatalog: vi.fn(async () => ({
      status: 'OK' as const,
      catalogStatus: 'OK' as const,
      mode: 'hybrid' as const,
      query: 'dn50',
      items: [],
      provenance: {
        channels: ['fts' as const, 'trigram' as const],
        rrfK: 60,
        candidatePool: 100,
        embedding: null,
      },
      completedAt: '2026-11-27T11:55:00.000Z',
      generatedAt: '2026-11-27T12:00:00.000Z',
    })),
    getExperienceContext: vi.fn(async () => sampleContext),
    getRecommendations: vi.fn(async () => ({
      items: [],
      provenance: {
        channels: ['fts' as const],
        rrfK: 60,
        candidatePool: 50,
        embedding: null,
        strategy: 'market_default' as const,
        signalWeights: {},
      },
      completedAt: '2026-11-27T11:55:00.000Z',
      generatedAt: '2026-11-27T12:00:00.000Z',
      sourceContextVersion: 4,
      consentLimited: true,
    })),
    proposeExperienceComposition: vi.fn(async () => sampleComposition),
    updateExplicitCriteria: vi.fn(async () => ({
      ...sampleContext,
      contextVersion: 5,
    })),
  };

  const getContextSpy = vi.fn(async () => sampleContext);
  const tryPublishSpy = vi.fn();
  const experienceMock = {
    getContext: getContextSpy,
    capabilitiesForServerVerifiedSession: vi.fn(() => expCapabilities),
    recordConversationMessageEvent: vi.fn(async () => ({
      ...sampleContext,
      contextVersion: 5,
    })),
    tryPublishCompositionProposal: tryPublishSpy,
  } as unknown as ExperienceService;

  const consentsMock = {
    get: vi.fn(async () => ({
      customerId: null,
      consents: emptyConsentState(),
    })),
  } as unknown as ConsentService;

  beforeEach(() => {
    vi.clearAllMocks();
    persistenceMocks.beginToolInvocationAudit.mockResolvedValue({
      kind: 'started',
      invocationId: '00000000-0000-4000-8000-000000000091',
    });
    persistenceMocks.finalizeToolInvocationAudit.mockResolvedValue(undefined);
    persistenceMocks.recordDeniedToolInvocation.mockResolvedValue(undefined);
    persistenceMocks.getCompatibleOptions.mockResolvedValue({
      status: 'FRESH',
      completedAt: '2026-11-27T11:55:00.000Z',
      product: {
        id: 'gid://shopify/Product/1001',
        handle: 'dn50-ball-valve',
        title: 'DN50 Stainless Ball Valve',
      },
      options: [{ name: 'Seal Material', values: ['PTFE', 'FKM'] }],
      personalization: [],
      compatibility: 'UNKNOWN',
    });
    persistenceMocks.recordActionProposalRecord.mockResolvedValue({
      proposalId,
      storeId,
      runId,
      conversationId,
      sessionId,
      customerId: null,
      proposedByRole: 'experience',
      proposalType: 'experience_composition',
      status: 'proposed',
      requiresConfirmation: false,
      contextVersion: 4,
      appliedExperienceRevision: null,
      payload: sampleComposition,
      createdAt: '2026-11-27T12:00:00.000Z',
      updatedAt: '2026-11-27T12:00:00.000Z',
    });
  });

  it('enforces role allowlists, blocks forbidden runtime/authority args, and records non-mutating composition proposals in ToolBrokerService', async () => {
    const broker = new ToolBrokerService(database, [binding], experienceMock);

    // 1. Blocks forbidden runtime tools (e.g. terminal) and audits denial
    await expect(
      broker.invoke({
        storeId,
        rootRunId: runId,
        runId,
        conversationId,
        sessionId,
        customerId: null,
        role: 'master',
        roleVerified: true,
        contextVersion: 4,
        correlationId: 'corr-1',
        capability: 'terminal',
        rawArguments: { command: 'whoami' },
      }),
    ).rejects.toThrow(/prohibited/i);
    expect(persistenceMocks.recordDeniedToolInvocation).toHaveBeenCalledTimes(1);

    // 2. Blocks caller-injected authority fields (storeId / consent / signals)
    await expect(
      broker.invoke({
        storeId,
        rootRunId: runId,
        runId,
        conversationId,
        sessionId,
        customerId: null,
        role: 'master',
        roleVerified: true,
        contextVersion: 4,
        correlationId: 'corr-1',
        capability: 'search_catalog',
        rawArguments: { q: 'valve', storeId: '00000000-0000-4000-8000-000000000099' },
      }),
    ).rejects.toThrow(/authority/i);

    // 3. Discovery specialist is blocked from update_explicit_criteria
    await expect(
      broker.invoke({
        storeId,
        rootRunId: runId,
        runId,
        conversationId,
        sessionId,
        customerId: null,
        role: 'discovery',
        roleVerified: true,
        contextVersion: 4,
        correlationId: 'corr-1',
        capability: 'update_explicit_criteria',
        rawArguments: { criteria: { vendor: 'VAARG Fluid' } },
      }),
    ).rejects.toThrow(/not permitted/i);

    // 4. Discovery specialist CAN inspect compatible options; compatibility is explicitly 'UNKNOWN'
    const compat = (await broker.invoke({
      storeId,
      rootRunId: runId,
      runId,
      conversationId,
      sessionId,
      customerId: null,
      role: 'discovery',
      roleVerified: true,
      contextVersion: 4,
      correlationId: 'corr-1',
      capability: 'get_compatible_options',
      rawArguments: { shopifyGid: 'gid://shopify/Product/1001' },
    })) as { found: boolean; compatibility: string };
    expect(compat.found).toBe(true);
    expect(compat.compatibility).toBe('UNKNOWN');

    // 5. Experience specialist creates non-mutating proposal without publishing directly
    const propOut = (await broker.invoke({
      storeId,
      rootRunId: runId,
      runId,
      conversationId,
      sessionId,
      customerId: null,
      role: 'experience',
      roleVerified: true,
      contextVersion: 4,
      correlationId: 'corr-1',
      capability: 'propose_experience_composition',
      rawArguments: { reason: 'explicit_criteria', limit: 6 },
    })) as { proposalId: string; status: string };
    expect(propOut).toMatchObject({
      proposalId,
      status: 'proposed',
    });
    expect(tryPublishSpy).not.toHaveBeenCalled();
  });

  it('authenticates HermesBridgeController guard & MCP JSON-RPC endpoints and blocks grandchildren (depth > 1)', async () => {
    const broker = new ToolBrokerService(database, [binding], experienceMock);
    const controller = new HermesBridgeController(database, broker, policyRegistry, BRIDGE_SECRET);

    const validTicket = issueRunBridgeTicket(BRIDGE_SECRET, {
      storeId,
      rootRunId: runId,
      conversationId,
      sessionId,
      preventiveHooksVerified: true,
      ttlMs: 60_000,
    });

    // Rejects missing shared bridge secret
    await expect(
      controller.invokeTool(
        {
          bridgeTicket: validTicket,
          hermesSessionId: 'hermes-master',
          capability: 'get_experience_context',
          arguments: {},
        },
        { headers: {} } as unknown as FastifyRequest,
      ),
    ).rejects.toThrow();

    // Blocks depth > 1 grandchild spawn attempt
    await expect(
      controller.registerSubagentStart(
        {
          bridgeTicket: validTicket,
          parentHermesSessionId: 'child-1',
          childHermesSessionId: 'grandchild-1',
          delegationId: 'del-grandchild',
          role: 'discovery',
          depth: 2,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
        },
        {
          headers: { authorization: `Bearer ${BRIDGE_SECRET}` },
        } as unknown as FastifyRequest,
      ),
    ).rejects.toThrow();

    // Serves role-scoped MCP tools/list ONLY for the caller's role (memory -> 1 tool: get_experience_context)
    persistenceMocks.resolveRunIdentityForHermesSession.mockResolvedValueOnce({
      roleVerified: true,
      run: {
        runId: '00000000-0000-4000-8000-000000000077',
        role: 'memory',
        customerId: null,
        contextVersion: 4,
        correlationId: 'corr-mcp',
      },
    });
    const mcpList = (await controller.handleMcpJsonRpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      },
      {
        headers: {
          authorization: `Bearer ${BRIDGE_SECRET}`,
          'x-vaarg-bridge-ticket': validTicket,
          'x-hermes-session-id': 'hermes-memory-child',
        },
      } as unknown as FastifyRequest,
    )) as { result: { tools: Array<{ name: string }> } };

    expect(mcpList.result.tools.map((t) => t.name)).toEqual(['get_experience_context']);
  });

  it('blocks stale composition publication when contextVersion advances concurrently and publishes when CAS matches', async () => {
    const baseRun: AgentRunRecord = {
      runId,
      rootRunId: runId,
      parentRunId: null,
      storeId,
      conversationId,
      sessionId,
      customerId: null,
      triggerMessageId: '00000000-0000-4000-8000-000000000021',
      role: 'master',
      depth: 0,
      status: 'running',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      promptVersion: ROLE_DEFINITIONS.master.version,
      hermesRunId: 'hermes-run-1',
      hermesSessionId: 'hermes-sess-1',
      delegationId: null,
      contextVersion: 4,
      correlationId: 'corr-1',
      budget: {
        policy: ROLE_DEFINITIONS.master.defaultBudgetPolicy,
        reservedTokens: 0,
        consumedInputTokens: 0,
        consumedOutputTokens: 0,
        consumedTotalTokens: 0,
        reservedCostUsd: 0,
        consumedCostUsd: 0,
        consumedModelCalls: 0,
        consumedToolCalls: 0,
        activeChildren: 0,
        spawnedChildrenTotal: 0,
      },
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-11-27T12:00:00.000Z',
      completedAt: null,
      createdAt: '2026-11-27T12:00:00.000Z',
    };

    const agentPort: AgentPort = {
      runtimeCapabilities: vi.fn(async () => ({
        status: 'AVAILABLE' as const,
        runtimeName: 'hermes' as const,
        pinnedVersion: '0.23.4',
        reportedVersion: '0.23.4',
        runSubmission: true,
        runStatus: true,
        runEventsSse: true,
        runStop: true,
        preventiveHooksVerified: true,
        delegationSupported: true,
        delegationLimitationReason: null,
        enabledToolsets: ['delegation', 'vaarg_confinement'],
        forbiddenToolsDetected: [],
        implicitFallbackDetected: false,
      })),
      readiness: vi.fn(),
      startRun: vi.fn(),
      getRun: vi.fn(async () => ({
        internalRunId: runId,
        externalRunId: 'hermes-run-1',
        status: 'completed' as const,
        output: 'We carry the DN50 Stainless Ball Valve (€199.00).',
        error: null,
        turnExitReason: 'end_turn',
        usage: {
          inputTokens: 150,
          outputTokens: 40,
          totalTokens: 190,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        runtime: {
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          routeSource: 'direct',
          requestedProvider: 'gemini',
          requestedModel: 'gemini-2.5-flash',
        },
      })),
      observeRun: vi.fn(),
      cancelRun: vi.fn(),
    };

    const convService = new ConversationService(
      database,
      experienceMock,
      agentPort,
      policyRegistry,
      BRIDGE_SECRET,
    );

    persistenceMocks.getOwnedAgentRun.mockResolvedValue(baseRun);
    persistenceMocks.listActionProposalsForRun.mockResolvedValue([
      {
        proposalId,
        storeId,
        runId,
        conversationId,
        sessionId,
        customerId: null,
        proposedByRole: 'experience',
        proposalType: 'experience_composition',
        status: 'proposed',
        requiresConfirmation: false,
        contextVersion: 4,
        appliedExperienceRevision: null,
        payload: sampleComposition,
        correlationId: 'corr-1',
        idempotencyKey: null,
        expiresAt: '2026-11-28T00:00:00.000Z',
        resolvedAt: null,
        createdAt: '2026-11-27T12:00:00.000Z',
        updatedAt: '2026-11-27T12:00:00.000Z',
      },
    ]);
    persistenceMocks.finalizeMasterRunAndAcceptMessage.mockImplementation(
      async (
        _pool: unknown,
        args: {
          status: AgentRunRecord['status'];
          assistantContent: string | null;
          structuredPayload: Record<string, unknown>;
        },
      ) => ({
        run: { ...baseRun, status: args.status },
        assistantMessage: {
          messageId: '00000000-0000-4000-8000-000000000022',
          storeId,
          conversationId,
          sessionId,
          runId,
          sequence: 2,
          role: 'assistant',
          status: 'accepted',
          content: args.assistantContent,
          structuredPayload: args.structuredPayload,
          contextVersion: 4,
          correlationId: 'corr-1',
          idempotencyKey: null,
          createdAt: '2026-11-27T12:00:01.000Z',
        },
        staleBlocked: false,
      }),
    );

    // 1. Concurrent context advance (live contextVersion 5 !== run contextVersion 4) -> blocks proposal publish!
    getContextSpy.mockResolvedValueOnce({
      ...sampleContext,
      contextVersion: 5,
    });
    await convService.getValidatedResult(tenant, activeSession, emptyConsentState(), runId, true);
    expect(tryPublishSpy).not.toHaveBeenCalled();

    // 2. Matching contextVersion 4 -> publishes via CAS and updates proposal resolution to 'applied'!
    getContextSpy.mockResolvedValueOnce(sampleContext);
    tryPublishSpy.mockResolvedValueOnce(2);
    const reconciled = await convService.getValidatedResult(
      tenant,
      activeSession,
      emptyConsentState(),
      runId,
      true,
    );
    expect(tryPublishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedContextVersion: 4,
      }),
    );
    expect(persistenceMocks.updateActionProposalResolution).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        proposalId,
        status: 'applied',
        appliedExperienceRevision: 2,
      }),
    );
    expect(reconciled.assistantMessage?.structuredPayload.experienceRevision).toBe(2);
  });

  it('enforces merchant owner/marketing authorization and signed delegation on operator catalog-sync workflow trigger', async () => {
    const prevSecret = process.env.CATALOG_JOB_SIGNING_SECRET;
    process.env.CATALOG_JOB_SIGNING_SECRET = CATALOG_SECRET;

    try {
      const submittedPayloads: Array<{ name: string; input: Record<string, unknown> }> = [];
      const workflowPort: WorkflowOrchestrationPort = {
        isConfigured: () => true,
        submitWorkflow: vi.fn(async (name, input) => {
          submittedPayloads.push({
            name,
            input: input as unknown as Record<string, unknown>,
          });
          return {
            executionId: '00000000-0000-4000-8000-000000000099',
            storeId,
            workflowName: name,
            hatchetWorkflowRunId: 'hatchet-wf-1',
            idempotencyKey: input.idempotencyKey,
            correlationId: input.correlationId,
            concurrencyKey: input.concurrencyKey,
            status: 'queued',
            errorCode: null,
            errorMessage: null,
            createdAt: '2026-11-27T12:00:00.000Z',
            updatedAt: '2026-11-27T12:00:00.000Z',
            completedAt: null,
          };
        }),
        getWorkflowStatus: vi.fn(),
        cancelWorkflow: vi.fn(),
      };

      const resolveIdentitySpy = vi.fn();
      const merchantAuth = {
        resolveIdentity: resolveIdentitySpy,
      } as unknown as MerchantAuthService;

      const controller = new ConversationController(
        {} as ConversationService,
        { resolve: vi.fn(async () => tenant) } as unknown as TenantContextResolver,
        [binding],
        {} as VisitorSessionService,
        consentsMock,
        merchantAuth,
        workflowPort,
      );

      const req = {
        headers: {
          host: 'industrial.example',
          authorization: `Bearer ${'M'.repeat(43)}`,
          'x-correlation-id': 'corr-sync-1',
        },
      } as unknown as FastifyRequest;

      // Support role -> 403 Forbidden
      resolveIdentitySpy.mockResolvedValueOnce({
        merchantUserId: '00000000-0000-4000-8000-000000000051',
        sessionId: '00000000-0000-4000-8000-000000000052',
        storeId,
        role: 'support',
      });
      await expect(
        controller.submitOperatorCatalogSync(
          {
            idempotencyKey: 'sync-001',
            initiateNewSweep: true,
            maxPages: 25,
          },
          req,
        ),
      ).rejects.toThrow(/owner or marketing/i);

      // Owner role -> issues valid HMAC delegation ticket and submits to Hatchet
      resolveIdentitySpy.mockResolvedValueOnce({
        merchantUserId: '00000000-0000-4000-8000-000000000051',
        sessionId: '00000000-0000-4000-8000-000000000052',
        storeId,
        role: 'owner',
      });
      const res = await controller.submitOperatorCatalogSync(
        {
          idempotencyKey: 'sync-001',
          initiateNewSweep: true,
          maxPages: 25,
        },
        req,
      );

      expect(res.execution.workflowName).toBe('vaarg.catalog.sync');
      expect(submittedPayloads).toHaveLength(1);
      const claims = verifyCatalogDelegation(
        String(submittedPayloads[0]!.input.delegationTicket),
        CATALOG_SECRET,
      );
      expect(claims).toMatchObject({
        host: 'industrial.example',
        storeId,
        merchantUserId: '00000000-0000-4000-8000-000000000051',
        action: 'start',
      });
    } finally {
      if (prevSecret === undefined) delete process.env.CATALOG_JOB_SIGNING_SECRET;
      else process.env.CATALOG_JOB_SIGNING_SECRET = prevSecret;
    }
  });
});
