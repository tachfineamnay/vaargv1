import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  DEFAULT_CANDIDATE_POOL,
  DEFAULT_RRF_K,
  recommendationRequestSchema,
  reciprocalRankFusion,
  searchRequestSchema,
  type ParsedRecommendationRequest,
  type RecommendationItem,
  type RecommendationPort,
  type RecommendationReasonCode,
  type RecommendationRequest,
  type RecommendationResult,
  type SearchPort,
} from '@vaarg/shared';

import { scopedCatalogTransaction } from './scope.js';

/**
 * FL05 TASK 09 — deterministic recommendation service over SearchPort and
 * catalog relationships. No LLM, no fabricated products, no unsupported
 * compatibility claims, no inferred discounts or stock guarantees, no
 * cross-store output, no optional personal signals unless the caller
 * passed them (consent is enforced at the application boundary before the
 * request is built). Bounded ranking with configurable signal weights.
 *
 * Strategies (deterministic selection):
 *  1. criteria      — explicit query/filter criteria drive hybrid search;
 *  2. related       — anchor product ⇒ collection/type relationships;
 *  3. contextual    — consent-gated signals seed a contextual search;
 *  4. market_default— verified, available market products by recency.
 * Every strategy applies the same hard constraints and returns verified
 * summaries with reason codes and provenance.
 */

export interface RecommendationServiceDependencies {
  pool: Pool;
  search: SearchPort;
  /** Configurable signal weights (kind → [0,1]); defaults when omitted. */
  signalWeights?: Partial<Record<string, number>>;
  rrfK?: number;
  candidatePool?: number;
}

const DEFAULT_WEIGHTS: Record<string, number> = {
  category_selected: 0.6,
  collection_viewed: 0.5,
  product_viewed: 0.7,
  search_submitted: 0.8,
  filter_changed: 0.4,
  comparison_changed: 0.9,
};

interface SummaryRow {
  product_gid: string;
  handle: string;
  title: string;
  product_type: string;
  vendor: string;
  tags: string[];
  available_for_sale: boolean;
  provider_updated_at: Date;
  generation: string;
  observed_at: Date;
  price_min: string | null;
  price_max: string | null;
  currency: string | null;
  image_url: string | null;
  image_alt: string | null;
}

const SUMMARY_SELECT = `p.product_gid,p.handle,p.title,p.product_type,p.vendor,p.tags,p.available_for_sale,p.provider_updated_at,p.generation,p.observed_at,
  vp.price_min,vp.price_max,vp.currency,mi.url AS image_url,mi.alt AS image_alt`;

const SUMMARY_JOINS = `LEFT JOIN LATERAL (SELECT min(v.price_amount) AS price_min, max(v.price_amount) AS price_max, (array_agg(DISTINCT v.currency))[1] AS currency
    FROM catalog_variants v WHERE v.store_id=p.store_id AND v.country=p.country AND v.language=p.language AND v.product_gid=p.product_gid AND v.visible=true) vp ON true
  LEFT JOIN LATERAL (SELECT m.url, m.alt FROM catalog_product_media m WHERE m.store_id=p.store_id AND m.country=p.country AND m.language=p.language AND p.product_gid=m.product_gid AND m.media_type='IMAGE' ORDER BY m.ordinal, m.media_id LIMIT 1) mi ON true`;

function formatAmount(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error('INVALID_AMOUNT');
  const trimmed = numeric.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  const [whole = '0', decimals = ''] = trimmed.split('.');
  return `${whole}.${(decimals + '00').slice(0, Math.max(2, decimals.length))}`;
}

function summaryDto(row: SummaryRow) {
  return {
    id: row.product_gid,
    handle: row.handle,
    title: row.title,
    productType: row.product_type,
    vendor: row.vendor,
    tags: row.tags,
    availableForSale: row.available_for_sale,
    priceMin:
      row.price_min && row.currency
        ? { amount: formatAmount(row.price_min), currencyCode: row.currency }
        : null,
    priceMax:
      row.price_max && row.currency
        ? { amount: formatAmount(row.price_max), currencyCode: row.currency }
        : null,
    image: row.image_url ? { url: row.image_url, altText: row.image_alt } : null,
    updatedAt: row.provider_updated_at.toISOString(),
    provenance: {
      source: 'shopify' as const,
      shopifyId: row.product_gid,
      generation: row.generation,
      observedAt: row.observed_at.toISOString(),
    },
  };
}

function hasQuery(request: ParsedRecommendationRequest): boolean {
  return Boolean(request.criteria.query && request.criteria.query.trim().length > 0);
}

