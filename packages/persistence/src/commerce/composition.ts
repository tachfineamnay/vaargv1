import type { Pool } from 'pg';
import {
  adaptiveCompositionSchema,
  adaptationReasonSchema,
  withinCompositionLimits,
  type AdaptiveComposition,
  type AdaptiveSection,
  type AdaptationReason,
  type CompositionMode,
  type ExperienceContext,
  type RecommendationPort,
} from '@vaarg/shared';
import { scopedCatalogTransaction } from './scope.js';

/**
 * FL05 TASK 10 — server-side deterministic adaptive composition service.
 * Generates a bounded, validated composition envelope from contextual
 * product selections, catalog collections, recommendations, related-product
 * sections, suggestion chips and comparison sections. Only registered
 * components appear (shared `ADAPTIVE_COMPONENTS`); every product/collection
 * reference is resolved server-side from the verified projection; hrefs are
 * controlled internal paths. No HTML, JavaScript, component imports or
 * external URLs are ever accepted or produced.
 *
 * Deterministic when AI services are unavailable: this service has no AI
 * dependency at all — rules only. The future official A2UI adapter will
 * consume these compositions; this is NOT a competing protocol.
 */

export interface CompositionServiceDependencies {
  pool: Pool;
  recommendations: RecommendationPort;
  /** Configurable section count bound (default 6, hard max 12). */
  maxSections?: number;
}

export interface ComposeInput {
  scope: { storeId: string; country: string; language: string };
  context: ExperienceContext;
  /** Personalization consent (gates signal-driven sections). */
  personalizationGranted: boolean;
  reason?: AdaptationReason;
  /** Optional comparison membership (verified refs, 2–4). */
  comparisonRefs?: string[];
  signal?: AbortSignal;
}

interface CollectionRow {
  collection_gid: string;
  handle: string;
  title: string;
  image_url: string | null;
  image_alt: string | null;
  provider_updated_at: Date;
  generation: string;
  observed_at: Date;
}

async function resolveCollections(
  pool: Pool,
  scope: ComposeInput['scope'],
  limit: number,
): Promise<AdaptiveSection & { component: 'CategoryTile' }> {
  const rows = await scopedCatalogTransaction(pool, scope, (client) =>
    client.query<CollectionRow>(
      `SELECT c.collection_gid, c.handle, c.title, c.image_url, c.image_alt,
              c.observed_at AS provider_updated_at, c.generation, c.observed_at
       FROM catalog_collections c
       WHERE c.store_id=$1 AND c.country=$2 AND c.language=$3 AND c.visible=true
       ORDER BY c.title, c.collection_gid LIMIT $4`,
      [scope.storeId, scope.country, scope.language, limit],
    ),
  );
  const collections = rows.rows.map((row) => ({
    id: row.collection_gid,
    handle: row.handle,
    title: row.title,
    description: '',
    image: row.image_url ? { url: row.image_url, altText: row.image_alt } : null,
    updatedAt: row.provider_updated_at.toISOString(),
    productCount: 0,
    provenance: {
      source: 'shopify' as const,
      shopifyId: row.collection_gid,
      generation: row.generation,
      observedAt: row.observed_at.toISOString(),
    },
  }));
  return { id: 'adaptive-categories', component: 'CategoryTile', collections };
}

