import { Redis } from 'ioredis';
import { withTimeout } from './timeout.js';

export class ValkeyClient {
  private client: Redis | undefined;
  private rateClient: Redis | undefined;

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
        // Client errors are surfaced through readiness probes.
      });
    }
    return this.client;
  }

  /** Unprefixed connection shared by every Shopify execution boundary. */
  getRateClient(): Redis {
    if (!this.rateClient) {
      this.rateClient = new Redis(this.connectionUrl, { maxRetriesPerRequest: 0, connectTimeout: 5000 });
      this.rateClient.on('error', () => undefined);
    }
    return this.rateClient;
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

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    this.rateClient?.disconnect();
    this.rateClient = undefined;
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
      this.client = undefined;
    }
  }
}
