import {
  emptyExplorationCriteria,
  type ExplicitPreference,
  type ExperienceContext,
  type ExplorationCriteria,
  type IntentSignal,
  type InteractionEvent,
} from './experience.js';

/**
 * FL05 shared deterministic context reducer (PRD EXP-02 step 2). Pure
 * functions over validated events: same state + same ordered events always
 * produce the same result. Rules enforced here:
 *  - unique event IDs and idempotent ingestion (caller tracks seen ids);
 *  - server-assigned ordering (events arrive pre-ordered by the ingest path);
 *  - explicit preferences always take precedence over inferred signals;
 *  - a single click/exposure/gift exploration NEVER becomes a permanent
 *    personal preference — inferred signals stay in bounded, expiring windows;
 *  - gift-recipient preferences are stored under their own subject scope;
 *  - without personalization consent only explicit current-request criteria
 *    are tracked: no optional persistent behavioral profile is built;
 *  - withdrawal (personalization revoked) clears derived personalization state;
 *  - bounded recent-history windows throughout.
 */

export const MAX_RECENT_VIEWED = 20;
export const MAX_INTENT_SIGNALS = 50;
export const MAX_PREFERENCES = 100;
export const MAX_COMPARISON_IDS = 4;

/** Weight assigned to each inferred signal kind (configurable, bounded). */
export const DEFAULT_SIGNAL_WEIGHTS: Readonly<Record<IntentSignal['kind'], number>> = Object.freeze({
  category_selected: 0.6,
  collection_viewed: 0.5,
  product_viewed: 0.7,
  search_submitted: 0.8,
  filter_changed: 0.4,
  comparison_changed: 0.9,
});

export interface ReducerOptions {
  /** Effective personalization consent at reduction time. */
  personalizationGranted: boolean;
  /** Injectable clock for determinism in tests. */
  now?: Date;
  signalWeights?: Partial<Record<IntentSignal['kind'], number>>;
}

export interface ReduceResult {
  context: ExperienceContext;
  /** True when the event changed state (false for duplicates/no-ops). */
  applied: boolean;
}

function isoNow(now: Date | undefined): string {
  return (now ?? new Date()).toISOString();
}

function clampWindow<T>(items: T[], max: number): T[] {
  return items.length > max ? items.slice(items.length - max) : items;
}

/** Replace or insert an explicit preference (subject-scoped, bounded). */
export function applyExplicitPreference(
  preferences: ExplicitPreference[],
  preference: ExplicitPreference,
): ExplicitPreference[] {
  const next = preferences.filter(
    (entry) => !(entry.key === preference.key && entry.subject === preference.subject),
  );
  next.push(preference);
  if (next.length > MAX_PREFERENCES) {
    // Deterministic eviction: oldest updatedAt first, buyer scope never
    // evicted by gift-scope entries.
    next.sort((a, b) =>
      a.subject === b.subject
        ? a.updatedAt.localeCompare(b.updatedAt)
        : a.subject === 'buyer'
          ? -1
          : b.subject === 'buyer'
            ? 1
            : a.updatedAt.localeCompare(b.updatedAt),
    );
    return next.slice(next.length - MAX_PREFERENCES);
  }
  return next;
}

/** Merge an inferred signal: newest first, deduped by kind+subject, bounded. */
function pushIntentSignal(
  signals: IntentSignal[],
  signal: IntentSignal,
  max: number,
): IntentSignal[] {
  const next = signals.filter(
    (entry) => !(entry.kind === signal.kind && entry.subject === signal.subject),
  );
  next.unshift(signal);
  return clampWindow(next, max);
}

function withRevisionBump(context: ExperienceContext): ExperienceContext {
  return { ...context, contextVersion: context.contextVersion + 1 };
}

/**
 * Apply one validated event. The caller is responsible for idempotency on
 * eventId (durable unique key) and for ordered delivery; this reducer still
 * treats an already-seen eventId as a no-op when the caller passes
 * `duplicate`.
 */
