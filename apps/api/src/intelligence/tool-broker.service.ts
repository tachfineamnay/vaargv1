import { Inject, Injectable } from '@nestjs/common';
import {
  ACTIVE_TOOL_CAPABILITIES,
  AppError,
  FORBIDDEN_RUNTIME_TOOLS,
  TOOL_CAPABILITY_INPUT_SCHEMAS,
  TOOL_CAPABILITY_OUTPUT_SCHEMAS,
  UNAVAILABLE_FUTURE_CAPABILITIES,
  findForbiddenAuthorityKeys,
  getEffectiveCapabilitiesForRole,
  type ActiveToolCapability,
  type AgentRole,
  type BrokerCompareProductsInput,
  type BrokerGetCompatibleOptionsInput,
  type BrokerGetProductInput,
  type BrokerGetRecommendationsInput,
  type BrokerGetRelatedProductsInput,
  type BrokerGetVariantInput,
  type BrokerProposeCompositionInput,
  type BrokerSearchCatalogInput,
  type BrokerUpdateExplicitCriteriaInput,
  type UnavailableFutureCapability,
} from '@vaarg/shared';
import {
  advanceRunContextVersion,
  beginToolInvocationAudit,
  compareProducts,
  finalizeToolInvocationAudit,
  getCompatibleOptions,
  getProduct,
  getRelatedProducts,
  getVariant,
  recordActionProposalRecord,
  recordDeniedToolInvocation,
  type StorefrontBinding,
} from '@vaarg/persistence';
import { DatabaseClient } from '../infra/database-client.js';
import { ExperienceService } from '../experience/experience.service.js';

export interface AuthenticatedToolInvocationContext {
  storeId: string;
  rootRunId: string;
  runId: string;
  conversationId: string;
  sessionId: string;
  customerId: string | null;
  role: AgentRole;
  roleVerified: boolean;
  contextVersion: number;
  correlationId: string;
  capability: string;
  rawArguments: unknown;
  toolCallId?: string | undefined;
  idempotencyKey?: string | undefined;
}

function refStringFromLookup(ref: { shopifyGid: string } | { handle: string }): string {
  return 'shopifyGid' in ref ? ref.shopifyGid : ref.handle;
}

@Injectable()
export class ToolBrokerService {
  constructor(
    @Inject(DatabaseClient) private readonly database: DatabaseClient,
    @Inject('STOREFRONT_BINDINGS') private readonly bindings: StorefrontBinding[],
    @Inject(ExperienceService) private readonly experience: ExperienceService,
  ) {}

  private resolveBindingForStore(storeId: string): StorefrontBinding {
    const binding = this.bindings.find((entry) => entry.storeId === storeId);
    if (!binding) {
      throw AppError.unavailable(`STOREFRONT_BINDING_MISSING: No verified binding for store ${storeId}`);
    }
    return binding;
  }

