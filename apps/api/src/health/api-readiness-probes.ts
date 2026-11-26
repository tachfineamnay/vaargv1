import { Injectable } from '@nestjs/common';
import type { ReadinessCheck } from '@vaarg/shared';
import { DatabaseClient } from '../infra/database-client.js';
import { ValkeyClient } from '../infra/valkey-client.js';
import type { ReadinessProbes } from './readiness-probes.js';

@Injectable()
export class ApiReadinessProbes implements ReadinessProbes {
  constructor(
    private readonly database: DatabaseClient,
    private readonly valkey: ValkeyClient,
    private readonly valkeyTimeoutMs: number,
  ) {}

  async check(): Promise<ReadinessCheck[]> {
    const results: ReadinessCheck[] = [];
    await probe('database', () => this.database.ping(), results);
    await probe('valkey', () => this.valkey.ping(this.valkeyTimeoutMs), results);
    return results;
  }
}

async function probe(
  name: string,
  run: () => Promise<void>,
  sink: ReadinessCheck[],
): Promise<void> {
  const start = Date.now();
  try {
    await run();
    sink.push({ name, status: 'ready', latencyMs: Date.now() - start, required: true });
  } catch {
    sink.push({
      name,
      status: 'not_ready',
      detail: 'Dependency probe failed',
      latencyMs: Date.now() - start,
      required: true,
    });
  }
}
