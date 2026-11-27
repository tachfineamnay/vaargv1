import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { InteractionEvent } from '@vaarg/shared';
import { ingestInteractionEvents, ExperienceContextCache } from '../src/experience/experience-context.js';
import { catalogHardFilterSql, createSearchPort } from '../src/commerce/search-port.js';
import { createRecommendationService, recordRecommendationRun } from '../src/commerce/recommendations.js';

const scope = { storeId: randomUUID(), country: 'FR', language: 'FR', currency: 'EUR' };
const session = { sessionId: randomUUID(), customerId: null, status: 'active' as const };
const searchScope = { storeId: scope.storeId, country: scope.country, language: scope.language };

/** Scripted SQL contract tests, NOT PostgreSQL/RLS/concurrency certification. */
function harness() {
  const events = new Set<string>();
  let revision: { state: object; context_version: string; experience_revision: string; expires_at: Date } | undefined;
  let failPersist = false;
  let backup: { events: string[]; revision: typeof revision };
  const query = vi.fn(async (sql: string, values: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount: number; command?: string }> => {
    if (sql === 'BEGIN') backup = { events: [...events], revision };
    if (sql === 'ROLLBACK') { events.clear(); for (const id of backup.events) events.add(id); revision = backup.revision; }
    if (sql.includes('pg_roles')) return { rows: [{ unsafe: false }], rowCount: 1 };
    if (sql.includes('FROM visitor_sessions')) return { rows: [{ customer_id: null, session_id: session.sessionId }], rowCount: 1 };
    if (sql.startsWith('SELECT state,') || sql.startsWith('SELECT context_version')) return { rows: revision ? [revision] : [], rowCount: revision ? 1 : 0 };
    if (sql.includes('INSERT INTO interaction_events')) {
      expect(sql).toContain('RETURNING seq::text AS seq, payload');
      const id = String(values[1]);
      if (events.has(id)) return { rows: [], rowCount: 0 };
      events.add(id);
      return { rows: [{ seq: String(events.size), payload: JSON.parse(String(values[4])) }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO experience_revisions')) {
      if (failPersist) return { rows: [], rowCount: 0 };
      revision = { state: JSON.parse(String(values[2])), context_version: String(values[3]), experience_revision: String(values[4]), expires_at: new Date(Date.now() + 60000) };
    }
    if (sql.includes('FROM catalog_imports')) return { rows: [{ phase: 'complete', completed_at: new Date('2020-01-01') }], rowCount: 1 };
    return { rows: [], rowCount: 1, ...(sql === 'COMMIT' ? { command: 'COMMIT' } : {}) };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, query, events, fail: () => { failPersist = true; }, recover: () => { failPersist = false; }, expire: () => { if (revision) revision.expires_at = new Date(0); } };
}
const searchEvent = (query: string): InteractionEvent => ({ eventId: randomUUID(), type: 'search_submitted', query });

describe('FL05-FIX persistence SQL contracts (simulated)', () => {
  it('does not re-reduce previously accepted or batch-internal duplicate events', async () => {
    const h = harness();
    const a = searchEvent('ring');
    const b = searchEvent('chain');
    const first = await ingestInteractionEvents(h.pool, scope, session, [a, a], { personalizationGranted: false });
    expect(first).toMatchObject({ accepted: 1, duplicates: 1, contextVersion: 1 });
    const duplicate = await ingestInteractionEvents(h.pool, scope, session, [a], { personalizationGranted: false });
    expect(duplicate).toMatchObject({ accepted: 0, duplicates: 1, contextVersion: 1 });
    expect(duplicate.context).toEqual(first.context);
    const mixed = await ingestInteractionEvents(h.pool, scope, session, [a, b, a], { personalizationGranted: false });
    expect(mixed).toMatchObject({ accepted: 1, duplicates: 2, contextVersion: 2 });
    expect(mixed.context.exploration.query).toBe('chain');
    expect(h.query.mock.calls.some(([sql]) => sql.includes('SELECT event_id'))).toBe(false);
    // Essential receipts contain no search history without optional consent.
    const insert = h.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO interaction_events'))!;
    expect(JSON.parse(String(insert[1]?.[4]))).toEqual({ eventId: a.eventId, type: a.type });
  });

  it('rejects optional raw behavior without consent even with an untrusted grant snapshot', async () => {
    const h = harness();
    const result = await ingestInteractionEvents(h.pool, scope, session, [{ eventId: randomUUID(), type: 'product_viewed', productRef: 'gid://shopify/Product/1' }], { personalizationGranted: true });
    expect(result).toMatchObject({ accepted: 0, rejected: 1, contextVersion: 0 });
    expect(h.events.size).toBe(0);
    expect(h.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO experience_revisions'))).toBe(false);
  });

  it('rolls back inserted receipts on CAS failure and preserves versions after expiry', async () => {
    const h = harness();
    const event = searchEvent('ring');
    h.fail();
    await expect(ingestInteractionEvents(h.pool, scope, session, [event], { personalizationGranted: false })).rejects.toThrow('CONTEXT_VERSION_CONFLICT');
    expect(h.events.size).toBe(0);
    h.recover();
    const initial = await ingestInteractionEvents(h.pool, scope, session, [event], { personalizationGranted: false });
    h.expire();
    await expect(ingestInteractionEvents(h.pool, scope, session, [searchEvent('chain')], { personalizationGranted: false, expectedContextVersion: 0 })).rejects.toThrow('CONTEXT_VERSION_CONFLICT');
    const recovered = await ingestInteractionEvents(h.pool, scope, session, [searchEvent('chain')], { personalizationGranted: false, expectedContextVersion: initial.contextVersion });
    expect(recovered.contextVersion).toBe(2);
  });

  it('keeps price, currency and availability on the same eligible variant', () => {
    const params: unknown[] = [];
    const sql = catalogHardFilterSql({ available: true, currency: 'EUR', priceMin: '10', priceMax: '20', vendor: 'Synthetic', productType: 'Ring', collection: 'rings', attributes: [{ name: 'metal', value: 'silver' }] }, params);
    expect(sql.match(/FROM catalog_variants/g)).toHaveLength(1);
    expect(sql).toContain('pv.available_for_sale = $1');
    expect(sql).toContain('pv.currency=$2');
    expect(sql).toContain('pv.price_amount >= $3::numeric');
    expect(sql).toContain('pv.price_amount <= $4::numeric');
    expect(sql).toContain('catalog_collection_members');
    expect(sql).toContain('catalog_product_attributes');
    expect(params).toEqual([true, 'EUR', '10', '20', 'rings', 'Ring', 'Synthetic', 'metal', 'silver']);
    expect(catalogHardFilterSql({ currency: 'USD' }, [])).toContain('pv.currency=$1');
  });

  it('rejects method/mode conflicts before database/provider access', async () => {
    const h = harness();
    const port = createSearchPort({ pool: h.pool });
    await expect(port.lexicalSearch({ scope: searchScope, mode: 'hybrid', q: 'ring' })).rejects.toThrow('SEARCH_MODE_MISMATCH');
    expect(h.pool.connect).not.toHaveBeenCalled();
  });

  it('degrades to ordered lexical channels without hiding stale catalog freshness', async () => {
    const h = harness();
    const result = await createSearchPort({ pool: h.pool }).hybridSearch({ scope: searchScope, mode: 'hybrid', q: 'ring' });
    expect(result).toMatchObject({ status: 'DEGRADED_LEXICAL', catalogStatus: 'STALE', provenance: { channels: ['fts', 'trigram'], embedding: null } });
    const sql = h.query.mock.calls.find(([sql]) => sql.includes('WITH fts AS'))?.[0];
    expect(sql).toMatch(/ORDER BY ts_rank_cd[\s\S]*LIMIT/);
    expect(sql).toMatch(/ORDER BY \(3 \* similarity[\s\S]*LIMIT/);
    expect(h.query.mock.calls.some(([sql]) => sql.includes('e.embedding'))).toBe(false);
  });

  it('binds vector candidates to current documents and exact provider identity (synthetic fixture)', async () => {
    const h = harness();
    const identity = { provider: 'synthetic-test', model: 'fixture', modelVersion: 'v1', dimension: 768 };
    const embedding = { availability: () => 'READY' as const, identity: () => identity,
      // Test fixture only; never a runtime fallback and no provider calls.
      embedQuery: vi.fn(async () => Array.from({ length: 768 }, (_, index) => (index + 1) / 1000)),
      embedDocuments: vi.fn(),
    };
    const result = await createSearchPort({ pool: h.pool, embedding }).hybridSearch({ scope: searchScope, mode: 'hybrid', q: 'ring' });
    expect(result.provenance.embedding).toEqual(identity);
    const sql = h.query.mock.calls.find(([sql]) => sql.includes('vec AS'))?.[0];
    expect(sql).toContain('sd.content_hash=e.content_hash');
    expect(sql).toContain('sd.visible=true');
    expect(sql).toContain('e.generation=sd.generation');
    expect(sql).toMatch(/e.provider=\$\d+ AND e.model=\$\d+ AND e.model_version=\$\d+ AND e.dimension=\$\d+/);
    expect(sql).toMatch(/ORDER BY e.embedding <=>[\s\S]*LIMIT/);
    expect(embedding.embedQuery).toHaveBeenCalledOnce();
  });

  it('reports no invented retrieval channels for market-default SQL', async () => {
    const h = harness();
    const search = createSearchPort({ pool: h.pool });
    const result = await createRecommendationService({ pool: h.pool, search }).recommend({ contextVersion: 0, constraints: { available: true, currency: 'EUR' } }, searchScope);
    expect(result.provenance).toMatchObject({ strategy: 'market_default', channels: [], embedding: null });
    expect(h.query.mock.calls.some(([sql]) => sql.includes('catalog_products') && sql.includes('pv.currency='))).toBe(true);
  });

  it('refuses to publish obsolete recommendation runs', async () => {
    const h = harness();
    const result = await createRecommendationService({ pool: h.pool, search: createSearchPort({ pool: h.pool }) }).recommend({ contextVersion: 8 }, searchScope);
    await expect(recordRecommendationRun(h.pool, searchScope, session, result, 0)).rejects.toMatchObject({ status: 409 });
    expect(h.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO recommendation_runs'))).toBe(false);
  });

  it('has no non-atomic GET/SET cache write fallback', async () => {
    const h = harness();
    const context = (await ingestInteractionEvents(h.pool, scope, session, [searchEvent('ring')], { personalizationGranted: false })).context;
    const client = { get: vi.fn(), set: vi.fn(), del: vi.fn(), eval: vi.fn() };
    await new ExperienceContextCache(client).set(scope.storeId, session.sessionId, context, 60);
    expect(client.get).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
    expect(client.eval).toHaveBeenCalledWith(expect.stringContaining("redis.call('SET'"), 1, expect.any(String), JSON.stringify(context), '60');
  });
});
