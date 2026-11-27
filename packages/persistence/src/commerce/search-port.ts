import type { Pool, PoolClient } from 'pg';
import {
  DEFAULT_CANDIDATE_POOL,
  DEFAULT_RRF_K,
  EMBEDDING_DIMENSION,
  searchRequestSchema,
  type EmbeddingPort,
  type ParsedSearchRequest,
  type SearchChannel,
  type SearchConstraints,
  type SearchPort,
  type SearchProvenance,
  type SearchRequest,
  type SearchResult,
  type SearchResultItem,
} from '@vaarg/shared';
import { normalizeText } from './catalog-projection.js';
import { scopedCatalogTransaction } from './scope.js';

/**
 * FL05 TASK 04 — PostgreSQL hybrid retrieval over the normalized FL03
 * projection. One provider-independent SearchPort with four real query
 * paths: full-text (tsvector/tsquery, language-mapped configuration),
 * trigram similarity (existing pg_trgm), pgvector semantic channel and
 * Reciprocal Rank Fusion combining the ranked channel lists in SQL.
 *
 * Invariants enforced here:
 *  - store + market scoping inside EVERY channel (RLS + explicit columns);
 *  - explicit constraints are hard filters applied inside each channel and
 *    re-checked before returning — never ranking suggestions;
 *  - bounded configurable candidate pool per channel; default RRF k=60;
 *  - dedupe by stable product reference; deterministic tie-breaking
 *    (score DESC, handle ASC, product_gid ASC);
 *  - every SQL statement is parameterized;
 *  - the vector channel always filters model + model_version + dimension
 *    so vectors are never compared across models;
 *  - no second product database: only catalog_* projection tables.
 */

export interface SearchPortDependencies {
  pool: Pool;
  /** Absent/unconfigured embedding port ⇒ semantic channel unavailable. */
  embedding?: EmbeddingPort | null;
  /** Identity reported in provenance when the vector channel runs. */
  embeddingIdentity?: SearchProvenance['embedding'];
  rrfK?: number;
  candidatePool?: number;
}

interface FreshnessRow {
  phase: string;
  completed_at: Date | null;
}

interface FusedRow {
  product_gid: string;
  handle: string;
  title: string;
  score: string;
  fts_rank: string | null;
  trigram_rank: string | null;
  vector_rank: string | null;
}

/** Mirror of the migration's language→regconfig mapping (query side). */
function tsConfigFor(language: string): string {
  switch (language.toLowerCase()) {
    case 'en':
      return 'english';
    case 'fr':
      return 'french';
    case 'de':
      return 'german';
    case 'es':
      return 'spanish';
    case 'it':
      return 'italian';
    case 'pt':
      return 'portuguese';
    case 'nl':
      return 'dutch';
    case 'ru':
      return 'russian';
    default:
      return 'simple';
  }
}

/**
 * Centralized hard-filter SQL over the `p` (catalog_products) alias. Every
 * present constraint becomes a WHERE predicate. Parameterized exclusively.
 * Shared by every retrieval channel and by the recommendation strategies
 * (FIX04) so availability, currency, budget, collection, vendor, product
 * type and attributes are enforced identically everywhere.
 */
