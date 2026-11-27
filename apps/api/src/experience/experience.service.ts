import { BadRequestException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
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
  experienceContextSchema,
  isPurposeGranted,
  searchRequestSchema,
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
  withdrawPersonalization,
} from '@vaarg/persistence';
import { DatabaseClient } from '../infra/database-client.js';
import { ValkeyClient } from '../infra/valkey-client.js';
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
@Injectable()
export class ExperienceService implements ExperienceCapabilities {
  private readonly searchPort: SearchPort;
  private readonly recommendationService: ReturnType<typeof createRecommendationService>;
  private readonly embedding: EmbeddingPort;
  private readonly contextCache: ExperienceContextCache;

  constructor(
    @Inject(DatabaseClient) private readonly database: DatabaseClient,
    @Inject(ValkeyClient) private readonly valkey: ValkeyClient,
    @Inject(VisitorSessionService) private readonly sessions: VisitorSessionService,
    @Inject(ConsentService) private readonly consents: ConsentService,
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
    const result = await this.database.getPool().query<{
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
    );
    const row = result.rows[0];
    if (!row) throw new UnauthorizedException('Capability session not active');
    return {
      sessionId: row.session_id,
      storeId: row.store_id,
      customerId: row.customer_id,
      status: row.status,
      context: row.context as VisitorSession['context'],
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
    };
  }

