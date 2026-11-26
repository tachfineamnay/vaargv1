import { Module } from '@nestjs/common';
import { InfraModule } from '../infra/infra.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { ConsentController } from './consent.controller.js';
import { ConsentService } from './consent.service.js';

/**
 * Privacy boundary: consent retrieval, explicit updates and withdrawal.
 * No newsletter dispatch or full deletion workflow in FL02.
 */
@Module({
  imports: [InfraModule, TenantModule, IdentityModule, SessionsModule],
  controllers: [ConsentController],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class PrivacyModule {}
