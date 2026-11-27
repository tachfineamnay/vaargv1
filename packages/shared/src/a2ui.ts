import { z } from 'zod';
import {
  catalogV1CollectionSchema,
  catalogV1ComparisonSchema,
  catalogV1ProductDetailSchema,
  catalogV1ProductSummarySchema,
} from './catalog.js';
import { internalHrefSchema } from './composition.js';
import { allowedA2UiActionNameSchema } from './a2ui-actions.js';

/**
 * FL07 Tasks 4, 5, 6 — Official A2UI 1.0 Wire Contracts & VAARG Storefront Catalog.
 *
 * Conforms to canonical A2UI v1.0 JSON Schemas:
 * - https://a2ui.org/specification/v1_0/agent_to_renderer.json
 * - https://a2ui.org/specification/v1_0/renderer_to_agent.json
 * - https://a2ui.org/specification/v1_0/common_types.json
 * - https://a2ui.org/specification/v1_0/catalog_definition.json
 */

export const A2UI_PROTOCOL_VERSION = '1.0' as const;
export const VAARG_A2UI_CATALOG_ID = 'https://vaarg.io/a2ui/v1_0/storefront_catalog.json' as const;
export const VAARG_A2UI_CATALOG_VERSION = '1.0.0' as const;

export const A2UI_LIMITS = Object.freeze({
  maxComponents: 48,
  maxDepth: 4,
  maxChildrenPerContainer: 12,
  maxMessageBytes: 131_072,
  maxDataModelBytes: 196_608,
  maxTotalSurfaceBytes: 262_144,
  maxPointerDepth: 8,
  maxStringLength: 1_200,
});

export const ACTIVE_VAARG_A2UI_COMPONENTS = [
  'CategoryTile',
  'CollectionGrid',
  'AdaptiveBento',
  'ProductCard',
  'ProductGrid',
  'ProductGallery',
  'Recommendations',
  'ProductComparator',
  'SuggestionChips',
  'GuidedQuestions',
] as const;
export const activeVaargA2UiComponentNameSchema = z.enum(ACTIVE_VAARG_A2UI_COMPONENTS);
export type ActiveVaargA2UiComponentName = z.infer<typeof activeVaargA2UiComponentNameSchema>;

/**
 * Future FL08–FL10 component contracts — typed for forward compatibility,
 * intentionally NOT registered as active renderable capabilities in FL07.
 */
export const FUTURE_VAARG_A2UI_COMPONENTS = [
  'EngravingConfigurator',
  'BundleBuilder',
  'CartSummary',
  'OrderTracking',
  'SupportCard',
] as const;
export const futureVaargA2UiComponentNameSchema = z.enum(FUTURE_VAARG_A2UI_COMPONENTS);
export type FutureVaargA2UiComponentName = z.infer<typeof futureVaargA2UiComponentNameSchema>;

export const a2uiComponentIdSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:_-]*$/, 'Invalid A2UI component id');

export const a2uiSurfaceKindSchema = z.enum(['adaptive', 'shopper']);
export type A2UiSurfaceKind = z.infer<typeof a2uiSurfaceKindSchema>;

export const a2uiSurfaceIdSchema = z
  .string()
  .min(16)
  .max(180)
  .regex(
    /^vaarg:session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(adaptive|shopper(:[a-z0-9_-]{1,64})?)$/i,
    'Surface ID must be scoped to a VAARG visitor session',
  );

export function buildVaargSurfaceId(
  sessionId: string,
  kind: A2UiSurfaceKind,
  subKey?: string,
): string {
  const suffix = kind === 'shopper' && subKey ? `shopper:${subKey}` : kind;
  return `vaarg:session:${sessionId}:${suffix}`;
}

export function extractSurfaceOwnerSessionId(surfaceId: string): string | null {
  const match =
    /^vaarg:session:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(?:adaptive|shopper(?::[a-z0-9_-]{1,64})?)$/i.exec(
      surfaceId,
    );
  return match?.[1] ?? null;
}

/**
 * Official A2UI 1.0 RFC 6901 JSON Pointer data binding (`common_types.json#/$defs/DataBinding`).
 */
export const a2uiJsonPointerSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^(\/[A-Za-z0-9_~-]+){1,8}$/, 'RFC 6901 JSON Pointer must have 1..8 safe path segments');

export const a2uiDataBindingSchema = z
  .object({
    '@path': a2uiJsonPointerSchema,
  })
  .strict();
export type A2UiDataBinding = z.infer<typeof a2uiDataBindingSchema>;

export function isA2UiDataBinding(value: unknown): value is A2UiDataBinding {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 1 &&
    typeof (value as Record<string, unknown>)['@path'] === 'string'
  );
}

