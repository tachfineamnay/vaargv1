import { Injectable } from '@nestjs/common';
import { DatabaseClient } from '../infra/database-client.js';
import { ValkeyClient } from '../infra/valkey-client.js';
import {
  ReadinessProbeResult,
  ReadinessProbes,
} from './readiness-probes.js';

@Injectable()
export class ApiReadinessProbes implements ReadinessProbes {
  constructor(
    private readonly database: DatabaseClient,
    private readonly valkey: ValkeyClient,
    private readonly databaseTimeoutMs: number,
    private readonly valkeyTimeoutMs: number,
  ) {}

  async check(): Promise<ReadinessProbeResult[]> {
    const results: ReadinessProbeResult[] = [];

    await probe('database', () => this.database.ping(this.databaseTimeoutMs), results);
    await probe('valkey', () => this.valkey.ping(this.valkeyTimeoutMs), results);

    return results;
  }
}

async function probe(
  name: string,
  run: () => Promise<void>,
  sink: ReadinessProbeResult[],
): Promise<void> {
  const start = Date.now();
  try {
    await run();
    sink.push({ name, status: 'ready', latencyMs: Date.now() - start });
  } catch (error) {
    sink.push({
      name,
      status: 'not_ready',
      detail: error instanceof Error ? error.message : 'Probe failed',
      latencyMs: Date.now() - start,
    });
  }
}
