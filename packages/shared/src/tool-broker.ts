import { z } from 'zod';
import { capabilityCompositionInputSchema, capabilityCriteriaInputSchema } from './capabilities.js';
import {
  catalogV1ComparisonSchema,
  catalogV1CompatibleOptionsSchema,
  catalogV1ProductDetailResponseSchema,
  catalogV1RelatedSchema,
  catalogV1VariantDetailResponseSchema,
} from './catalog.js';
import { adaptiveCompositionSchema } from './composition.js';
import { experienceContextSchema } from './experience.js';
import { agentRoleSchema, directModelProviderSchema } from './intelligence.js';
import { recommendationResultSchema } from './recommendation.js';
import { searchConstraintsSchema, searchResultSchema } from './search.js';
import { type ActiveToolCapability } from './specialists.js';

/**
 * Authority-bearing fields that MUST NEVER be accepted from an LLM/agent argument payload.
 */
export const FORBIDDEN_AUTHORITY_KEYS = [
  'storeId',
  'store_id',
  'sessionId',
  'session_id',
  'customerId',
  'customer_id',
  'principal',
  'role',
  'consent',
  'consents',
  'personalizationGranted',
  'tenant',
  'merchantUserId',
  'country',
  'language',
  'currency',
  'signals',
  'scope',
] as const;

/**
 * Dangerous host/system/network/admin tools that MUST NEVER be registered or allowed on Hermes.
 */
export const FORBIDDEN_RUNTIME_TOOLS = new Set<string>([
  'terminal',
  'process_manage',
  'shell',
  'bash',
  'sh',
  'read_file',
  'write_file',
  'patch',
  'search_files',
  'file',
  'execute_code',
  'code_execution',
  'browser',
  'browser_exec',
  'browser_cdp',
  'browser_navigate',
  'web',
  'web_search',
  'web_extract',
  'sql',
  'psql',
  'docker',
  'cronjob',
  'cronjob_manage',
  'memory',
  'session_search',
  'computer_use',
  'connections',
  'manage_connections',
  'admin_api',
]);

export function findForbiddenAuthorityKeys(rawInput: unknown): string[] {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    return [];
  }
  const found = new Set<string>();
  const forbiddenSet = new Set<string>(FORBIDDEN_AUTHORITY_KEYS);
  const visit = (obj: Record<string, unknown>, depth: number) => {
    if (depth > 4) return;
    for (const [k, v] of Object.entries(obj)) {
      if (forbiddenSet.has(k)) {
        found.add(k);
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        visit(v as Record<string, unknown>, depth + 1);
      }
    }
  };
  visit(rawInput as Record<string, unknown>, 0);
  return [...found];
}

const shopifyProductGidSchema = z
  .string()
  .regex(/^gid:\/\/shopify\/Product\/\d+$/, 'Expected verified Shopify Product GID');
const shopifyVariantGidSchema = z
  .string()
  .regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/, 'Expected verified Shopify ProductVariant GID');

const productLookupRefSchema = z.union([
  z.object({ shopifyGid: shopifyProductGidSchema }).strict(),
  z
    .object({
      handle: z
        .string()
        .trim()
        .min(1)
        .max(255)
        .regex(/^[a-z0-9][a-z0-9-]*$/i, 'Invalid product handle'),
    })
    .strict(),
]);

// ============================================================================
// ToolBroker Capability Input & Output Schemas (Strict, No Authority Fields)
// ============================================================================

export const brokerSearchCatalogInputSchema = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
    mode: z.enum(['lexical', 'hybrid', 'contextual']).default('hybrid'),
    constraints: searchConstraintsSchema.optional(),
    limit: z.number().int().min(1).max(24).default(12),
  })
  .strict()
  .superRefine((val, ctx) => {
    if ((val.mode === 'lexical' || val.mode === 'hybrid') && !val.q) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['q'],
        message: 'q is required for lexical or hybrid search',
      });
    }
  });
export type BrokerSearchCatalogInput = z.infer<typeof brokerSearchCatalogInputSchema>;

export const brokerGetProductInputSchema = productLookupRefSchema;
export type BrokerGetProductInput = z.infer<typeof brokerGetProductInputSchema>;

export const brokerGetVariantInputSchema = z
  .object({
    variantGid: shopifyVariantGidSchema,
  })
  .strict();
export type BrokerGetVariantInput = z.infer<typeof brokerGetVariantInputSchema>;

export const brokerCompareProductsInputSchema = z
  .object({
    products: z.array(productLookupRefSchema).min(2).max(4),
  })
  .strict();
export type BrokerCompareProductsInput = z.infer<typeof brokerCompareProductsInputSchema>;

