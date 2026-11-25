import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { ValkeyHealthIndicator } from './indicators/valkey.health';

@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DatabaseHealthIndicator,
    private readonly valkey: ValkeyHealthIndicator
  ) {}

  @Get('health')
  @HealthCheck()
  async check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.isHealthable('postgres'),
      () => this.valkey.isHealthable('valkey'),
    ]);
  }

  @Get('ready')
  @HealthCheck()
  async readiness(): Promise<HealthCheckResult> {
    // Readiness includes critical dependencies
    return this.health.check([
      () => this.db.isHealthable('postgres'),
      () => this.valkey.isHealthable('valkey'),
    ]);
  }

  @Get('live')
  @HealthCheck()
  async liveness(): Promise<HealthCheckResult> {
    // Liveness only checks if process is alive
    return this.health.check([
      () => ({
        process: { status: 'up' as const },
      }),
    ]);
  }
}
