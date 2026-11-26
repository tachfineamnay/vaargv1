import type { Pool } from 'pg';
import { z } from 'zod';
import {
  compareCatalogProductsV1,
  getCatalogProductV1,
  getCatalogVariantV1,
  getCompatibleOptionsV1,
  relatedCatalogProductsV1,
  searchCatalogV1,
  type CatalogReadScope,
  type CatalogFreshnessState,
} from './catalog-read.js';

/**
 * Agent-readable read-only catalog knowledge services (FL03). These are the
 * typed application capabilities future Hermes agents consume through the
 * server-side ToolBroker (FL06/FL07) — they are NOT autonomous agents, hold
 * no credentials and never write. Every result carries market freshness and
 * provider provenance; descriptions and configured metafields are untrusted
 * content (data, never instructions); compatibility is never inferred and
 * stays UNKNOWN without an explicit provider declaration.
 */

export const catalogKnowledgeScopeSchema = z.strictObject({
  storeId: z.uuid(),
  country: z.string().regex(/^[A-Z]{2}$/),
  language: z.string().regex(/^[A-Z]{2,3}$/),
});
export type CatalogKnowledgeScope = z.infer<typeof catalogKnowledgeScopeSchema>;

const refSchema = z.string().min(1).max(300);
const searchSchema = z.strictObject({ q: z.string().min(1).max(200), limit: z.number().int().min(1).max(50).default(10) });

function scopeOf(rawScope: CatalogKnowledgeScope): CatalogReadScope {
  return catalogKnowledgeScopeSchema.parse(rawScope);
}

export interface KnowledgeEnvelope<F extends CatalogFreshnessState | 'NOT_CONFIGURED'> {
  freshness: F;
}

/** Lexical catalog search over normalized documents (deterministic). */
export function searchCatalog(pool: Pool, scope: CatalogKnowledgeScope, query: { q: string; limit?: number }) {
  const parsed = searchSchema.parse(query);
  return searchCatalogV1(pool, scopeOf(scope), { q: parsed.q, limit: parsed.limit });
}

/** Verified product detail (handle or stable gid reference). */
export function getProduct(pool: Pool, scope: CatalogKnowledgeScope, ref: string) {
  return getCatalogProductV1(pool, scopeOf(scope), refSchema.parse(ref));
}

/** Verified variant detail (stable gid reference). */
export function getVariant(pool: Pool, scope: CatalogKnowledgeScope, variantGid: string) {
  return getCatalogVariantV1(pool, scopeOf(scope), refSchema.parse(variantGid));
}

/** Deterministic bounded comparison (2–4 products). */
export function compareProducts(pool: Pool, scope: CatalogKnowledgeScope, refs: string[]) {
  return compareCatalogProductsV1(pool, scopeOf(scope), z.array(refSchema).min(2).max(4).parse(refs));
}

/**
 * Configured personalization options for a product. Compatibility is
 * always UNKNOWN in FL03: no engraving availability, stock guarantee,
 * discount or compatibility may be inferred from names or descriptions.
 */
export function getCompatibleOptions(pool: Pool, scope: CatalogKnowledgeScope, ref: string) {
  return getCompatibleOptionsV1(pool, scopeOf(scope), refSchema.parse(ref));
}

/** Related products with explicit provenance (collection membership or shared verified type). */
export function getRelatedProducts(pool: Pool, scope: CatalogKnowledgeScope, ref: string, limit = 6) {
  return relatedCatalogProductsV1(pool, scopeOf(scope), refSchema.parse(ref), z.number().int().min(1).max(12).parse(limit));
}

export type { CatalogReadScope, CatalogFreshnessState };
