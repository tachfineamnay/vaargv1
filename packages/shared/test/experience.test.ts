import { describe, expect, it } from 'vitest';
import {
  adaptiveCompositionSchema,
  applyConsentWithdrawal,
  emptyConsentState,
  emptyExplorationCriteria,
  experienceContextSchema,
  experienceRefreshRequestSchema,
  experienceSearchQuerySchema,
  interactionIngestRequestSchema,
  isStaleResponse,
  reciprocalRankFusion,
  reduceEvents,
  reduceEvent,
  resolveRankingSignals,
  type ExperienceContext,
  type InteractionEvent,
} from '../src/index.js';

const storeId = '00000000-0000-4000-8000-000000000001';
const sessionId = '00000000-0000-4000-8000-0000000000f1';

function baseContext(): ExperienceContext {
  return experienceContextSchema.parse({
    store: { storeId, market: { country: 'FR', language: 'FR', currency: 'EUR' } },
    session: { sessionId, status: 'active', customerId: null },
    customerId: null,
    market: { country: 'FR', language: 'FR', currency: 'EUR' },
    consent: emptyConsentState(),
    preferences: [],
    exploration: emptyExplorationCriteria(),
    recentlyViewed: [],
    intentSignals: [],
    conversationRef: null,
    cartRef: null,
    brandRevision: null,
    configurationRevision: null,
    contextVersion: 0,
    experienceRevision: 0,
  });
}

function event<T extends InteractionEvent['type']>(
  type: T,
  extra: Record<string, unknown>,
  id = crypto.randomUUID(),
): InteractionEvent {
  return { eventId: id, type, ...extra } as InteractionEvent;
}

const at = '2026-11-27T10:00:00.000Z';

