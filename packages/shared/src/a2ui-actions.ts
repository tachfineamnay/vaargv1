import { z } from 'zod';
import { explorationCriteriaSchema } from './experience.js';

/**
 * FL07 Task 9 — Controlled UI action contracts for A2UI 1.0 (`renderer_to_agent.json` `action`).
 *
 * Only explicit, non-mutating or server-validated exploration/navigation actions
 * are executable in FL07. Commercial, order, support, campaign, and durable memory
 * mutations planned for FL08–FL11 are classified explicitly as unavailable or
 * proposal-only — they never fake a purchase, order, cart change, or ticket.
 */

export const ALLOWED_A2UI_ACTION_NAMES = [
  'view_product',
  'view_collection',
  'refine_search',
  'update_explicit_criteria',
  'compare_products',
  'answer_guided_question',
  'request_composition',
  'return_to_general_exploration',
] as const;
export const allowedA2UiActionNameSchema = z.enum(ALLOWED_A2UI_ACTION_NAMES);
export type AllowedA2UiActionName = z.infer<typeof allowedA2UiActionNameSchema>;

export const FUTURE_UNAVAILABLE_A2UI_ACTION_NAMES = [
  'add_to_cart',
  'update_cart',
  'remove_from_cart',
  'start_checkout',
  'create_order',
  'submit_support_case',
  'dispatch_campaign',
  'save_memory_preference',
] as const;
export const futureUnavailableA2UiActionNameSchema = z.enum(FUTURE_UNAVAILABLE_A2UI_ACTION_NAMES);
export type FutureUnavailableA2UiActionName = z.infer<typeof futureUnavailableA2UiActionNameSchema>;

export const FUTURE_ACTION_PHASE_MAP: Readonly<
  Record<FutureUnavailableA2UiActionName, { availableIn: 'FL08' | 'FL09' | 'FL10' | 'FL11'; proposalType: string }>
> = Object.freeze({
  add_to_cart: { availableIn: 'FL08', proposalType: 'cart_change' },
  update_cart: { availableIn: 'FL08', proposalType: 'cart_change' },
  remove_from_cart: { availableIn: 'FL08', proposalType: 'cart_change' },
  start_checkout: { availableIn: 'FL08', proposalType: 'checkout_start' },
  create_order: { availableIn: 'FL08', proposalType: 'checkout_start' },
  save_memory_preference: { availableIn: 'FL09', proposalType: 'memory_preference' },
  submit_support_case: { availableIn: 'FL10', proposalType: 'support_case' },
  dispatch_campaign: { availableIn: 'FL11', proposalType: 'campaign_draft' },
});

const safeHandleSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9][a-z0-9-]*$/i, 'Invalid catalog handle');

const shopifyProductGidSchema = z
  .string()
  .regex(/^gid:\/\/shopify\/Product\/\d+$/, 'Expected verified Shopify Product GID');

export const partialCriteriaPatchSchema = z
  .object({
    query: z.string().max(200).nullable().optional(),
    productType: z.string().max(200).nullable().optional(),
    vendor: z.string().max(200).nullable().optional(),
    collection: z.string().max(300).nullable().optional(),
    priceMin: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/).nullable().optional(),
    priceMax: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/).nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
    attributes: explorationCriteriaSchema.shape.attributes.optional(),
  })
  .strict();
export type PartialCriteriaPatch = z.infer<typeof partialCriteriaPatchSchema>;

export const viewProductActionContextSchema = z
  .object({
    handle: safeHandleSchema,
    productId: shopifyProductGidSchema.optional(),
  })
  .strict();

export const viewCollectionActionContextSchema = z
  .object({
    handle: safeHandleSchema,
  })
  .strict();

export const refineSearchActionContextSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    mode: z.enum(['lexical', 'hybrid', 'contextual']).optional(),
  })
  .strict();

export const updateExplicitCriteriaActionContextSchema = z
  .object({
    criteria: partialCriteriaPatchSchema,
    expectedContextVersion: z.number().int().nonnegative().optional(),
  })
  .strict();

export const compareProductsActionContextSchema = z
  .object({
    productIds: z.array(shopifyProductGidSchema).min(2).max(4),
    navigate: z.boolean().default(false),
  })
  .strict();

export const answerGuidedQuestionActionContextSchema = z
  .object({
    questionId: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/i),
    optionId: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/i),
    label: z.string().trim().min(1).max(160),
    conversationId: z.string().uuid().optional(),
    criteriaPatch: partialCriteriaPatchSchema.optional(),
    submitReply: z.boolean().default(true),
  })
  .strict();

export const requestCompositionActionContextSchema = z
  .object({
    reason: z
      .enum([
        'initial',
        'explicit_criteria',
        'category_signal',
        'collection_signal',
        'product_signal',
        'comparison_available',
        'exploration_reset',
        'degraded_rules',
      ])
      .optional(),
    compareProductIds: z.array(shopifyProductGidSchema).min(2).max(4).optional(),
    expectedContextVersion: z.number().int().nonnegative().optional(),
  })
  .strict();

export const returnToGeneralExplorationActionContextSchema = z.object({}).strict();

export const futureProposalOnlyActionContextSchema = z
  .object({
    proposalId: z.string().uuid().optional(),
  })
  .passthrough();

export const CONTROLLED_ACTION_CONTEXT_SCHEMAS: Readonly<
  Record<AllowedA2UiActionName, z.ZodTypeAny>
