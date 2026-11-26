import { Module } from '@nestjs/common';
import { InfraModule } from '../infra/infra.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogV1Controller } from './catalog-v1.controller.js';
import { CatalogService } from './catalog.service.js';

/**
 * Catalog application boundary: projection reads, synchronization and
 * delegation over the shared tenant and identity modules. Merchant
 * authentication comes from IdentityModule (single engine), tenant
 * identification and active-store verification from TenantModule; provider
 * configuration remains operator-owned server configuration.
 */
@Module({
  imports: [InfraModule, TenantModule, IdentityModule],
  controllers: [CatalogController, CatalogV1Controller],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
