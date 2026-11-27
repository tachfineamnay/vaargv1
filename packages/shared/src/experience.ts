import { z } from 'zod';
import { consentStateSchema } from './application.js';

/**
 * FL05 unified versioned visitor context (PRD EXP-01) and interaction event
 * contracts (EXP-02 step 1–2). PostgreSQL is durable authority; Valkey holds
 * derived active-session state only. Conversation and cart references are
 * typed extension points until those modules exist — never simulated here.
 * Nothing in this file imports frameworks.
 */

// ---------------------------------------------------------------------------
// Market + identity scope
// ---------------------------------------------------------------------------

export const experienceMarketSchema = z.strictObject({
  country: z.string().regex(/^[A-Z]{2}$/),
  language: z.string().regex(/^[A-Z]{2,3}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type ExperienceMarket = z.infer<typeof experienceMarketSchema>;

export const experienceStoreScopeSchema = z.strictObject({
  storeId: z.uuid(),
  market: experienceMarketSchema,
});
export type ExperienceStoreScope = z.infer<typeof experienceStoreScopeSchema>;

// ---------------------------------------------------------------------------
// Explicit preferences (never inferred; gift scope never becomes buyer scope)
// ---------------------------------------------------------------------------

export const preferenceSubjectSchema = z.enum(['buyer', 'gift_recipient']);
export type PreferenceSubject = z.infer<typeof preferenceSubjectSchema>;

export const explicitPreferenceSchema = z.strictObject({
  key: z.string().min(1).max(120),
  value: z.string().min(1).max(200),
  subject: preferenceSubjectSchema,
  updatedAt: z.iso.datetime(),
});
export type ExplicitPreference = z.infer<typeof explicitPreferenceSchema>;

// ---------------------------------------------------------------------------
// Exploration criteria (explicit current-request filters)
// ---------------------------------------------------------------------------

export const explorationCriteriaSchema = z.strictObject({
  query: z.string().max(200).nullable(),
  productType: z.string().max(200).nullable(),
  vendor: z.string().max(200).nullable(),
  collection: z.string().max(300).nullable(),
  priceMin: z.string().max(24).nullable(),
  priceMax: z.string().max(24).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  attributes: z
    .array(z.strictObject({ name: z.string().min(1).max(255), value: z.string().min(1).max(255) }))
    .max(10),
});
export type ExplorationCriteria = z.infer<typeof explorationCriteriaSchema>;

export const emptyExplorationCriteria = (): ExplorationCriteria => ({
  query: null,
  productType: null,
  vendor: null,
  collection: null,
  priceMin: null,
  priceMax: null,
  currency: null,
  attributes: [],
});

// ---------------------------------------------------------------------------
// Recently viewed + intent signals (bounded windows, consent-gated)
// ---------------------------------------------------------------------------

export const recentlyViewedProductSchema = z.strictObject({
  productRef: z.string().startsWith('gid://shopify/Product/'),
  viewedAt: z.iso.datetime(),
});
export type RecentlyViewedProduct = z.infer<typeof recentlyViewedProductSchema>;

export const intentSignalKindSchema = z.enum([
  'category_selected',
  'collection_viewed',
  'product_viewed',
  'search_submitted',
  'filter_changed',
  'comparison_changed',
]);
export type IntentSignalKind = z.infer<typeof intentSignalKindSchema>;

export const intentSignalSchema = z.strictObject({
  kind: intentSignalKindSchema,
  /** Subject reference: product gid, collection handle/gid or free text query. */
  subject: z.string().min(1).max(300),
  weight: z.number().min(0).max(1),
  observedAt: z.iso.datetime(),
  /** Inferred signals are optional personalization data; explicit criteria are not. */
  inferred: z.boolean(),
});
export type IntentSignal = z.infer<typeof intentSignalSchema>;

// ---------------------------------------------------------------------------
// Extension points (typed, inert until their modules exist)
// ---------------------------------------------------------------------------

export const conversationRefSchema = z.strictObject({
  conversationId: z.string().min(1).max(200),
});
export type ConversationRef = z.infer<typeof conversationRefSchema>;

export const cartRefSchema = z.strictObject({
  cartId: z.string().min(1).max(200),
});
export type CartRef = z.infer<typeof cartRefSchema>;

// ---------------------------------------------------------------------------
// Unified experience context (EXP-01)
// ---------------------------------------------------------------------------

export const experienceContextSchema = z.strictObject({
  /** Store scope — server-resolved, never client-authoritative. */
  store: experienceStoreScopeSchema,
  /** Visitor session (FL02 contract). */
  session: z.strictObject({
    sessionId: z.uuid(),
    status: z.enum(['active', 'expired', 'rotated', 'revoked']),
    customerId: z.uuid().nullable(),
  }),
  /** Verified customer identity — only when the session carries one. */
  customerId: z.uuid().nullable(),
  market: experienceMarketSchema,
  /** Effective consent projection at read time. */
  consent: consentStateSchema,
  /** Explicit preferences (buyer scope). Gift scope is separate. */
  preferences: z.array(explicitPreferenceSchema).max(100),
  /** Explicit current-request exploration criteria. */
  exploration: explorationCriteriaSchema,
  /** Bounded recent-history window (personalization consent required). */
  recentlyViewed: z.array(recentlyViewedProductSchema).max(20),
  /** Bounded intent signals (personalization consent required). */
  intentSignals: z.array(intentSignalSchema).max(50),
  /** Extension points — null until conversation/cart modules exist. */
  conversationRef: conversationRefSchema.nullable(),
  cartRef: cartRefSchema.nullable(),
  /** Brand/configuration revisions (server-owned). */
  brandRevision: z.string().max(64).nullable(),
  configurationRevision: z.string().max(64).nullable(),
  /** Monotonic event-state version (optimistic concurrency). */
  contextVersion: z.number().int().min(0),
  /** Published experience revision (composition/recommendation publishing). */
  experienceRevision: z.number().int().min(0),
});
export type ExperienceContext = z.infer<typeof experienceContextSchema>;

// ---------------------------------------------------------------------------
// Interaction events (validated ingestion envelope)
// ---------------------------------------------------------------------------

export const interactionEventIdSchema = z.uuid();

const eventBase = {
  eventId: interactionEventIdSchema,
  /** Server assigns ordering; clients may suggest occurredAt only. */
  occurredAt: z.iso.datetime().optional(),
};

export const interactionEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...eventBase, type: z.literal('category_selected'), category: z.string().min(1).max(300) }),
  z.strictObject({ ...eventBase, type: z.literal('collection_viewed'), collection: z.string().min(1).max(300) }),
  z.strictObject({
    ...eventBase,
    type: z.literal('product_viewed'),
    productRef: z.string().startsWith('gid://shopify/Product/'),
  }),
  z.strictObject({ ...eventBase, type: z.literal('search_submitted'), query: z.string().min(1).max(200) }),
  z.strictObject({
    ...eventBase,
    type: z.literal('filter_changed'),
    filters: explorationCriteriaSchema,
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('comparison_changed'),
    added: z.array(z.string().startsWith('gid://shopify/Product/')).max(4).default([]),
    removed: z.array(z.string().startsWith('gid://shopify/Product/')).max(4).default([]),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('explicit_preference_updated'),
    key: z.string().min(1).max(120),
    value: z.string().min(1).max(200),
    subject: preferenceSubjectSchema,
  }),
  z.strictObject({ ...eventBase, type: z.literal('exploration_reset') }),
  // Prepared internal inputs for later modules — validated, never simulated:
  z.strictObject({
    ...eventBase,
    type: z.literal('conversation_message'),
    conversationId: z.string().min(1).max(200),
    messageId: z.string().min(1).max(200),
  }),
  z.strictObject({
    ...eventBase,
    type: z.literal('cart_action_confirmed'),
    cartId: z.string().min(1).max(200),
    action: z.enum(['add', 'update', 'remove']),
    productRef: z.string().startsWith('gid://shopify/Product/').optional(),
  }),
]);
export type InteractionEvent = z.infer<typeof interactionEventSchema>;
export type InteractionEventType = InteractionEvent['type'];

