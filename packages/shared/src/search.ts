import { z } from 'zod';

/**
 * FL05 SearchPort contracts — provider-independent, framework-independent.
 * The port is implemented over PostgreSQL hybrid retrieval (FTS + pg_trgm +
 * pgvector + RRF) in @vaarg/persistence; nothing here imports pg, Drizzle or
 * NestJS. Explicit constraints are HARD filters applied inside every retrieval
 * channel before results are returned — never ranking suggestions. A second
 * product database is never introduced: every channel reads the normalized
 * FL03 catalog projection.
 */

// ---------------------------------------------------------------------------
// Scope and constraints
// ---------------------------------------------------------------------------

/** Market scope: server-resolved store + market columns. */
export const searchScopeSchema = z.strictObject({
  storeId: z.uuid(),
  country: z.string().regex(/^[A-Z]{2}$/),
  language: z.string().regex(/^[A-Z]{2,3}$/),
});
export type SearchScope = z.infer<typeof searchScopeSchema>;

/** A verified catalog attribute hard filter (name/value both required). */
export const searchAttributeConstraintSchema = z.strictObject({
  name: z.string().min(1).max(255),
  value: z.string().min(1).max(255),
});
export type SearchAttributeConstraint = z.infer<typeof searchAttributeConstraintSchema>;

/**
 * Explicit search constraints. Every present field is a hard filter:
 * availability, price range (currency required with either bound),
 * collection (handle or gid), product type, vendor and verified attributes.
 */
export const searchConstraintsSchema = z
  .strictObject({
    available: z.boolean().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    priceMin: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/).optional(),
    priceMax: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/).optional(),
    collection: z.string().min(1).max(300).optional(),
    productType: z.string().min(1).max(200).optional(),
    vendor: z.string().min(1).max(200).optional(),
    attributes: z.array(searchAttributeConstraintSchema).max(10).optional(),
  })
  .refine(
    (value) =>
      (value.priceMin === undefined && value.priceMax === undefined) ||
      value.currency !== undefined,
    { message: 'CURRENCY_REQUIRED' },
  );
export type SearchConstraints = z.infer<typeof searchConstraintsSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const searchModeSchema = z.enum(['lexical', 'semantic', 'hybrid', 'contextual']);
export type SearchMode = z.infer<typeof searchModeSchema>;

/**
 * Typed search request. `q` is required for lexical/semantic/hybrid;
 * contextual search additionally carries consent-gated exploration signals
 * used ONLY as ranking input (never to widen or narrow hard filters).
 */
export const searchRequestSchema = z
  .strictObject({
    /** Server-resolved store + market scope (never client-authoritative). */
    scope: searchScopeSchema,
    mode: searchModeSchema,
    q: z.string().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(50).default(24),
    constraints: searchConstraintsSchema.default({}),
    /** Consent-gated contextual signals (ranking only). */
    context: z
      .strictObject({
        categories: z.array(z.string().min(1).max(300)).max(5).default([]),
        collections: z.array(z.string().min(1).max(300)).max(5).default([]),
        products: z.array(z.string().min(1).max(300)).max(5).default([]),
      })
      .default({ categories: [], collections: [], products: [] }),
  })
  .refine(
    (value) => value.mode === 'contextual' || value.q !== undefined,
    { message: 'QUERY_REQUIRED' },
  );
export type SearchRequest = z.input<typeof searchRequestSchema>;
export type ParsedSearchRequest = z.output<typeof searchRequestSchema>;

// ---------------------------------------------------------------------------
// Results and provenance
// ---------------------------------------------------------------------------

/** Which retrieval channels contributed, and their candidate depths. */
export const searchChannelSchema = z.enum(['fts', 'trigram', 'vector', 'context']);
export type SearchChannel = z.infer<typeof searchChannelSchema>;

export const searchItemProvenanceSchema = z.strictObject({
  /** Per-channel 1-based ranks (absent channel = did not contribute). */
  ranks: z.record(searchChannelSchema, z.number().int().min(1).max(100000).optional()),
  /** Stable product reference (Shopify gid) — dedupe key. */
  productRef: z.string().startsWith('gid://shopify/Product/'),
});
export type SearchItemProvenance = z.infer<typeof searchItemProvenanceSchema>;

