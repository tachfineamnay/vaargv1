import { z } from 'zod';
import { catalogV1CollectionSchema, catalogV1ProductSummarySchema } from './catalog.js';

/**
 * FL05 adaptive composition contracts (PRD EXP-02 step 5, EXP-04 foundation).
 * This is the deterministic domain composition model the future official
 * A2UI adapter will consume — NOT a competing A2UI protocol. Only registered
 * component names, validated props and resolved catalog references appear
 * here; never arbitrary HTML, JavaScript, component imports or external URLs.
 */

/** Registered components allowed in adaptive compositions. */
export const ADAPTIVE_COMPONENTS = [
  'CategoryTile',
  'CollectionGrid',
  'ProductCard',
  'ProductGrid',
  'Recommendations',
  'ProductComparator',
  'SuggestionChips',
] as const;
export const adaptiveComponentSchema = z.enum(ADAPTIVE_COMPONENTS);
export type AdaptiveComponentName = z.infer<typeof adaptiveComponentSchema>;

export const adaptationReasonSchema = z.enum([
  'initial',
  'explicit_criteria',
  'category_signal',
  'collection_signal',
  'product_signal',
  'comparison_available',
  'exploration_reset',
  'degraded_rules',
]);
export type AdaptationReason = z.infer<typeof adaptationReasonSchema>;

export const compositionModeSchema = z.enum(['ssr', 'adaptive', 'degraded_rules']);
export type CompositionMode = z.infer<typeof compositionModeSchema>;

/** Controlled internal navigation only (same-origin path, no external URLs). */
export const internalHrefSchema = z
  .string()
  .min(1)
  .max(300)
  .regex(/^\/(?!\/)[a-z0-9\-/._~%?=&:]*$/i, 'internal path required');
export type InternalHref = z.infer<typeof internalHrefSchema>;

const suggestionChipSchema = z.strictObject({
  label: z.string().min(1).max(80),
  href: internalHrefSchema,
});

/**
 * Section union with stable IDs and validated props. Product references are
 * resolved server-side to verified summaries before publishing — the client
 * never invents catalog data.
 */
export const adaptiveSectionSchema = z.discriminatedUnion('component', [
  z.strictObject({
    id: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
    component: z.literal('CategoryTile'),
    collections: z.array(catalogV1CollectionSchema).max(12),
  }),
  z.strictObject({
    id: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
    component: z.literal('CollectionGrid'),
    title: z.string().min(1).max(120),
    collections: z.array(catalogV1CollectionSchema).max(12),
  }),
  z.strictObject({
    id: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
    component: z.literal('ProductGrid'),
    title: z.string().min(1).max(120),
    products: z.array(catalogV1ProductSummarySchema).max(24),
    footerHref: internalHrefSchema.optional(),
    footerLabel: z.string().max(80).optional(),
  }),
  z.strictObject({
    id: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
    component: z.literal('ProductCard'),
    product: catalogV1ProductSummarySchema,
  }),
  z.strictObject({
    id: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
    component: z.literal('Recommendations'),
    title: z.string().min(1).max(120),
    products: z.array(catalogV1ProductSummarySchema).max(12),
    reasonCodes: z.array(z.string().min(1).max(64)).max(24).optional(),
  }),
  z.strictObject({
    id: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
    component: z.literal('ProductComparator'),
    products: z.array(catalogV1ProductSummarySchema).min(2).max(4),
  }),
  z.strictObject({
    id: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
    component: z.literal('SuggestionChips'),
    chips: z.array(suggestionChipSchema).min(1).max(8),
  }),
]);
export type AdaptiveSection = z.infer<typeof adaptiveSectionSchema>;

/** Bounded composition envelope with revision safety metadata (EXP-03). */
export const adaptiveCompositionSchema = z.strictObject({
  sessionId: z.uuid(),
  contextVersion: z.number().int().min(0),
  experienceRevision: z.number().int().min(0),
  mode: compositionModeSchema,
  adaptationReason: adaptationReasonSchema,
  freshness: z.iso.datetime(),
  sections: z.array(adaptiveSectionSchema).min(1).max(12),
});
export type AdaptiveComposition = z.infer<typeof adaptiveCompositionSchema>;

/** Hard bounds enforced server-side before publishing. */
export const COMPOSITION_LIMITS = Object.freeze({
  maxSections: 12,
  maxDepth: 3,
  maxProductsPerSection: 24,
  maxBytes: 256 * 1024,
});

/** Validate a parsed composition against size bounds (defense in depth). */
export function withinCompositionLimits(composition: AdaptiveComposition): boolean {
  if (composition.sections.length > COMPOSITION_LIMITS.maxSections) return false;
  let bytes: number;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(composition)).length;
  } catch {
    return false;
  }
  return bytes <= COMPOSITION_LIMITS.maxBytes;
}
