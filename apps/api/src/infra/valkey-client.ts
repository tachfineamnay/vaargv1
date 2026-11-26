import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { withTimeout } from './database-client.js';

export class ValkeyClient {
  private readonly logger = new Logger(ValkeyClient.name);
  private client: Redis | undefined;

  constructor(
    private readonly connectionUrl: string,
    private readonly keyPrefix: string,
  ) {}

  getClient(): Redis {
    if (!this.client) {
      this.client = new Redis(this.connectionUrl, {
        keyPrefix: this.keyPrefix,
        enableAutoPipelining: true,
        maxRetriesPerRequest: 2,
        connectTimeout: 5000,
      });
      this.client.on('error', (error) => {
        this.logger.error(`Valkey client error: ${error.message}`);
      });
    }
    return this.client;
  }

  async ping(timeoutMs: number): Promise<void> {
    const response = await withTimeout(
      this.getClient().ping(),
      timeoutMs,
      'Valkey readiness probe timed out',
    );
    if (response !== 'PONG') {
      throw new Error(`Valkey readiness probe returned ${response}`);
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = undefined;
    }
  }
}