/** Merge explicit criteria into search constraints (hard filters). */
function constraintsOf(request: ParsedRecommendationRequest) {
  const constraints = { ...request.constraints };
  if (request.criteria.productType && !constraints.productType) {
    constraints.productType = request.criteria.productType;
  }
  if (request.criteria.vendor && !constraints.vendor) {
    constraints.vendor = request.criteria.vendor;
  }
  if (request.criteria.collection && !constraints.collection) {
    constraints.collection = request.criteria.collection;
  }
  const priceMin = request.criteria.priceMin;
  const priceMax = request.criteria.priceMax;
  const currency = request.criteria.currency ?? constraints.currency;
  if ((priceMin || priceMax) && currency) {
    constraints.currency = currency;
    if (priceMin) constraints.priceMin = priceMin;
    if (priceMax) constraints.priceMax = priceMax;
  }
  return constraints;
}

export function createRecommendationService(
  dependencies: RecommendationServiceDependencies,
): RecommendationPort {
  const weights = { ...DEFAULT_WEIGHTS, ...dependencies.signalWeights };

  return {
    async recommend(
      rawRequest: RecommendationRequest,
      scope: { storeId: string; country: string; language: string },
      options = {},
    ): Promise<RecommendationResult> {
      const request = parseRequest(rawRequest);
      const generatedAt = new Date().toISOString();
      const personalizationGranted = options.personalizationGranted ?? false;
      // Consent defense-in-depth: without personalization consent the
      // signals array must be empty regardless of what the caller built.
      const signals = personalizationGranted ? request.signals : [];
      const consentLimited = !personalizationGranted;

      const constraints = constraintsOf(request);
      const signalWeights: Record<string, number> = {};
      for (const signal of signals) {
        signalWeights[signal.kind] = Math.max(signalWeights[signal.kind] ?? 0, weights[signal.kind] ?? 0.5);
      }

      // --- Strategy selection (deterministic) -----------------------------
      let strategy: RecommendationResult['provenance']['strategy'];
      if (hasQuery(request)) strategy = 'criteria';
      else if (request.seedProductRef) strategy = 'related';
      else if (signals.length > 0) strategy = 'contextual';
      else strategy = 'market_default';

      let rankedRefs: Array<{ productRef: string; score: number }> = [];
      const reasonByRef = new Map<string, Set<RecommendationReasonCode>>();

      const bumpReason = (ref: string, code: RecommendationReasonCode) => {
        const set = reasonByRef.get(ref) ?? new Set<RecommendationReasonCode>();
        set.add(code);
        reasonByRef.set(ref, set);
      };

      if (strategy === 'criteria' || strategy === 'contextual') {
        const searchResult = await dependencies.search[
          strategy === 'criteria' ? 'hybridSearch' : 'contextualSearch'
        ](
          searchRequestSchema.parse({
            scope,
            mode: strategy === 'criteria' ? 'hybrid' : 'contextual',
            ...(request.criteria.query ? { q: request.criteria.query } : {}),
            limit: Math.min(request.limit * 3, 50),
            constraints,
            context: {
              categories: signals.filter((s) => s.kind === 'category_selected').map((s) => s.subject),
              collections: signals.filter((s) => s.kind === 'collection_viewed').map((s) => s.subject),
              products: signals
                .filter((s) => s.kind === 'product_viewed' || s.kind === 'comparison_changed')
                .flatMap((s) => s.subject.split(','))
                .filter((subject) => subject.startsWith('gid://shopify/Product/'))
                .slice(0, 5),
            },
          }),
          options.signal,
        );
        rankedRefs = searchResult.items.map((item, index) => ({
          productRef: item.productRef,
          score: item.score > 0 ? item.score : 1 / (DEFAULT_RRF_K + index + 1),
        }));
        for (const item of searchResult.items) {
          if (request.criteria.query) bumpReason(item.productRef, 'explicit_query');
          if (
            request.constraints.available ||
            request.constraints.priceMin ||
            request.constraints.priceMax ||
            request.constraints.collection ||
            request.constraints.productType ||
            request.constraints.vendor
          ) {
            bumpReason(item.productRef, 'explicit_filter');
          }
          if (item.provenance.ranks.vector) bumpReason(item.productRef, 'available_in_market');
        }
        for (const signal of signals) {
          const code: RecommendationReasonCode =
            signal.kind === 'category_selected'
              ? 'category_signal'
              : signal.kind === 'collection_viewed'
                ? 'collection_signal'
                : 'product_signal';
          for (const ref of rankedRefs.map((entry) => entry.productRef)) bumpReason(ref, code);
        }
        if (strategy === 'contextual') {
          for (const ref of rankedRefs.map((entry) => entry.productRef)) {
            bumpReason(ref, 'available_in_market');
          }
        }
      } else if (strategy === 'related') {
        const seed = request.seedProductRef as string;
        const related = await relatedForSeed(dependencies.pool, scope, seed, request.limit * 3);
        rankedRefs = related.map((ref, index) => ({
          productRef: ref.productRef,
          score: 1 / (DEFAULT_RRF_K + index + 1),
        }));
        for (const entry of related) {
          bumpReason(entry.productRef, entry.via === 'collection' ? 'shared_collection' : 'shared_product_type');
          bumpReason(entry.productRef, 'available_in_market');
        }
      } else {
        // market_default: verified + available market products, newest first.
        const rows = await marketDefault(dependencies.pool, scope, request.limit * 3, constraints);
        rankedRefs = rows.map((ref, index) => ({
          productRef: ref,
          score: 1 / (DEFAULT_RRF_K + index + 1),
        }));
        for (const ref of rows) {
          bumpReason(ref, 'available_in_market');
          if (constraints.priceMin || constraints.priceMax) bumpReason(ref, 'price_range_match');
        }
      }

      // --- Bounded deterministic ranking (RRF when multiple lists) --------
      const fused = reciprocalRankFusion(
        [rankedRefs.map((entry) => entry.productRef)],
        { k: dependencies.rrfK ?? DEFAULT_RRF_K, limit: request.limit * 2 },
      );
      const scoreByRef = new Map(rankedRefs.map((entry) => [entry.productRef, entry.score]));
      const topRefs = fused.slice(0, request.limit);

      // --- Resolve verified summaries (store+market scoped) ---------------
      const summaries = await resolveSummaries(
        dependencies.pool,
        scope,
        topRefs.map((entry) => entry.productRef),
      );

      const items: RecommendationItem[] = [];
      for (const entry of topRefs) {
        const summary = summaries.get(entry.productRef);
        if (!summary) continue; // never fabricate: drop unresolved refs
        const reasonCodes = [...(reasonByRef.get(entry.productRef) ?? new Set<RecommendationReasonCode>() as Set<RecommendationReasonCode>)];
        if (reasonCodes.length === 0) reasonCodes.push('available_in_market');
        items.push({
          productRef: entry.productRef,
          summary: summary as RecommendationItem['summary'],
          reasonCodes,
          score: scoreByRef.get(entry.productRef) ?? entry.score,
        });
      }

      const freshness = await readCompletion(dependencies.pool, scope);

      return {
        items,
        provenance: {
          channels: strategy === 'market_default' ? ['context'] : ['fts', 'trigram', 'vector', 'context'],
          rrfK: dependencies.rrfK ?? DEFAULT_RRF_K,
          candidatePool: dependencies.candidatePool ?? DEFAULT_CANDIDATE_POOL,
          embedding: null,
          strategy,
          signalWeights,
        },
        completedAt: freshness,
        generatedAt,
        sourceContextVersion: request.contextVersion,
        consentLimited,
      };
    },
  };
}

