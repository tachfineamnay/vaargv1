import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { ValkeyHealthIndicator } from './indicators/valkey.health';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, ValkeyHealthIndicator],
  exports: [DatabaseHealthIndicator, ValkeyHealthIndicator],
})
export class HealthModule {}
