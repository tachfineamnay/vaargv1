import { z } from 'zod';
import { catalogV1ProductSummarySchema } from './catalog.js';
import { searchConstraintsSchema, searchProvenanceSchema } from './search.js';

/**
 * FL05 RecommendationPort contracts — deterministic, no LLM. Inputs are
 * explicit search criteria, consent-gated contextual signals, verified
 * attributes and market availability. Outputs are ranked verified product
 * references with reason codes, provenance, freshness and the source
 * contextVersion. Never fabricates products, compatibility, discounts or
 * stock; never crosses stores; never uses optional personal signals without
 * personalization consent.
 */

export const recommendationReasonCodeSchema = z.enum([
  'explicit_query',
  'explicit_filter',
  'category_signal',
  'collection_signal',
  'product_signal',
  'shared_collection',
  'shared_product_type',
  'price_range_match',
  'available_in_market',
]);
export type RecommendationReasonCode = z.infer<typeof recommendationReasonCodeSchema>;

export const recommendationRequestSchema = z.strictObject({
  limit: z.number().int().min(1).max(24).default(8),
  constraints: searchConstraintsSchema.default({}),
  /** Explicit exploration criteria from the experience context. */
  criteria: z
    .strictObject({
      query: z.string().max(200).nullable().default(null),
      productType: z.string().max(200).nullable().default(null),
      vendor: z.string().max(200).nullable().default(null),
      collection: z.string().max(300).nullable().default(null),
      priceMin: z.string().max(24).nullable().default(null),
      priceMax: z.string().max(24).nullable().default(null),
      currency: z.string().regex(/^[A-Z]{3}$/).nullable().default(null),
    })
    .default({
      query: null,
      productType: null,
      vendor: null,
      collection: null,
      priceMin: null,
      priceMax: null,
      currency: null,
    }),
  /** Anchor product for related-product recommendations (stable gid). */
  seedProductRef: z.string().startsWith('gid://shopify/Product/').nullable().default(null),
  /**
   * Consent-gated inferred signals. Callers MUST pass an empty array without
   * personalization consent; the engine does not read context signals itself.
   */
  signals: z
    .array(
      z.strictObject({
        kind: z.enum([
          'category_selected',
          'collection_viewed',
          'product_viewed',
          'search_submitted',
          'filter_changed',
          'comparison_changed',
        ]),
        subject: z.string().min(1).max(300),
        weight: z.number().min(0).max(1),
      }),
    )
    .max(50)
    .default([]),
  /** Source context version — echoed in the result for stale rejection. */
  contextVersion: z.number().int().min(0),
});
export type RecommendationRequest = z.input<typeof recommendationRequestSchema>;
export type ParsedRecommendationRequest = z.output<typeof recommendationRequestSchema>;

export const recommendationItemSchema = z.strictObject({
  productRef: z.string().startsWith('gid://shopify/Product/'),
  summary: catalogV1ProductSummarySchema,
  reasonCodes: z.array(recommendationReasonCodeSchema).min(1),
  score: z.number(),
});
export type RecommendationItem = z.infer<typeof recommendationItemSchema>;

export const recommendationResultSchema = z.strictObject({
  items: z.array(recommendationItemSchema),
  provenance: searchProvenanceSchema.extend({
    strategy: z.enum(['criteria', 'contextual', 'related', 'market_default']),
    signalWeights: z.record(z.string().min(1).max(64), z.number().min(0).max(1)),
  }),
  /** Catalog freshness for the market. */
  completedAt: z.iso.datetime().nullable(),
  generatedAt: z.iso.datetime(),
  /** Source context version used to build this result (stale rejection). */
  sourceContextVersion: z.number().int().min(0),
  /** True when the run was only allowed to use explicit criteria. */
  consentLimited: z.boolean(),
});
export type RecommendationResult = z.infer<typeof recommendationResultSchema>;

/**
 * RecommendationPort — deterministic recommendation engine interface.
 * Implementations must stay within the store/market scope of the supplied
 * context and re-validate contextVersion before publishing.
 */
export interface RecommendationPort {
  recommend(
    request: RecommendationRequest,
    scope: { storeId: string; country: string; language: string },
    options?: { personalizationGranted?: boolean; signal?: AbortSignal },
  ): Promise<RecommendationResult>;
}
