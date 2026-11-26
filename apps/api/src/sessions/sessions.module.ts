import { Module } from '@nestjs/common';
import { InfraModule } from '../infra/infra.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { SessionsController } from './sessions.controller.js';
import { VisitorSessionService } from './visitor-session.service.js';

/**
 * Visitor session boundary: create, retrieve, rotate, revoke and
 * expiration enforcement for anonymous storefront sessions.
 */
@Module({
  imports: [InfraModule, TenantModule],
  controllers: [SessionsController],
  providers: [VisitorSessionService],
  exports: [VisitorSessionService],
})
export class SessionsModule {}