  async invoke(ctx: AuthenticatedToolInvocationContext): Promise<Record<string, unknown>> {
    const pool = this.database.getPool();
    const startedMs = Date.now();

    // 1. Explicitly block dangerous runtime/host/system/admin tools
    if (FORBIDDEN_RUNTIME_TOOLS.has(ctx.capability)) {
      const msg = `FORBIDDEN_RUNTIME_TOOL: Capability "${ctx.capability}" is strictly prohibited`;
      await recordDeniedToolInvocation(pool, {
        storeId: ctx.storeId,
        rootRunId: ctx.rootRunId,
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        role: ctx.role,
        roleVerified: ctx.roleVerified,
        capability: ctx.capability,
        ...(ctx.toolCallId ? { toolCallId: ctx.toolCallId } : {}),
        rawInput: ctx.rawArguments,
        correlationId: ctx.correlationId,
        contextVersion: ctx.contextVersion,
        status: 'denied',
        errorCode: 'FORBIDDEN_RUNTIME_TOOL',
        errorMessage: msg,
      });
      throw AppError.forbidden(msg);
    }

    // 2. Explicitly refuse FL08-FL11 capabilities with structured unavailability
    if (ctx.capability in UNAVAILABLE_FUTURE_CAPABILITIES) {
      const info =
        UNAVAILABLE_FUTURE_CAPABILITIES[ctx.capability as UnavailableFutureCapability];
      const msg = `CAPABILITY_UNAVAILABLE (${info.implementedIn}): ${info.reason}`;
      await recordDeniedToolInvocation(pool, {
        storeId: ctx.storeId,
        rootRunId: ctx.rootRunId,
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        role: ctx.role,
        roleVerified: ctx.roleVerified,
        capability: ctx.capability,
        ...(ctx.toolCallId ? { toolCallId: ctx.toolCallId } : {}),
        rawInput: ctx.rawArguments,
        correlationId: ctx.correlationId,
        contextVersion: ctx.contextVersion,
        status: 'denied',
        errorCode: 'CAPABILITY_UNAVAILABLE',
        errorMessage: msg,
      });
      throw AppError.unavailable(msg);
    }

    // 3. Verify capability exists in the active registry
    if (!(ACTIVE_TOOL_CAPABILITIES as readonly string[]).includes(ctx.capability)) {
      const msg = `UNKNOWN_CAPABILITY: "${ctx.capability}" is not registered in ToolBroker`;
      await recordDeniedToolInvocation(pool, {
        storeId: ctx.storeId,
        rootRunId: ctx.rootRunId,
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        role: ctx.role,
        roleVerified: ctx.roleVerified,
        capability: ctx.capability,
        ...(ctx.toolCallId ? { toolCallId: ctx.toolCallId } : {}),
        rawInput: ctx.rawArguments,
        correlationId: ctx.correlationId,
        contextVersion: ctx.contextVersion,
        status: 'denied',
        errorCode: 'UNKNOWN_CAPABILITY',
        errorMessage: msg,
      });
      throw AppError.forbidden(msg);
    }
    const capability = ctx.capability as ActiveToolCapability;

    // 4. Reject authority-bearing fields supplied by agent arguments (zero trust in agent identity args)
    const forbiddenKeys = findForbiddenAuthorityKeys(ctx.rawArguments);
    if (forbiddenKeys.length > 0) {
      const msg = `AUTHORITY_FIELD_FORBIDDEN: Agent arguments must never supply authority fields (${forbiddenKeys.join(', ')})`;
      await recordDeniedToolInvocation(pool, {
        storeId: ctx.storeId,
        rootRunId: ctx.rootRunId,
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        role: ctx.role,
        roleVerified: ctx.roleVerified,
        capability,
        ...(ctx.toolCallId ? { toolCallId: ctx.toolCallId } : {}),
        rawInput: ctx.rawArguments,
        correlationId: ctx.correlationId,
        contextVersion: ctx.contextVersion,
        status: 'denied',
        errorCode: 'AUTHORITY_FIELD_FORBIDDEN',
        errorMessage: msg,
      });
      throw AppError.forbidden(msg);
    }

    // 5. Enforce role-based capability policy + unverified child safe-read intersection
    const allowedCapabilities = getEffectiveCapabilitiesForRole(ctx.role, ctx.roleVerified);
    if (!allowedCapabilities.includes(capability)) {
      const msg = ctx.roleVerified
        ? `ROLE_CAPABILITY_DENIED: Role "${ctx.role}" is not permitted to invoke "${capability}"`
        : `UNVERIFIED_CHILD_ROLE_DENIED: Unverified child session restricted to safe read capabilities; "${capability}" is denied`;
      await recordDeniedToolInvocation(pool, {
        storeId: ctx.storeId,
        rootRunId: ctx.rootRunId,
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        role: ctx.role,
        roleVerified: ctx.roleVerified,
        capability,
        ...(ctx.toolCallId ? { toolCallId: ctx.toolCallId } : {}),
        rawInput: ctx.rawArguments,
        correlationId: ctx.correlationId,
        contextVersion: ctx.contextVersion,
        status: 'denied',
        errorCode: ctx.roleVerified ? 'ROLE_CAPABILITY_DENIED' : 'UNVERIFIED_CHILD_ROLE_DENIED',
        errorMessage: msg,
      });
      throw AppError.forbidden(msg);
    }

    // 6. Strict Zod input validation
    const inputSchema = TOOL_CAPABILITY_INPUT_SCHEMAS[capability];
    const parsedInput = inputSchema.safeParse(ctx.rawArguments ?? {});
    if (!parsedInput.success) {
      const msg = `TOOL_INPUT_INVALID: ${parsedInput.error.issues.map((i) => i.message).join('; ')}`;
      await recordDeniedToolInvocation(pool, {
        storeId: ctx.storeId,
        rootRunId: ctx.rootRunId,
        runId: ctx.runId,
        sessionId: ctx.sessionId,
        role: ctx.role,
        roleVerified: ctx.roleVerified,
        capability,
        ...(ctx.toolCallId ? { toolCallId: ctx.toolCallId } : {}),
        rawInput: ctx.rawArguments,
        correlationId: ctx.correlationId,
        contextVersion: ctx.contextVersion,
        status: 'validation_failed',
        errorCode: 'TOOL_INPUT_INVALID',
        errorMessage: msg,
      });
      throw AppError.badRequest(msg);
    }

    const argIdempotencyKey =
      typeof (parsedInput.data as { idempotencyKey?: string }).idempotencyKey === 'string'
        ? (parsedInput.data as { idempotencyKey?: string }).idempotencyKey
        : undefined;
    const effectiveIdempotencyKey = ctx.idempotencyKey ?? argIdempotencyKey;

    // 7. Atomic deadline/cancellation check + shared tool-call budget reservation + idempotency check
    const auditStart = await beginToolInvocationAudit(pool, {
      storeId: ctx.storeId,
      rootRunId: ctx.rootRunId,
      runId: ctx.runId,
      sessionId: ctx.sessionId,
      role: ctx.role,
      roleVerified: ctx.roleVerified,
      capability,
      ...(ctx.toolCallId ? { toolCallId: ctx.toolCallId } : {}),
      ...(effectiveIdempotencyKey ? { idempotencyKey: effectiveIdempotencyKey } : {}),
      rawInput: parsedInput.data,
      correlationId: ctx.correlationId,
      contextVersion: ctx.contextVersion,
      reserveBudgetSlot: true,
    });

    if (auditStart.kind === 'replayed') {
      return auditStart.cachedOutput;
    }

    const invocationId = auditStart.invocationId;
    try {
      const binding = this.resolveBindingForStore(ctx.storeId);
      const rawOutput = await this.executeValidatedCapability(
        capability,
        parsedInput.data,
        ctx,
        binding,
      );

      // 8. Strict Zod output validation before returning to agent
      const outputSchema = TOOL_CAPABILITY_OUTPUT_SCHEMAS[capability];
      const validatedOutput = outputSchema.parse(rawOutput) as Record<string, unknown>;

      await finalizeToolInvocationAudit(pool, {
        storeId: ctx.storeId,
        rootRunId: ctx.rootRunId,
        invocationId,
        status: 'succeeded',
        output: validatedOutput,
        durationMs: Date.now() - startedMs,
        releaseReservedBudgetSlot: true,
      });

      return validatedOutput;
    } catch (err) {
      const code = err instanceof AppError ? err.kind.toUpperCase() : 'TOOL_EXECUTION_FAILED';
      const msg = err instanceof Error ? err.message : 'Tool execution failed';
      await finalizeToolInvocationAudit(pool, {
        storeId: ctx.storeId,
        rootRunId: ctx.rootRunId,
        invocationId,
        status: 'failed',
        errorCode: code,
        errorMessage: msg,
        durationMs: Date.now() - startedMs,
        releaseReservedBudgetSlot: true,
      });
      throw err;
    }
  }

