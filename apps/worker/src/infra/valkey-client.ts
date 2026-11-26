import { Redis } from 'ioredis';
import { withTimeout } from './timeout.js';

export class ValkeyClient {
  private client: Redis | undefined;

  constructor(
    private readonly connectionUrl: string,
    private readonly keyPrefix: string,
  ) {}

  getClient(): Redis {
    if (!this.client) {
      this.client = new Redis(this.connectionUrl, {
        keyPrefix: this.keyPrefix,
        maxRetriesPerRequest: 2,
        connectTimeout: 5000,
      });
      this.client.on('error', () => {
        // Client errors are surfaced through the dependency readiness check.
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
      try {
        await this.client.quit();
      } catch {
        // Connection may already be broken; discard the client regardless.
        this.client.disconnect();
      }
      this.client = undefined;
    }
  }
}
