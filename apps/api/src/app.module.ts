import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './db/database.module';
import { StoresModule } from './modules/stores/stores.module';
import { ProductsModule } from './modules/products/products.module';
import { CartModule } from './modules/cart/cart.module';
import { OrdersModule } from './modules/orders/orders.module';
import { CustomersModule } from './modules/customers/customers.module';

@Module({
  imports: [
    // Configuration
    ConfigModule,

    // Health checks
    TerminusModule,
    HealthModule,

    // Database
    DatabaseModule,

    // Feature modules
    StoresModule,
    ProductsModule,
    CartModule,
    OrdersModule,
    CustomersModule,
  ],
})
export class AppModule {}
