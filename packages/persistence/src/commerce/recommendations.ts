import { AppError } from '@vaarg/shared';
import { lockActiveExperience } from '../experience/experience-context.js';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  DEFAULT_CANDIDATE_POOL,
  DEFAULT_RRF_K,
  recommendationRequestSchema,
  reciprocalRankFusion,
  searchRequestSchema,
  searchConstraintsSchema,
  type ParsedRecommendationRequest,
  type RecommendationItem,
  type RecommendationPort,
  type RecommendationReasonCode,
  type RecommendationRequest,
  type RecommendationResult,
  type SearchPort,
} from '@vaarg/shared';

import { scopedCatalogTransaction } from './scope.js';
import { catalogHardFilterSql } from './search-port.js';

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
  if (currency) constraints.currency = currency;
  if (priceMin) constraints.priceMin = priceMin;
  if (priceMax) constraints.priceMax = priceMax;
  return searchConstraintsSchema.parse(constraints);
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
      // FIX04: provenance reflects only channels/embedding that actually ran.
      let actualChannels: RecommendationResult['provenance']['channels'] =
        [];
      let actualEmbedding: RecommendationResult['provenance']['embedding'] = null;

      const bumpReason = (ref: string, code: RecommendationReasonCode) => {
        const set = reasonByRef.get(ref) ?? new Set<RecommendationReasonCode>();
        set.add(code);
        reasonByRef.set(ref, set);
      };
      const hasHardConstraints = Boolean(
        constraints.available !== undefined ||
          constraints.priceMin !== undefined ||
          constraints.priceMax !== undefined ||
          constraints.collection !== undefined ||
          constraints.productType !== undefined ||
          constraints.vendor !== undefined ||
          (constraints.attributes?.length ?? 0) > 0,
      );

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
        // Actual retrieval provenance from the search engine (never assumed).
        actualChannels = searchResult.provenance.channels;
        actualEmbedding = searchResult.provenance.embedding;
        for (const item of searchResult.items) {
          if (request.criteria.query) bumpReason(item.productRef, 'explicit_query');
          // Hard filters are enforced inside every search channel, so a
          // returned item verifiably satisfied any present constraint.
          if (hasHardConstraints) bumpReason(item.productRef, 'explicit_filter');
        }
        // Signal reasons are only emitted when verified against the resolved
        // summary below — never blanket-applied to every ranked ref.
      } else if (strategy === 'related') {
        const seed = request.seedProductRef as string;
        const related = await relatedForSeed(dependencies.pool, scope, seed, request.limit * 3, constraints);
        rankedRefs = related.map((ref, index) => ({
          productRef: ref.productRef,
          score: 1 / (DEFAULT_RRF_K + index + 1),
        }));
        for (const entry of related) {
          bumpReason(entry.productRef, entry.via === 'collection' ? 'shared_collection' : 'shared_product_type');
        }
      } else {
        // market_default: verified market products, newest first, with the
        // same hard constraints as every other strategy (FIX04).
        const rows = await marketDefault(dependencies.pool, scope, request.limit * 3, constraints);
        rankedRefs = rows.map((ref, index) => ({
          productRef: ref,
          score: 1 / (DEFAULT_RRF_K + index + 1),
        }));
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
        constraints,
      );

      const items: RecommendationItem[] = [];
      for (const entry of topRefs) {
        const summary = summaries.get(entry.productRef);
        if (!summary) continue; // never fabricate: drop unresolved refs
        // Defense-in-depth: drop any summary that verifiably violates a hard
        // constraint (SQL is primary; this never widens results).
        if (!satisfiesConstraints(summary, constraints)) continue;
        const reasonCodes = new Set<RecommendationReasonCode>(
          reasonByRef.get(entry.productRef) ?? [],
        );
        // Verified reasons only: availability and price range are checked
        // against the resolved summary, never assumed.
        if (summary.availableForSale) reasonCodes.add('available_in_market');
        if (priceMatches(summary, constraints)) reasonCodes.add('price_range_match');
        // Verified signal reasons: subject must match the product itself.
        for (const signal of signals) {
          if (signalMatchesSummary(signal, summary)) {
            reasonCodes.add(
              signal.kind === 'category_selected'
                ? 'category_signal'
                : signal.kind === 'collection_viewed'
                  ? 'collection_signal'
                  : 'product_signal',
            );
          }
        }
        if (reasonCodes.size === 0) continue; // no honest reason: drop
        items.push({
          productRef: entry.productRef,
          summary: summary as RecommendationItem['summary'],
          reasonCodes: [...reasonCodes],
          score: scoreByRef.get(entry.productRef) ?? entry.score,
        });
      }

      const freshness = await readCompletion(dependencies.pool, scope);

      return {
        items,
        provenance: {
          channels: actualChannels,
          rrfK: dependencies.rrfK ?? DEFAULT_RRF_K,
          candidatePool: dependencies.candidatePool ?? DEFAULT_CANDIDATE_POOL,
          embedding: actualEmbedding,
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

type SummaryDto = ReturnType<typeof summaryDto>;
type HardConstraints = import('@vaarg/shared').SearchConstraints;

/** True when the summary price range overlaps the budget (variant-level
 *  EXISTS is enforced in SQL; this is the necessary-condition check). */
function priceMatches(summary: SummaryDto, constraints: HardConstraints): boolean {
  if (constraints.priceMin === undefined && constraints.priceMax === undefined) return false;
  if (!summary.priceMin || !summary.priceMax) return false;
  if (constraints.currency && summary.priceMin.currencyCode !== constraints.currency) return false;
  const min = Number(summary.priceMin.amount);
  const max = Number(summary.priceMax.amount);
  if (constraints.priceMin !== undefined && max < Number(constraints.priceMin)) return false;
  if (constraints.priceMax !== undefined && min > Number(constraints.priceMax)) return false;
  return true;
}

/** Defense-in-depth constraint check over the resolved summary. Collection
 *  and attribute membership are SQL-enforced (absent from the summary) and
 *  are not re-checked here — this check only ever drops, never widens. */
function satisfiesConstraints(summary: SummaryDto, constraints: HardConstraints): boolean {
  if (constraints.available !== undefined && summary.availableForSale !== constraints.available) return false;
  if (constraints.productType !== undefined && summary.productType !== constraints.productType) return false;
  if (constraints.vendor !== undefined && summary.vendor !== constraints.vendor) return false;
  if (constraints.currency !== undefined && summary.priceMin && summary.priceMin.currencyCode !== constraints.currency) return false;
  if ((constraints.priceMin !== undefined || constraints.priceMax !== undefined) && !priceMatches(summary, constraints)) return false;
  return true;
}

/** Verified signal match: the signal subject must equal a product field. */
function signalMatchesSummary(
  signal: { kind: string; subject: string },
  summary: SummaryDto,
): boolean {
  const subject = signal.subject.trim();
  if (!subject) return false;
  if (signal.kind === 'product_viewed' || signal.kind === 'comparison_changed') {
    return subject.split(',').map((s) => s.trim()).includes(summary.id);
  }
  if (signal.kind === 'category_selected') {
    return summary.productType === subject || summary.tags.includes(subject);
  }
  if (signal.kind === 'collection_viewed') {
    // Collection membership is not in the summary; only a handle match is
    // verifiable here, so this stays conservative (no fabricated reason).
    return summary.handle === subject;
  }
  if (signal.kind === 'search_submitted') {
    const q = subject.toLowerCase();
    return summary.title.toLowerCase().includes(q) || summary.tags.some((tag) => tag.toLowerCase().includes(q));
  }
  return false;
}

async function relatedForSeed(
  pool: Pool,
  scope: { storeId: string; country: string; language: string },
  seed: string,
  limit: number,
  constraints: HardConstraints = {},
): Promise<Array<{ productRef: string; via: 'collection' | 'product_type' }>> {
  const bounded = Math.min(Math.max(limit, 1), 36);
  // FIX01: store-scoped transaction (RLS enforced); FIX04: every hard
  // constraint applies to related candidates exactly as to other strategies.
  return scopedCatalogTransaction(pool, scope, async (client) => {
    const collectionParams: unknown[] = [scope.storeId, scope.country, scope.language, seed];
    const collectionFilter = catalogHardFilterSql(constraints, collectionParams);
    collectionParams.push(bounded);
    const collectionRows = await client.query<{ product_gid: string; via: string }>(
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
         GROUP BY m2.product_gid ORDER BY shared DESC, m2.product_gid LIMIT $${collectionParams.length}
       )
       SELECT related.product_gid, related.via FROM related
       JOIN catalog_products p
         ON p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.product_gid=related.product_gid AND p.visible=true${collectionFilter}`,
      collectionParams,
    );
    if (collectionRows.rows.length > 0) {
      return collectionRows.rows.map((row) => ({ productRef: row.product_gid, via: 'collection' as const }));
    }
    const typeParams: unknown[] = [scope.storeId, scope.country, scope.language, seed];
    const typeFilter = catalogHardFilterSql(constraints, typeParams);
    typeParams.push(bounded);
    const typeRows = await client.query<{ product_gid: string }>(
      `SELECT p.product_gid FROM catalog_products p0
       JOIN catalog_products p
         ON p.store_id=p0.store_id AND p.country=p0.country AND p.language=p0.language
        AND p.product_type=p0.product_type AND p.product_gid<>p0.product_gid AND p.visible=true
       WHERE p0.store_id=$1 AND p0.country=$2 AND p0.language=$3 AND p0.product_gid=$4
         AND p0.visible=true AND p0.product_type<>''${typeFilter}
       ORDER BY p.handle, p.product_gid LIMIT $${typeParams.length}`,
      typeParams,
    );
    return typeRows.rows.map((row) => ({ productRef: row.product_gid, via: 'product_type' as const }));
  });
}

async function marketDefault(
  pool: Pool,
  scope: { storeId: string; country: string; language: string },
  limit: number,
  constraints: HardConstraints,
): Promise<string[]> {
  // FIX01: store-scoped transaction; FIX04: centralized hard filters
  // (availability, currency, budget, collection, vendor, type, attributes).
  return scopedCatalogTransaction(pool, scope, async (client) => {
    const params: unknown[] = [scope.storeId, scope.country, scope.language];
    const filter = catalogHardFilterSql(constraints, params);
    params.push(Math.min(Math.max(limit, 1), 72));
    const rows = await client.query<{ product_gid: string }>(
      `SELECT p.product_gid FROM catalog_products p
       WHERE p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.visible=true${filter}
       ORDER BY p.provider_updated_at DESC, p.product_gid ASC
       LIMIT $${params.length}`,
      params,
    );
    return rows.rows.map((row) => row.product_gid);
  });
}

async function resolveSummaries(
  pool: Pool,
  scope: { storeId: string; country: string; language: string },
  refs: string[],
  constraints: HardConstraints = {},
): Promise<Map<string, ReturnType<typeof summaryDto>>> {
  const map = new Map<string, ReturnType<typeof summaryDto>>();
  if (refs.length === 0) return map;
  // FIX01: store-scoped transaction (RLS enforced).
  const rows = await scopedCatalogTransaction(pool, scope, client => {
    const params: unknown[] = [scope.storeId, scope.country, scope.language, refs];
    const filters = catalogHardFilterSql(constraints, params);
    return client.query<SummaryRow>(
      `SELECT ${SUMMARY_SELECT} FROM catalog_products p ${SUMMARY_JOINS}
       WHERE p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.visible=true AND p.product_gid = ANY($4::text[])${filters}`, params);
  });
  for (const row of rows.rows) map.set(row.product_gid, summaryDto(row));
  return map;
}

/** Exported for the session-free storefront search (FIX07): resolves ranked
 *  refs to verified product summaries under the same RLS boundary. */
export async function resolveProductSummaries(
  pool: Pool,
  scope: { storeId: string; country: string; language: string },
  refs: string[],
): Promise<Map<string, ReturnType<typeof summaryDto>>> {
  return resolveSummaries(pool, scope, refs);
}

async function readCompletion(
  pool: Pool,
  scope: { storeId: string; country: string; language: string },
): Promise<string | null> {
  // FIX01: store-scoped transaction. Freshness is read independently of
  // retrieval mode (FIX04): degraded lexical never hides catalog freshness.
  const result = await scopedCatalogTransaction(pool, scope, (client) =>
    client.query<{ completed_at: Date | null }>(
      'SELECT completed_at FROM catalog_imports WHERE store_id=$1 AND country=$2 AND language=$3',
      [scope.storeId, scope.country, scope.language],
    ),
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
    try { await lockActiveExperience(client, scope.storeId, session.sessionId); }
    catch (error) {
      if (error instanceof Error && error.message === 'SESSION_NOT_ACTIVE') throw AppError.conflict('Session is no longer active');
      throw error;
    }
    // FIX09: revalidate the authoritative contextVersion and the active
    // session identity at publication time. A stale run is never marked
    // published — the caller receives an explicit conflict.
    const revision = await client.query<{ context_version: string; live: boolean }>(
      `SELECT context_version::text, expires_at > now() AS live FROM experience_revisions
       WHERE store_id=$1 AND session_id=$2 FOR UPDATE`,
      [scope.storeId, session.sessionId],
    );
    const currentVersion = revision.rows[0] ? Number(revision.rows[0].context_version) : 0;
    if (currentVersion !== result.sourceContextVersion || revision.rows[0]?.live === false) {
      throw AppError.conflict('Stale context version — reload and retry');
    }
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
