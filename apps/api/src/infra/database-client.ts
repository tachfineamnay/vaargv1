import { Pool, type PoolClient } from 'pg';
import { withTimeout } from './timeout.js';

export class DatabaseClient {
  private pool: Pool | undefined;

  constructor(
    private readonly connectionString: string,
    private readonly readinessTimeoutMs: number,
  ) {}

  getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({
        connectionString: this.connectionString,
        max: 10,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
      });
      this.pool.on('error', () => {
        // Pool errors are surfaced through readiness probes; avoid crashing the process.
      });
    }
    return this.pool;
  }

  async acquire(): Promise<PoolClient> {
    return this.getPool().connect();
  }

  async ping(): Promise<void> {
    const client = await this.acquire();
    try {
      await withTimeout(
        client.query('SELECT 1'),
        this.readinessTimeoutMs,
        'PostgreSQL readiness probe timed out',
      );
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = undefined;
  }
}