export const brokerGetCompatibleOptionsInputSchema = productLookupRefSchema;
export type BrokerGetCompatibleOptionsInput = z.infer<typeof brokerGetCompatibleOptionsInputSchema>;

export const brokerGetRelatedProductsInputSchema = z
  .object({
    product: productLookupRefSchema,
    limit: z.number().int().min(1).max(12).default(6),
  })
  .strict();
export type BrokerGetRelatedProductsInput = z.infer<typeof brokerGetRelatedProductsInputSchema>;

export const brokerGetExperienceContextInputSchema = z.object({}).strict();
export type BrokerGetExperienceContextInput = z.infer<typeof brokerGetExperienceContextInputSchema>;

export const brokerGetRecommendationsInputSchema = z
  .object({
    constraints: searchConstraintsSchema.optional(),
    seedProductRef: shopifyProductGidSchema.nullable().optional(),
    limit: z.number().int().min(1).max(24).default(12),
  })
  .strict();
export type BrokerGetRecommendationsInput = z.infer<typeof brokerGetRecommendationsInputSchema>;

export const brokerProposeCompositionInputSchema = z
  .object({
    reason: capabilityCompositionInputSchema.shape.reason,
    limit: capabilityCompositionInputSchema.shape.limit,
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type BrokerProposeCompositionInput = z.infer<typeof brokerProposeCompositionInputSchema>;

export const brokerUpdateExplicitCriteriaInputSchema = z
  .object({
    criteria: capabilityCriteriaInputSchema.shape.criteria,
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type BrokerUpdateExplicitCriteriaInput = z.infer<
  typeof brokerUpdateExplicitCriteriaInputSchema
>;

export const verifiedProductDetailOutputSchema = z.strictObject({
  found: z.boolean(),
  detail: catalogV1ProductDetailResponseSchema.nullable(),
});

export const verifiedVariantDetailOutputSchema = z.strictObject({
  found: z.boolean(),
  detail: catalogV1VariantDetailResponseSchema.nullable(),
});

export const compareProductsOutputSchema = catalogV1ComparisonSchema;

export const compatibleOptionsOutputSchema = z.strictObject({
  found: z.boolean(),
  compatibility: z.literal('UNKNOWN'),
  detail: catalogV1CompatibleOptionsSchema.nullable(),
});

export const relatedProductsOutputSchema = catalogV1RelatedSchema;

export const proposeCompositionOutputSchema = z.object({
  proposalId: z.string().uuid(),
  status: z.literal('proposed'),
  composition: adaptiveCompositionSchema,
});

export const updateExplicitCriteriaOutputSchema = z.object({
  proposalId: z.string().uuid(),
  accepted: z.boolean(),
  contextVersion: z.number().int().nonnegative(),
  context: experienceContextSchema,
});

export const TOOL_CAPABILITY_OUTPUT_SCHEMAS = {
  search_catalog: searchResultSchema,
  get_product: verifiedProductDetailOutputSchema,
  get_variant: verifiedVariantDetailOutputSchema,
  compare_products: compareProductsOutputSchema,
  get_compatible_options: compatibleOptionsOutputSchema,
  get_related_products: relatedProductsOutputSchema,
  get_experience_context: experienceContextSchema,
  get_recommendations: recommendationResultSchema,
  propose_experience_composition: proposeCompositionOutputSchema,
  update_explicit_criteria: updateExplicitCriteriaOutputSchema,
} as const;

export const TOOL_CAPABILITY_INPUT_SCHEMAS = {
  search_catalog: brokerSearchCatalogInputSchema,
  get_product: brokerGetProductInputSchema,
  get_variant: brokerGetVariantInputSchema,
  compare_products: brokerCompareProductsInputSchema,
  get_compatible_options: brokerGetCompatibleOptionsInputSchema,
  get_related_products: brokerGetRelatedProductsInputSchema,
  get_experience_context: brokerGetExperienceContextInputSchema,
  get_recommendations: brokerGetRecommendationsInputSchema,
  propose_experience_composition: brokerProposeCompositionInputSchema,
  update_explicit_criteria: brokerUpdateExplicitCriteriaInputSchema,
} as const;

// ============================================================================
// Private Hermes Confinement Bridge Contracts
// ============================================================================

export const hermesBridgeToolInvokeSchema = z
  .object({
    bridgeTicket: z.string().min(16).max(2_048),
    hermesSessionId: z.string().min(1).max(200),
    capability: z.string().min(1).max(120),
    arguments: z.record(z.string(), z.unknown()).default({}),
    toolCallId: z.string().min(1).max(200).optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict();
export type HermesBridgeToolInvokeRequest = z.infer<typeof hermesBridgeToolInvokeSchema>;

export const hermesBridgeLlmReserveSchema = z
  .object({
    bridgeTicket: z.string().min(16).max(2_048),
    hermesSessionId: z.string().min(1).max(200),
    provider: directModelProviderSchema,
    model: z.string().min(1).max(120),
    estimatedInputTokens: z.number().int().min(1).max(500_000).default(2_048),
    maxOutputTokens: z.number().int().min(1).max(65_536).default(1_024),
    /** Stable logical provider-call identity; reuses VAARG's initial reservation. */
    providerCallId: z.string().min(1).max(200).optional(),
  })
  .strict();
export type HermesBridgeLlmReserveRequest = z.infer<typeof hermesBridgeLlmReserveSchema>;

export const hermesBridgeLlmReconcileSchema = z
  .object({
    bridgeTicket: z.string().min(16).max(2_048),
    reservationId: z.string().uuid(),
    hermesSessionId: z.string().min(1).max(200),
    provider: directModelProviderSchema,
    model: z.string().min(1).max(120),
    providerRequestId: z.string().max(200).optional(),
    /** Stable logical provider-call identity used for dedupe/reconciliation. */
    providerCallId: z.string().min(1).max(200).optional(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative().default(0),
    cacheWriteTokens: z.number().int().nonnegative().default(0),
    latencyMs: z.number().int().nonnegative().optional(),
    routeSource: z.string().max(64).optional(),
  })
  .strict();
export type HermesBridgeLlmReconcileRequest = z.infer<typeof hermesBridgeLlmReconcileSchema>;

export const hermesBridgeSubagentStartSchema = z
  .object({
    bridgeTicket: z.string().min(16).max(2_048),
    parentHermesSessionId: z.string().min(1).max(200),
    childHermesSessionId: z.string().min(1).max(200),
    delegationId: z.string().min(1).max(200),
    role: agentRoleSchema,
    depth: z.number().int().min(1).max(8),
    provider: directModelProviderSchema.optional(),
    model: z.string().min(1).max(120).optional(),
  })
  .strict();
export type HermesBridgeSubagentStartRequest = z.infer<typeof hermesBridgeSubagentStartSchema>;

export const hermesBridgeRuntimeAttestSchema = z
  .object({
    runtimeInstanceId: z.string().min(1).max(120),
    hermesVersion: z.string().min(1).max(64),
    pluginVersion: z.string().min(1).max(64),
    activeHooks: z.array(z.string().min(1).max(80)).min(1).max(16),
    registeredCapabilities: z.array(z.string().min(1).max(120)).min(1).max(32),
    forbiddenToolsBlocked: z.boolean(),
    timestampMs: z.number().int().positive(),
    signature: z.string().min(32).max(256),
  })
  .strict();
export type HermesBridgeRuntimeAttestRequest = z.infer<typeof hermesBridgeRuntimeAttestSchema>;

export const hermesBridgeSubagentStopSchema = z
  .object({
    bridgeTicket: z.string().min(16).max(2_048),
    childHermesSessionId: z.string().min(1).max(200),
    status: z.enum(['completed', 'failed', 'cancelled', 'timed_out']),
    errorMessage: z.string().max(500).optional(),
  })
  .strict();
export type HermesBridgeSubagentStopRequest = z.infer<typeof hermesBridgeSubagentStopSchema>;

export const mcpJsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    method: z.string().min(1).max(120),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type McpJsonRpcRequest = z.infer<typeof mcpJsonRpcRequestSchema>;

export const uuidParamSchema = z.string().uuid();

export function getToolJsonSchemasForAdvertisedCapabilities(
  capabilities: readonly ActiveToolCapability[],
): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  const descriptions: Record<ActiveToolCapability, string> = {
    search_catalog:
      'Search store catalog in current verified market with lexical, hybrid, or contextual retrieval.',
    get_product:
      'Retrieve verified Shopify product details, variants, options, and market pricing.',
    get_variant: 'Retrieve a verified Shopify product variant by ProductVariant GID.',
    compare_products: 'Compare 2 to 4 verified catalog products side by side.',
    get_compatible_options:
      'Inspect declared options and available variants for a product (compatibility is UNKNOWN unless declared).',
    get_related_products: 'Find verified products in the same collection or product type.',
    get_experience_context: 'Read the active visitor session ExperienceContext and contextVersion.',
    get_recommendations: 'Retrieve consent-aware, market-scoped product recommendations.',
    propose_experience_composition:
      'Create a validated non-mutating AdaptiveComposition proposal bound to contextVersion.',
    update_explicit_criteria:
      'Record explicit visitor-declared exploration criteria on the active session.',
  };

  return capabilities.map((name) => ({
    name,
    description: descriptions[name],
    inputSchema: z.toJSONSchema(TOOL_CAPABILITY_INPUT_SCHEMAS[name]) as Record<string, unknown>,
  }));
}
