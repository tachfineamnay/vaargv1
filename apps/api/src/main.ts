import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { loadApiConfiguration } from './infra/config.js';
import { ApiExceptionFilter } from './common/exception.filter.js';

async function bootstrap(): Promise<void> {
  const configuration = loadApiConfiguration();
  const logger = new Logger('bootstrap');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      trustProxy: true,
    }),
    {
      logger: ['log', 'error', 'warn'],
    },
  );

  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  const port = configuration.app.port;
  const host = configuration.app.host;
  await app.listen(port, host);
  logger.log(`VAARG API listening on http://${host}:${port} (${configuration.app.nodeEnv})`);
}

void bootstrap();
