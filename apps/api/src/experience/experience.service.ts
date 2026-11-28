import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type {
  ExperienceCapabilityScope,
  ExperienceCapabilities,
  ExperienceContext,
  ParsedExperienceSearchQuery,
  AdaptiveComposition,
  ConsentState,
  InteractionIngestRequest,
  InteractionIngestResult,
  RecommendationRequest,
  RecommendationResult,
  SearchRequest,
  SearchResult,
  TenantContext,
  VisitorSession,
} from '@vaarg/shared';
import {
  AppError,
  adaptiveCompositionSchema,
  capabilityCompositionInputSchema,
  capabilityCriteriaInputSchema,
  explorationCriteriaSchema,
  recommendationRequestSchema,
  experienceCapabilityScopeSchema,
  experienceContextSchema,
  isPurposeGranted,
  recommendationResultSchema,
  searchRequestSchema,
  searchResultSchema,
  storefrontSearchResponseSchema,
  visitorSessionSchema,
  withinCompositionLimits,
  type EmbeddingPort,
  type SearchPort,
} from '@vaarg/shared';
import {
  ExperienceContextCache,
  composeExperience,
  createRecommendationService,
  createSearchPort,
  createGeminiEmbeddingPort,
  loadExperienceContext,
  ingestInteractionEvents,
  loadGeminiEmbeddingConfig,
  publishExperienceRevision,
  recordRecommendationRun,
  resetExploration,
  resolveProductSummaries,
  scopedStoreTransaction,
  withdrawPersonalization,
  checkProviderAdmission,
  type StorefrontBinding,
} from '@vaarg/persistence';
import { TenantContextResolver } from '../tenant/tenant-context.resolver.js';
import { DatabaseClient } from '../infra/database-client.js';
import { ValkeyClient } from '../infra/valkey-client.js';
import { AbuseLimitService } from '../infra/abuse-limit.service.js';
import { ConsentService } from '../privacy/consent.service.js';
import { VisitorSessionService } from '../sessions/visitor-session.service.js';

/**
 * FL05 experience application service (EXP-01/02/03 + Task 10/14).
 *
 * Owns the adaptive experience loop for the storefront: unified context
 * reads, idempotent interaction ingestion, contextual search, deterministic
 * recommendations, composition generation with revision-safe publishing,
 * adaptation refresh and exploration reset. Store/market/session/consent are
 * ALWAYS resolved server-side — client input never supplies store or
 * customer identity. Composition publishing re-validates contextVersion
 * (compare-and-set) before an experienceRevision is handed out, so a stale
 * generation can never overwrite a newer experience (EXP-03).
 *
 * The same service exposes the five bounded Hermes-facing capabilities
 * (Task 10) through `capabilities()` — consent checks and provenance stay at
 * this application boundary; no agent runtime exists here.
 */
/**
 * Minimal server-resolved market scope for experience operations. HTTP
 * callers pass the full TenantContext (structurally assignable); capability
 * callers pass a scope resolved from operator bindings — never a partial
 * TenantContext with an empty currency (FIX03).
 */
export type ExperienceTenantScope = {
  storeId: string;
  country: string;
  language: string;
  currency: string;
};

@Injectable()
export class ExperienceService {
  private readonly searchPort: SearchPort;
  private readonly recommendationService: ReturnType<typeof createRecommendationService>;
  private readonly embedding: EmbeddingPort;
  private readonly contextCache: ExperienceContextCache;

  constructor(
    @Inject(DatabaseClient) private readonly database: DatabaseClient,
    @Inject(ValkeyClient) private readonly valkey: ValkeyClient,
    @Inject(VisitorSessionService) private readonly sessions: VisitorSessionService,
    @Inject(ConsentService) private readonly consents: ConsentService,
    @Inject(TenantContextResolver) private readonly tenants: TenantContextResolver,
    @Inject('STOREFRONT_BINDINGS') private readonly bindings: StorefrontBinding[],
    @Inject(AbuseLimitService) private readonly abuseLimit: AbuseLimitService,
  ) {
    // Provider-independent ports over PostgreSQL. The Gemini adapter reports
    // NOT_CONFIGURED without an operator key — never a fake vector path.
    this.embedding = createGeminiEmbeddingPort(loadGeminiEmbeddingConfig());
    this.searchPort = createSearchPort({
      pool: this.database.getPool(),
      embedding: this.embedding,
      embeddingIdentity: this.embedding.identity(),
    });
    this.recommendationService = createRecommendationService({
      pool: this.database.getPool(),
      search: this.searchPort,
    });
    this.contextCache = new ExperienceContextCache({
      eval: (script, keys, ...args) => this.rawValkey().eval(script, keys, ...args),
      get: (key) => this.rawValkey().get(key),
      set: (key, value, _mode, ttl) => this.rawValkey().set(key, value, 'EX', ttl),
      del: (key) => this.rawValkey().del(key),
    });
  }