> = {
  view_product: viewProductActionContextSchema,
  view_collection: viewCollectionActionContextSchema,
  refine_search: refineSearchActionContextSchema,
  update_explicit_criteria: updateExplicitCriteriaActionContextSchema,
  compare_products: compareProductsActionContextSchema,
  answer_guided_question: answerGuidedQuestionActionContextSchema,
  request_composition: requestCompositionActionContextSchema,
  return_to_general_exploration: returnToGeneralExplorationActionContextSchema,
};

/**
 * Official A2UI 1.0 Renderer-to-Agent `action` message envelope (`renderer_to_agent.json`).
 */
export const a2uiRendererActionEnvelopeSchema = z
  .object({
    version: z.literal('1.0'),
    action: z
      .object({
        name: z.string().min(1).max(80),
        surfaceId: z.string().min(1).max(200),
        sourceComponentId: z.string().min(1).max(120),
        timestamp: z.string().datetime(),
        context: z.record(z.string(), z.unknown()).default({}),
        userMessage: z.string().max(400).optional(),
      })
      .strict(),
  })
  .strict();
export type A2UiRendererActionEnvelope = z.infer<typeof a2uiRendererActionEnvelopeSchema>;

export type ValidatedControlledUiAction =
  | {
      kind: 'allowed';
      name: AllowedA2UiActionName;
      surfaceId: string;
      sourceComponentId: string;
      timestamp: string;
      context:
        | z.infer<typeof viewProductActionContextSchema>
        | z.infer<typeof viewCollectionActionContextSchema>
        | z.infer<typeof refineSearchActionContextSchema>
        | z.infer<typeof updateExplicitCriteriaActionContextSchema>
        | z.infer<typeof compareProductsActionContextSchema>
        | z.infer<typeof answerGuidedQuestionActionContextSchema>
        | z.infer<typeof requestCompositionActionContextSchema>
        | z.infer<typeof returnToGeneralExplorationActionContextSchema>;
    }
  | {
      kind: 'future_unavailable';
      name: FutureUnavailableA2UiActionName;
      surfaceId: string;
      sourceComponentId: string;
      availableIn: 'FL08' | 'FL09' | 'FL10' | 'FL11';
      proposalType: string;
      proposalId: string | null;
    }
  | {
      kind: 'rejected';
      code: 'INVALID_ENVELOPE' | 'UNAUTHORIZED_ACTION' | 'INVALID_ACTION_CONTEXT';
      message: string;
    };

export function validateControlledUiAction(raw: unknown): ValidatedControlledUiAction {
  const envelopeParsed = a2uiRendererActionEnvelopeSchema.safeParse(raw);
  if (!envelopeParsed.success) {
    return {
      kind: 'rejected',
      code: 'INVALID_ENVELOPE',
      message: envelopeParsed.error.issues.map((i) => i.message).join('; '),
    };
  }
  const { name, surfaceId, sourceComponentId, timestamp, context } = envelopeParsed.data.action;

  const allowedParsed = allowedA2UiActionNameSchema.safeParse(name);
  if (allowedParsed.success) {
    const ctxSchema = CONTROLLED_ACTION_CONTEXT_SCHEMAS[allowedParsed.data];
    const ctxParsed = ctxSchema.safeParse(context);
    if (!ctxParsed.success) {
      return {
        kind: 'rejected',
        code: 'INVALID_ACTION_CONTEXT',
        message: `Invalid context for action "${allowedParsed.data}": ${ctxParsed.error.issues.map((i) => i.message).join('; ')}`,
      };
    }
    return {
      kind: 'allowed',
      name: allowedParsed.data,
      surfaceId,
      sourceComponentId,
      timestamp,
      context: ctxParsed.data as Extract<ValidatedControlledUiAction, { kind: 'allowed' }>['context'],
    };
  }

  const futureParsed = futureUnavailableA2UiActionNameSchema.safeParse(name);
  if (futureParsed.success) {
    const meta = FUTURE_ACTION_PHASE_MAP[futureParsed.data];
    const futCtx = futureProposalOnlyActionContextSchema.safeParse(context);
    return {
      kind: 'future_unavailable',
      name: futureParsed.data,
      surfaceId,
      sourceComponentId,
      availableIn: meta.availableIn,
      proposalType: meta.proposalType,
      proposalId: futCtx.success ? (futCtx.data.proposalId ?? null) : null,
    };
  }

  return {
    kind: 'rejected',
    code: 'UNAUTHORIZED_ACTION',
    message: `Action "${name}" is not authorized in the VAARG A2UI catalog`,
  };
}

export const agentUiActionResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('APPLIED'),
    actionName: allowedA2UiActionNameSchema,
    navigationHref: z.string().nullable(),
    contextVersion: z.number().int().nonnegative(),
    experienceRevision: z.number().int().nonnegative(),
    compareProductIds: z.array(shopifyProductGidSchema).max(4).optional(),
    submittedMessageId: z.string().uuid().nullable().optional(),
    a2uiMessages: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
  z.object({
    status: z.literal('UNAVAILABLE_IN_CURRENT_PHASE'),
    executed: z.literal(false),
    actionName: futureUnavailableA2UiActionNameSchema,
    availableIn: z.enum(['FL08', 'FL09', 'FL10', 'FL11']),
    proposalId: z.string().uuid().nullable(),
    proposalStatus: z.enum(['verified_non_executing', 'not_found', 'none']),
    message: z.string().min(1).max(400),
  }),
]);
export type AgentUiActionResponse = z.infer<typeof agentUiActionResponseSchema>;