/**
 * Official A2UI 1.0 Action (`common_types.json#/$defs/Action`) — only `event` is permitted;
 * `functionCall` / `@call` arbitrary renderer execution is rejected fail-closed.
 */
export const a2uiActionEventSchema = z
  .object({
    event: z
      .object({
        name: allowedA2UiActionNameSchema,
        userMessage: z.string().min(1).max(300).optional(),
        context: z.record(z.string(), z.unknown()).default({}),
      })
      .strict(),
  })
  .strict();
export type A2UiAction = z.infer<typeof a2uiActionEventSchema>;

export const a2uiAccessibilitySchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(300).optional(),
  })
  .strict();

export const a2uiSurfaceMetadataSchema = z
  .object({
    sessionId: z.string().uuid(),
    contextVersion: z.number().int().nonnegative(),
    experienceRevision: z.number().int().nonnegative(),
    surfaceKind: a2uiSurfaceKindSchema,
    freshness: z.string().datetime(),
    personalizationApplied: z.boolean().default(false),
    runId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type A2UiSurfaceMetadata = z.infer<typeof a2uiSurfaceMetadataSchema>;

// ============================================================================
// Resolved Prop Schemas for the 10 Active VAARG Catalog Components
// ============================================================================

const baseResolvedComponentFields = {
  id: a2uiComponentIdSchema,
  '@catalogId': z.literal(VAARG_A2UI_CATALOG_ID).optional(),
  '@accessibility': a2uiAccessibilitySchema.optional(),
  '@metadata': z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
};

export const resolvedAdaptiveBentoComponentSchema = z
  .object({
    ...baseResolvedComponentFields,
    component: z.literal('AdaptiveBento'),
    title: z.string().min(1).max(120).optional(),
    layout: z.enum(['stack', 'bento']).default('stack'),
    children: z.array(a2uiComponentIdSchema).min(1).max(A2UI_LIMITS.maxChildrenPerContainer),
  })
  .strict();

export const resolvedCategoryTileComponentSchema = z
  .object({
    ...baseResolvedComponentFields,
    component: z.literal('CategoryTile'),
    title: z.string().max(120).optional(),
    collections: z.array(catalogV1CollectionSchema).min(1).max(12),
  })
  .strict();

export const resolvedCollectionGridComponentSchema = z
  .object({
    ...baseResolvedComponentFields,
    component: z.literal('CollectionGrid'),
    title: z.string().min(1).max(120),
    collections: z.array(catalogV1CollectionSchema).min(1).max(12),
  })
  .strict();

export const resolvedProductCardComponentSchema = z
  .object({
    ...baseResolvedComponentFields,
    component: z.literal('ProductCard'),
    product: catalogV1ProductSummarySchema,
    note: z.string().max(120).optional(),
    action: a2uiActionEventSchema.optional(),
  })
  .strict();

export const resolvedProductGridComponentSchema = z
  .object({
    ...baseResolvedComponentFields,
    component: z.literal('ProductGrid'),
    title: z.string().min(1).max(120),
    products: z.array(catalogV1ProductSummarySchema).min(1).max(24),
    footerHref: internalHrefSchema.optional(),
    footerLabel: z.string().min(1).max(80).optional(),
  })
  .strict();

export const resolvedProductGalleryComponentSchema = z
  .object({
    ...baseResolvedComponentFields,
    component: z.literal('ProductGallery'),
    productHandle: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-z0-9][a-z0-9-]*$/i),
    productTitle: z.string().min(1).max(200).optional(),
    images: catalogV1ProductDetailSchema.shape.images.min(1).max(16),
    mediaCount: catalogV1ProductDetailSchema.shape.mediaCount,
  })
  .strict();

export const a2uiRecommendationItemSchema = z
  .object({
    summary: catalogV1ProductSummarySchema,
    relation: z.enum(['shared_collection', 'product_type']),
    provenance: z.string().min(1).max(200),
  })
  .strict();

export const resolvedRecommendationsComponentSchema = z
  .object({
    ...baseResolvedComponentFields,
    component: z.literal('Recommendations'),
    title: z.string().min(1).max(120),
    products: z.array(catalogV1ProductSummarySchema).min(1).max(12),
    items: z.array(a2uiRecommendationItemSchema).max(12).optional(),
    reasonCodes: z.array(z.string().min(1).max(64)).max(24).optional(),
  })
  .strict();

export const resolvedProductComparatorComponentSchema = z
  .object({
    ...baseResolvedComponentFields,
    component: z.literal('ProductComparator'),
    products: z.array(catalogV1ProductSummarySchema).min(2).max(4),
    comparison: catalogV1ComparisonSchema.optional(),
  })
  .strict();