  // -------------------------------------------------------------------------
  // Server-side resolution helpers (never trust client identity)
  // -------------------------------------------------------------------------

  /** Resolve the active visitor session from the request credential. */
  async requireSession(
    tenant: Pick<TenantContext, 'storeId'>,
    token: string | undefined,
  ): Promise<VisitorSession> {
    if (!token) throw new UnauthorizedException('Visitor session required');
    const session = await this.sessions.current(tenant, token);
    if (!session) throw new UnauthorizedException('Visitor session required');
    if (session.status !== 'active') throw new UnauthorizedException('Visitor session not active');
    if (session.storeId !== tenant.storeId) throw new ForbiddenException('Session scope mismatch');
    return session;
  }

  /** Effective consent for the session's identity (anonymous ⇒ undecided). */
  async effectiveConsent(
    tenant: Pick<TenantContext, 'storeId'>,
    session: VisitorSession,
  ): Promise<ConsentState> {
    const result = await this.consents.get(tenant, { kind: 'visitor', session });
    return result.consents;
  }

  private rawValkey() {
    return this.valkey.getClient();
  }

  /**
   * Server-side session binding by id (capability callers receive a scope
   * stamped by this server, never a token). Store-scoped, active-only.
   */
  private async sessionById(storeId: string, sessionId: string): Promise<VisitorSession> {
    // FIX01: store-scoped transaction (RLS enforced, restricted role).
    const result = await scopedStoreTransaction(this.database.getPool(), storeId, (client) =>
      client.query<{
        session_id: string;
        store_id: string;
        customer_id: string | null;
        status: 'active' | 'expired' | 'rotated' | 'revoked';
        context: string;
        expires_at: Date;
        created_at: Date;
      }>(
        `SELECT session_id, store_id, customer_id, status, context, expires_at, created_at
         FROM visitor_sessions
         WHERE store_id=$1 AND session_id=$2 AND status='active' AND expires_at > now()
         LIMIT 1`,
        [storeId, sessionId],
      ),
    );
    const row = result.rows[0];
    if (!row) throw new UnauthorizedException('Capability session not active');
    return visitorSessionSchema.parse({
      sessionId: row.session_id,
      storeId: row.store_id,
      customerId: row.customer_id,
      status: row.status,
      context: row.context,
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
    });
  }

  private scopeOf(tenant: ExperienceTenantScope) {
    return {
      storeId: tenant.storeId,
      country: tenant.country,
      language: tenant.language,
      currency: tenant.currency,
    };
  }

  private personalizationOf(consent: ConsentState): boolean {
    return isPurposeGranted(consent, 'personalization');
  }

  /**
   * FIX03: one verified context for all five capabilities. Validates the
   * scope, resolves the market currency from operator bindings (never
   * agent-supplied), verifies the session is active, and re-reads
   * effective consent from the database. `scope.personalizationGranted`
   * is never trusted — the server value always wins.
   */
  private async resolveCapabilityScope(rawScope: ExperienceCapabilityScope): Promise<{
    tenant: ExperienceTenantScope;
    session: VisitorSession;
    consent: ConsentState;
    personalizationGranted: boolean;
  }> {
    const scope = experienceCapabilityScopeSchema.parse(rawScope);
    const binding = this.bindings.find(
      (entry) =>
        entry.storeId === scope.storeId &&
        entry.country === scope.country &&
        entry.language === scope.language,
    );
    if (!binding || binding.currency !== scope.currency) throw new ForbiddenException('Capability market scope not configured');
    const tenant = await this.tenants.resolve(binding.host, crypto.randomUUID());
    const session = await this.sessionById(scope.storeId, scope.sessionId);
    const consent = await this.effectiveConsent({ storeId: scope.storeId }, session);
    return { tenant, session, consent, personalizationGranted: this.personalizationOf(consent) };
  }

