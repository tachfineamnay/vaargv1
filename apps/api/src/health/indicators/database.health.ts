import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult } from '@nestjs/terminus';
import { Pool } from 'pg';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DatabaseHealthIndicator {
  private pool: Pool | null = null;

  constructor(private config: ConfigService) {}

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({
        connectionString: this.config.get<string>('DATABASE_URL'),
        max: 1,
        idleTimeoutMillis: 5000,
        connectionTimeoutMillis: 5000,
      });
    }
    return this.pool;
  }

  async isHealthable(key: string): Promise<HealthIndicatorResult> {
    const pool = this.getPool();
    try {
      const client = await pool.connect();
      const result = await client.query('SELECT 1 as health, now() as server_time, version() as pg_version');
      client.release();
      
      return {
        [key]: {
          status: 'up' as const,
          component: 'postgres',
          details: {
            serverTime: result.rows[0]?.server_time,
            version: result.rows[0]?.pg_version?.split(' ')[0],
          },
        },
      };
    } catch (error) {
      return {
        [key]: {
          status: 'down' as const,
          component: 'postgres',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