export const a2uiSuggestionChipItemSchema = z
  .object({
    id: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/i),
    label: z.string().min(1).max(80),
    href: internalHrefSchema.optional(),
    action: a2uiActionEventSchema.optional(),
  })
  .strict()
  .refine((item) => Boolean(item.href || item.action), {
    message: 'SuggestionChip requires either an internal href or a controlled A2UI action',
  });

export const resolvedSuggestionChipsComponentSchema = z
  .object({
    ...baseResolvedComponentFields,
    component: z.literal('SuggestionChips'),
    title: z.string().max(120).optional(),
    chips: z.array(a2uiSuggestionChipItemSchema).min(1).max(8),
  })
  .strict();

export const a2uiGuidedQuestionOptionSchema = z
  .object({
    id: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/i),
    label: z.string().min(1).max(120),
    description: z.string().max(200).optional(),
    action: a2uiActionEventSchema,
  })
  .strict();

export const resolvedGuidedQuestionsComponentSchema = z
  .object({
    ...baseResolvedComponentFields,
    component: z.literal('GuidedQuestions'),
    questionId: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/i),
    title: z.string().min(1).max(120),
    prompt: z.string().min(1).max(300),
    options: z.array(a2uiGuidedQuestionOptionSchema).min(1).max(6),
  })
  .strict();

export const resolvedVaargA2UiComponentSchema = z.discriminatedUnion('component', [
  resolvedAdaptiveBentoComponentSchema,
  resolvedCategoryTileComponentSchema,
  resolvedCollectionGridComponentSchema,
  resolvedProductCardComponentSchema,
  resolvedProductGridComponentSchema,
  resolvedProductGalleryComponentSchema,
  resolvedRecommendationsComponentSchema,
  resolvedProductComparatorComponentSchema,
  resolvedSuggestionChipsComponentSchema,
  resolvedGuidedQuestionsComponentSchema,
]);
export type ResolvedVaargA2UiComponent = z.infer<typeof resolvedVaargA2UiComponentSchema>;

// ============================================================================
// Future FL08–FL10 Component Contracts (Typed Only — Not Registered as Active)
// ============================================================================

export const futureEngravingConfiguratorContractSchema = z
  .object({
    ...baseResolvedComponentFields,
    component: z.literal('EngravingConfigurator'),
    productId: z.string().startsWith('gid://shopify/Product/'),
    maxCharacters: z.number().int().min(1).max(120),
    proposalOnly: z.literal(true),
  })
  .strict();

export const futureBundleBuilderContractSchema = z
  .object({
    ...baseResolvedComponentFields,
    component: z.literal('BundleBuilder'),
    bundleKey: z.string().min(1).max(80),
    slotProductIds: z.array(z.string().startsWith('gid://shopify/Product/')).min(1).max(8),
    proposalOnly: z.literal(true),
  })
  .strict();

export const futureCartSummaryContractSchema = z
  .object({
    ...baseResolvedComponentFields,
    component: z.literal('CartSummary'),
    cartId: z.string().min(1).max(200),
    lineCount: z.number().int().nonnegative(),
  })
  .strict();

export const futureOrderTrackingContractSchema = z
  .object({
    ...baseResolvedComponentFields,
    component: z.literal('OrderTracking'),
    orderReference: z.string().min(1).max(120),
    fulfillmentStatus: z.string().min(1).max(64),
  })
  .strict();

export const futureSupportCardContractSchema = z
  .object({
    ...baseResolvedComponentFields,
    component: z.literal('SupportCard'),
    caseReference: z.string().min(1).max(120).nullable(),
    escalationAvailable: z.boolean(),
  })
  .strict();

export const FUTURE_A2UI_COMPONENT_CONTRACTS = Object.freeze({
  EngravingConfigurator: { availableIn: 'FL08', schema: futureEngravingConfiguratorContractSchema },
  BundleBuilder: { availableIn: 'FL08', schema: futureBundleBuilderContractSchema },
  CartSummary: { availableIn: 'FL08', schema: futureCartSummaryContractSchema },
  OrderTracking: { availableIn: 'FL09', schema: futureOrderTrackingContractSchema },
  SupportCard: { availableIn: 'FL10', schema: futureSupportCardContractSchema },
});

// ============================================================================
// Official A2UI 1.0 Agent-to-Renderer & Renderer-to-Agent Wire Envelopes
// ============================================================================

export const a2uiRawComponentWireSchema = z
  .object({
    id: a2uiComponentIdSchema,
    component: z.string().min(1).max(80),
  })
  .passthrough();
export type A2UiRawComponentWire = z.infer<typeof a2uiRawComponentWireSchema>;