export function catalogHardFilterSql(constraints: SearchConstraints, params: unknown[]): string {
  const clauses: string[] = [];
  const variant: string[] = ['pv.store_id=p.store_id', 'pv.country=p.country', 'pv.language=p.language', 'pv.product_gid=p.product_gid', 'pv.visible=true'];
  if (constraints.available !== undefined) {
    params.push(constraints.available);
    clauses.push(`p.available_for_sale = $${params.length}`);
    variant.push(`pv.available_for_sale = $${params.length}`);
  }
  if (constraints.currency !== undefined) {
    params.push(constraints.currency);
    variant.push(`pv.currency=$${params.length}`);
  }
  if (constraints.priceMin !== undefined) {
    params.push(constraints.priceMin);
    variant.push(`pv.price_amount >= $${params.length}::numeric`);
  }
  if (constraints.priceMax !== undefined) {
    params.push(constraints.priceMax);
    variant.push(`pv.price_amount <= $${params.length}::numeric`);
  }
  if (constraints.available !== undefined || constraints.currency !== undefined || constraints.priceMin !== undefined || constraints.priceMax !== undefined) {
    clauses.push(`EXISTS (SELECT 1 FROM catalog_variants pv WHERE ${variant.join(' AND ')})`);
  }
  if (constraints.collection !== undefined) {
    params.push(constraints.collection);
    const ref = `$${params.length}`;
    clauses.push(
      `EXISTS (SELECT 1 FROM catalog_collection_members cm JOIN catalog_collections cc ON cc.store_id=cm.store_id AND cc.country=cm.country AND cc.language=cm.language AND cc.collection_gid=cm.collection_gid AND cc.visible=true WHERE cm.store_id=p.store_id AND cm.country=p.country AND cm.language=p.language AND cm.product_gid=p.product_gid AND (cc.handle=${ref} OR cc.collection_gid=${ref}))`,
    );
  }
  if (constraints.productType !== undefined) {
    params.push(constraints.productType);
    clauses.push(`p.product_type = $${params.length}`);
  }
  if (constraints.vendor !== undefined) {
    params.push(constraints.vendor);
    clauses.push(`p.vendor = $${params.length}`);
  }
  for (const attribute of constraints.attributes ?? []) {
    params.push(attribute.name);
    const name = `$${params.length}`;
    params.push(attribute.value);
    const value = `$${params.length}`;
    clauses.push(
      `EXISTS (SELECT 1 FROM catalog_product_attributes a WHERE a.store_id=p.store_id AND a.country=p.country AND a.language=p.language AND a.product_gid=p.product_gid AND a.name=${name} AND a.value=${value})`,
    );
  }
  return clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
}

/** Escape LIKE wildcards in the trigram ILIKE fallback. */
function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

async function readFreshness(
  client: PoolClient,
  scope: ParsedSearchRequest['scope'],
): Promise<{ status: NonNullable<SearchResult['catalogStatus']>; completedAt: string | null }> {
  const row = (
    await client.query<FreshnessRow>(
      'SELECT phase, completed_at FROM catalog_imports WHERE store_id=$1 AND country=$2 AND language=$3',
      [scope.storeId, scope.country, scope.language],
    )
  ).rows[0];
  if (!row) return { status: 'NOT_SYNCED', completedAt: null };
  if (row.phase !== 'complete') return { status: 'IN_PROGRESS', completedAt: null };
  if (!row.completed_at) return { status: 'STALE', completedAt: null };
  const stale = Date.now() - row.completed_at.getTime() > 3600000;
  return {
    status: stale ? 'STALE' : 'OK',
    completedAt: row.completed_at.toISOString(),
  };
}

function vectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}

class PostgresSearchPort implements SearchPort {
  private readonly pool: Pool;
  private readonly embedding: EmbeddingPort | null;
  private readonly embeddingIdentity: SearchProvenance['embedding'];
  private readonly rrfK: number;
  private readonly candidatePool: number;

  constructor(dependencies: SearchPortDependencies) {
    this.pool = dependencies.pool;
    this.embedding = dependencies.embedding ?? null;
    this.embeddingIdentity = dependencies.embeddingIdentity ?? null;
    this.rrfK = dependencies.rrfK ?? DEFAULT_RRF_K;
    this.candidatePool = dependencies.candidatePool ?? DEFAULT_CANDIDATE_POOL;
    if (!Number.isInteger(this.rrfK) || this.rrfK < 1) throw new Error('INVALID_RRF_K');
    if (!Number.isInteger(this.candidatePool) || this.candidatePool < 1) {
      throw new Error('INVALID_CANDIDATE_POOL');
    }
  }

