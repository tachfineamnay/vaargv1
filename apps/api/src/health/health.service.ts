import { Injectable } from '@nestjs/common';
import {
  healthSchema,
  type Health,
  type Readiness,
  readinessSchema,
} from '@vaarg/shared';
import type { ReadinessProbes } from './readiness-probes.js';

const startedAt = Date.now();

@Injectable()
export class HealthService {
  build(service: string, version: string): Health {
    return healthSchema.parse({
      status: 'ok',
      service,
      version,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    });
  }
}

@Injectable()
export class ReadinessService {
  constructor(private readonly probes: ReadinessProbes) {}

  async build(service: string, version: string): Promise<Readiness> {
    const checks = await this.probes.check();
    const ready = checks.every((check) => check.status === 'ready');
    return readinessSchema.parse({
      status: ready ? 'ready' : 'not_ready',
      service,
      version,
      checks,
      timestamp: new Date().toISOString(),
    });
  }
}
