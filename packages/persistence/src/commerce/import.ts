import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type { CommerceContext, CommercePort } from './shopify.js';
import { catalogResponseSchema, type CatalogResponse } from '@vaarg/shared';
import { applyCatalogPage, reconcileCatalogGeneration } from './catalog-projection.js';
import { scopedCatalogTransaction as scoped } from './scope.js';

const inputSchema = z.object({ storeId: z.uuid(), country: z.string().regex(/^[A-Z]{2}$/), language: z.string().regex(/^[A-Z]{2,3}$/) });
type ImportInput = z.infer<typeof inputSchema>;
type ImportRow = { generation: string; phase: 'products' | 'collections' | 'complete'; cursor: string | null; started_at: Date; completed_at: Date | null; cursor_history: string[] };
async function jobReceipt(client: PoolClient, input: ImportInput, jobId: string, action: 'start' | 'step'): Promise<ImportRow | null> {
  const receipt = (await client.query<ImportRow & { country: string; language: string; action: string }>('SELECT generation,phase,cursor,cursor_history,started_at,completed_at,country,language,action FROM catalog_job_receipts WHERE store_id=$1 AND job_id=$2', [input.storeId,jobId])).rows[0];
  if (!receipt) return null;
  if (receipt.country !== input.country || receipt.language !== input.language || receipt.action !== action) throw new Error('CATALOG_JOB_CONFLICT');
  return receipt;
}
async function saveReceipt(client: PoolClient, input: ImportInput, jobId: string, action: 'start' | 'step', state: ImportRow): Promise<void> {
  await client.query('INSERT INTO catalog_job_receipts(store_id,country,language,job_id,action,generation,phase,cursor,cursor_history,started_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [input.storeId,input.country,input.language,jobId,action,state.generation,state.phase,state.cursor,state.cursor_history,state.started_at,state.completed_at]);
}
/** Claim a bounded lease, fetch outside the database, then compare-and-set the checkpoint. */
export async function importCatalogPage(pool: Pool, commerce: CommercePort, raw: ImportInput, signal?: AbortSignal, jobId?: string): Promise<ImportRow> {
  const input = inputSchema.parse(raw);
  if (signal?.aborted) throw new Error('CANCELLED');
  if (jobId) z.uuid().parse(jobId);
  const args = [input.storeId, input.country, input.language];
  const token = randomUUID();
  const leaseMs = 120000;
  const current = await scoped(pool, input, async client => {
    if (jobId) { const receipt = await jobReceipt(client, input, jobId, 'step'); if (receipt) return { ...receipt, replayed: true }; }
    await client.query(`INSERT INTO catalog_imports(store_id,country,language,generation,phase) VALUES ($1,$2,$3,$4,'products') ON CONFLICT DO NOTHING`, [...args, randomUUID()]);
    const claimed = await client.query<ImportRow>(`UPDATE catalog_imports SET lease_token=$4,lease_until=clock_timestamp()+($5::int * interval '1 millisecond') WHERE store_id=$1 AND country=$2 AND language=$3 AND phase<>'complete' AND (lease_until IS NULL OR lease_until<=clock_timestamp()) RETURNING generation,phase,cursor,cursor_history,started_at,completed_at`, [...args, token, leaseMs]);
    if (claimed.rows[0]) return claimed.rows[0];
    const state = (await client.query<ImportRow>('SELECT generation,phase,cursor,cursor_history,started_at,completed_at FROM catalog_imports WHERE store_id=$1 AND country=$2 AND language=$3', args)).rows[0];
    if (state?.phase === 'complete') { if (jobId) await saveReceipt(client, input, jobId, 'step', state); return { ...state, replayed: true }; }
    throw new Error('IMPORT_BUSY');
  });
  if ('replayed' in current || current.phase === 'complete') return current;
  const context: CommerceContext = { country: input.country, language: input.language };
  try {
    const page = current.phase === 'products' ? await commerce.products(context, current.cursor, signal) : await commerce.collections(context, current.cursor, signal);
    if (signal?.aborted) throw new Error('CANCELLED');
    if (page.nextCursor !== null && (page.nextCursor === current.cursor || current.cursor_history.includes(page.nextCursor))) throw new Error('INVALID_CURSOR');
    return await scoped(pool, input, async client => {
      if (signal?.aborted) throw new Error('CANCELLED');
      const held = await client.query(`SELECT 1 FROM catalog_imports WHERE store_id=$1 AND country=$2 AND language=$3 AND generation=$4 AND phase=$5 AND cursor IS NOT DISTINCT FROM $6 AND lease_token=$7 AND lease_until>clock_timestamp() FOR UPDATE`, [...args, current.generation, current.phase, current.cursor, token]);
      if (!held.rowCount) throw new Error('IMPORT_LEASE_LOST');
      for (const item of page.items) {
        await client.query(`INSERT INTO catalog_projection(store_id,country,language,kind,shopify_id,payload,seen_generation,visible,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,true,now()) ON CONFLICT (store_id,country,language,kind,shopify_id) DO UPDATE SET payload=EXCLUDED.payload,seen_generation=EXCLUDED.seen_generation,visible=true,observed_at=now()`, [...args, current.phase === 'products' ? 'product' : 'collection', item.id, JSON.stringify(item), current.generation]);
      }
      // Same-transaction normalized projection: a failed apply rolls the
      // checkpoint back, so an interrupted import stays exactly resumable.
      await applyCatalogPage(client, input, current.phase === 'products' ? 'products' : 'collections', current.generation, page.items);
      const phase = page.nextCursor !== null ? current.phase : current.phase === 'products' ? 'collections' : 'complete';
      if (phase === 'complete') {
        await client.query('UPDATE catalog_projection SET visible=false WHERE store_id=$1 AND country=$2 AND language=$3 AND seen_generation<>$4', [...args, current.generation]);
        await reconcileCatalogGeneration(client, input, current.generation);
      }
      const updated = await client.query<ImportRow>(`UPDATE catalog_imports SET phase=$4,cursor=$5,cursor_history=CASE WHEN $5::text IS NULL THEN ARRAY[]::text[] ELSE array_append(cursor_history,$5::text) END,completed_at=CASE WHEN $4='complete' THEN now() ELSE NULL END,lease_token=NULL,lease_until=NULL WHERE store_id=$1 AND country=$2 AND language=$3 AND lease_token=$6 RETURNING generation,phase,cursor,cursor_history,started_at,completed_at`, [...args, phase, page.nextCursor, token]);
      if (!updated.rows[0]) throw new Error('IMPORT_LEASE_LOST');
      if (signal?.aborted) throw new Error('CANCELLED');
      if (jobId) await saveReceipt(client, input, jobId, 'step', updated.rows[0]);
      return updated.rows[0];
    });
  } catch (error) {
    await scoped(pool, input, async client => { await client.query('UPDATE catalog_imports SET lease_token=NULL,lease_until=NULL WHERE store_id=$1 AND country=$2 AND language=$3 AND lease_token=$4', [...args, token]); }).catch(() => undefined);
    throw error;
  }
}
/** Starts a new sweep only after completion; interrupted sweeps resume unchanged. */
export async function startCatalogSweep(pool: Pool, raw: ImportInput, jobId?: string): Promise<void> {
  const input = inputSchema.parse(raw);
  if (jobId) z.uuid().parse(jobId);
  await scoped(pool, input, async (client) => {
    if (jobId && await jobReceipt(client, input, jobId, 'start')) return;
    await client.query(`INSERT INTO catalog_imports(store_id,country,language,generation,phase) VALUES($1,$2,$3,$4,'products') ON CONFLICT (store_id,country,language) DO UPDATE SET generation=EXCLUDED.generation,phase='products',cursor=NULL,cursor_history=ARRAY[]::text[],started_at=now(),completed_at=NULL WHERE catalog_imports.phase='complete'`, [input.storeId, input.country, input.language, randomUUID()]);
    if (jobId) { const state = (await client.query<ImportRow>('SELECT generation,phase,cursor,cursor_history,started_at,completed_at FROM catalog_imports WHERE store_id=$1 AND country=$2 AND language=$3', [input.storeId,input.country,input.language])).rows[0]; if (!state) throw new Error('IMPORT_NOT_FOUND'); await saveReceipt(client,input,jobId,'start',state); }
  });
}

/** Freshness always accompanies a scoped snapshot; callers must revalidate commerce with Shopify. */
export async function readCatalogSnapshot(pool: Pool, raw: ImportInput, maxAgeMs: number, cursor?: { kind: 'product' | 'collection'; id: string }) {
  const input = inputSchema.parse(raw);
  const age = z.number().int().min(0).max(86400000).parse(maxAgeMs);
  const after = z.object({ kind: z.enum(['product', 'collection']), id: z.string().min(1).max(300) }).optional().parse(cursor);
  return scoped(pool, input, async (client) => {
    const args = [input.storeId, input.country, input.language];
    const status = (await client.query<ImportRow>('SELECT generation, phase, cursor, cursor_history, started_at, completed_at FROM catalog_imports WHERE store_id=$1 AND country=$2 AND language=$3 FOR SHARE', args)).rows[0];
    if (!status) return { freshness: 'NOT_SYNCED' as const, completedAt: null, items: [], nextCursor: null };
    const freshness = status.phase !== 'complete' ? 'IN_PROGRESS' as const : !status.completed_at || Date.now() - status.completed_at.getTime() > age ? 'STALE' as const : 'FRESH' as const;
    const items = (await client.query<{ kind: string; shopify_id: string; payload: unknown }>('SELECT kind,shopify_id,payload FROM catalog_projection WHERE store_id=$1 AND country=$2 AND language=$3 AND visible=true AND ($4::text IS NULL OR (kind,shopify_id)>($4,$5)) ORDER BY kind,shopify_id LIMIT 101', [...args, after?.kind ?? null, after?.id ?? null])).rows;
    const hasMore = items.length > 100;
    const visibleItems = items.slice(0, 100);
    const last = visibleItems.at(-1);
    const nextCursor = hasMore && last ? { kind: z.enum(['product', 'collection']).parse(last.kind), id: last.shopify_id } : null;
    return { freshness, completedAt: status.completed_at, items: visibleItems, nextCursor };
  });
}

const projectionQuerySchema = z.strictObject({
  kind: z.enum(['product', 'collection']),
  limit: z.number().int().min(1).max(100).default(20),
  maxAgeMs: z.number().int().min(0).max(86400000),
  cursor: z.string().min(1).max(300).optional(),
  handle: z.string().min(1).max(255).optional(),
  q: z.string().min(1).max(200).optional(),
  available: z.boolean().optional(),
  collectionId: z.string().startsWith('gid://shopify/Collection/').max(300).optional(),
});
export type CatalogProjectionQuery = z.input<typeof projectionQuerySchema>;

/** Server-scoped snapshot. A stale projection is never represented as live Shopify data. */
export async function readCatalogProjection(pool: Pool, raw: ImportInput, query: CatalogProjectionQuery): Promise<CatalogResponse> {
  const input = inputSchema.parse(raw);
  const options = projectionQuerySchema.parse(query);
  return scoped(pool, input, async client => {
    const args = [input.storeId, input.country, input.language];
    const state = (await client.query<ImportRow>('SELECT generation, phase, cursor, cursor_history, started_at, completed_at FROM catalog_imports WHERE store_id=$1 AND country=$2 AND language=$3 FOR SHARE', args)).rows[0];
    if (!state) return catalogResponseSchema.parse({ status: 'NOT_SYNCED', completedAt: null, items: [], nextCursor: null });
    const status = state.phase !== 'complete' ? 'IN_PROGRESS' : !state.completed_at || Date.now() - state.completed_at.getTime() > options.maxAgeMs ? 'STALE' : 'FRESH';
    const search = options.q ? `%${options.q.replace(/[\\%_]/g, '\\$&')}%` : null;
    const rows = (await client.query<{ shopify_id: string; payload: unknown }>(`
      SELECT p.shopify_id,p.payload FROM catalog_projection p
      WHERE p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.kind=$4 AND p.visible=true
        AND ($5::text IS NULL OR p.shopify_id > $5)
        AND ($6::text IS NULL OR p.payload->>'handle' = $6)
        AND ($7::text IS NULL OR p.payload->>'title' ILIKE $7 OR p.payload->>'description' ILIKE $7)
        AND ($8::boolean IS NULL OR (p.payload->>'availableForSale')::boolean = $8)
        AND ($9::text IS NULL OR EXISTS (SELECT 1 FROM catalog_projection c WHERE c.store_id=p.store_id AND c.country=p.country AND c.language=p.language AND c.kind='collection' AND c.shopify_id=$9 AND c.visible=true AND c.payload->'products'->'nodes' @> jsonb_build_array(jsonb_build_object('id',p.shopify_id))))
      ORDER BY p.shopify_id LIMIT $10`, [...args, options.kind, options.cursor ?? null, options.handle ?? null, search, options.available ?? null, options.collectionId ?? null, options.limit + 1])).rows;
    const page = rows.slice(0, options.limit);
    return catalogResponseSchema.parse({ status, completedAt: state.completed_at?.toISOString() ?? null, items: page.map(row => ({ kind: options.kind, data: row.payload })), nextCursor: rows.length > options.limit ? page.at(-1)?.shopify_id ?? null : null });
  });
}

/**
 * Read the current catalog generation for a store/market. Used to bind
 * catalog sync continuations to the original generation so an intervening
 * new sweep cannot silently redirect a continuation.
 */
export async function getCatalogGeneration(
  pool: Pool,
  raw: ImportInput,
): Promise<string | null> {
  const input = inputSchema.parse(raw);
  return scoped(pool, input, async (client) => {
    const { rows } = await client.query<{ generation: string }>(
      'SELECT generation FROM catalog_imports WHERE store_id=$1 AND country=$2 AND language=$3',
      [input.storeId, input.country, input.language],
    );
    return rows[0]?.generation ?? null;
  });
}