  // -------------------------------------------------------------------------
  // EXP-01 — current experience context
  // -------------------------------------------------------------------------

  async getContext(tenant: ExperienceTenantScope, session: VisitorSession, consent: ConsentState): Promise<ExperienceContext> {
    const scope = this.scopeOf(tenant);
    const context = await loadExperienceContext(
      this.database.getPool(),
      scope,
      { sessionId: session.sessionId, status: session.status, customerId: session.customerId },
      consent,
    );
    if (
      !this.personalizationOf(consent) &&
      (context.intentSignals.length > 0 || context.recentlyViewed.length > 0)
    ) {
      return this.clearDerivedIfWithdrawn(tenant, session, consent);
    }
    // PostgreSQL remains authoritative; do not repopulate a cache across withdrawal.
    return context;
  }

  /** Durable clear of derived personalization state after withdrawal. */
  private async clearDerivedIfWithdrawn(
    tenant: ExperienceTenantScope,
    session: VisitorSession,
    consent: ConsentState,
  ): Promise<ExperienceContext> {
    const cleared = await withdrawPersonalization(
      this.database.getPool(),
      this.scopeOf(tenant),
      { sessionId: session.sessionId, status: session.status, customerId: session.customerId },
    );
    await this.contextCache.invalidate(tenant.storeId, session.sessionId);
    return experienceContextSchema.parse({ ...cleared, consent });
  }

  // -------------------------------------------------------------------------
  // EXP-02 — interaction ingestion (idempotent, ordered, CAS)
  // -------------------------------------------------------------------------

  async ingestEvents(
    tenant: ExperienceTenantScope,
    session: VisitorSession,
    consent: ConsentState,
    body: InteractionIngestRequest,
  ): Promise<InteractionIngestResult> {
    const personalization = this.personalizationOf(consent);
    let result: Awaited<ReturnType<typeof ingestInteractionEvents>>;
    try {
      result = await ingestInteractionEvents(
        this.database.getPool(),
        this.scopeOf(tenant),
        { sessionId: session.sessionId, status: session.status, customerId: session.customerId },
        body.events,
        {
          personalizationGranted: personalization,
          ...(body.expectedContextVersion !== undefined
            ? { expectedContextVersion: body.expectedContextVersion }
            : {}),
        },
      );
    } catch (error) {
      // CAS mismatch is a client-reload condition, not a server fault.
      if (error instanceof Error && error.message === 'CONTEXT_VERSION_CONFLICT') {
        throw AppError.conflict('Stale context version — reload and retry');
      }
      if (error instanceof Error && error.message === 'SESSION_NOT_ACTIVE') {
        throw new UnauthorizedException('Visitor session required');
      }
      throw error;
    }
    await this.contextCache.invalidate(tenant.storeId, session.sessionId);
    return {
      accepted: result.accepted,
      duplicates: result.duplicates,
      rejected: result.rejected,
      contextVersion: result.contextVersion,
      experienceRevision: result.experienceRevision,
    };
  }

  async resetExploration(
    tenant: ExperienceTenantScope,
    session: VisitorSession,
    consent: ConsentState,
  ): Promise<InteractionIngestResult> {
    const result = await resetExploration(
      this.database.getPool(),
      this.scopeOf(tenant),
      { sessionId: session.sessionId, status: session.status, customerId: session.customerId },
      { personalizationGranted: this.personalizationOf(consent) },
    );
    await this.contextCache.invalidate(tenant.storeId, session.sessionId);
    return {
      accepted: result.accepted,
      duplicates: result.duplicates,
      rejected: result.rejected,
      contextVersion: result.contextVersion,
      experienceRevision: result.experienceRevision,
    };
  }

  /** Consent withdrawal: clears derived personalization state durably. */
  async onPersonalizationWithdrawn(
    tenant: ExperienceTenantScope,
    session: VisitorSession,
  ): Promise<void> {
    await withdrawPersonalization(
      this.database.getPool(),
      this.scopeOf(tenant),
      { sessionId: session.sessionId, status: session.status, customerId: session.customerId },
    );
    await this.contextCache.invalidate(tenant.storeId, session.sessionId);
  }

  // -------------------------------------------------------------------------
  // Contextual search (Task 09/Tasks 12)
  // -------------------------------------------------------------------------