  private async executeValidatedCapability(
    capability: ActiveToolCapability,
    data: unknown,
    ctx: AuthenticatedToolInvocationContext,
    binding: StorefrontBinding,
  ): Promise<unknown> {
    const pool = this.database.getPool();
    const marketScope = {
      storeId: binding.storeId,
      country: binding.country,
      language: binding.language,
    };
    const expCaps = this.experience.capabilitiesForServerVerifiedSession({
      storeId: binding.storeId,
      country: binding.country,
      language: binding.language,
      currency: binding.currency,
      sessionId: ctx.sessionId,
    });

    switch (capability) {
      case 'search_catalog': {
        const input = data as BrokerSearchCatalogInput;
        const constraints = input.constraints
          ? {
              ...input.constraints,
              ...((input.constraints.priceMin !== undefined ||
                input.constraints.priceMax !== undefined) &&
              !input.constraints.currency
                ? { currency: binding.currency }
                : {}),
            }
          : {};
        return expCaps.searchCatalog({
          scope: marketScope,
          mode: input.mode,
          ...(input.q ? { q: input.q } : {}),
          limit: input.limit,
          constraints,
        });
      }

      case 'get_product': {
        const input = data as BrokerGetProductInput;
        const detail = await getProduct(pool, marketScope, refStringFromLookup(input));
        return {
          found: detail !== null,
          detail,
        };
      }

      case 'get_variant': {
        const input = data as BrokerGetVariantInput;
        try {
          const detail = await getVariant(pool, marketScope, input.variantGid);
          return {
            found: detail !== null,
            detail,
          };
        } catch {
          return {
            found: false,
            detail: null,
          };
        }
      }

      case 'compare_products': {
        const input = data as BrokerCompareProductsInput;
        const refs = input.products.map(refStringFromLookup);
        return compareProducts(pool, marketScope, refs);
      }

      case 'get_compatible_options': {
        const input = data as BrokerGetCompatibleOptionsInput;
        const detail = await getCompatibleOptions(pool, marketScope, refStringFromLookup(input));
        return {
          found: detail !== null,
          compatibility: 'UNKNOWN' as const,
          detail,
        };
      }

      case 'get_related_products': {
        const input = data as BrokerGetRelatedProductsInput;
        return getRelatedProducts(pool, marketScope, refStringFromLookup(input.product), input.limit);
      }

      case 'get_experience_context': {
        return expCaps.getExperienceContext();
      }

      case 'get_recommendations': {
        const input = data as BrokerGetRecommendationsInput;
        return expCaps.getRecommendations({
          limit: input.limit,
          ...(input.seedProductRef !== undefined ? { seedProductRef: input.seedProductRef } : {}),
          ...(input.constraints ? { constraints: input.constraints } : {}),
          signals: [],
          contextVersion: ctx.contextVersion,
        });
      }

      case 'propose_experience_composition': {
        const input = data as BrokerProposeCompositionInput;
        const composition = await expCaps.proposeExperienceComposition({
          ...(input.reason ? { reason: input.reason } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        });
        const proposal = await recordActionProposalRecord(pool, {
          storeId: ctx.storeId,
          runId: ctx.runId,
          conversationId: ctx.conversationId,
          sessionId: ctx.sessionId,
          customerId: ctx.customerId,
          proposedByRole: ctx.role,
          proposalType: 'experience_composition',
          status: 'proposed',
          requiresConfirmation: false,
          contextVersion: composition.contextVersion,
          payload: composition as unknown as Record<string, unknown>,
          correlationId: ctx.correlationId,
          ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        });
        return {
          proposalId: proposal.proposalId,
          status: 'proposed' as const,
          composition,
        };
      }

      case 'update_explicit_criteria': {
        if (ctx.role !== 'master' || !ctx.roleVerified) {
          throw AppError.forbidden(
            'CRITERIA_UPDATE_MASTER_ONLY: Only verified Master role may update explicit exploration criteria',
          );
        }
        const input = data as BrokerUpdateExplicitCriteriaInput;
        const cleanCriteria = Object.fromEntries(
          Object.entries(input.criteria).filter(([, v]) => v !== undefined),
        ) as {
          query?: string | null;
          productType?: string | null;
          vendor?: string | null;
          collection?: string | null;
          priceMin?: string | null;
          priceMax?: string | null;
          currency?: string | null;
        };
        const updatedContext = await expCaps.updateExplicitCriteria({
          criteria: cleanCriteria,
        });
        await advanceRunContextVersion(
          pool,
          ctx.storeId,
          ctx.rootRunId,
          updatedContext.contextVersion,
        );
        const proposal = await recordActionProposalRecord(pool, {
          storeId: ctx.storeId,
          runId: ctx.runId,
          conversationId: ctx.conversationId,
          sessionId: ctx.sessionId,
          customerId: ctx.customerId,
          proposedByRole: 'master',
          proposalType: 'explicit_criteria_update',
          status: 'applied',
          requiresConfirmation: false,
          contextVersion: updatedContext.contextVersion,
          payload: { criteria: input.criteria },
          correlationId: ctx.correlationId,
          ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        });
        return {
          proposalId: proposal.proposalId,
          accepted: true,
          contextVersion: updatedContext.contextVersion,
          context: updatedContext,
        };
      }
    }
  }
}