/** Bounded ingestion envelope: unique ids, bounded batch. */
export const interactionIngestRequestSchema = z.strictObject({
  events: z.array(interactionEventSchema).min(1).max(20),
  /** Client's last known context version (optimistic concurrency). */
  expectedContextVersion: z.number().int().min(0).optional(),
});
export type InteractionIngestRequest = z.infer<typeof interactionIngestRequestSchema>;

export const interactionIngestResultSchema = z.strictObject({
  accepted: z.number().int().min(0),
  duplicates: z.number().int().min(0),
  rejected: z.number().int().min(0),
  contextVersion: z.number().int().min(0),
  experienceRevision: z.number().int().min(0),
});
export type InteractionIngestResult = z.infer<typeof interactionIngestResultSchema>;

// ---------------------------------------------------------------------------
// Experience HTTP DTOs (versioned /v1/experience contracts)
// ---------------------------------------------------------------------------

/** Query-string shape for contextual search (values arrive as strings). */
export const experienceSearchQuerySchema = z.strictObject({
  q: z.string().min(1).max(200).optional(),
  mode: z.enum(['lexical', 'semantic', 'hybrid', 'contextual']).default('contextual'),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  available: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  priceMin: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/).optional(),
  priceMax: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/).optional(),
  collection: z.string().min(1).max(300).optional(),
  productType: z.string().min(1).max(200).optional(),
  vendor: z.string().min(1).max(200).optional(),
  attribute: z.preprocess((raw) => {
    if (typeof raw !== 'string') return raw;
    const index = raw.indexOf(':');
    if (index <= 0) return raw;
    return { name: raw.slice(0, index), value: raw.slice(index + 1) };
  }, z.strictObject({ name: z.string().min(1).max(255), value: z.string().min(1).max(255) }).optional()),
}).refine(
  (value) =>
    (value.priceMin === undefined && value.priceMax === undefined) || value.currency !== undefined,
  { message: 'CURRENCY_REQUIRED' },
);
export type ExperienceSearchQuery = z.input<typeof experienceSearchQuerySchema>;
export type ParsedExperienceSearchQuery = z.output<typeof experienceSearchQuerySchema>;

