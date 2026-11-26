import { Module } from '@nestjs/common';
import { InfraModule } from '../infra/infra.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { IdentityController } from './identity.controller.js';
import { MerchantAuthService } from './merchant-auth.service.js';
import { MerchantAuthGuard } from './merchant-auth.guard.js';
import { PermissionsGuard } from './permissions.guard.js';

/**
 * Identity boundary: merchant authentication, session lifecycle and
 * authorization guards. No catalog, tenant-resolution or privacy logic
 * lives here — those are separate modules with explicit contracts.
 */
@Module({
  imports: [InfraModule, TenantModule],
  controllers: [IdentityController],
  providers: [MerchantAuthService, MerchantAuthGuard, PermissionsGuard],
  exports: [MerchantAuthService, MerchantAuthGuard, PermissionsGuard],
})
export class IdentityModule {}
