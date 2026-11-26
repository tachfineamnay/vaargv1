import { Module } from '@nestjs/common';
import { InfraModule } from '../infra/infra.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

/**
 * Catalog application boundary: projection reads, synchronization and
 * delegation. Authentication/authorization are delegated to the identity
 * module's MerchantAuthService; tenant identification reuses the shared
 * storefront-binding boundary.
 */
@Module({
  imports: [InfraModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
