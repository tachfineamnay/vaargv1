/** Server-only one-page execution boundary; suitable for a durable scheduler. */
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { executeCatalogStep } from './execution.js';
import { loadStorefrontBindings, resolveStorefront } from './store-config.js';
import { z } from 'zod';
import type { RateLimitClient } from './rate-limit.js';

async function main(): Promise<void> {
  const { DATABASE_URL, VALKEY_URL, CATALOG_HOST, CATALOG_ACTION = 'step' } = process.env;
  const binding = resolveStorefront(loadStorefrontBindings(), CATALOG_HOST);
  if (!DATABASE_URL || !VALKEY_URL || !binding) throw new Error('NOT_CONFIGURED');
  const action = z.enum(['start', 'step', 'status']).parse(CATALOG_ACTION);
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
  const valkey = new Redis(VALKEY_URL, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 5000 }) as unknown as RateLimitClient & { on(event: string, callback: () => void): void; connect(): Promise<void>; disconnect(): void };
  valkey.on('error', () => undefined);
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  try {
    if (action === 'step') await valkey.connect();
    const result = await executeCatalogStep(pool, valkey, binding, process.env, action, controller.signal);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally { valkey.disconnect(); await pool.end(); }
}
main().catch(() => { console.error('CATALOG_OPERATION_FAILED'); process.exitCode = 1; });
