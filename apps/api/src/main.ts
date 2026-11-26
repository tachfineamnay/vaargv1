import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance } from 'fastify';
import { AppModule } from './app.module.js';
import { loadApiConfiguration } from './infra/config.js';
import { createApiLogger } from './infra/logger.js';
import { ApiExceptionFilter } from './common/exception.filter.js';
import { REQUEST_ID_HEADER } from './common/request-context.js';
import { REQUEST_ID_SCHEMA } from '@vaarg/shared';

async function bootstrap(): Promise<void> {
  const configuration = loadApiConfiguration();
  const logger = createApiLogger(configuration.app.logLevel);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      // Explicit trusted-proxy boundary: forwarded headers are only
      // trusted when the operator enables TRUST_PROXY behind a proxy.
      trustProxy: configuration.http.trustProxy,
    }),
    { logger: false },
  );

  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;

  // Request ID: accept a safe client value or generate one.
  fastify.addHook('onRequest', async (request, reply) => {
    const header = request.headers[REQUEST_ID_HEADER];
    const raw = Array.isArray(header) ? header[0] : header;
    const parsed = REQUEST_ID_SCHEMA.safeParse(raw);
    const requestId = parsed.success
      ? parsed.data
      : `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    request.headers[REQUEST_ID_HEADER] = requestId;
    reply.header(REQUEST_ID_HEADER, requestId);
    logger.info({ method: request.method, requestId }, 'request');
  });

  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  const port = configuration.app.port;
  const host = configuration.app.host;
  await app.listen(port, host);
  logger.info({ host, port, nodeEnv: configuration.app.nodeEnv, revision: process.env.APP_VERSION }, 'VAARG API listening');
}

void bootstrap().catch(() => {
  console.error(JSON.stringify({ event: 'api_startup_failed' }));
  process.exitCode = 1;
});
