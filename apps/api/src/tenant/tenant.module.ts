import { Module } from '@nestjs/common';
import { InfraModule } from '../infra/infra.module.js';
import { TenantContextResolver } from './tenant-context.resolver.js';

/** Trusted tenant context boundary shared by every request-scoped module. */
@Module({
  imports: [InfraModule],
  providers: [TenantContextResolver],
  exports: [TenantContextResolver],
})
export class TenantModule {}
