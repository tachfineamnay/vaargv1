import { Body, Controller, Header, Inject, Optional, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  AppError,
  ROLE_DEFINITIONS,
  getEffectiveCapabilitiesForRole,
  getToolJsonSchemasForAdvertisedCapabilities,
  hermesBridgeLlmReconcileSchema,
  hermesBridgeLlmReserveSchema,
  hermesBridgeRuntimeAttestSchema,
  hermesBridgeSubagentStartSchema,
  hermesBridgeSubagentStopSchema,
  hermesBridgeToolInvokeSchema,
  mcpJsonRpcRequestSchema,
} from '@vaarg/shared';
import {
  ConfinementAttestationRegistry,
  ProviderPolicyRegistry,
  completeChildDelegationRun,
  reconcileModelCallUsage,
  reserveChildDelegationRun,
  reserveModelCallBudget,
  resolveRunIdentityForHermesSession,
  verifyRunBridgeTicket,
  verifyRuntimeAttestationPayload,
  verifySharedBridgeSecret,
} from '@vaarg/persistence';
import { DatabaseClient } from '../infra/database-client.js';
import {
  CONFINEMENT_ATTESTATION_REGISTRY,
  HERMES_BRIDGE_SECRET_TOKEN,
  PROVIDER_POLICY_REGISTRY,
} from './intelligence.tokens.js';
import { ToolBrokerService } from './tool-broker.service.js';

/**
 * Private authenticated internal boundary between Hermes runtime and VAARG.
 * Never exposed to browsers or public edge routes; requires BOTH shared Bearer
 * secret (`HERMES_TOOL_BRIDGE_SECRET`) AND HMAC-signed per-run `bridgeTicket`.
 */
@Controller('internal/v1')
export class HermesBridgeController {
  constructor(
    @Inject(DatabaseClient) private readonly database: DatabaseClient,
    @Inject(ToolBrokerService) private readonly toolBroker: ToolBrokerService,
    @Inject(PROVIDER_POLICY_REGISTRY) private readonly providerPolicies: ProviderPolicyRegistry,
    @Inject(HERMES_BRIDGE_SECRET_TOKEN) private readonly bridgeSecret: string | undefined,
    @Optional()
    @Inject(CONFINEMENT_ATTESTATION_REGISTRY)
    private readonly attestationRegistry?: ConfinementAttestationRegistry,
  ) {}

  private authenticateBridge(request: FastifyRequest, bridgeTicket: string) {
    verifySharedBridgeSecret(this.bridgeSecret, request.headers.authorization);
    return verifyRunBridgeTicket(this.bridgeSecret!, bridgeTicket);
  }

  @Post('hermes-bridge/guard/runtime-attest')
  @Header('Cache-Control', 'private, no-store')
  async attestRuntimeConfinement(@Body() body: unknown, @Req() request: FastifyRequest) {
    verifySharedBridgeSecret(this.bridgeSecret, request.headers.authorization);
    const parsed = hermesBridgeRuntimeAttestSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.badRequest('Invalid runtime confinement attestation payload');
    }

    if (this.attestationRegistry) {
      const lease = this.attestationRegistry.recordVerifiedAttestation(
        this.bridgeSecret,
        parsed.data,
      );
      return {
        attested: true,
        runtimeInstanceId: lease.runtimeInstanceId,
        preventiveHooksVerified: true,
      };
    }

    const check = verifyRuntimeAttestationPayload(this.bridgeSecret, parsed.data);
    if (!check.verified) {
      throw AppError.forbidden(
        `INVALID_RUNTIME_ATTESTATION: ${check.reason ?? 'Confinement attestation rejected'}`,
      );
    }

