import { Module } from '@nestjs/common';
import { DatabaseClient } from './database-client.js';
import { ValkeyClient } from './valkey-client.js';
import { loadApiConfiguration, type ApiConfiguration } from './config.js';

/**
 * Infrastructure boundary: process-wide clients and operator configuration.
 * Storefront bindings are operator configuration loaded once at startup —
 * never derived from request data.
 */
@Module({
  providers: [
    {
      provide: 'STOREFRONT_BINDINGS',
      useFactory: async () => (await import('@vaarg/persistence')).loadStorefrontBindings(),
    },
    {
      provide: 'API_CONFIGURATION',
      useFactory: (): ApiConfiguration => loadApiConfiguration(),
    },
    {
      provide: DatabaseClient,
      useFactory: (configuration: ApiConfiguration) =>
        new DatabaseClient(configuration.database.url, configuration.database.readinessTimeoutMs),
      inject: ['API_CONFIGURATION'],
    },
    {
      provide: ValkeyClient,
      useFactory: (configuration: ApiConfiguration) =>
        new ValkeyClient(configuration.valkey.url, configuration.valkey.keyPrefix),
      inject: ['API_CONFIGURATION'],
    },
  ],
  exports: ['STOREFRONT_BINDINGS', 'API_CONFIGURATION', DatabaseClient, ValkeyClient],
})
export class InfraModule {}
