import { createHash } from 'node:crypto';
import { z } from 'zod';
import { adaptiveCompositionSchema } from './composition.js';
import { explorationCriteriaSchema, preferenceSubjectSchema } from './experience.js';
import {
  MAX_CONCURRENT_CHILDREN_HARD_CAP,
  MAX_DELEGATION_DEPTH_HARD_CAP,
  type AgentRole,
  type RunBudgetPolicy,
  type SpecialistRole,
  specialistRoleSchema,
} from './intelligence.js';

export const preferencePolaritySchema = z.enum(['positive', 'negative', 'neutral']);
export type PreferencePolarity = z.infer<typeof preferencePolaritySchema>;

export const preferenceProvenanceSchema = z.enum(['DECLARED', 'OBSERVED', 'INFERRED']);
export type PreferenceProvenance = z.infer<typeof preferenceProvenanceSchema>;

export const ACTIVE_TOOL_CAPABILITIES = [
  'search_catalog',
  'get_product',
  'get_variant',
  'compare_products',
  'get_compatible_options',
  'get_related_products',
  'get_experience_context',
  'get_recommendations',
  'propose_experience_composition',
  'update_explicit_criteria',
] as const;
export const activeToolCapabilitySchema = z.enum(ACTIVE_TOOL_CAPABILITIES);
export type ActiveToolCapability = z.infer<typeof activeToolCapabilitySchema>;

/**
 * Safe read-only intersection exposed when authenticated child-role identity cannot be proven
 * (for example, shared Hermes parent/child MCP transport without signed child registration).
 */
export const SAFE_READ_CAPABILITY_INTERSECTION: readonly ActiveToolCapability[] = [
  'search_catalog',
  'get_product',
  'get_variant',
  'compare_products',
  'get_compatible_options',
  'get_related_products',
  'get_experience_context',
  'get_recommendations',
] as const;

export const UNAVAILABLE_FUTURE_CAPABILITIES = {
  propose_cart_change: { implementedIn: 'FL08', reason: 'Cart mutation proposals require FL08 Shopify Storefront Cart integration.' },
  propose_checkout: { implementedIn: 'FL08', reason: 'Checkout URL proposals require FL08 Shopify checkout boundary.' },
  get_customer_context: { implementedIn: 'FL09', reason: 'Persistent CDP customer context requires FL09.' },
  propose_memory_update: { implementedIn: 'FL09', reason: 'Persistent cross-session memory consolidation requires FL09.' },
  draft_campaign: { implementedIn: 'FL11', reason: 'Merchant campaign preparation requires FL11.' },
  get_order_status: { implementedIn: 'FL10', reason: 'Authenticated order history access requires FL10.' },
  propose_support_case: { implementedIn: 'FL10', reason: 'Support case escalation persistence requires FL10.' },
} as const;
export type UnavailableFutureCapability = keyof typeof UNAVAILABLE_FUTURE_CAPABILITIES;

const shopifyProductGidSchema = z
  .string()
  .regex(/^gid:\/\/shopify\/Product\/\d+$/, 'Expected verified Shopify Product GID');
const shopifyVariantGidSchema = z
  .string()
  .regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/, 'Expected verified Shopify ProductVariant GID');

// ============================================================================
// Master & 6 Specialist Typed Input / Output Schemas
// ============================================================================

export const masterInputSchema = z
  .object({
    visitorMessage: z.string().min(1).max(4_000),
    contextVersion: z.number().int().nonnegative(),
    market: z.object({
      country: z.string().length(2),
      language: z.string().min(2).max(10),
      currency: z.string().length(3),
    }),
    personalizationGranted: z.boolean(),
    delegationAllowed: z.boolean(),
  })
  .strict();
export type MasterInput = z.infer<typeof masterInputSchema>;

export const masterOutputSchema = z
  .object({
    responseMessage: z.string().min(1).max(8_000),
    groundedProductRefs: z.array(shopifyProductGidSchema).max(24).default([]),
    groundedVariantRefs: z.array(shopifyVariantGidSchema).max(24).default([]),
    clarificationPrompt: z.string().max(1_000).nullable().default(null),
    confirmationRequired: z.boolean().default(false),
    delegatedRoles: z.array(specialistRoleSchema).max(6).default([]),
    proposalIds: z.array(z.string().uuid()).max(12).default([]),
  })
  .strict();