  async contextualSearch(
    tenant: ExperienceTenantScope,
    session: VisitorSession,
    consent: ConsentState,
    query: ParsedExperienceSearchQuery,
  ): Promise<SearchResult> {
    const context = await this.getContext(tenant, session, consent);
    const personalization = this.personalizationOf(consent);
    const request: SearchRequest = searchRequestSchema.parse({
      scope: { storeId: tenant.storeId, country: tenant.country, language: tenant.language },
      mode: query.mode,
      ...(query.q ? { q: query.q } : {}),
      limit: query.limit,
      constraints: {
        ...(query.available !== undefined ? { available: query.available } : {}),
        ...(query.currency ? { currency: query.currency } : {}),
        ...(query.priceMin ? { priceMin: query.priceMin } : {}),
        ...(query.priceMax ? { priceMax: query.priceMax } : {}),
        ...(query.collection ? { collection: query.collection } : {}),
        ...(query.productType ? { productType: query.productType } : {}),
        ...(query.vendor ? { vendor: query.vendor } : {}),
        ...(query.attribute ? { attributes: [query.attribute] } : {}),
      },
      // Consent-gated context signals (ranking only). Without personalization
      // consent only explicit current-request criteria participate.
      context: personalization
        ? {
            categories: context.intentSignals
              .filter((signal) => signal.kind === 'category_selected')
              .map((signal) => signal.subject),
            collections: context.intentSignals
              .filter((signal) => signal.kind === 'collection_viewed')
              .map((signal) => signal.subject),
            products: context.intentSignals
              .filter((signal) => signal.kind === 'product_viewed')
              .map((signal) => signal.subject),
          }
        : { categories: [], collections: [], products: [] },
    });
    if (query.mode === 'contextual') return this.searchPort.contextualSearch(request);
    if (query.mode === 'semantic') return this.searchPort.semanticSearch(request);
    if (query.mode === 'hybrid') return this.searchPort.hybridSearch(request);
    return this.searchPort.lexicalSearch(request);
  }

  /** Public bounded catalog search: tenant-only, no visitor identity or proxy target. */
  async storefrontSearch(tenant: ExperienceTenantScope, query: ParsedExperienceSearchQuery) {
    const scope = { storeId: tenant.storeId, country: tenant.country, language: tenant.language };
    const request = searchRequestSchema.parse({ scope, q: query.q, mode: query.mode, limit: query.limit,
      constraints: { available: query.available, currency: tenant.currency, priceMin: query.priceMin,
        priceMax: query.priceMax, collection: query.collection, productType: query.productType,
        vendor: query.vendor, attributes: query.attribute ? [query.attribute] : [] } });

    // FIX05: hybrid mode invokes the embedding provider. Gate it behind the
    // durable provider admission ledger so an unconfigured/unauthorized/
    // expired provider allocation fails closed instead of silently degrading.
    if (query.mode === 'hybrid') {
      // FL07-FIX: paid retrieval enforces distributed abuse limits (aggregate
      // store cap) and fails closed if enforcement is unavailable.
      await this.abuseLimit.enforce(tenant.storeId, 'public_retrieval', null);
      const embeddingIdentity = this.embedding.identity();
      if (!embeddingIdentity) {
        // No provider configured: hybrid degrades to the lexical channel
        // (honest DEGRADED_LEXICAL status, never a fake vector path).
        const lexical = await this.searchPort.lexicalSearch(request);
        return this.finalizeStorefront(lexical, scope);
      }
      const admission = await checkProviderAdmission(this.database.getPool(), {
        storeId: tenant.storeId,
        purpose: 'storefront_hybrid_search',
        provider: embeddingIdentity.provider,
        model: embeddingIdentity.model,
        scopeKey: `${tenant.storeId}:${tenant.country}:${tenant.language}`,
      });
      if (!admission.admitted) {
        // Fail closed: no admission allocation ⇒ hybrid is not permitted.
        throw AppError.forbidden(`PROVIDER_ADMISSION_DENIED: ${admission.reason}`);
      }
    }

    const result = query.mode === 'hybrid' ? await this.searchPort.hybridSearch(request) : await this.searchPort.lexicalSearch(request);
    return this.finalizeStorefront(result, scope);
  }

