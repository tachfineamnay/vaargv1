import { Module, Global } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
        PORT: Joi.number().port().default(4000),
        HOST: Joi.string().default('0.0.0.0'),
        CORS_ORIGIN: Joi.string().default('http://localhost:3000'),
        LOG_LEVEL: Joi.string()
          .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
          .default('info'),
        APP_VERSION: Joi.string().default('0.0.0'),
        GIT_COMMIT: Joi.string().default('unknown'),

        // Database
        DATABASE_URL: Joi.string().uri().required(),
        DATABASE_POOL_SIZE: Joi.number().default(10),

        // Redis/Valkey
        VALKEY_URL: Joi.string().uri().required(),

        // Shopify (optional for P00)
        SHOPIFY_STORE_DOMAIN: Joi.string().optional(),
        SHOPIFY_STOREFRONT_TOKEN: Joi.string().optional(),
        SHOPIFY_ADMIN_TOKEN: Joi.string().optional(),

        // AI (optional for P00)
        GEMINI_API_KEY: Joi.string().optional(),
        DEEPSEEK_API_KEY: Joi.string().optional(),
      }),
      validationOptions: { abortEarly: true, allowUnknown: true },
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}