export type MasterOutput = z.infer<typeof masterOutputSchema>;

export const discoveryInputSchema = z
  .object({
    goal: z.string().min(1).max(1_000),
    query: z.string().max(200).optional(),
    criteria: explorationCriteriaSchema.optional(),
    maxCandidates: z.number().int().min(1).max(24).default(12),
  })
  .strict();
export type DiscoveryInput = z.infer<typeof discoveryInputSchema>;

export const discoveryCandidateSchema = z
  .object({
    productRef: shopifyProductGidSchema,
    variantRefs: z.array(shopifyVariantGidSchema).max(12).default([]),
    rationale: z.string().min(1).max(500),
    provenanceChannel: z.enum(['lexical', 'hybrid', 'contextual', 'related', 'compatible']),
  })
  .strict();

export const discoveryOutputSchema = z
  .object({
    role: z.literal('discovery'),
    candidates: z.array(discoveryCandidateSchema).max(24),
    catalogFreshnessAt: z.string().datetime().nullable(),
    degradedMode: z.boolean().default(false),
    summary: z.string().min(1).max(1_500),
  })
  .strict();
export type DiscoveryOutput = z.infer<typeof discoveryOutputSchema>;

export const experienceSpecialistInputSchema = z
  .object({
    goal: z.string().min(1).max(1_000),
    contextVersion: z.number().int().nonnegative(),
    candidateProductRefs: z.array(shopifyProductGidSchema).max(24).default([]),
  })
  .strict();
export type ExperienceSpecialistInput = z.infer<typeof experienceSpecialistInputSchema>;

export const experienceSpecialistOutputSchema = z
  .object({
    role: z.literal('experience'),
    contextVersion: z.number().int().nonnegative(),
    compositionProposal: adaptiveCompositionSchema.nullable(),
    adaptationSummary: z.string().min(1).max(1_000),
  })
  .strict();
export type ExperienceSpecialistOutput = z.infer<typeof experienceSpecialistOutputSchema>;

export const commerceInputSchema = z
  .object({
    goal: z.string().min(1).max(1_000),
    productRefs: z.array(shopifyProductGidSchema).min(1).max(4),
    variantRefs: z.array(shopifyVariantGidSchema).max(8).default([]),
    requestedAction: z.enum(['compare', 'inspect_variant', 'propose_cart', 'propose_checkout']).default('compare'),
  })
  .strict();
export type CommerceInput = z.infer<typeof commerceInputSchema>;

export const commercialProposalDraftSchema = z
  .object({
    actionType: z.enum(['cart_change', 'checkout_start']),
    variantRef: shopifyVariantGidSchema,
    quantity: z.number().int().min(1).max(20),
    requiresExplicitConfirmation: z.literal(true),
    executionAvailability: z.literal('UNAVAILABLE_UNTIL_FL08'),
  })
  .strict();

export const commerceOutputSchema = z
  .object({
    role: z.literal('commerce'),
    verifiedProductRefs: z.array(shopifyProductGidSchema).max(4),
    verifiedVariantRefs: z.array(shopifyVariantGidSchema).max(8),
    compatibilityStatus: z.literal('UNKNOWN'),
    comparisonSummary: z.string().min(1).max(1_500),
    commercialProposal: commercialProposalDraftSchema.nullable().default(null),
  })
  .strict();
export type CommerceOutput = z.infer<typeof commerceOutputSchema>;

export const memoryInputSchema = z
  .object({
    goal: z.string().min(1).max(1_000),
    personalizationGranted: z.boolean(),
    recentStatements: z.array(z.string().min(1).max(1_000)).max(12),
  })
  .strict();
export type MemoryInput = z.infer<typeof memoryInputSchema>;

export const proposedPreferenceItemSchema = z
  .object({
    dimension: z.string().min(1).max(64),
    value: z.string().min(1).max(160),
    polarity: preferencePolaritySchema,
    provenance: preferenceProvenanceSchema,
    subject: preferenceSubjectSchema,
    confidence: z.number().min(0).max(1),
    sourceStatement: z.string().min(1).max(300),
  })
  .strict();

