import 'reflect-metadata';
import { setupLogger } from './config/logger';
import { createValkeyConnection } from './config/valkey';
import { registerJobs } from './jobs/index';
import { config } from './config/env';

const logger = setupLogger();

async function bootstrap() {
  logger.info('Starting VAARG Worker...');

  // Create Valkey connection
  const connection = createValkeyConnection();

  // Register job processors
  const workers = registerJobs(connection);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down worker...');
    await Promise.all(workers.map((w) => w.close()));
    await connection.quit();
    logger.info('Worker shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info(
    {
      queues: workers.map((w) => w.name),
      concurrency: config.WORKER_CONCURRENCY,
    },
    'Worker started successfully'
  );
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Failed to start worker');
  process.exit(1);
});
