import { Module } from '@nestjs/common';
import { CatalogController } from './catalog/catalog.controller.js';
import { CatalogService } from './catalog/catalog.service.js';
import { HealthController, VersionController } from './health/health.controller.js';
import { ApiReadinessProbes } from './health/api-readiness-probes.js';
import { HealthService, ReadinessService } from './health/health.service.js';
import { DatabaseClient } from './infra/database-client.js';
import { ValkeyClient } from './infra/valkey-client.js';
import { loadApiConfiguration, type ApiConfiguration } from './infra/config.js';

@Module({
  controllers: [HealthController, VersionController, CatalogController],
  providers: [
    {
      provide: 'API_CONFIGURATION',
      useFactory: () => loadApiConfiguration(),
    },
    {
      provide: DatabaseClient,
      useFactory: (configuration: ApiConfiguration) =>
        new DatabaseClient(configuration.database.url),
      inject: ['API_CONFIGURATION'],
    },
    {
      provide: ValkeyClient,
      useFactory: (configuration: ApiConfiguration) =>
        new ValkeyClient(configuration.valkey.url, configuration.valkey.keyPrefix),
      inject: ['API_CONFIGURATION'],
    },
    {
      provide: ApiReadinessProbes,
      useFactory: (
        database: DatabaseClient,
        valkey: ValkeyClient,
        configuration: ApiConfiguration,
      ) =>
        new ApiReadinessProbes(
          database,
          valkey,
          configuration.database.readinessTimeoutMs,
          configuration.valkey.readinessTimeoutMs,
        ),
      inject: [DatabaseClient, ValkeyClient, 'API_CONFIGURATION'],
    },
    {
      provide: ReadinessService,
      useFactory: (probes: ApiReadinessProbes) => new ReadinessService(probes),
      inject: [ApiReadinessProbes],
    },
    HealthService,
    CatalogService,
  ],
})
export class AppModule {}