export const searchProvenanceSchema = z.strictObject({
  channels: z.array(searchChannelSchema).min(1),
  /** RRF constant used for fusion (default 60). */
  rrfK: z.number().int().min(1).max(1000),
  /** Bounded candidate pool per channel. */
  candidatePool: z.number().int().min(1).max(1000),
  /** Embedding identity when the vector channel ran; null when degraded. */
  embedding: z
    .strictObject({
      provider: z.string().min(1).max(64),
      model: z.string().min(1).max(128),
      modelVersion: z.string().min(1).max(64),
      dimension: z.number().int().min(1).max(4096),
    })
    .nullable(),
});
export type SearchProvenance = z.infer<typeof searchProvenanceSchema>;

export const searchAvailabilitySchema = z.enum([
  'OK',
  'DEGRADED_LEXICAL',
  'NOT_CONFIGURED',
  'ERROR',
  'NOT_SYNCED',
  'IN_PROGRESS',
  'STALE',
]);
export type SearchAvailability = z.infer<typeof searchAvailabilitySchema>;

export const searchResultItemSchema = z.strictObject({
  productRef: z.string().startsWith('gid://shopify/Product/'),
  handle: z.string().min(1),
  title: z.string(),
  score: z.number(),
  provenance: searchItemProvenanceSchema,
});
export type SearchResultItem = z.infer<typeof searchResultItemSchema>;

export const searchResultSchema = z.strictObject({
  status: searchAvailabilitySchema,
  mode: searchModeSchema,
  query: z.string().max(200).nullable(),
  items: z.array(searchResultItemSchema),
  provenance: searchProvenanceSchema,
  /** Market freshness (from the FL03 catalog snapshot). */
  completedAt: z.iso.datetime().nullable(),
  generatedAt: z.iso.datetime(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

// ---------------------------------------------------------------------------
// SearchPort — provider-independent interface
// ---------------------------------------------------------------------------

/**
 * Provider-independent catalog search port. Implementations MUST keep
 * store/market scoping inside every channel, apply explicit constraints as
 * hard filters before returning, parameterize all SQL, deduplicate by stable
 * product reference and break ties deterministically (score DESC, productRef
 * ASC). Semantic channels must never compare vectors across models.
 */
export interface SearchPort {
  lexicalSearch(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult>;
  semanticSearch(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult>;
  hybridSearch(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult>;
  contextualSearch(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult>;
}

/** Default RRF constant (Cormack et al.); configurable per call site. */
export const DEFAULT_RRF_K = 60;
/** Default bounded candidate pool per retrieval channel. */
export const DEFAULT_CANDIDATE_POOL = 100;
/** Initial embedding dimension baseline (PRD). */
export const EMBEDDING_DIMENSION = 768;

/**
 * Reciprocal Rank Fusion over ranked lists of stable product references.
 * Pure, deterministic: score = Σ 1/(k + rank); ties broken by productRef
 * ascending. Used for unit verification and TS-side fusion of ranked lists
 * (the SQL hybrid path performs the equivalent fusion in-database).
 */
export function reciprocalRankFusion(
  rankedLists: ReadonlyArray<ReadonlyArray<string>>,
  options: { k?: number; limit?: number } = {},
): Array<{ productRef: string; score: number }> {
  const k = options.k ?? DEFAULT_RRF_K;
  if (!Number.isInteger(k) || k < 1) throw new Error('INVALID_RRF_K');
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1) throw new Error('INVALID_LIMIT');
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    const seen = new Set<string>();
    let rank = 0;
    for (const productRef of list) {
      if (seen.has(productRef)) continue;
      seen.add(productRef);
      rank += 1;
      scores.set(productRef, (scores.get(productRef) ?? 0) + 1 / (k + rank));
    }
  }
  return [...scores.entries()]
    .map(([productRef, score]) => ({ productRef, score }))
    .sort((a, b) => b.score - a.score || (a.productRef < b.productRef ? -1 : a.productRef > b.productRef ? 1 : 0))
    .slice(0, limit);
}
