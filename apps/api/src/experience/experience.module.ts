import { Module } from '@nestjs/common';
import { InfraModule } from '../infra/infra.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { PrivacyModule } from '../privacy/privacy.module.js';
import { ExperienceController } from './experience.controller.js';
import { ExperienceService } from './experience.service.js';

/**
 * Adaptive experience boundary (FL05): unified context, interaction
 * ingestion, contextual search, deterministic recommendations, composition
 * publishing, adaptation refresh and exploration reset. Reuses the shared
 * tenant, session and consent modules — no second identity engine.
 * `ExperienceService` also exposes the five bounded capability methods the
 * future Hermes ToolBroker will bind to (FL06) — no agent runtime here.
 */
@Module({
  imports: [InfraModule, TenantModule, SessionsModule, PrivacyModule],
  controllers: [ExperienceController],
  providers: [ExperienceService],
  exports: [ExperienceService],
})
export class ExperienceModule {}