export const memoryOutputSchema = z
  .object({
    role: z.literal('memory'),
    personalizationApplied: z.boolean(),
    proposedPreferences: z.array(proposedPreferenceItemSchema).max(12),
    proposedConversationSummary: z.string().max(2_000).nullable(),
    persistenceAvailability: z.literal('SESSION_PROPOSAL_ONLY_UNTIL_FL09'),
  })
  .strict();
export type MemoryOutput = z.infer<typeof memoryOutputSchema>;

export const marketingInputSchema = z
  .object({
    goal: z.string().min(1).max(1_000),
    segmentKey: z.string().min(1).max(120),
    featuredProductRefs: z.array(shopifyProductGidSchema).min(1).max(8),
  })
  .strict();
export type MarketingInput = z.infer<typeof marketingInputSchema>;

export const marketingOutputSchema = z
  .object({
    role: z.literal('marketing'),
    campaignDraftHeadline: z.string().min(1).max(160),
    campaignDraftBody: z.string().min(1).max(2_000),
    groundedProductRefs: z.array(shopifyProductGidSchema).min(1).max(8),
    requiresMerchantApproval: z.literal(true),
    dispatchAvailability: z.literal('UNAVAILABLE_UNTIL_FL11'),
  })
  .strict();
export type MarketingOutput = z.infer<typeof marketingOutputSchema>;

export const supportInputSchema = z
  .object({
    goal: z.string().min(1).max(1_000),
    inquiryTopic: z.enum(['product_question', 'shipping_policy', 'returns_policy', 'order_issue', 'human_escalation']),
    relatedProductRefs: z.array(shopifyProductGidSchema).max(4).default([]),
  })
  .strict();
export type SupportInput = z.infer<typeof supportInputSchema>;

export const supportOutputSchema = z
  .object({
    role: z.literal('support'),
    groundedAnswer: z.string().min(1).max(1_500),
    escalationRecommended: z.boolean(),
    escalationReason: z.string().max(500).nullable(),
    autonomousRefundAllowed: z.literal(false),
    orderAccessAvailability: z.literal('UNAVAILABLE_UNTIL_FL10'),
  })
  .strict();
export type SupportOutput = z.infer<typeof supportOutputSchema>;

