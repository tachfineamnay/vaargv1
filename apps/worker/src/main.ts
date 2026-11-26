import {
  createJsonLogger,
  type Logger,
} from '@vaarg/shared';
import { WorkerDependencies, type DependencyReport } from './infra/dependencies.js';
import { loadWorkerConfiguration } from './infra/worker-config.js';
import { JobRunner } from './jobs/job-runner.js';

export interface WorkerRuntime {
  logger: Logger;
  dependencies: WorkerDependencies;
  runner: JobRunner;
  report(): Promise<DependencyReport>;
  shutdown(): Promise<void>;
}

export async function createWorkerRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<WorkerRuntime> {
  const configuration = loadWorkerConfiguration(env);
  const logger = createJsonLogger({ level: configuration.app.logLevel });

  const dependencies = new WorkerDependencies(configuration, logger);
  const report = await dependencies.check();

  logger.info('Worker dependency readiness', { ...report });

  const runner = new JobRunner([], logger);

  return {
    logger,
    dependencies,
    runner,
    report: () => dependencies.check(),
    shutdown: async () => {
      logger.info('Worker shutting down');
      await dependencies.close();
    },
  };
}

async function bootstrap(): Promise<void> {
  const runtime = await createWorkerRuntime();

  const shutdown = (): void => {
    runtime.logger.info('Shutting down worker');
    void runtime.shutdown().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  runtime.logger.info('VAARG worker started', {
    jobs: runtime.runner.registeredJobs,
    hatchet: runtime.report().then((report) => report.hatchet),
  });

  // Keep the worker alive; dependency health is re-probed periodically.
  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      void runtime.report().then((report) => {
        if (!report.allReady) {
          runtime.logger.warn('Worker running with unready dependencies');
        }
      });
    }, 30_000);
    const stop = (): void => {
      clearInterval(interval);
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

void bootstrap();