export const a2uiCreateSurfaceMessageSchema = z
  .object({
    version: z.literal(A2UI_PROTOCOL_VERSION),
    createSurface: z
      .object({
        surfaceId: a2uiSurfaceIdSchema,
        catalogId: z.string().min(1).max(256),
        sendDataModel: z.boolean().default(false),
        components: z.array(a2uiRawComponentWireSchema).max(A2UI_LIMITS.maxComponents).optional(),
        dataModel: z.record(z.string(), z.unknown()).optional(),
        metadata: a2uiSurfaceMetadataSchema,
      })
      .strict(),
  })
  .strict();
export type A2UiCreateSurfaceMessage = z.infer<typeof a2uiCreateSurfaceMessageSchema>;

export const a2uiUpdateComponentsMessageSchema = z
  .object({
    version: z.literal(A2UI_PROTOCOL_VERSION),
    updateComponents: z
      .object({
        surfaceId: a2uiSurfaceIdSchema,
        components: z.array(a2uiRawComponentWireSchema).min(1).max(A2UI_LIMITS.maxComponents),
      })
      .strict(),
  })
  .strict();
export type A2UiUpdateComponentsMessage = z.infer<typeof a2uiUpdateComponentsMessageSchema>;

export const a2uiUpdateDataModelMessageSchema = z
  .object({
    version: z.literal(A2UI_PROTOCOL_VERSION),
    updateDataModel: z
      .object({
        surfaceId: a2uiSurfaceIdSchema,
        path: z
          .string()
          .max(256)
          .refine((p) => p === '/' || /^(\/[A-Za-z0-9_~-]+){1,8}$/.test(p), {
            message: 'Invalid RFC 6901 JSON Pointer path',
          })
          .default('/'),
        value: z.unknown(),
      })
      .strict(),
  })
  .strict();
export type A2UiUpdateDataModelMessage = z.infer<typeof a2uiUpdateDataModelMessageSchema>;

export const a2uiDeleteSurfaceMessageSchema = z
  .object({
    version: z.literal(A2UI_PROTOCOL_VERSION),
    deleteSurface: z
      .object({
        surfaceId: a2uiSurfaceIdSchema,
      })
      .strict(),
  })
  .strict();
export type A2UiDeleteSurfaceMessage = z.infer<typeof a2uiDeleteSurfaceMessageSchema>;

export const a2uiAgentToRendererMessageSchema = z.union([
  a2uiCreateSurfaceMessageSchema,
  a2uiUpdateDataModelMessageSchema,
  a2uiUpdateComponentsMessageSchema,
  a2uiDeleteSurfaceMessageSchema,
]);
export type A2UiAgentToRendererMessage = z.infer<typeof a2uiAgentToRendererMessageSchema>;

export const a2uiRendererErrorMessageSchema = z
  .object({
    version: z.literal(A2UI_PROTOCOL_VERSION),
    error: z
      .object({
        code: z.enum(['VALIDATION_FAILED', 'UNALLOWED_PARENT', 'UNALLOWED_CHILD']),
        surfaceId: z.string().min(1).max(200),
        path: z.string().min(1).max(256),
        message: z.string().min(1).max(400),
      })
      .strict(),
  })
  .strict();
export type A2UiRendererErrorMessage = z.infer<typeof a2uiRendererErrorMessageSchema>;

/**
 * Published VAARG A2UI 1.0 Catalog Definition conforming to
 * `https://a2ui.org/specification/v1_0/catalog_definition.json`.
 */
export const VAARG_A2UI_CATALOG_DEFINITION = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: VAARG_A2UI_CATALOG_ID,
  title: 'VAARG V1 Storefront A2UI 1.0 Component Catalog',
  description:
    'Deterministic, XSS-safe, catalog-grounded VAARG storefront A2UI 1.0 catalog (active FL07 components only; arbitrary renderer functions disabled).',
  protocolVersion: A2UI_PROTOCOL_VERSION,
  catalogId: VAARG_A2UI_CATALOG_ID,
  catalogVersion: VAARG_A2UI_CATALOG_VERSION,
  components: Object.fromEntries(
    ACTIVE_VAARG_A2UI_COMPONENTS.map((name) => [
      name,
      {
        type: 'object',
        required: ['id', 'component'],
        properties: {
          id: { type: 'string' },
          component: { const: name },
        },
      },
    ]),
  ),
  functions: {},
  $defs: {
    anyComponent: {
      oneOf: ACTIVE_VAARG_A2UI_COMPONENTS.map((name) => ({
        $ref: `#/components/${name}`,
      })),
    },
    anyFunction: {
      not: {},
    },
  },
});