export const experienceRecommendationsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(24).default(8),
  seed: z.string().startsWith('gid://shopify/Product/').max(300).optional(),
});
export type ExperienceRecommendationsQuery = z.infer<typeof experienceRecommendationsQuerySchema>;

export const experienceCompositionQuerySchema = z.strictObject({
  /** Optional comparison membership (verified refs, 2–4, comma separated). */
  compare: z.string().max(1300).optional(),
});
export type ExperienceCompositionQuery = z.infer<typeof experienceCompositionQuerySchema>;

export const experienceRefreshRequestSchema = z.strictObject({
  /** Client's last known context version — stale refreshes are rejected. */
  expectedContextVersion: z.number().int().min(0).optional(),
  compare: z.array(z.string().startsWith('gid://shopify/Product/')).max(4).optional(),
});
export type ExperienceRefreshRequest = z.infer<typeof experienceRefreshRequestSchema>;

export const experienceContextResponseSchema = z.strictObject({
  context: experienceContextSchema,
});
export type ExperienceContextResponse = z.infer<typeof experienceContextResponseSchema>;

// ---------------------------------------------------------------------------
// Stale-response rejection (EXP-03) — shared by server and browser
// ---------------------------------------------------------------------------

export interface RevisionEnvelope {
  sessionId: string;
  contextVersion: number;
  experienceRevision: number;
}

/**
 * A response generated for an obsolete contextVersion, an older
 * experienceRevision, or a different session must never be applied.
 * Deterministic and side-effect free — the browser uses the exact same rule.
 */
export function isStaleResponse(
  current: RevisionEnvelope | null,
  incoming: RevisionEnvelope,
): boolean {
  if (!current) return false;
  if (current.sessionId !== incoming.sessionId) return true;
  if (incoming.contextVersion < current.contextVersion) return true;
  if (
    incoming.contextVersion === current.contextVersion &&
    incoming.experienceRevision < current.experienceRevision
  ) {
    return true;
  }
  return false;
}
