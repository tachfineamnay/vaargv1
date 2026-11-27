import { z } from 'zod';
import type { AdaptiveComposition } from './composition.js';
import { explorationCriteriaSchema, type ExperienceContext } from './experience.js';
import { adaptationReasonSchema } from './composition.js';
import type { RecommendationRequest, RecommendationResult } from './recommendation.js';
import type { SearchRequest, SearchResult } from './search.js';

/**
 * FL05 Task 10 — typed application capabilities for the future Hermes
 * ToolBroker (FL06/FL07). These are bounded application capabilities, NOT
 * autonomous agents: no delegation, no budgets, no tool routing. Every
 * capability preserves provenance and consent checks at the application
 * boundary and treats catalog content as untrusted data. Implementations
 * live server-side (API application services); the interface exists so the
 * future ToolBroker binds to a stable contract without inventing tools.
 */

export const experienceCapabilityScopeSchema = z.strictObject({
  storeId: z.uuid(),
  country: z.string().regex(/^[A-Z]{2}$/),
  language: z.string().regex(/^[A-Z]{2,3}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** Verified session id (server-resolved from the credential). */
  sessionId: z.uuid(),
  /** Server stamp only; implementations MUST re-resolve consent at call time. Never agent-authoritative. */
  personalizationGranted: z.boolean(),
});
export type ExperienceCapabilityScope = z.infer<typeof experienceCapabilityScopeSchema>;

export const capabilityCompositionInputSchema = z.strictObject({
  reason: adaptationReasonSchema.optional(),
  limit: z.number().int().min(1).max(24).optional(),
});
export const capabilityCriteriaInputSchema = z.strictObject({
  criteria: explorationCriteriaSchema.pick({ query: true, productType: true, vendor: true,
    collection: true, priceMin: true, priceMax: true, currency: true }).partial(),
});

/** Bound by the server to a verified request credential. Agent inputs never
 * supply authority; SearchRequest.scope/context are overwritten by the binding. */
export interface ExperienceCapabilities {
  /** Hybrid/lexical catalog search within store+market scope. */
  searchCatalog(request: SearchRequest): Promise<SearchResult>;
  /** Current unified visitor context (server-authoritative revisions). */
  getExperienceContext(): Promise<ExperienceContext>;
  /** Deterministic recommendations; consent-limits inferred signals. */
  getRecommendations(
    request: RecommendationRequest,
  ): Promise<RecommendationResult>;
  /**
   * Compose a deterministic experience proposal. A PROPOSAL: validation and
   * stale-response checks happen before it can be published; the caller
   * never receives raw HTML/JS.
   */
  proposeExperienceComposition(
    input: { reason?: string; limit?: number },
  ): Promise<AdaptiveComposition>;
  /** Update explicit exploration criteria (current-request scope only). */
  updateExplicitCriteria(
    input: {
      criteria: Partial<{
        query: string | null;
        productType: string | null;
        vendor: string | null;
        collection: string | null;
        priceMin: string | null;
        priceMax: string | null;
        currency: string | null;
      }>;
    },
  ): Promise<ExperienceContext>;
}