function parseRequest(raw: RecommendationRequest): ParsedRecommendationRequest {
  return recommendationRequestSchema.parse(raw);
}

async function relatedForSeed(
  pool: Pool,
  scope: { storeId: string; country: string; language: string },
  seed: string,
  limit: number,
): Promise<Array<{ productRef: string; via: 'collection' | 'product_type' }>> {
  const bounded = Math.min(Math.max(limit, 1), 36);
  const collectionRows = await pool.query<{ product_gid: string; via: string }>(
    `WITH related AS (
       SELECT m2.product_gid, min(m2.collection_gid) AS via, count(DISTINCT m2.collection_gid) AS shared
       FROM catalog_collection_members m1
       JOIN catalog_collection_members m2
         ON m2.store_id=m1.store_id AND m2.country=m1.country AND m2.language=m1.language
        AND m2.collection_gid=m1.collection_gid AND m2.product_gid<>m1.product_gid
       JOIN catalog_collections c
         ON c.store_id=m2.store_id AND c.country=m2.country AND c.language=m2.language
        AND c.collection_gid=m2.collection_gid AND c.visible=true
       WHERE m1.store_id=$1 AND m1.country=$2 AND m1.language=$3 AND m1.product_gid=$4
       GROUP BY m2.product_gid ORDER BY shared DESC, m2.product_gid LIMIT $5
     )
     SELECT related.product_gid, related.via FROM related
     JOIN catalog_products p
       ON p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.product_gid=related.product_gid AND p.visible=true`,
    [scope.storeId, scope.country, scope.language, seed, bounded],
  );
  if (collectionRows.rows.length > 0) {
    return collectionRows.rows.map((row) => ({ productRef: row.product_gid, via: 'collection' as const }));
  }
  const typeRows = await pool.query<{ product_gid: string }>(
    `SELECT p.product_gid FROM catalog_products p0
     JOIN catalog_products p
       ON p.store_id=p0.store_id AND p.country=p0.country AND p.language=p0.language
      AND p.product_type=p0.product_type AND p.product_gid<>p0.product_gid AND p.visible=true
     WHERE p0.store_id=$1 AND p0.country=$2 AND p0.language=$3 AND p0.product_gid=$4
       AND p0.visible=true AND p0.product_type<>''
     ORDER BY p.handle, p.product_gid LIMIT $5`,
    [scope.storeId, scope.country, scope.language, seed, bounded],
  );
  return typeRows.rows.map((row) => ({ productRef: row.product_gid, via: 'product_type' as const }));
}

