import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyConsentState, emptyExplorationCriteria, experienceContextSchema, type SearchRequest } from '@vaarg/shared';
import type { StorefrontBinding } from '@vaarg/persistence';
import { ExperienceService } from '../src/experience/experience.service.js';
import type { DatabaseClient } from '../src/infra/database-client.js';
import type { ValkeyClient } from '../src/infra/valkey-client.js';
import type { ConsentService } from '../src/privacy/consent.service.js';
import type { VisitorSessionService } from '../src/sessions/visitor-session.service.js';
import type { TenantContextResolver } from '../src/tenant/tenant-context.resolver.js';

const mocks = vi.hoisted(() => ({ load: vi.fn(), ingest: vi.fn(), search: vi.fn(), recommend: vi.fn(), compose: vi.fn(), summaries: vi.fn() }));
vi.mock('@vaarg/persistence', async original => ({
  ...await original<typeof import('@vaarg/persistence')>(),
  loadExperienceContext: mocks.load, ingestInteractionEvents: mocks.ingest,
  createSearchPort: () => ({ lexicalSearch: mocks.search, hybridSearch: mocks.search, semanticSearch: mocks.search, contextualSearch: mocks.search }),
  createRecommendationService: () => ({ recommend: mocks.recommend }),
  composeExperience: mocks.compose, resolveProductSummaries: mocks.summaries,
}));
const storeId = '00000000-0000-4000-8000-000000000001';
const sessionId = '00000000-0000-4000-8000-000000000002';
const binding: StorefrontBinding = { host: 'synthetic.example', storeId, country: 'FR', language: 'FR', currency: 'EUR', shopifyDomain: 'synthetic.myshopify.com', tokenEnv: 'SHOPIFY_SYNTHETIC' };
const tenant = { ...binding, storeStatus: 'active' as const, correlationId: 'synthetic-request' };
const searchResult = { status: 'OK', catalogStatus: 'OK', mode: 'lexical', query: 'ring', items: [], provenance: { channels: ['fts', 'trigram'], rrfK: 60, candidatePool: 100, embedding: null }, completedAt: null, generatedAt: '2026-11-27T10:00:00.000Z' };
const context = experienceContextSchema.parse({
  store: { storeId, market: { country: 'FR', language: 'FR', currency: 'EUR' } },
  market: { country: 'FR', language: 'FR', currency: 'EUR' }, session: { sessionId, customerId: null, status: 'active' }, customerId: null,
  consent: emptyConsentState(), exploration: emptyExplorationCriteria(), preferences: [], intentSignals: [], recentlyViewed: [],
  conversationRef: null, cartRef: null, brandRevision: null, configurationRevision: null, contextVersion: 0, experienceRevision: 0,
});
function setup() {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('pg_roles')) return { rows: [{ unsafe: false }] };
    if (sql.includes('FROM visitor_sessions')) return { rows: [{ session_id: sessionId, store_id: storeId, customer_id: null, status: 'active', context: 'default', expires_at: new Date(Date.now() + 60000), created_at: new Date() }] };
    return { rows: [], command: 'COMMIT' };
  });
  const database = { getPool: () => ({ connect: async () => ({ query, release: vi.fn() }) }) } as unknown as DatabaseClient;
  const valkey = { getClient: () => ({ del: vi.fn(), eval: vi.fn() }) } as unknown as ValkeyClient;
  const consentGet = vi.fn(async () => ({ customerId: null, consents: emptyConsentState() }));
  const resolve = vi.fn(async () => ({ ...binding, storeStatus: 'active', correlationId: 'synthetic-request' }));
  const service = new ExperienceService(database, valkey, { current: vi.fn(async () => ({ sessionId, storeId, status: 'active', customerId: null })) } as unknown as VisitorSessionService, { get: consentGet } as unknown as ConsentService, { resolve } as unknown as TenantContextResolver, [binding]);
  return { service, query, consentGet, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(context);
  mocks.search.mockResolvedValue(searchResult);
  mocks.recommend.mockResolvedValue({ items: [], provenance: { ...searchResult.provenance, strategy: 'market_default', signalWeights: {} }, completedAt: null, generatedAt: searchResult.generatedAt, sourceContextVersion: 0, consentLimited: true });
  mocks.compose.mockResolvedValue({ sessionId, contextVersion: 0, experienceRevision: 0, mode: 'ssr', adaptationReason: 'initial', freshness: searchResult.generatedAt, sections: [{ id: 'chips', component: 'SuggestionChips', chips: [{ label: 'Rings', href: '/collections/rings' }] }] });
  mocks.ingest.mockResolvedValue({ accepted: 1, duplicates: 0, rejected: 0, contextVersion: 1, experienceRevision: 0, context });
  mocks.summaries.mockResolvedValue(new Map());
});