  private async finalizeStorefront(
    result: SearchResult,
    scope: { storeId: string; country: string; language: string },
  ) {
    const summaries = await resolveProductSummaries(this.database.getPool(), scope, result.items.map(item => item.productRef));
    return storefrontSearchResponseSchema.parse({ ...result,
      items: result.items.flatMap(item => { const summary = summaries.get(item.productRef); return summary ? [summary] : []; }), nextCursor: null });
  }

  // -------------------------------------------------------------------------
  // Deterministic recommendations (Task 09)
  // -------------------------------------------------------------------------

  async recommendations(
    tenant: ExperienceTenantScope,
    session: VisitorSession,
    consent: ConsentState,
    input: { limit: number; seedProductRef?: string | undefined },
  ): Promise<RecommendationResult> {
    const context = await this.getContext(tenant, session, consent);
    const personalization = this.personalizationOf(consent);
    const request: RecommendationRequest = {
      limit: input.limit,
      constraints: { available: true, attributes: context.exploration.attributes },
      criteria: {
        query: context.exploration.query,
        productType: context.exploration.productType,
        vendor: context.exploration.vendor,
        collection: context.exploration.collection,
        priceMin: context.exploration.priceMin,
        priceMax: context.exploration.priceMax,
        currency: context.exploration.currency ?? tenant.currency,
      },
      seedProductRef: input.seedProductRef ?? null,
      signals: personalization
        ? context.intentSignals.map((signal) => ({
            kind: signal.kind,
            subject: signal.subject,
            weight: signal.weight,
          }))
        : [],
      contextVersion: context.contextVersion,
    };
    const scope = { storeId: tenant.storeId, country: tenant.country, language: tenant.language };
    const result = await this.recommendationService.recommend(
      request,
      scope,
      { personalizationGranted: personalization },
    );
    // Durable run provenance (EXP-01 tables): published run + ordered items.
    // The composite FK to catalog_products stores only verified products.
    await recordRecommendationRun(
      this.database.getPool(),
      scope,
      { sessionId: context.session.sessionId },
      result,
      context.experienceRevision,
    );
    return result;
  }

  // -------------------------------------------------------------------------
  // Composition + revision-safe publishing (Tasks 10/11)
  // -------------------------------------------------------------------------

  async composition(
    tenant: ExperienceTenantScope,
    session: VisitorSession,
    consent: ConsentState,
    input: { comparisonRefs?: string[] | undefined; publish: boolean },
  ): Promise<AdaptiveComposition> {
    const context = await this.getContext(tenant, session, consent);
    const personalization = this.personalizationOf(consent);
    const proposal = await composeExperience(
      { pool: this.database.getPool(), recommendations: this.recommendationService },
      {
        scope: { storeId: tenant.storeId, country: tenant.country, language: tenant.language },
        context,
        personalizationGranted: personalization,
        ...(input.comparisonRefs && input.comparisonRefs.length >= 2
          ? { comparisonRefs: input.comparisonRefs }
          : {}),
      },
    );
    if (!input.publish) return proposal;

    // Re-validate the context version BEFORE publishing: a composition for
    // an obsolete contextVersion must never receive a new experienceRevision
    // (EXP-03 authoritative server-side effect protection).
    const published = await publishExperienceRevision(
      this.database.getPool(),
      this.scopeOf(tenant),
      session.sessionId,
      proposal.contextVersion,
    ).catch((error: unknown) => {
      if (error instanceof Error && error.message === 'SESSION_NOT_ACTIVE') throw AppError.conflict('Session is no longer active');
      throw error;
    });
    if (!published) throw AppError.conflict('Stale context version — refresh and retry');
    await this.contextCache.invalidate(tenant.storeId, session.sessionId);
    return adaptiveCompositionSchema.parse({
      ...proposal,
      experienceRevision: published.experienceRevision,
    });
  }

  /** Adaptation refresh: stale expectedContextVersion ⇒ explicit conflict. */
  async refresh(
    tenant: ExperienceTenantScope,
    session: VisitorSession,
    consent: ConsentState,
    input: { expectedContextVersion?: number | undefined; comparisonRefs?: string[] | undefined },
  ): Promise<AdaptiveComposition> {
    const context = await this.getContext(tenant, session, consent);
    if (
      input.expectedContextVersion !== undefined &&
      input.expectedContextVersion !== context.contextVersion
    ) {
      throw AppError.conflict('Stale context version — refresh and retry');
    }
    return this.composition(tenant, session, consent, {
      ...(input.comparisonRefs ? { comparisonRefs: input.comparisonRefs } : {}),
      publish: true,
    });
  }

