import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult } from '@nestjs/terminus';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ValkeyHealthIndicator {
  private client: Redis | null = null;

  constructor(private config: ConfigService) {}

  private getClient(): Redis {
    if (!this.client) {
      this.client = new Redis(this.config.get<string>('VALKEY_URL')!, {
        maxRetriesPerRequest: 1,
        retryStrategy: () => null, // Don't retry for health checks
        connectTimeout: 5000,
        commandTimeout: 5000,
        lazyConnect: true,
      });
    }
    return this.client;
  }

  async isHealthable(key: string): Promise<HealthIndicatorResult> {
    const client = this.getClient();
    try {
      if (client.status === 'wait') {
        await client.connect();
      }
      const pong = await client.ping();
      const info = await client.info('memory');
      const usedMemory = info.match(/used_memory_human:(\S+)/)?.[1] || 'unknown';
      
      return {
        [key]: {
          status: pong === 'PONG' ? 'up' as const : 'down' as const,
          component: 'valkey',
          details: {
            ping: pong,
            usedMemory,
          },
        },
      };
    } catch (error) {
      return {
        [key]: {
          status: 'down' as const,
          component: 'valkey',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}