describe('FL05 deterministic context reducer (EXP-02)', () => {
  it('applies all eight storefront event types with contextVersion bumps', () => {
    let context = baseContext();
    const events: InteractionEvent[] = [
      event('category_selected', { category: 'rings', occurredAt: at }),
      event('collection_viewed', { collection: 'new-arrivals', occurredAt: at }),
      event('product_viewed', { productRef: 'gid://shopify/Product/1', occurredAt: at }),
      event('search_submitted', { query: 'silver ring', occurredAt: at }),
      event('filter_changed', {
        filters: { ...emptyExplorationCriteria(), productType: 'Rings' },
        occurredAt: at,
      }),
      event('comparison_changed', { added: ['gid://shopify/Product/1'], removed: [], occurredAt: at }),
      event('explicit_preference_updated', {
        key: 'style',
        value: 'minimal',
        subject: 'buyer',
        occurredAt: at,
      }),
      event('exploration_reset', {}, at),
    ];
    const seen = new Set<string>();
    for (const one of events) {
      const result = reduceEvent(context, one, { personalizationGranted: true, now: new Date(at) });
      expect(result.applied).toBe(true);
      expect(result.context.contextVersion).toBe(context.contextVersion + 1);
      context = result.context;
      seen.add(one.eventId);
    }
    // Reset cleared exploration but kept the explicit preference.
    expect(context.exploration.query).toBeNull();
    expect(context.preferences).toHaveLength(1);
    expect(context.preferences[0]?.key).toBe('style');
    expect(seen.size).toBe(8);
  });

  it('is idempotent: a seen eventId never mutates state twice', () => {
    const id = crypto.randomUUID();
    const first = reduceEvent(baseContext(), event('product_viewed', { productRef: 'gid://shopify/Product/9', occurredAt: at }, id), {
      personalizationGranted: true,
      now: new Date(at),
    });
    expect(first.applied).toBe(true);
    const duplicate = reduceEvent(first.context, event('product_viewed', { productRef: 'gid://shopify/Product/9', occurredAt: at }, id), {
      personalizationGranted: true,
      now: new Date(at),
      duplicate: true,
    });
    expect(duplicate.applied).toBe(false);
    expect(duplicate.context.contextVersion).toBe(first.context.contextVersion);

    // Batch path: seen ids are reported as duplicates, not re-applied.
    const batch = reduceEvents(first.context, [event('product_viewed', { productRef: 'gid://shopify/Product/9' }, id)], {
      personalizationGranted: true,
      now: new Date(at),
      seenEventIds: new Set([id]),
    });
    expect(batch.accepted).toBe(0);
    expect(batch.duplicates).toBe(1);
  });

  it('separates consent: without personalization only explicit criteria are tracked', () => {
    const noConsent = reduceEvents(
      baseContext(),
      [
        event('product_viewed', { productRef: 'gid://shopify/Product/1', occurredAt: at }),
        event('search_submitted', { query: 'earrings', occurredAt: at }),
        event('explicit_preference_updated', { key: 'size', value: 'M', subject: 'buyer', occurredAt: at }),
      ],
      { personalizationGranted: false, now: new Date(at) },
    );
    expect(noConsent.context.recentlyViewed).toHaveLength(0);
    expect(noConsent.context.intentSignals).toHaveLength(0);
    // Explicit current-request state and explicit preferences still apply.
    expect(noConsent.context.exploration.query).toBe('earrings');
    expect(noConsent.context.preferences).toHaveLength(1);

    const withConsent = reduceEvents(
      baseContext(),
      [
        event('product_viewed', { productRef: 'gid://shopify/Product/1', occurredAt: at }),
        event('search_submitted', { query: 'earrings', occurredAt: at }),
      ],
      { personalizationGranted: true, now: new Date(at) },
    );
    expect(withConsent.context.recentlyViewed).toHaveLength(1);
    expect(withConsent.context.intentSignals.length).toBeGreaterThan(0);
  });

  it('explicit preferences win over inferred signals and gift scope stays separate', () => {
    let context = baseContext();
    context = reduceEvent(
      context,
      event('explicit_preference_updated', { key: 'style', value: 'classic', subject: 'buyer', occurredAt: at }),
      { personalizationGranted: true, now: new Date(at) },
    ).context;
    context = reduceEvent(
      context,
      event('explicit_preference_updated', { key: 'style', value: 'gift-wrap', subject: 'gift_recipient', occurredAt: at }),
      { personalizationGranted: true, now: new Date(at) },
    ).context;
    expect(context.preferences).toHaveLength(2);
    const buyer = context.preferences.filter((entry) => entry.subject === 'buyer');
    expect(buyer).toHaveLength(1);
    expect(buyer[0]?.value).toBe('classic');
    // Ranking resolution keeps explicit criteria separate from inferred signals.
    const resolved = resolveRankingSignals(context, true);
    expect(resolved.explicit).toEqual(context.exploration);
    const consentless = resolveRankingSignals(context, false);
    expect(consentless.inferred).toEqual([]);
  });

  it('withdrawal clears derived personalization but keeps explicit inputs', () => {
    let context = reduceEvent(
      baseContext(),
      event('product_viewed', { productRef: 'gid://shopify/Product/1', occurredAt: at }),
      { personalizationGranted: true, now: new Date(at) },
    ).context;
    context = reduceEvent(
      context,
      event('explicit_preference_updated', { key: 'style', value: 'minimal', subject: 'buyer', occurredAt: at }),
      { personalizationGranted: true, now: new Date(at) },
    ).context;
    const cleared = applyConsentWithdrawal(context);
    expect(cleared.recentlyViewed).toHaveLength(0);
    expect(cleared.intentSignals).toHaveLength(0);
    expect(cleared.preferences).toHaveLength(1);
    expect(cleared.contextVersion).toBe(context.contextVersion + 1);
  });

  it('is deterministic: same state + same ordered events = same result', () => {
    const events = [
      event('search_submitted', { query: 'ring', occurredAt: at }),
      event('filter_changed', { filters: { ...emptyExplorationCriteria(), vendor: 'VAARG' }, occurredAt: at }),
      event('comparison_changed', { added: ['gid://shopify/Product/2'], removed: [], occurredAt: at }),
    ];
    const a = reduceEvents(baseContext(), events, { personalizationGranted: true, now: new Date(at) });
    const b = reduceEvents(baseContext(), events, { personalizationGranted: true, now: new Date(at) });
    expect(a.context).toEqual(b.context);
  });
});

describe('FL05 stale-response rule (EXP-03, shared server+browser)', () => {
  const current = { sessionId, contextVersion: 5, experienceRevision: 2 };
  it('accepts newer or equal-fresh envelopes from the same session', () => {
    expect(isStaleResponse(current, { sessionId, contextVersion: 6, experienceRevision: 0 })).toBe(false);
    expect(isStaleResponse(current, { sessionId, contextVersion: 5, experienceRevision: 2 })).toBe(false);
    expect(isStaleResponse(current, { sessionId, contextVersion: 5, experienceRevision: 3 })).toBe(false);
    expect(isStaleResponse(null, { sessionId, contextVersion: 0, experienceRevision: 0 })).toBe(false);
  });
  it('rejects older versions, older revisions and foreign sessions', () => {
    expect(isStaleResponse(current, { sessionId, contextVersion: 4, experienceRevision: 9 })).toBe(true);
    expect(isStaleResponse(current, { sessionId, contextVersion: 5, experienceRevision: 1 })).toBe(true);
    expect(isStaleResponse(current, { sessionId: '00000000-0000-4000-8000-0000000000f2', contextVersion: 9, experienceRevision: 9 })).toBe(true);
  });
});