  // -------------------------------------------------------------------------
  // Task 10 — bounded Hermes-facing capabilities (no agent runtime)
  // -------------------------------------------------------------------------

  async capabilities(tenant: TenantContext, token: string | undefined): Promise<ExperienceCapabilities> {
    // Only a verified request credential can establish authority. Scope is
    // captured here, not accepted from tool/agent input. Every invocation
    // still revalidates the active identity, market binding and live consent.
    const verified = await this.tenants.resolve(tenant.host, tenant.correlationId);
    const session = await this.requireSession(verified, token);
    const scope = experienceCapabilityScopeSchema.parse({
      storeId: verified.storeId, country: verified.country, language: verified.language,
      currency: verified.currency, sessionId: session.sessionId, personalizationGranted: false,
    });
    return this.buildCapabilitiesFromScope(scope);
  }

  /**
   * Server-internal capability binder for ToolBroker: binds to a server-verified
   * store + market + sessionId (resolved from PostgreSQL agent_runs, never from
   * agent arguments) without exposing visitor cookie tokens to Hermes. Every call
   * still re-verifies active store, active visitor_session, and live DB consent.
   */
  capabilitiesForServerVerifiedSession(raw: {
    storeId: string;
    country: string;
    language: string;
    currency: string;
    sessionId: string;
  }): ExperienceCapabilities {
    const scope = experienceCapabilityScopeSchema.parse({
      storeId: raw.storeId,
      country: raw.country,
      language: raw.language,
      currency: raw.currency,
      sessionId: raw.sessionId,
      personalizationGranted: false,
    });
    return this.buildCapabilitiesFromScope(scope);
  }

  async recordConversationMessageEvent(params: {
    storeId: string;
    country: string;
    language: string;
    currency: string;
    sessionId: string;
    conversationId: string;
    messageId: string;
  }): Promise<ExperienceContext> {
    const scope = experienceCapabilityScopeSchema.parse({
      storeId: params.storeId,
      country: params.country,
      language: params.language,
      currency: params.currency,
      sessionId: params.sessionId,
      personalizationGranted: false,
    });
    const { tenant, session, personalizationGranted } = await this.resolveCapabilityScope(scope);
    const result = await ingestInteractionEvents(
      this.database.getPool(),
      {
        storeId: tenant.storeId,
        country: tenant.country,
        language: tenant.language,
        currency: tenant.currency,
      },
      { sessionId: session.sessionId, status: session.status, customerId: session.customerId },
      [
        {
          eventId: crypto.randomUUID(),
          type: 'conversation_message',
          conversationId: params.conversationId,
          messageId: params.messageId,
        },
      ],
      { personalizationGranted },
    );
    await this.contextCache.invalidate(tenant.storeId, session.sessionId);
    return experienceContextSchema.parse(result.context);
  }

  async tryPublishCompositionProposal(params: {
    storeId: string;
    country: string;
    language: string;
    currency: string;
    sessionId: string;
    expectedContextVersion: number;
    composition: AdaptiveComposition;
  }): Promise<number | null> {
    const validated = adaptiveCompositionSchema.parse(params.composition);
    if (!withinCompositionLimits(validated)) {
      throw AppError.unprocessable('COMPOSITION_LIMITS_EXCEEDED');
    }
    if (
      validated.sessionId !== params.sessionId ||
      validated.contextVersion !== params.expectedContextVersion
    ) {
      return null;
    }
    const published = await publishExperienceRevision(
      this.database.getPool(),
      {
        storeId: params.storeId,
        country: params.country,
        language: params.language,
        currency: params.currency,
      },
      params.sessionId,
      params.expectedContextVersion,
    );
    if (published) {
      await this.contextCache.invalidate(params.storeId, params.sessionId);
      return published.experienceRevision;
    }
    return null;
  }

  private buildCapabilitiesFromScope(scope: ExperienceCapabilityScope): ExperienceCapabilities {
    return {
      searchCatalog: request => this.searchCatalog(request, scope),
      getExperienceContext: () => this.getExperienceContext(scope),
      getRecommendations: request => this.getRecommendations(request, scope),
      proposeExperienceComposition: input => this.proposeExperienceComposition(input, scope),
      updateExplicitCriteria: input => this.updateExplicitCriteria(input, scope),
    };
  }