  private scopeOf(tenant: TenantContext) {
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

  // -------------------------------------------------------------------------
  // EXP-01 — current experience context
  // -------------------------------------------------------------------------

  async getContext(tenant: TenantContext, session: VisitorSession, consent: ConsentState): Promise<ExperienceContext> {
    const scope = this.scopeOf(tenant);
    const cached = await this.contextCache.get(tenant.storeId, session.sessionId);
    if (cached && cached.contextVersion >= 0) {
      // Derived state must still reflect the live session binding.
      if (cached.session.sessionId === session.sessionId) {
        const revived = experienceContextSchema.parse({ ...cached, consent });
        // Withdrawal enforcement on read: without personalization consent,
        // lingering derived personalization state is cleared durably.
        if (
          !this.personalizationOf(consent) &&
          (revived.intentSignals.length > 0 || revived.recentlyViewed.length > 0)
        ) {
          return this.clearDerivedIfWithdrawn(tenant, session, consent);
        }
        return revived;
      }
      await this.contextCache.invalidate(tenant.storeId, session.sessionId);
    }
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
    await this.contextCache.set(tenant.storeId, session.sessionId, context, 300);
    return context;
  }

  /** Durable clear of derived personalization state after withdrawal. */
  private async clearDerivedIfWithdrawn(
    tenant: TenantContext,
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
    tenant: TenantContext,
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
    tenant: TenantContext,
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
    tenant: TenantContext,
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
    tenant: TenantContext,
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

  // -------------------------------------------------------------------------
  // Deterministic recommendations (Task 09)
  // -------------------------------------------------------------------------

  async recommendations(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
    input: { limit: number; seedProductRef?: string | undefined },
  ): Promise<RecommendationResult> {
    const context = await this.getContext(tenant, session, consent);
    const personalization = this.personalizationOf(consent);
    const request: RecommendationRequest = {
      limit: input.limit,
      constraints: { available: true },
      criteria: {
        query: context.exploration.query,
        productType: context.exploration.productType,
        vendor: context.exploration.vendor,
        collection: context.exploration.collection,
        priceMin: context.exploration.priceMin,
        priceMax: context.exploration.priceMax,
        currency: context.exploration.currency,
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
    tenant: TenantContext,
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
    );
    if (!published) throw new BadRequestException('Stale context version — refresh and retry');
    await this.contextCache.invalidate(tenant.storeId, session.sessionId);
    return adaptiveCompositionSchema.parse({
      ...proposal,
      experienceRevision: published.experienceRevision,
    });
  }

  /** Adaptation refresh: stale expectedContextVersion ⇒ explicit conflict. */
  async refresh(
    tenant: TenantContext,
    session: VisitorSession,
    consent: ConsentState,
    input: { expectedContextVersion?: number | undefined; comparisonRefs?: string[] | undefined },
  ): Promise<AdaptiveComposition> {
    const context = await this.getContext(tenant, session, consent);
    if (
      input.expectedContextVersion !== undefined &&
      input.expectedContextVersion !== context.contextVersion
    ) {
      throw new BadRequestException('Stale context version — refresh and retry');
    }
    return this.composition(tenant, session, consent, {
      ...(input.comparisonRefs ? { comparisonRefs: input.comparisonRefs } : {}),
      publish: true,
    });
  }

  // -------------------------------------------------------------------------
  // Task 10 — bounded Hermes-facing capabilities (no agent runtime)
  // -------------------------------------------------------------------------

  capabilities(): ExperienceCapabilities {
    return this;
  }

  async searchCatalog(
    request: SearchRequest,
    scope: ExperienceCapabilityScope,
  ): Promise<SearchResult> {
    const parsed = searchRequestSchema.parse({
      ...request,
      // Store scope is re-stamped from the server-resolved capability scope;
      // callers can never point the tool at another store.
      scope: { storeId: scope.storeId, country: scope.country, language: scope.language },
    });
    if (parsed.mode === 'semantic') return this.searchPort.semanticSearch(parsed);
    if (parsed.mode === 'lexical') return this.searchPort.lexicalSearch(parsed);
    if (parsed.mode === 'contextual') return this.searchPort.contextualSearch(parsed);
    return this.searchPort.hybridSearch(parsed);
  }

  async getExperienceContext(scope: ExperienceCapabilityScope): Promise<ExperienceContext> {
    const session = await this.sessionById(scope.storeId, scope.sessionId);
    const consent = await this.effectiveConsent({ storeId: scope.storeId }, session);
    return this.getContext(
      {
        storeId: scope.storeId,
        country: scope.country,
        language: scope.language,
        currency: '',
      } as TenantContext,
      session,
      consent,
    );
  }

  async getRecommendations(
    request: RecommendationRequest,
    scope: ExperienceCapabilityScope,
  ): Promise<RecommendationResult> {
    const context = await this.getExperienceContext(scope);
    const parsed: RecommendationRequest = {
      ...request,
      signals: scope.personalizationGranted ? request.signals : [],
      contextVersion: context.contextVersion,
    };
    return this.recommendationService.recommend(
      parsed,
      { storeId: scope.storeId, country: scope.country, language: scope.language },
      { personalizationGranted: scope.personalizationGranted },
    );
  }

  async proposeExperienceComposition(
    input: { reason?: string | undefined; limit?: number | undefined },
    scope: ExperienceCapabilityScope,
  ): Promise<AdaptiveComposition> {
    const context = await this.getExperienceContext(scope);
    const proposal = await composeExperience(
      { pool: this.database.getPool(), recommendations: this.recommendationService },
      {
        scope: { storeId: scope.storeId, country: scope.country, language: scope.language },
        context,
        personalizationGranted: scope.personalizationGranted,
        ...(input.reason ? { reason: input.reason as never } : {}),
      },
    );
    // Proposals are NOT published: no experienceRevision bump, so they can
    // never overwrite a newer experience (the caller validates before use).
    return proposal;
  }

  async updateExplicitCriteria(
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
    const session = await this.sessionById(scope.storeId, scope.sessionId);
    const consent = await this.effectiveConsent({ storeId: scope.storeId }, session);
    const context = await this.getContext(
      {
        storeId: scope.storeId,
        country: scope.country,
        language: scope.language,
        currency: '',
      } as TenantContext,
      session,
      consent,
    );
    const filters = {
      ...context.exploration,
      ...Object.fromEntries(
        Object.entries(input.criteria).map(([key, value]) => [key, value ?? null]),
      ),
    };
    const result = await ingestInteractionEvents(
      this.database.getPool(),
      { storeId: scope.storeId, country: scope.country, language: scope.language, currency: context.market.currency },
      { sessionId: session.sessionId, status: session.status, customerId: session.customerId },
      [{ eventId: crypto.randomUUID(), type: 'filter_changed', filters: filters as never }],
      { personalizationGranted: scope.personalizationGranted },
    );
    await this.contextCache.invalidate(scope.storeId, session.sessionId);
    return result.context;
  }
}
