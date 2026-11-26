import { setupLogger } from './config/logger';
import { createValkeyConnection } from './config/valkey';
import { startWorker } from './lifecycle';

const logger = setupLogger();
async function bootstrap() {
  const connection = createValkeyConnection();
  const stop = await startWorker(connection);
  logger.info('Worker ready; no workflows registered');
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    try { await stop(); process.exitCode = 0; }
    catch (err) { logger.error({ err }, 'Shutdown failed'); process.exitCode = 1; }
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}
bootstrap().catch((err: unknown) => { logger.error({ err }, 'Worker startup failed'); process.exit(1); });