  lexicalSearch(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult> {
    return this.execute('lexical', request, signal);
  }

  semanticSearch(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult> {
    return this.execute('semantic', request, signal);
  }

  hybridSearch(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult> {
    return this.execute('hybrid', request, signal);
  }

  contextualSearch(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult> {
    return this.execute('contextual', request, signal);
  }

  private async execute(
    mode: 'lexical' | 'semantic' | 'hybrid' | 'contextual',
    rawRequest: SearchRequest,
    signal?: AbortSignal,
  ): Promise<SearchResult> {
    const request = searchRequestSchema.parse(rawRequest);
    // FIX05: the invoked method and request.mode must agree — a caller can
    // never get hybrid channels from lexicalSearch (or vice versa).
    if (request.mode !== mode) throw new Error('SEARCH_MODE_MISMATCH');
    const scope = request.scope;
    const generatedAt = new Date().toISOString();

    // --- Query normalization (lexical text) -------------------------------
    const normalizedQuery = request.q ? normalizeText(request.q) : '';
    if (request.mode !== 'contextual' && !normalizedQuery) {
      throw new Error('INVALID_QUERY');
    }
    if (signal?.aborted) throw new Error('ABORTED');

    // --- Vector channel decision (provider outside any transaction) -------
    let channels: SearchChannel[] = [];
    let queryVector: number[] | null = null;
    const wantsVector =
      request.mode === 'semantic' ||
      request.mode === 'hybrid' ||
      (request.mode === 'contextual' && this.embedding?.availability() === 'READY');

    if (wantsVector) {
      if (this.embedding && this.embedding.availability() === 'READY' && normalizedQuery) {
        try {
          const identity = this.embedding.identity();
          if (!identity || identity.dimension !== EMBEDDING_DIMENSION) throw new Error('EMBEDDING_IDENTITY_MISMATCH');
          if (this.embeddingIdentity && (this.embeddingIdentity.provider !== identity.provider || this.embeddingIdentity.model !== identity.model || this.embeddingIdentity.modelVersion !== identity.modelVersion || this.embeddingIdentity.dimension !== identity.dimension)) throw new Error('EMBEDDING_IDENTITY_MISMATCH');
          queryVector = await this.embedding.embedQuery(
            normalizedQuery,
            signal ? { signal } : {},
          );
          if (
            !Array.isArray(queryVector) ||
            queryVector.length !== EMBEDDING_DIMENSION ||
            queryVector.some((value) => typeof value !== 'number' || !Number.isFinite(value))
          ) {
            queryVector = null;
            if (request.mode === 'semantic') {
              return this.notConfigured('semantic', request, generatedAt, signal);
            }
          }
        } catch (error) {
          if (signal?.aborted) throw error;
          if (request.mode === 'semantic') {
            return this.notConfigured('semantic', request, generatedAt, signal);
          }
          // hybrid/contextual: degrade to lexical channels below.
          queryVector = null;
        }
      } else if (request.mode === 'semantic') {
        return this.notConfigured('semantic', request, generatedAt, signal);
      }
    }

    // Lexical channels: always for lexical; for hybrid they are the
    // degradation path when the vector channel is unavailable (D-05); for
    // contextual only when a text query exists (empty ILIKE would match
    // everything). Vector joins when a valid query vector was produced.
    const lexicalQuery = request.mode !== 'contextual' || normalizedQuery.length > 0;
    if (lexicalQuery && (request.mode === 'lexical' || request.mode === 'hybrid' || request.mode === 'contextual' || queryVector)) {
      channels.push('fts', 'trigram');
    }
    if (queryVector) channels.push('vector');
    if (request.mode === 'contextual') channels.push('context');
    // Semantic-only success with no lexical query: vector alone.
    if (request.mode === 'semantic' && queryVector) {
      channels = ['vector'];
    }
    if (channels.length === 0) {
      return this.notConfigured(mode, request, generatedAt, signal);
    }

    // --- Execute retrieval in a store-scoped transaction ------------------
    const freshness = await scopedCatalogTransaction(this.pool, scope, (client) =>
      readFreshness(client, scope),
    );
    if (signal?.aborted) throw new Error('ABORTED');

    const items = await scopedCatalogTransaction(this.pool, scope, (client) =>
      this.runChannels(client, request, channels, queryVector, signal),
    );
    if (signal?.aborted) throw new Error('ABORTED');

    const provenance: SearchProvenance = {
      channels,
      rrfK: this.rrfK,
      candidatePool: this.candidatePool,
      embedding: queryVector ? (this.embedding?.identity() ?? null) : null,
    };

    // Honest status: catalog freshness wins; a hybrid/contextual request
    // whose vector channel was unavailable reports DEGRADED_LEXICAL.
    const degraded = !queryVector && (request.mode === 'hybrid' || request.mode === 'contextual');
    const status: SearchResult['status'] =
      freshness.status === 'NOT_SYNCED' || freshness.status === 'IN_PROGRESS'
        ? freshness.status
        : degraded
          ? 'DEGRADED_LEXICAL'
          : freshness.status === 'STALE'
            ? 'STALE'
            : 'OK';

    return {
      status,
      catalogStatus: freshness.status,
      mode: request.mode,
      query: request.q ?? null,
      items,
      provenance,
      completedAt: freshness.completedAt,
      generatedAt,
    };
  }

  private async notConfigured(
    mode: SearchResult['mode'],
    request: ParsedSearchRequest,
    generatedAt: string,
    _signal?: AbortSignal,
  ): Promise<SearchResult> {
    const freshness = await scopedCatalogTransaction(this.pool, request.scope, client => readFreshness(client, request.scope));
    return {
      status: 'NOT_CONFIGURED',
      catalogStatus: freshness.status,
      mode,
      query: request.q ?? null,
      items: [],
      provenance: {
        channels: [],
        rrfK: this.rrfK,
        candidatePool: this.candidatePool,
        embedding: null,
      },
      completedAt: freshness.completedAt,
      generatedAt,
    };
  }

  /**
   * Runs every requested channel with hard constraints applied inside the
   * channel, fuses with RRF in SQL, re-applies hard constraints on the
   * fused set, dedupes by product_gid and orders deterministically.
   */
  private async runChannels(
    client: PoolClient,
    request: ParsedSearchRequest,
    channels: SearchChannel[],
    queryVector: number[] | null,
    signal?: AbortSignal,
  ): Promise<SearchResultItem[]> {
    if (signal?.aborted) throw new Error('ABORTED');
    const scope = request.scope;
    const params: unknown[] = [scope.storeId, scope.country, scope.language];
    const pool = this.candidatePool;

    const useFts = channels.includes('fts');
    const useTrigram = channels.includes('trigram');
    const useVector = channels.includes('vector') && queryVector;
    const useContext = channels.includes('context');

    const parts: string[] = [];
    const unions: string[] = [];

    if (useFts) {
      params.push(tsConfigFor(scope.language));
      const cfg = `$${params.length}`;
      params.push(normalizeText(request.q ?? ''));
      const query = `$${params.length}`;
      // Empty tsquery (pure stop-words) must not match everything.
      parts.push(
        `fts AS (
          SELECT sd.product_gid AS product_gid,
                 rank() OVER (ORDER BY ts_rank_cd(sd.search_vector, websearch_to_tsquery(${cfg}, ${query})) DESC, sd.product_gid ASC) AS rank
          FROM catalog_search_documents sd
          JOIN catalog_products p ON p.store_id=sd.store_id AND p.country=sd.country AND p.language=sd.language AND p.product_gid=sd.product_gid
          WHERE sd.store_id=$1 AND sd.country=$2 AND sd.language=$3 AND sd.visible=true AND p.visible=true
            AND sd.search_vector @@ websearch_to_tsquery(${cfg}, ${query})${catalogHardFilterSql(request.constraints, params)}
          ORDER BY ts_rank_cd(sd.search_vector, websearch_to_tsquery(${cfg}, ${query})) DESC, sd.product_gid ASC
          LIMIT ${pool}
        )`,
      );
      unions.push('SELECT product_gid, 1 AS channel_order, rank FROM fts');
    }

    if (useTrigram) {
      params.push(normalizeText(request.q ?? ''));
      const query = `$${params.length}`;
      params.push(likePattern(normalizeText(request.q ?? '')));
      const like = `$${params.length}`;
      parts.push(
        `trgm AS (
          SELECT sd.product_gid AS product_gid,
                 rank() OVER (
                   ORDER BY (3 * similarity(sd.title_normalized, ${query}) + similarity(sd.body_normalized, ${query})
                     + CASE WHEN ${query} = ANY(sd.tags_normalized) THEN 1 ELSE 0 END) DESC, sd.product_gid ASC
                 ) AS rank
          FROM catalog_search_documents sd
          JOIN catalog_products p ON p.store_id=sd.store_id AND p.country=sd.country AND p.language=sd.language AND p.product_gid=sd.product_gid
          WHERE sd.store_id=$1 AND sd.country=$2 AND sd.language=$3 AND sd.visible=true AND p.visible=true
            AND (sd.title_normalized % ${query} OR sd.body_normalized % ${query}
                 OR sd.title_normalized ILIKE ${like} OR sd.body_normalized ILIKE ${like})${catalogHardFilterSql(request.constraints, params)}
          ORDER BY (3 * similarity(sd.title_normalized, ${query}) + similarity(sd.body_normalized, ${query})
                     + CASE WHEN ${query} = ANY(sd.tags_normalized) THEN 1 ELSE 0 END) DESC, sd.product_gid ASC
          LIMIT ${pool}
        )`,
      );
      unions.push('SELECT product_gid, 2 AS channel_order, rank FROM trgm');
    }

    if (useVector && queryVector) {
      // Identity predicates: single model/partition only (no cross-model).
      const identity = this.embedding?.identity();
      if (!identity) throw new Error('EMBEDDING_IDENTITY_REQUIRED');
      params.push(identity.provider);
      const provider = `$${params.length}`;
      params.push(identity.model);
      const model = `$${params.length}`;
      params.push(identity.modelVersion);
      const modelVersion = `$${params.length}`;
      params.push(identity.dimension);
      const dimension = `$${params.length}`;
      params.push(vectorLiteral(queryVector));
      const vector = `$${params.length}`;
      parts.push(
        `vec AS (
          SELECT e.product_gid AS product_gid,
                 rank() OVER (ORDER BY e.embedding <=> ${vector}::vector, e.product_gid ASC) AS rank
          FROM catalog_product_embeddings e
          JOIN catalog_products p ON p.store_id=e.store_id AND p.country=e.country AND p.language=e.language AND p.product_gid=e.product_gid
          JOIN catalog_search_documents sd ON sd.store_id=e.store_id AND sd.country=e.country AND sd.language=e.language AND sd.product_gid=e.product_gid
          WHERE e.store_id=$1 AND e.country=$2 AND e.language=$3
            AND e.provider=${provider} AND e.model=${model} AND e.model_version=${modelVersion} AND e.dimension=${dimension}
            AND p.visible=true AND sd.visible=true AND sd.content_hash=e.content_hash
            AND sd.generation=p.generation AND e.generation=sd.generation${catalogHardFilterSql(request.constraints, params)}
          ORDER BY e.embedding <=> ${vector}::vector, e.product_gid ASC
          LIMIT ${pool}
        )`,
      );
      unions.push('SELECT product_gid, 3 AS channel_order, rank FROM vec');
    }

    if (useContext && request.context) {
      // Context channel: products sharing collection membership or product
      // type with the context subjects (handles or gids). Ranking-only
      // signal; hard filters from `constraints` still apply inside.
      params.push(request.context.collections);
      const collections = `$${params.length}`;
      params.push(request.context.products);
      const products = `$${params.length}`;
      parts.push(
        `ctx AS (
          SELECT cand.product_gid AS product_gid,
                 rank() OVER (ORDER BY overlap DESC, cand.product_gid ASC) AS rank
          FROM (
            SELECT p.product_gid,
              (SELECT count(DISTINCT cm.collection_gid) FROM catalog_collection_members cm
                JOIN catalog_collections cc ON cc.store_id=cm.store_id AND cc.country=cm.country AND cc.language=cm.language
                  AND cc.collection_gid=cm.collection_gid AND cc.visible=true
                WHERE cm.store_id=p.store_id AND cm.country=p.country AND cm.language=p.language
                  AND cm.product_gid=p.product_gid AND (cc.collection_gid = ANY(${collections}) OR cc.handle = ANY(${collections}))) +
              (SELECT count(*) FROM catalog_products anchor
                WHERE anchor.store_id=p.store_id AND anchor.country=p.country AND anchor.language=p.language
                  AND anchor.product_gid = ANY(${products}) AND anchor.product_type <> ''
                  AND anchor.product_type = p.product_type) AS overlap
            FROM catalog_products p
            WHERE p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.visible=true${catalogHardFilterSql(request.constraints, params)}
          ) cand
          JOIN catalog_products p ON p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.product_gid=cand.product_gid
          WHERE cand.overlap > 0
          ORDER BY cand.overlap DESC, cand.product_gid ASC
          LIMIT ${pool}
        )`,
      );
      unions.push('SELECT product_gid, 4 AS channel_order, rank FROM ctx');
    }

    if (unions.length === 0) return [];

    // RRF fusion in SQL: score = Σ 1/(k + rank) over channel lists.
    params.push(this.rrfK);
    const k = `$${params.length}`;
    params.push(request.limit);
    const limit = `$${params.length}`;
    // Second hard-filter pass over the fused set (post-fusion guarantee).
    const finalConstraints = catalogHardFilterSql(request.constraints, params);

    const sql = `
      WITH ${parts.join(',\n')},
      raw AS (
        ${unions.join('\nUNION ALL\n')}
      ),
      fused AS (
        SELECT raw.product_gid,
          sum(1.0 / (${k}::numeric + raw.rank)) AS score,
          min(raw.rank) FILTER (WHERE raw.channel_order = 1) AS fts_rank,
          min(raw.rank) FILTER (WHERE raw.channel_order = 2) AS trigram_rank,
          min(raw.rank) FILTER (WHERE raw.channel_order = 3) AS vector_rank
        FROM raw
        GROUP BY raw.product_gid
      )
      SELECT p.product_gid, p.handle, p.title, fused.score,
             fused.fts_rank, fused.trigram_rank, fused.vector_rank
      FROM fused
      JOIN catalog_products p
        ON p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.product_gid=fused.product_gid AND p.visible=true
      WHERE true${finalConstraints}
      ORDER BY fused.score DESC, p.handle ASC, p.product_gid ASC
      LIMIT ${limit}`;

    const rows = (await client.query<FusedRow>(sql, params)).rows;
    return rows.map((row) => {
      const ranks: Record<string, number> = {};
      if (row.fts_rank !== null) ranks.fts = Number(row.fts_rank);
      if (row.trigram_rank !== null) ranks.trigram = Number(row.trigram_rank);
      if (row.vector_rank !== null) ranks.vector = Number(row.vector_rank);
      return {
        productRef: row.product_gid,
        handle: row.handle,
        title: row.title,
        score: Number(row.score),
        provenance: {
          productRef: row.product_gid,
          ranks: ranks as SearchResultItem['provenance']['ranks'],
        },
      };
    });
  }
}

export function createSearchPort(dependencies: SearchPortDependencies): SearchPort {
  return new PostgresSearchPort(dependencies);
}
