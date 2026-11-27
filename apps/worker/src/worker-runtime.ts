import pino from 'pino';
import { Redis } from 'ioredis';
import { createDb, executeCatalogStep, loadStorefrontBindings, resolveMerchantSessionId, withStoreContext } from '@vaarg/persistence';
import { WorkerDependencies, type DependencyReport } from './infra/dependencies.js';
import { loadWorkerConfiguration } from './infra/worker-config.js';
import { JobRunner } from './jobs/job-runner.js';
import { createCatalogJob } from './jobs/catalog-job.js';
import { createEmbeddingJob } from './jobs/embedding-job.js';

export interface WorkerRuntime {
  logger: pino.Logger;
  dependencies: WorkerDependencies;
  runner: JobRunner;
  report(): Promise<DependencyReport>;
  shutdown(): Promise<void>;
}

export async function createWorkerRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorkerRuntime> {
  const configuration = loadWorkerConfiguration(env);
  const logger = pino({
    level: configuration.app.logLevel,
    formatters: { level: (label) => ({ level: label }) },
    redact: {
      paths: ['*.apiKey', '*.api_key', '*.token', '*.password'],
      censor: '[redacted]',
    },
  });

  const dependencies = new WorkerDependencies(configuration, logger);
  const report = await dependencies.check();
  logger.info(report, 'Worker dependency readiness');

  const bindings = loadStorefrontBindings(env);
  const delegationSecret = env.CATALOG_JOB_SIGNING_SECRET;
  if (delegationSecret && delegationSecret.length < 32) throw new Error('INVALID_CATALOG_JOB_SIGNING_SECRET');
  if (bindings.length && !delegationSecret) logger.warn('Catalog job delegation is not configured');
  // No keyPrefix: all worker and CLI instances share the same store pacing key.
  const rateClient = bindings.length && delegationSecret ? new Redis(configuration.valkey.url, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 5000 }) : undefined;
  rateClient?.on('error', () => undefined);
  const jobs = rateClient && delegationSecret ? [createCatalogJob(bindings, delegationSecret,
    async (binding, merchantUserId, sessionId) => { const identity = await withStoreContext(createDb(dependencies.database.getPool()), binding.storeId, tx => resolveMerchantSessionId(tx, binding.storeId, sessionId)); return identity?.merchantUserId === merchantUserId ? identity : null; },
    (binding, action, signal, jobId) => executeCatalogStep(dependencies.database.getPool(), rateClient, binding, env, action, signal, jobId),
  )] : [];
  // Embeddings maintenance is registered unconditionally (FL05): without a
  // provider key the job reports NOT_CONFIGURED and performs no paid work.
  jobs.push(createEmbeddingJob(dependencies.database.getPool(), env));
  const runner = new JobRunner(jobs, logger);

  return {
    logger,
    dependencies,
    runner,
    report: () => dependencies.check(),
    shutdown: async () => {
      logger.info('Worker shutting down');
      rateClient?.disconnect();
      await dependencies.close();
    },
  };
}