  private async searchCatalog(request: SearchRequest, scope: ExperienceCapabilityScope): Promise<SearchResult> {
    const verified = await this.resolveCapabilityScope(scope);
    const context = await this.getContext(verified.tenant, verified.session, verified.consent);
    const parsed = searchRequestSchema.parse({
      ...request,
      scope: { storeId: verified.tenant.storeId, country: verified.tenant.country, language: verified.tenant.language },
      context: verified.personalizationGranted ? {
        categories: context.intentSignals.filter(s => s.kind === 'category_selected').map(s => s.subject).slice(0, 5),
        collections: context.intentSignals.filter(s => s.kind === 'collection_viewed').map(s => s.subject).slice(0, 5),
        products: context.intentSignals.filter(s => s.kind === 'product_viewed').map(s => s.subject).slice(0, 5),
      } : { categories: [], collections: [], products: [] },
    });
    const result = parsed.mode === 'semantic' ? await this.searchPort.semanticSearch(parsed)
      : parsed.mode === 'lexical' ? await this.searchPort.lexicalSearch(parsed)
      : parsed.mode === 'contextual' ? await this.searchPort.contextualSearch(parsed)
      : await this.searchPort.hybridSearch(parsed);
    return searchResultSchema.parse(result);
  }

  private async getExperienceContext(scope: ExperienceCapabilityScope): Promise<ExperienceContext> {
    const { tenant, session, consent } = await this.resolveCapabilityScope(scope);
    return experienceContextSchema.parse(await this.getContext(tenant, session, consent));
  }

  private async getRecommendations(request: RecommendationRequest, scope: ExperienceCapabilityScope): Promise<RecommendationResult> {
    const { tenant, session, consent, personalizationGranted } = await this.resolveCapabilityScope(scope);
    const context = await this.getContext(tenant, session, consent);
    const parsed = recommendationRequestSchema.parse({ ...request,
      signals: personalizationGranted ? context.intentSignals.map(({kind, subject, weight}) => ({kind, subject, weight})) : [],
      contextVersion: context.contextVersion,
    });
    return recommendationResultSchema.parse(await this.recommendationService.recommend(parsed,
      { storeId: tenant.storeId, country: tenant.country, language: tenant.language }, { personalizationGranted }));
  }

  private async proposeExperienceComposition(
    input: { reason?: string | undefined; limit?: number | undefined },
    scope: ExperienceCapabilityScope,
  ): Promise<AdaptiveComposition> {
    const { tenant, session, consent, personalizationGranted } = await this.resolveCapabilityScope(scope);
    const parsed = capabilityCompositionInputSchema.parse(input);
    const context = await this.getContext(tenant, session, consent);
    return adaptiveCompositionSchema.parse(await composeExperience(
      { pool: this.database.getPool(), recommendations: this.recommendationService },
      { scope: { storeId: tenant.storeId, country: tenant.country, language: tenant.language }, context,
        personalizationGranted, ...(parsed.reason ? { reason: parsed.reason } : {}) },
    ));
  }

  private async updateExplicitCriteria(
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
    scope: ExperienceCapabilityScope,
  ): Promise<ExperienceContext> {
    const { tenant, session, consent, personalizationGranted } = await this.resolveCapabilityScope(scope);
    const context = await this.getContext(tenant, session, consent);
    const parsed = capabilityCriteriaInputSchema.parse(input);
    const filters = {
      ...context.exploration,
      ...Object.fromEntries(
        Object.entries(parsed.criteria).map(([key, value]) => [key, value ?? null]),
      ),
    };
    const result = await ingestInteractionEvents(
      this.database.getPool(),
      { storeId: scope.storeId, country: scope.country, language: scope.language, currency: context.market.currency },
      { sessionId: session.sessionId, status: session.status, customerId: session.customerId },
      [{ eventId: crypto.randomUUID(), type: 'filter_changed', filters: explorationCriteriaSchema.parse(filters) }],
      { personalizationGranted, expectedContextVersion: context.contextVersion },
    );
    await this.contextCache.invalidate(scope.storeId, session.sessionId);
    return experienceContextSchema.parse(result.context);
  }
}