export interface RolePromptDefinition {
  role: AgentRole;
  version: string;
  promptSha256: string;
  inputSchemaVersion: string;
  outputSchemaVersion: string;
  templateText: string;
  allowedCapabilities: readonly ActiveToolCapability[];
  delegationEnabled: boolean;
  defaultBudgetPolicy: RunBudgetPolicy;
  outputJsonSchema: Record<string, unknown>;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const ROLE_PROMPTS_RAW: Record<
  AgentRole,
  {
    version: string;
    templateText: string;
    allowedCapabilities: readonly ActiveToolCapability[];
    delegationEnabled: boolean;
    budget: Omit<RunBudgetPolicy, 'policyKey' | 'role' | 'allowedCapabilities' | 'delegationEnabled'>;
    outputSchema: z.ZodTypeAny;
  }
> = {
  master: {
    version: 'master@1.0.0',
    templateText: [
      'You are the VAARG Personal Shopper (Master orchestrator).',
      'Speak directly to the visitor clearly, concisely, and truthfully.',
      'GROUNDING RULES:',
      '1. Never invent product IDs, variant IDs, prices, currencies, stock availability, promotions, shipping promises, or compatibility.',
      '2. Every recommended or compared item MUST come from verified ToolBroker catalog capabilities in this store and market.',
      '3. Answer straightforward questions directly using your catalog and experience tools without unnecessary delegation.',
      '4. Only delegate to a specialist (`discovery`, `experience`, `commerce`, `memory`, `marketing`, `support`) when parallel domain analysis genuinely adds value, never exceeding 3 concurrent children and never nesting beyond depth 1.',
      '5. Never expose hidden reasoning, internal IDs, or unverified specialist drafts. Ask for clarification when criteria conflict or are ambiguous, and require explicit visitor confirmation before any commercial action.',
    ].join('\n'),
    allowedCapabilities: ACTIVE_TOOL_CAPABILITIES,
    delegationEnabled: true,
    budget: {
      maxConcurrentChildren: MAX_CONCURRENT_CHILDREN_HARD_CAP,
      maxDelegationDepth: MAX_DELEGATION_DEPTH_HARD_CAP,
      maxTotalChildren: 6,
      maxTotalTokens: 32_768,
      maxModelCalls: 12,
      maxToolCalls: 16,
      maxCostUsd: 0.25,
      maxDurationMs: 45_000,
    },
    outputSchema: masterOutputSchema,
  },
  discovery: {
    version: 'discovery@1.0.0',
    templateText: [
      'You are the VAARG Discovery Specialist.',
      'Explore the catalog using `search_catalog`, `get_product`, `get_variant`, `get_compatible_options`, and `get_related_products`.',
      'Return only grounded Shopify Product and ProductVariant GIDs returned by tools, with freshness and channel provenance.',
      'Never invent products, attributes, or compatibility.',
    ].join('\n'),
    allowedCapabilities: [
      'search_catalog',
      'get_product',
      'get_variant',
      'get_compatible_options',
      'get_related_products',
    ],
    delegationEnabled: false,
    budget: {
      maxConcurrentChildren: 0,
      maxDelegationDepth: 0,
      maxTotalChildren: 0,
      maxTotalTokens: 8_192,
      maxModelCalls: 4,
      maxToolCalls: 6,
      maxCostUsd: 0.05,
      maxDurationMs: 15_000,
    },
    outputSchema: discoveryOutputSchema,
  },
  experience: {
    version: 'experience@1.0.0',
    templateText: [
      'You are the VAARG Experience Specialist.',
      'Inspect the current `ExperienceContext` and grounded recommendations to propose a structured `AdaptiveComposition` bound to the exact `contextVersion`.',
      'Never bypass `withinCompositionLimits` or invent ungrounded products.',
    ].join('\n'),
    allowedCapabilities: [
      'get_experience_context',
      'get_recommendations',
      'propose_experience_composition',
      'search_catalog',
      'get_product',
    ],
    delegationEnabled: false,
    budget: {
      maxConcurrentChildren: 0,
      maxDelegationDepth: 0,
      maxTotalChildren: 0,
      maxTotalTokens: 8_192,
      maxModelCalls: 4,
      maxToolCalls: 5,
      maxCostUsd: 0.05,
      maxDurationMs: 15_000,
    },
    outputSchema: experienceSpecialistOutputSchema,
  },
  commerce: {
    version: 'commerce@1.0.0',
    templateText: [
      'You are the VAARG Commerce Specialist.',
      'Compare verified products and variants, check verified market price/currency/availability, and report compatibility strictly as `UNKNOWN` unless explicitly verified.',
      'Never execute cart or checkout mutations; cart and checkout execution remain unavailable until FL08 and may only be represented as non-executing confirmation-gated proposals.',
    ].join('\n'),
    allowedCapabilities: [
      'get_product',
      'get_variant',
      'compare_products',
      'get_compatible_options',
      'get_related_products',
      'get_experience_context',
    ],
    delegationEnabled: false,
    budget: {
      maxConcurrentChildren: 0,
      maxDelegationDepth: 0,
      maxTotalChildren: 0,
      maxTotalTokens: 8_192,
      maxModelCalls: 4,
      maxToolCalls: 6,
      maxCostUsd: 0.05,
      maxDurationMs: 15_000,
    },
    outputSchema: commerceOutputSchema,
  },
  memory: {
    version: 'memory@1.0.0',
    templateText: [
      'You are the VAARG Memory Specialist.',
      'Distinguish declared, observed, and inferred preferences and separate `SELF` vs `GIFT` shopping context.',
      'Strictly respect `personalization` consent, never modify consent, and emit session proposals only (cross-session CDP persistence belongs to FL09).',
    ].join('\n'),
    allowedCapabilities: ['get_experience_context'],
    delegationEnabled: false,
    budget: {
      maxConcurrentChildren: 0,
      maxDelegationDepth: 0,
      maxTotalChildren: 0,
      maxTotalTokens: 6_144,
      maxModelCalls: 3,
      maxToolCalls: 2,
      maxCostUsd: 0.04,
      maxDurationMs: 12_000,
    },
    outputSchema: memoryOutputSchema,
  },
  marketing: {
    version: 'marketing@1.0.0',
    templateText: [
      'You are the VAARG Marketing Specialist.',
      'Draft merchant-reviewable campaign proposals grounded strictly in verified catalog products.',
      'Never send or schedule customer communications; campaign persistence and dispatch remain unavailable until FL11.',
    ].join('\n'),
    allowedCapabilities: ['search_catalog', 'get_product', 'get_recommendations'],
    delegationEnabled: false,
    budget: {
      maxConcurrentChildren: 0,
      maxDelegationDepth: 0,
      maxTotalChildren: 0,
      maxTotalTokens: 6_144,
      maxModelCalls: 3,
      maxToolCalls: 4,
      maxCostUsd: 0.04,
      maxDurationMs: 12_000,
    },
    outputSchema: marketingOutputSchema,
  },
  support: {
    version: 'support@1.0.0',
    templateText: [
      'You are the VAARG Support Specialist.',
      'Answer product questions from verified catalog data only and recommend human escalation when order-specific assistance is needed.',
      'Never access customer orders, fabricate policy terms, or issue autonomous refunds (order/support workflows belong to FL10).',
    ].join('\n'),
    allowedCapabilities: ['get_product', 'get_variant', 'search_catalog'],
    delegationEnabled: false,
    budget: {
      maxConcurrentChildren: 0,
      maxDelegationDepth: 0,
      maxTotalChildren: 0,
      maxTotalTokens: 6_144,
      maxModelCalls: 3,
      maxToolCalls: 4,
      maxCostUsd: 0.04,
      maxDurationMs: 12_000,
    },
    outputSchema: supportOutputSchema,
  },
};

export const ROLE_DEFINITIONS: Record<AgentRole, RolePromptDefinition> = {
  master: buildRoleDefinition('master'),
  discovery: buildRoleDefinition('discovery'),
  experience: buildRoleDefinition('experience'),
  commerce: buildRoleDefinition('commerce'),
  memory: buildRoleDefinition('memory'),
  marketing: buildRoleDefinition('marketing'),
  support: buildRoleDefinition('support'),
};

function buildRoleDefinition(role: AgentRole): RolePromptDefinition {
  const spec = ROLE_PROMPTS_RAW[role];
  const jsonSchema = z.toJSONSchema(spec.outputSchema) as Record<string, unknown>;
  return {
    role,
    version: spec.version,
    promptSha256: sha256Hex(spec.templateText),
    inputSchemaVersion: '1.0.0',
    outputSchemaVersion: '1.0.0',
    templateText: spec.templateText,
    allowedCapabilities: spec.allowedCapabilities,
    delegationEnabled: spec.delegationEnabled,
    defaultBudgetPolicy: {
      policyKey: 'default-v1',
      role,
      allowedCapabilities: [...spec.allowedCapabilities],
      delegationEnabled: spec.delegationEnabled,
      ...spec.budget,
    },
    outputJsonSchema: jsonSchema,
  };
}

export function getRoleDefinition(role: AgentRole): RolePromptDefinition {
  return ROLE_DEFINITIONS[role];
}

export function getEffectiveCapabilitiesForRole(
  role: AgentRole,
  roleVerified: boolean,
): readonly ActiveToolCapability[] {
  const def = ROLE_DEFINITIONS[role];
  const roleAllowed = new Set<ActiveToolCapability>(def.allowedCapabilities);
  if (roleVerified) {
    return def.allowedCapabilities;
  }
  return SAFE_READ_CAPABILITY_INTERSECTION.filter((cap) => roleAllowed.has(cap));
}

export function buildSpecialistDelegationInstruction(
  role: SpecialistRole,
  goal: string,
): {
  goal: string;
  context: string;
  outputSchema: Record<string, unknown>;
} {
  const def = ROLE_DEFINITIONS[role];
  return {
    goal: `[ROLE:${role}] ${goal.trim()}`,
    context: def.templateText,
    outputSchema: def.outputJsonSchema,
  };
}
