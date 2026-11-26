import type { Logger } from '@vaarg/shared';
import { DatabaseClient } from './database-client.js';
import { ValkeyClient } from './valkey-client.js';
import type { WorkerConfiguration } from './worker-config.js';

export interface DependencyReport {
  database: 'ready' | 'not_ready';
  valkey: 'ready' | 'not_ready';
  hatchet: 'enabled' | 'disabled';
  allReady: boolean;
}

export class WorkerDependencies {
  readonly database: DatabaseClient;
  readonly valkey: ValkeyClient;

  constructor(
    private readonly configuration: WorkerConfiguration,
    private readonly logger: Logger,
  ) {
    this.database = new DatabaseClient(
      configuration.database.url,
      configuration.database.readinessTimeoutMs,
    );
    this.valkey = new ValkeyClient(configuration.valkey.url, configuration.valkey.keyPrefix);
  }

  async check(): Promise<DependencyReport> {
    const database = await this.probe('database', () =>
      this.database.ping(),
    );
    const valkey = await this.probe('valkey', () =>
      this.valkey.ping(this.configuration.valkey.readinessTimeoutMs),
    );

    return {
      database,
      valkey,
      hatchet: this.configuration.hatchet.enabled ? 'enabled' : 'disabled',
      allReady: database === 'ready' && valkey === 'ready',
    };
  }

  private async probe(name: string, run: () => Promise<void>): Promise<'ready' | 'not_ready'> {
    try {
      await run();
      this.logger.info(`Dependency ready: ${name}`);
      return 'ready';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Probe failed';
      this.logger.warn(`Dependency not ready: ${name}`, { error: message });
      return 'not_ready';
    }
  }

  async close(): Promise<void> {
    await this.valkey.close();
    await this.database.close();
  }
}
