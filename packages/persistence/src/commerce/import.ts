import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type { CommerceContext, CommercePort } from './shopify.js';

const inputSchema = z.object({ storeId: z.uuid(), country: z.string().regex(/^[A-Z]{2}$/), language: z.string().regex(/^[A-Z]{2,3}$/) });
type ImportInput = z.infer<typeof inputSchema>;
type ImportRow = { generation: string; phase: 'products' | 'collections' | 'complete'; cursor: string | null; started_at: Date; completed_at: Date | null; cursor_history: string[] };
async function scoped<T>(pool: Pool, input: ImportInput, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const role = await client.query<{ unsafe: boolean }>('SELECT rolsuper OR rolbypassrls AS unsafe FROM pg_roles WHERE rolname = current_user');
    if (role.rows[0]?.unsafe !== false) throw new Error('UNSAFE_DATABASE_ROLE');
    await client.query("SELECT set_config('app.store_id', $1, true)", [input.storeId]);
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
/** One idempotent, transactionally checkpointed page; a durable scheduler may call it repeatedly. */
export async function importCatalogPage(pool: Pool, commerce: CommercePort, raw: ImportInput): Promise<ImportRow> {
  const input = inputSchema.parse(raw);
  const args = [input.storeId, input.country, input.language];
  const context: CommerceContext = { country: input.country, language: input.language };
  return scoped(pool, input, async (client) => {
    await client.query(`INSERT INTO catalog_imports(store_id, country, language, generation, phase) VALUES ($1,$2,$3,$4,'products') ON CONFLICT DO NOTHING`, [...args, randomUUID()]);
    const result = await client.query<ImportRow>('SELECT generation, phase, cursor, cursor_history, started_at, completed_at FROM catalog_imports WHERE store_id=$1 AND country=$2 AND language=$3 FOR UPDATE', args);
    const current = result.rows[0];
    if (!current) throw new Error('IMPORT_NOT_FOUND');
    if (current.phase === 'complete') return current;
    const page = current.phase === 'products' ? await commerce.products(context, current.cursor) : await commerce.collections(context, current.cursor);
    if (page.nextCursor !== null && (page.nextCursor === current.cursor || current.cursor_history.includes(page.nextCursor))) throw new Error('INVALID_CURSOR');
    for (const item of page.items) {
      await client.query(`INSERT INTO catalog_projection(store_id,country,language,kind,shopify_id,payload,seen_generation,visible,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,true,now()) ON CONFLICT (store_id,country,language,kind,shopify_id) DO UPDATE SET payload=EXCLUDED.payload, seen_generation=EXCLUDED.seen_generation,visible=true,observed_at=now()`, [...args, current.phase === 'products' ? 'product' : 'collection', item.id, JSON.stringify(item), current.generation]);
    }
    const phase = page.nextCursor !== null ? current.phase : current.phase === 'products' ? 'collections' : 'complete';
    if (phase === 'complete') await client.query('UPDATE catalog_projection SET visible=false WHERE store_id=$1 AND country=$2 AND language=$3 AND seen_generation<>$4', [...args, current.generation]);
    const updated = await client.query<ImportRow>(`UPDATE catalog_imports SET phase=$4,cursor=$5,cursor_history=CASE WHEN $5::text IS NULL THEN ARRAY[]::text[] ELSE array_append(cursor_history,$5::text) END,completed_at=CASE WHEN $4='complete' THEN now() ELSE NULL END WHERE store_id=$1 AND country=$2 AND language=$3 RETURNING generation,phase,cursor,cursor_history,started_at,completed_at`, [...args, phase, page.nextCursor]);
    const row = updated.rows[0];
    if (!row) throw new Error('IMPORT_NOT_FOUND');
    return row;
  });
}
/** Starts a new sweep only after completion; interrupted sweeps resume unchanged. */
export async function startCatalogSweep(pool: Pool, raw: ImportInput): Promise<void> {
  const input = inputSchema.parse(raw);
  await scoped(pool, input, async (client) => {
    await client.query(`INSERT INTO catalog_imports(store_id,country,language,generation,phase) VALUES($1,$2,$3,$4,'products') ON CONFLICT (store_id,country,language) DO UPDATE SET generation=EXCLUDED.generation,phase='products',cursor=NULL,cursor_history=ARRAY[]::text[],started_at=now(),completed_at=NULL WHERE catalog_imports.phase='complete'`, [input.storeId, input.country, input.language, randomUUID()]);
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