describe('FL05-FIX server capability boundary (simulated)', () => {
  it('resolves all five capabilities through the same active session/market/consent boundary', async () => {
    const { service, query, consentGet, resolve } = setup();
    const capabilities = await service.capabilities(tenant, 'synthetic-token');
    await capabilities.searchCatalog({ scope: { storeId: '00000000-0000-4000-8000-000000000099', country: 'US', language: 'EN' }, mode: 'lexical', q: 'ring', context: { categories: ['untrusted'], collections: [], products: [] } });
    await capabilities.getExperienceContext();
    await capabilities.getRecommendations({ contextVersion: 99, signals: [{ kind: 'product_viewed', subject: 'untrusted', weight: 1 }] });
    await capabilities.proposeExperienceComposition({});
    await capabilities.updateExplicitCriteria({ criteria: { vendor: 'Synthetic' } });
    expect(resolve).toHaveBeenCalledTimes(6);
    expect(consentGet).toHaveBeenCalledTimes(5);
    expect(query.mock.calls.filter(([sql]) => sql.includes('FROM visitor_sessions'))).toHaveLength(5);
    expect(query.mock.calls.filter(([sql]) => sql.includes("set_config('app.store_id'"))).toHaveLength(5);
    expect(mocks.load.mock.calls.every(call => call[1].currency === 'EUR')).toBe(true);
    expect(mocks.search.mock.calls[0]?.[0].scope).toEqual({ storeId, country: 'FR', language: 'FR' });
    expect(mocks.search.mock.calls[0]?.[0].context).toEqual({ categories: [], collections: [], products: [] });
    expect(mocks.recommend.mock.calls[0]?.[0]).toMatchObject({ signals: [], contextVersion: 0 });
    expect(mocks.recommend.mock.calls[0]?.[2]).toEqual({ personalizationGranted: false });
    expect(mocks.compose.mock.calls[0]?.[1].personalizationGranted).toBe(false);
    expect(mocks.ingest.mock.calls[0]?.[4]).toEqual({ personalizationGranted: false, expectedContextVersion: 0 });
  });

  it('requires a server credential and validates capability input/output', async () => {
    const { service, consentGet } = setup();
    await expect(service.capabilities(tenant, undefined)).rejects.toThrow('Visitor session required');
    expect(consentGet).not.toHaveBeenCalled();
    const capabilities = await service.capabilities(tenant, 'synthetic-token');
    await expect(capabilities.searchCatalog({ scope: { storeId, country: 'FR', language: 'FR' }, mode: 'lexical', q: '' } as SearchRequest)).rejects.toThrow();
    await expect(capabilities.updateExplicitCriteria({ criteria: { currency: '' } })).rejects.toThrow();
    expect(mocks.ingest).not.toHaveBeenCalled();
    mocks.search.mockResolvedValue({ invented: true });
    await expect(capabilities.searchCatalog({ scope: { storeId, country: 'FR', language: 'FR' }, mode: 'lexical', q: 'ring' })).rejects.toThrow();
  });

  it('serves bounded lexical/hybrid verified DTOs without a visitor session', async () => {
    const { service, consentGet } = setup();
    const parsed = { mode: 'lexical' as const, q: 'ring', limit: 24, currency: 'EUR' };
    const result = await service.storefrontSearch(binding, parsed);
    expect(result.nextCursor).toBeNull();
    expect(result.items).toEqual([]);
    expect(consentGet).not.toHaveBeenCalled();
    expect(mocks.search.mock.calls[0]?.[0]).toMatchObject({ mode: 'lexical', constraints: { currency: 'EUR' } });
    mocks.search.mockResolvedValue({ ...searchResult, mode: 'hybrid', status: 'DEGRADED_LEXICAL' });
    expect((await service.storefrontSearch(binding, { ...parsed, mode: 'hybrid' })).status).toBe('DEGRADED_LEXICAL');
  });
});