    return {
      attested: true,
      runtimeInstanceId: parsed.data.runtimeInstanceId,
      preventiveHooksVerified: true,
    };
  }

  @Post('hermes-bridge/guard/llm-reserve')
  @Header('Cache-Control', 'private, no-store')
  async reserveLlmCall(@Body() body: unknown, @Req() request: FastifyRequest) {
    const parsed = hermesBridgeLlmReserveSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.badRequest('Invalid LLM reservation payload');
    }
    const claims = this.authenticateBridge(request, parsed.data.bridgeTicket);
    const pool = this.database.getPool();
    const identity = await resolveRunIdentityForHermesSession(pool, {
      storeId: claims.storeId,
      rootRunId: claims.rootRunId,
      hermesSessionId: parsed.data.hermesSessionId,
      preventiveHooksVerified: claims.preventiveHooksVerified,
    });

    // Enforce direct provider + model + role policy BEFORE the LLM request leaves Hermes
    const policy = this.providerPolicies.resolveForRole(
      identity.run.role,
      parsed.data.provider,
      parsed.data.model,
    );
    const est = this.providerPolicies.estimateReservationCostUsd(
      policy,
      parsed.data.estimatedInputTokens,
      parsed.data.maxOutputTokens,
    );
    const { reservationId } = await reserveModelCallBudget(pool, {
      storeId: claims.storeId,
      rootRunId: claims.rootRunId,
      runId: identity.run.runId,
      provider: policy.provider,
      model: policy.model,
      reservedTokens: est.reservedTokens,
      reservedCostUsd: est.reservedCostUsd,
      // FIX04: stable logical provider-call identity. When the plugin echoes
      // VAARG's initial reservation id, this dedupes to ONE reservation per
      // logical call instead of double-reserving.
      providerCallId: parsed.data.providerCallId ?? null,
    });

    return {
      allowed: true,
      reservationId,
      reservedTokens: est.reservedTokens,
      reservedCostUsd: est.reservedCostUsd,
    };
  }

  @Post('hermes-bridge/guard/llm-reconcile')
  @Header('Cache-Control', 'private, no-store')
  async reconcileLlmCall(@Body() body: unknown, @Req() request: FastifyRequest) {
    const parsed = hermesBridgeLlmReconcileSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.badRequest('Invalid LLM reconciliation payload');
    }
    const claims = this.authenticateBridge(request, parsed.data.bridgeTicket);
    const pool = this.database.getPool();
    const identity = await resolveRunIdentityForHermesSession(pool, {
      storeId: claims.storeId,
      rootRunId: claims.rootRunId,
      hermesSessionId: parsed.data.hermesSessionId,
      preventiveHooksVerified: claims.preventiveHooksVerified,
    });

    const policy = this.providerPolicies.resolveForRole(
      identity.run.role,
      parsed.data.provider,
      parsed.data.model,
    );
    this.providerPolicies.verifyServedRuntimeRoute(policy, {
      provider: parsed.data.provider,
      model: parsed.data.model,
      routeSource: parsed.data.routeSource ?? null,
      requestedProvider: policy.provider,
      requestedModel: policy.model,
    });

    const measuredCostUsd = this.providerPolicies.computeMeasuredCostUsd(policy, {
      inputTokens: parsed.data.inputTokens,
      outputTokens: parsed.data.outputTokens,
      cacheReadTokens: parsed.data.cacheReadTokens,
      cacheWriteTokens: parsed.data.cacheWriteTokens,
    });

    const reconciled = await reconcileModelCallUsage(pool, {
      storeId: claims.storeId,
      rootRunId: claims.rootRunId,
      runId: identity.run.runId,
      reservationId: parsed.data.reservationId,
      provider: policy.provider,
      model: policy.model,
      ...(parsed.data.providerRequestId
        ? { providerRequestId: parsed.data.providerRequestId }
        : {}),
      ...(parsed.data.providerCallId ? { providerCallId: parsed.data.providerCallId } : {}),
      inputTokens: parsed.data.inputTokens,
      outputTokens: parsed.data.outputTokens,
      cacheReadTokens: parsed.data.cacheReadTokens,
      cacheWriteTokens: parsed.data.cacheWriteTokens,
      measuredCostUsd,
      ...(parsed.data.latencyMs !== undefined ? { latencyMs: parsed.data.latencyMs } : {}),
      ...(parsed.data.routeSource ? { routeSource: parsed.data.routeSource } : {}),
    });

    return {
      reconciled: true,
      measuredCostUsd,
      budgetExceeded: reconciled.budgetExceeded,
    };
  }

  @Post('hermes-bridge/guard/subagent-start')
  @Header('Cache-Control', 'private, no-store')
  async registerSubagentStart(@Body() body: unknown, @Req() request: FastifyRequest) {
    const parsed = hermesBridgeSubagentStartSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.badRequest('Invalid subagent-start payload');
    }
    const claims = this.authenticateBridge(request, parsed.data.bridgeTicket);
    if (!claims.preventiveHooksVerified) {
      throw AppError.forbidden(
        'DELEGATION_DISABLED_CAPABILITY_LIMITATION: Preventive confinement hooks were not attested at run start',
      );
    }

    // Enforce child provider policy BEFORE spawning child specialist
    const childPolicy = this.providerPolicies.resolveForRole(
      parsed.data.role,
      parsed.data.provider,
      parsed.data.model,
    );
    const roleDef = ROLE_DEFINITIONS[parsed.data.role];
    const childRun = await reserveChildDelegationRun(this.database.getPool(), {
      storeId: claims.storeId,
      rootRunId: claims.rootRunId,
      parentHermesSessionId: parsed.data.parentHermesSessionId,
      childHermesSessionId: parsed.data.childHermesSessionId,
      delegationId: parsed.data.delegationId,
      role: parsed.data.role,
      requestedDepth: parsed.data.depth,
      provider: childPolicy.provider,
      model: childPolicy.model,
      promptVersion: roleDef.version,
    });

    if ('deadlineExceeded' in childRun) {
      throw AppError.unavailable('RUN_DEADLINE_EXCEEDED: Execution deadline reached');
    }

    return {
      allowed: true,
      childRunId: childRun.runId,
      role: childRun.role,
      depth: childRun.depth,
      provider: childPolicy.provider,
      model: childPolicy.model,
    };
  }

  @Post('hermes-bridge/guard/subagent-stop')
  @Header('Cache-Control', 'private, no-store')
  async registerSubagentStop(@Body() body: unknown, @Req() request: FastifyRequest) {
    const parsed = hermesBridgeSubagentStopSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.badRequest('Invalid subagent-stop payload');
    }
    const claims = this.authenticateBridge(request, parsed.data.bridgeTicket);
    await completeChildDelegationRun(this.database.getPool(), {
      storeId: claims.storeId,
      rootRunId: claims.rootRunId,
      childHermesSessionId: parsed.data.childHermesSessionId,
      status: parsed.data.status,
      ...(parsed.data.errorMessage ? { errorMessage: parsed.data.errorMessage } : {}),
    });
    return { completed: true };
  }

  @Post('hermes-bridge/tools/invoke')
  @Header('Cache-Control', 'private, no-store')
  async invokeTool(@Body() body: unknown, @Req() request: FastifyRequest) {
    const parsed = hermesBridgeToolInvokeSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.badRequest('Invalid Hermes bridge tool invocation payload');
    }
    const claims = this.authenticateBridge(request, parsed.data.bridgeTicket);
    const identity = await resolveRunIdentityForHermesSession(this.database.getPool(), {
      storeId: claims.storeId,
      rootRunId: claims.rootRunId,
      hermesSessionId: parsed.data.hermesSessionId,
      preventiveHooksVerified: claims.preventiveHooksVerified,
    });

    const result = await this.toolBroker.invoke({
      storeId: claims.storeId,
      rootRunId: claims.rootRunId,
      runId: identity.run.runId,
      conversationId: claims.conversationId,
      sessionId: claims.sessionId,
      customerId: identity.run.customerId,
      role: identity.run.role,
      roleVerified: identity.roleVerified,
      contextVersion: identity.run.contextVersion,
      correlationId: identity.run.correlationId,
      capability: parsed.data.capability,
      rawArguments: parsed.data.arguments,
      toolCallId: parsed.data.toolCallId,
      idempotencyKey: parsed.data.idempotencyKey,
    });

    return { ok: true, result };
  }

  /**
   * Authenticated Streamable HTTP MCP JSON-RPC 2.0 endpoint for Hermes MCP client.
   * When child-role identity cannot be proven (`roleVerified === false`), only
   * `SAFE_READ_CAPABILITY_INTERSECTION` is advertised and permitted.
   */
  @Post('mcp')
  @Header('Cache-Control', 'private, no-store')
  async handleMcpJsonRpc(@Body() body: unknown, @Req() request: FastifyRequest) {
    const rpcParsed = mcpJsonRpcRequestSchema.safeParse(body);
    if (!rpcParsed.success) {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' },
      };
    }

    const rpc = rpcParsed.data;
    const ticketHeader = request.headers['x-vaarg-bridge-ticket'];
    const sessionHeader = request.headers['x-hermes-session-id'];
    const ticket = typeof ticketHeader === 'string' ? ticketHeader : '';
    const hermesSessionId = typeof sessionHeader === 'string' ? sessionHeader : '';

    try {
      const claims = this.authenticateBridge(request, ticket);
      if (rpc.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id: rpc.id ?? null,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'vaarg-tool-broker', version: '1.0.0' },
          },
        };
      }
      if (rpc.method === 'notifications/initialized') {
        return { jsonrpc: '2.0', id: rpc.id ?? null, result: {} };
      }

      const identity = await resolveRunIdentityForHermesSession(this.database.getPool(), {
        storeId: claims.storeId,
        rootRunId: claims.rootRunId,
        hermesSessionId: hermesSessionId || '__shared_mcp__',
        preventiveHooksVerified: claims.preventiveHooksVerified && Boolean(hermesSessionId),
      });

      if (rpc.method === 'tools/list') {
        const effectiveCaps = getEffectiveCapabilitiesForRole(
          identity.run.role,
          identity.roleVerified,
        );
        return {
          jsonrpc: '2.0',
          id: rpc.id ?? null,
          result: {
            tools: getToolJsonSchemasForAdvertisedCapabilities(effectiveCaps),
          },
        };
      }

      if (rpc.method === 'tools/call') {
        const params = rpc.params ?? {};
        const name = typeof params.name === 'string' ? params.name : '';
        const args =
          params.arguments &&
          typeof params.arguments === 'object' &&
          !Array.isArray(params.arguments)
            ? (params.arguments as Record<string, unknown>)
            : {};
        const output = await this.toolBroker.invoke({
          storeId: claims.storeId,
          rootRunId: claims.rootRunId,
          runId: identity.run.runId,
          conversationId: claims.conversationId,
          sessionId: claims.sessionId,
          customerId: identity.run.customerId,
          role: identity.run.role,
          roleVerified: identity.roleVerified,
          contextVersion: identity.run.contextVersion,
          correlationId: identity.run.correlationId,
          capability: name,
          rawArguments: args,
        });
        return {
          jsonrpc: '2.0',
          id: rpc.id ?? null,
          result: {
            content: [{ type: 'text', text: JSON.stringify(output) }],
            isError: false,
          },
        };
      }

      return {
        jsonrpc: '2.0',
        id: rpc.id ?? null,
        error: { code: -32601, message: `Unsupported MCP method: ${rpc.method}` },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'ToolBroker MCP error';
      return {
        jsonrpc: '2.0',
        id: rpc.id ?? null,
        error: { code: -32000, message: msg },
      };
    }
  }
}
