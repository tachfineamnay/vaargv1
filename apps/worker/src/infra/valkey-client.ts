import { createJsonLogger } from '@vaarg/shared';
import { Redis } from 'ioredis';

export class ValkeyClient {
  private readonly logger = createJsonLogger({ level: 'info' });
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
      this.client.on('error', (error) => {
        this.logger.error(`Valkey client error: ${error.message}`);
      });
    }
    return this.client;
  }

  async ping(timeoutMs: number): Promise<void> {
    const response = await withTimeoutSafe(
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

async function withTimeoutSafe<T>(
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