describe('FL05 reciprocal rank fusion (RRF k=60)', () => {
  it('fuses deterministically with dedupe and productRef tie-break', () => {
    const a = ['p1', 'p2', 'p3'];
    const b = ['p3', 'p1'];
    const first = reciprocalRankFusion([a, b]);
    const second = reciprocalRankFusion([a, b]);
    expect(first).toEqual(second);
    expect(first.map((entry) => entry.productRef)).toEqual(['p1', 'p3', 'p2']);
    // Duplicate refs inside one list count once (dedupe).
    const deduped = reciprocalRankFusion([['p1', 'p1', 'p2']]);
    expect(deduped).toHaveLength(2);
    // Ties break by productRef ascending.
    const tied = reciprocalRankFusion([['p2'], ['p1']]);
    expect(tied[0]?.productRef).toBe('p1');
    expect(tied[1]?.productRef).toBe('p2');
  });
  it('is configurable and validates k', () => {
    expect(() => reciprocalRankFusion([['p1']], { k: 0 })).toThrow('INVALID_RRF_K');
    const custom = reciprocalRankFusion([['p1']], { k: 1 });
    expect(custom[0]?.score).toBeCloseTo(1 / 2, 10);
  });
});

describe('FL05 versioned experience DTOs (strict contracts)', () => {
  it('experience search query: defaults, coercion and unknown-field rejection', () => {
    const parsed = experienceSearchQuerySchema.parse({ q: 'ring', limit: '10', available: 'true' });
    expect(parsed.mode).toBe('contextual');
    expect(parsed.limit).toBe(10);
    expect(parsed.available).toBe(true);
    expect(experienceSearchQuerySchema.safeParse({ q: 'ring', evil: 1 }).success).toBe(false);
    expect(experienceSearchQuerySchema.safeParse({ priceMin: '10' }).success).toBe(false); // currency required
    expect(experienceSearchQuerySchema.safeParse({ priceMin: '10', currency: 'EUR' }).success).toBe(true);
    expect(experienceSearchQuerySchema.safeParse({ attribute: 'Size:L' }).success).toBe(true);
  });

  it('interaction ingest envelope: bounded batch, unique ids required by caller', () => {
    const single = { events: [event('exploration_reset', {})] };
    expect(interactionIngestRequestSchema.safeParse(single).success).toBe(true);
    const tooMany = { events: Array.from({ length: 21 }, () => event('exploration_reset', {})) };
    expect(interactionIngestRequestSchema.safeParse(tooMany).success).toBe(false);
    expect(
      interactionIngestRequestSchema.safeParse({ events: [event('exploration_reset', {})], extra: true }).success,
    ).toBe(false);
  });

  it('refresh request rejects wrong-typed and unknown fields', () => {
    expect(experienceRefreshRequestSchema.safeParse({ expectedContextVersion: 3 }).success).toBe(true);
    expect(experienceRefreshRequestSchema.safeParse({ expectedContextVersion: '3' }).success).toBe(false);
    expect(experienceRefreshRequestSchema.safeParse({ compare: ['gid://shopify/Product/1'] }).success).toBe(true);
    expect(experienceRefreshRequestSchema.safeParse({ compare: ['1'] }).success).toBe(false);
    expect(experienceRefreshRequestSchema.safeParse({ bogus: true }).success).toBe(false);
  });

  it('adaptive composition envelope enforces bounds and registry-only components', () => {
    const envelope = {
      sessionId,
      contextVersion: 1,
      experienceRevision: 1,
      mode: 'adaptive',
      adaptationReason: 'explicit_criteria',
      freshness: at,
      sections: [
        {
          id: 's1',
          component: 'SuggestionChips',
          chips: [{ label: 'Rings', href: '/collections/rings' }],
        },
      ],
    };
    expect(adaptiveCompositionSchema.safeParse(envelope).success).toBe(true);
    expect(
      adaptiveCompositionSchema.safeParse({
        ...envelope,
        sections: [{ id: 's1', component: 'ScriptTag', html: '<script>x</script>' }],
      }).success,
    ).toBe(false);
    expect(
      adaptiveCompositionSchema.safeParse({ ...envelope, mode: 'arbitrary_html' }).success,
    ).toBe(false);
    expect(
      adaptiveCompositionSchema.safeParse({ ...envelope, sections: [] }).success,
    ).toBe(false);
  });
});
