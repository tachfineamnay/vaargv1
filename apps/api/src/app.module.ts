import { Module } from '@nestjs/common';
import { HealthController, VersionController } from './health/health.controller.js';
import { ApiReadinessProbes } from './health/api-readiness-probes.js';
import { HealthService, ReadinessService } from './health/health.service.js';
import { DatabaseClient } from './infra/database-client.js';
import { ValkeyClient } from './infra/valkey-client.js';
import { InfraModule } from './infra/infra.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { PrivacyModule } from './privacy/privacy.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { ExperienceModule } from './experience/experience.module.js';

/**
 * Application composition root. Functional boundaries live in explicit
 * modules: infra (clients/config), tenant (trusted context), identity
 * (merchant auth + guards), sessions (visitor lifecycle), privacy
 * (consent) and catalog (projection/sync). Health probes stay at the
 * root alongside the version endpoint.
 */
@Module({
  imports: [
    InfraModule,
    TenantModule,
    IdentityModule,
    SessionsModule,
    PrivacyModule,
    CatalogModule,
    ExperienceModule,
  ],
  controllers: [HealthController, VersionController],
  providers: [
    {
      provide: ApiReadinessProbes,
      useFactory: (
        database: DatabaseClient,
        valkey: ValkeyClient,
        configuration: { valkey: { readinessTimeoutMs: number } },
      ) =>
        new ApiReadinessProbes(database, valkey, configuration.valkey.readinessTimeoutMs),
      inject: [DatabaseClient, ValkeyClient, 'API_CONFIGURATION'],
    },
    {
      provide: ReadinessService,
      useFactory: (probes: ApiReadinessProbes) => new ReadinessService(probes),
      inject: [ApiReadinessProbes],
    },
    HealthService,
  ],
})
export class AppModule {}
