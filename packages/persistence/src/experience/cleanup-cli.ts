/** Operator-triggered per-store cleanup; no provider/network work. */
import { Pool } from 'pg';
import { purgeExpiredExperience } from './experience-context.js';
import { loadStorefrontBindings } from '../commerce/store-config.js';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_NOT_CONFIGURED');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
  try {
    for (const storeId of new Set(loadStorefrontBindings().map(binding => binding.storeId))) {
      const deleted = await purgeExpiredExperience(pool, storeId);
      process.stdout.write(`${JSON.stringify({ storeId, deleted })}\n`);
    }
  } finally { await pool.end(); }
}
main().catch(() => { console.error('EXPERIENCE_CLEANUP_FAILED'); process.exitCode = 1; });
