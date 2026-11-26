import { Logger } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';

export class DatabaseClient {
  private readonly logger = new Logger(DatabaseClient.name);
  private pool: Pool | undefined;

  constructor(private readonly connectionString: string) {}

  getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({
        connectionString: this.connectionString,
        max: 10,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
      });
      this.pool.on('error', (error) => {
        this.logger.error(`PostgreSQL pool error: ${error.message}`);
      });
    }
    return this.pool;
  }

  async acquire(): Promise<PoolClient> {
    return this.getPool().connect();
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.getPool().query<T>(sql, params as never[]);
    return result.rows;
  }

  async ping(timeoutMs: number): Promise<void> {
    const client = await this.acquire();
    try {
      await withTimeout(
        client.query('SELECT 1'),
        timeoutMs,
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

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