/** Deterministic composition entry point. */
export async function composeExperience(
  dependencies: CompositionServiceDependencies,
  input: ComposeInput,
): Promise<AdaptiveComposition> {
  if (input.signal?.aborted) throw new Error('ABORTED');
  const maxSections = Math.min(Math.max(dependencies.maxSections ?? 6, 1), 12);
  const sections: AdaptiveSection[] = [];
  const { context, scope } = input;
  const reason: AdaptationReason = input.reason ?? deriveReason(context, input.personalizationGranted);
  const mode: CompositionMode =
    reason === 'degraded_rules' || !input.personalizationGranted ? 'degraded_rules' : 'adaptive';

  const criteria = context.exploration;
  const explicitCriteriaActive = Boolean(
    criteria.query || criteria.productType || criteria.vendor || criteria.collection || criteria.priceMin || criteria.priceMax,
  );

  // 1. Contextual product selection: recommendation engine (criteria or
  //    consent-gated contextual strategy; deterministic either way).
  if (sections.length < maxSections) {
    const recommendations = await dependencies.recommendations.recommend(
      {
        limit: 8,
        constraints: {},
        criteria: {
          query: criteria.query,
          productType: criteria.productType,
          vendor: criteria.vendor,
          collection: criteria.collection,
          priceMin: criteria.priceMin,
          priceMax: criteria.priceMax,
          currency: criteria.currency ?? null,
        },
        seedProductRef: context.recentlyViewed[0]?.productRef ?? null,
        signals: input.personalizationGranted
          ? context.intentSignals.slice(0, 12).map((signal) => ({
              kind: signal.kind,
              subject: signal.subject,
              weight: signal.weight,
            }))
          : [],
        contextVersion: context.contextVersion,
      },
      scope,
      {
        personalizationGranted: input.personalizationGranted,
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
    if (recommendations.items.length > 0) {
      sections.push({
        id: explicitCriteriaActive ? 'adaptive-criteria-grid' : 'adaptive-recommendations',
        component: 'Recommendations',
        title: explicitCriteriaActive ? 'Matched to your search' : 'Recommended for you',
        products: recommendations.items.map((item) => item.summary),
        reasonCodes: recommendations.items.flatMap((item) => item.reasonCodes),
      });
    }
  }

  // 2. Category/collection recommendations.
  if (sections.length < maxSections) {
    const tile = await resolveCollections(dependencies.pool, scope, 6);
    if (tile.collections.length > 0) sections.push(tile);
  }

  // 3. Comparison section (verified refs only, when the browser supplied
  //    2–4 members through the compare UI).
  if (
    sections.length < maxSections &&
    input.comparisonRefs &&
    input.comparisonRefs.length >= 2 &&
    input.comparisonRefs.length <= 4
  ) {
    const resolved = await scopedCatalogTransaction(dependencies.pool, scope, (client) =>
      client.query<{ product_gid: string; handle: string; title: string; product_type: string; vendor: string; tags: string[]; available_for_sale: boolean; provider_updated_at: Date; generation: string; observed_at: Date; price_min: string | null; price_max: string | null; currency: string | null; image_url: string | null; image_alt: string | null }>(
        `SELECT p.product_gid, p.handle, p.title, p.product_type, p.vendor, p.tags, p.available_for_sale,
                p.provider_updated_at, p.generation, p.observed_at,
                (SELECT min(v.price_amount)::text FROM catalog_variants v WHERE v.store_id=p.store_id AND v.country=p.country AND v.language=p.language AND v.product_gid=p.product_gid AND v.visible=true) AS price_min,
                (SELECT max(v.price_amount)::text FROM catalog_variants v WHERE v.store_id=p.store_id AND v.country=p.country AND v.language=p.language AND v.product_gid=p.product_gid AND v.visible=true) AS price_max,
                (SELECT min(v.currency) FROM catalog_variants v WHERE v.store_id=p.store_id AND v.country=p.country AND v.language=p.language AND v.product_gid=p.product_gid AND v.visible=true) AS currency,
                (SELECT m.url FROM catalog_product_media m WHERE m.store_id=p.store_id AND m.country=p.country AND m.language=p.language AND m.product_gid=p.product_gid AND m.media_type='IMAGE' ORDER BY m.ordinal, m.media_id LIMIT 1) AS image_url,
                (SELECT m.alt FROM catalog_product_media m WHERE m.store_id=p.store_id AND m.country=p.country AND m.language=p.language AND m.product_gid=p.product_gid AND m.media_type='IMAGE' ORDER BY m.ordinal, m.media_id LIMIT 1) AS image_alt
         FROM catalog_products p
         WHERE p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.visible=true
           AND p.product_gid = ANY($4::text[])`,
        [scope.storeId, scope.country, scope.language, input.comparisonRefs],
      ),
    );
    if (resolved.rows.length >= 2) {
      sections.push({
        id: 'adaptive-comparison',
        component: 'ProductComparator',
        products: resolved.rows.map((row) => ({
          id: row.product_gid,
          handle: row.handle,
          title: row.title,
          productType: row.product_type,
          vendor: row.vendor,
          tags: row.tags,
          availableForSale: row.available_for_sale,
          priceMin:
            row.price_min && row.currency
              ? { amount: row.price_min, currencyCode: row.currency }
              : null,
          priceMax:
            row.price_max && row.currency
              ? { amount: row.price_max, currencyCode: row.currency }
              : null,
          image: row.image_url ? { url: row.image_url, altText: row.image_alt } : null,
          updatedAt: row.provider_updated_at.toISOString(),
          provenance: {
            source: 'shopify' as const,
            shopifyId: row.product_gid,
            generation: row.generation,
            observedAt: row.observed_at.toISOString(),
          },
        })),
      });
    }
  }

  // 4. Suggestion chips: controlled internal navigation derived from
  //    deterministic rules (no AI, no external links).
  if (sections.length < maxSections) {
    const chips: Array<{ label: string; href: string }> = [];
    if (criteria.query) {
      chips.push({ label: `Search “${criteria.query.slice(0, 40)}”`, href: `/search?q=${encodeURIComponent(criteria.query)}` });
      chips.push({ label: 'Reset exploration', href: '/products' });
    }
    if (criteria.collection) {
      chips.push({ label: 'Browse all collections', href: '/collections' });
    }
    if (context.recentlyViewed.length > 0 && input.personalizationGranted) {
      chips.push({ label: 'Recently viewed', href: '/products?sort=updated-desc' });
    }
    chips.push({ label: 'All products', href: '/products' });
    if (chips.length > 0) {
      sections.push({
        id: 'adaptive-chips',
        component: 'SuggestionChips',
        chips: chips.slice(0, 8),
      });
    }
  }

  if (sections.length === 0) {
    // Honest empty composition is rejected by the schema (min 1) — fall back
    // to a deterministic market section so the envelope is always valid.
    sections.push({
      id: 'adaptive-empty',
      component: 'SuggestionChips',
      chips: [{ label: 'Browse the catalog', href: '/products' }],
    });
  }

  const composition = adaptiveCompositionSchema.parse({
    sessionId: context.session.sessionId,
    contextVersion: context.contextVersion,
    experienceRevision: context.experienceRevision,
    mode,
    adaptationReason: reason,
    freshness: new Date().toISOString(),
    sections: sections.slice(0, maxSections),
  });
  if (!withinCompositionLimits(composition)) throw new Error('COMPOSITION_TOO_LARGE');
  if (input.signal?.aborted) throw new Error('ABORTED');
  return composition;
}

function deriveReason(context: ExperienceContext, personalizationGranted: boolean): AdaptationReason {
  const parsed = adaptationReasonSchema.safeParse('degraded_rules');
  if (!parsed.success) return 'degraded_rules';
  if (context.exploration.query || context.exploration.productType || context.exploration.collection) {
    return 'explicit_criteria';
  }
  if (personalizationGranted && context.intentSignals.length > 0) {
    const top = context.intentSignals[0];
    if (top?.kind === 'category_selected') return 'category_signal';
    if (top?.kind === 'collection_viewed') return 'collection_signal';
    if (top?.kind === 'product_viewed') return 'product_signal';
  }
  if (context.recentlyViewed.length > 0) return 'product_signal';
  return personalizationGranted ? 'initial' : 'degraded_rules';
}