async function marketDefault(
  pool: Pool,
  scope: { storeId: string; country: string; language: string },
  limit: number,
  constraints: import('@vaarg/shared').SearchConstraints,
): Promise<string[]> {
  const params: unknown[] = [scope.storeId, scope.country, scope.language];
  const clauses: string[] = [];
  if (constraints.available !== undefined) {
    params.push(constraints.available);
    clauses.push(`p.available_for_sale = $${params.length}`);
  } else {
    clauses.push('p.available_for_sale = true');
  }
  if (constraints.currency) {
    params.push(constraints.currency);
    const currency = `$${params.length}`;
    clauses.push(
      `EXISTS (SELECT 1 FROM catalog_variants pv WHERE pv.store_id=p.store_id AND pv.country=p.country AND pv.language=p.language AND pv.product_gid=p.product_gid AND pv.visible=true AND pv.currency=${currency})`,
    );
  }
  params.push(Math.min(Math.max(limit, 1), 72));
  const rows = await pool.query<{ product_gid: string }>(
    `SELECT p.product_gid FROM catalog_products p
     WHERE p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.visible=true AND ${clauses.join(' AND ')}
     ORDER BY p.provider_updated_at DESC, p.product_gid ASC
     LIMIT $${params.length}`,
    params,
  );
  return rows.rows.map((row) => row.product_gid);
}

async function resolveSummaries(
  pool: Pool,
  scope: { storeId: string; country: string; language: string },
  refs: string[],
): Promise<Map<string, ReturnType<typeof summaryDto>>> {
  const map = new Map<string, ReturnType<typeof summaryDto>>();
  if (refs.length === 0) return map;
  const rows = await pool.query<SummaryRow>(
    `SELECT ${SUMMARY_SELECT} FROM catalog_products p ${SUMMARY_JOINS}
     WHERE p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.visible=true AND p.product_gid = ANY($4::text[])`,
    [scope.storeId, scope.country, scope.language, refs],
  );
  for (const row of rows.rows) map.set(row.product_gid, summaryDto(row));
  return map;
}

async function readCompletion(
  pool: Pool,
  scope: { storeId: string; country: string; language: string },
): Promise<string | null> {
  const result = await pool.query<{ completed_at: Date | null }>(
    'SELECT completed_at FROM catalog_imports WHERE store_id=$1 AND country=$2 AND language=$3',
    [scope.storeId, scope.country, scope.language],
  );
  return result.rows[0]?.completed_at?.toISOString() ?? null;
}

/**
 * Durability for published runs (migration 0012): one `recommendation_runs`
 * row plus position-ordered `recommendation_items`. The composite FK to
 * catalog_products guarantees only verified store+market products can be
 * stored — nothing fabricated. Bounded retention on the run row.
 */
export async function recordRecommendationRun(
  pool: Pool,
  scope: { storeId: string; country: string; language: string },
  session: { sessionId: string },
  result: RecommendationResult,
  experienceRevision: number,
): Promise<string> {
  const runId = randomUUID();
  await scopedCatalogTransaction(pool, scope, async (client) => {
    await client.query(
      `INSERT INTO recommendation_runs
         (run_id, store_id, session_id, country, language, context_version,
          experience_revision, status, strategy, channels, consent_limited, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'published',$8,$9,$10, now() + interval '7 days')`,
      [
        runId,
        scope.storeId,
        session.sessionId,
        scope.country,
        scope.language,
        String(result.sourceContextVersion),
        String(experienceRevision),
        result.provenance.strategy,
        result.provenance.channels,
        result.consentLimited,
      ],
    );
    let position = 0;
    for (const item of result.items) {
      await client.query(
        `INSERT INTO recommendation_items
           (store_id, run_id, country, language, product_gid, position, reason_codes, score, provenance)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          scope.storeId,
          runId,
          scope.country,
          scope.language,
          item.productRef,
          position,
          item.reasonCodes,
          item.score,
          JSON.stringify({ strategy: result.provenance.strategy, channels: result.provenance.channels }),
        ],
      );
      position += 1;
    }
  });
  return runId;
}