export function reduceEvent(
  context: ExperienceContext,
  event: InteractionEvent,
  options: ReducerOptions & { duplicate?: boolean },
): ReduceResult {
  if (options.duplicate) return { context, applied: false };
  const at = event.occurredAt ?? isoNow(options.now);
  const weights = { ...DEFAULT_SIGNAL_WEIGHTS, ...options.signalWeights };
  const personal = options.personalizationGranted;

  switch (event.type) {
    case 'category_selected': {
      const exploration: ExplorationCriteria = { ...context.exploration };
      // Category selection narrows the current request; it is explicit.
      const next: ExperienceContext = {
        ...context,
        exploration: { ...exploration, collection: event.category },
        intentSignals: personal
          ? pushIntentSignal(
              context.intentSignals,
              {
                kind: 'category_selected',
                subject: event.category,
                weight: weights.category_selected,
                observedAt: at,
                inferred: true,
              },
              MAX_INTENT_SIGNALS,
            )
          : context.intentSignals,
      };
      return { context: withRevisionBump(next), applied: true };
    }
    case 'collection_viewed': {
      const next: ExperienceContext = {
        ...context,
        exploration: { ...context.exploration, collection: event.collection },
        intentSignals: personal
          ? pushIntentSignal(
              context.intentSignals,
              {
                kind: 'collection_viewed',
                subject: event.collection,
                weight: weights.collection_viewed,
                observedAt: at,
                inferred: true,
              },
              MAX_INTENT_SIGNALS,
            )
          : context.intentSignals,
      };
      return { context: withRevisionBump(next), applied: true };
    }
    case 'product_viewed': {
      // FIX08: without personalization consent this is purely optional
      // behavioral data — a no-op (no version bump, no state change).
      if (!personal) return { context, applied: false };
      const recentlyViewed = clampWindow(
        [
          { productRef: event.productRef, viewedAt: at },
          ...context.recentlyViewed.filter((entry) => entry.productRef !== event.productRef),
        ],
        MAX_RECENT_VIEWED,
      );
      const next: ExperienceContext = {
        ...context,
        recentlyViewed,
        intentSignals: pushIntentSignal(
          context.intentSignals,
          {
            kind: 'product_viewed',
            subject: event.productRef,
            weight: weights.product_viewed,
            observedAt: at,
            inferred: true,
          },
          MAX_INTENT_SIGNALS,
        ),
      };
      return { context: withRevisionBump(next), applied: true };
    }
    case 'search_submitted': {
      const next: ExperienceContext = {
        ...context,
        exploration: {
          ...emptyExplorationCriteria(),
          currency: context.exploration.currency,
          query: event.query,
        },
        intentSignals: personal
          ? pushIntentSignal(
              context.intentSignals,
              {
                kind: 'search_submitted',
                subject: event.query,
                weight: weights.search_submitted,
                observedAt: at,
                inferred: true,
              },
              MAX_INTENT_SIGNALS,
            )
          : context.intentSignals,
      };
      return { context: withRevisionBump(next), applied: true };
    }
    case 'filter_changed': {
      // Explicit current-request filters — allowed with or without consent.
      const next: ExperienceContext = {
        ...context,
        exploration: { ...event.filters },
        intentSignals: personal
          ? pushIntentSignal(
              context.intentSignals,
              {
                kind: 'filter_changed',
                subject: JSON.stringify(event.filters).slice(0, 300),
                weight: weights.filter_changed,
                observedAt: at,
                inferred: true,
              },
              MAX_INTENT_SIGNALS,
            )
          : context.intentSignals,
      };
      return { context: withRevisionBump(next), applied: true };
    }
    case 'comparison_changed': {
      // Comparison membership lives in the cart/compare UI; here it only
      // feeds a bounded inferred signal when consent permits. Without
      // consent it is a no-op (FIX08: no version bump for optional data).
      if (!personal) return { context, applied: false };
      const next: ExperienceContext = {
        ...context,
        intentSignals: pushIntentSignal(
          context.intentSignals,
          {
            kind: 'comparison_changed',
            subject: [...event.added, ...event.removed].join(',').slice(0, 300) || 'empty',
            weight: weights.comparison_changed,
            observedAt: at,
            inferred: true,
          },
          MAX_INTENT_SIGNALS,
        ),
      };
      return { context: withRevisionBump(next), applied: true };
    }
    case 'explicit_preference_updated': {
      // Explicit user action: recorded regardless of personalization consent
      // (it is a direct request, not an inferred profile). Gift scope never
      // merges into buyer scope.
      const preference: ExplicitPreference = {
        key: event.key,
        value: event.value,
        subject: event.subject,
        updatedAt: at,
      };
      const next: ExperienceContext = {
        ...context,
        preferences: applyExplicitPreference(context.preferences, preference),
      };
      return { context: withRevisionBump(next), applied: true };
    }
    case 'exploration_reset': {
      const next: ExperienceContext = {
        ...context,
        exploration: { ...emptyExplorationCriteria(), currency: context.exploration.currency },
        intentSignals: personal ? [] : context.intentSignals,
        recentlyViewed: personal ? [] : context.recentlyViewed,
        conversationRef: null,
      };
      return { context: withRevisionBump(next), applied: true };
    }
    case 'conversation_message': {
      const next: ExperienceContext = {
        ...context,
        conversationRef: { conversationId: event.conversationId },
      };
      return { context: withRevisionBump(next), applied: true };
    }
    case 'cart_action_confirmed': {
      const next: ExperienceContext = {
        ...context,
        cartRef: { cartId: event.cartId },
      };
      return { context: withRevisionBump(next), applied: true };
    }
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/**
 * Reduce an ordered batch of events with per-batch idempotency. Returns the
 * final context plus counts for the ingest response.
 */
export function reduceEvents(
  context: ExperienceContext,
  events: ReadonlyArray<InteractionEvent>,
  options: ReducerOptions & { seenEventIds?: ReadonlySet<string> },
): ReduceResult & { accepted: number; duplicates: number } {
  const seen = new Set(options.seenEventIds ?? []);
  let current = context;
  let accepted = 0;
  let duplicates = 0;
  for (const event of events) {
    const duplicate = seen.has(event.eventId);
    if (duplicate) {
      duplicates += 1;
      continue;
    }
    const result = reduceEvent(current, event, { ...options, duplicate: false });
    if (result.applied) {
      current = result.context;
      accepted += 1;
    }
    seen.add(event.eventId);
  }
  return { context: current, applied: accepted > 0, accepted, duplicates };
}

/**
 * Apply a consent withdrawal: stop optional processing and clear or
 * invalidate derived personalization state. Explicit criteria and explicit
 * preferences are preserved (they are direct user inputs), but inferred
 * signals, recent history and conversation state are cleared.
 */
export function applyConsentWithdrawal(context: ExperienceContext): ExperienceContext {
  return {
    ...context,
    intentSignals: [],
    recentlyViewed: [],
    conversationRef: null,
    contextVersion: context.contextVersion + 1,
  };
}

/**
 * Resolution of ranking signals for the recommendation engine: explicit
 * criteria always come first; inferred signals only when consent permits.
 * Returns subjects in deterministic order (weight DESC, subject ASC).
 */
export function resolveRankingSignals(
  context: ExperienceContext,
  personalizationGranted: boolean,
): { explicit: ExplorationCriteria; inferred: IntentSignal[] } {
  return {
    explicit: { ...context.exploration },
    inferred: personalizationGranted
      ? [...context.intentSignals].sort(
          (a, b) => b.weight - a.weight || (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0),
        )
      : [],
  };
}
