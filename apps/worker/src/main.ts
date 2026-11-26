import type { DependencyStatus } from '@vaarg/shared';
import { loadWorkerConfiguration } from './infra/worker-config.js';
import { createWorkerRuntime } from './worker-runtime.js';

async function bootstrap(): Promise<void> {
  const configuration = loadWorkerConfiguration();
  const runtime = await createWorkerRuntime();

  const shutdown = (signal: string): void => {
    runtime.logger.info({ signal }, 'Shutting down worker');
    void runtime.shutdown().then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  const initial = await runtime.report();
  runtime.logger.info({ jobs: runtime.runner.registeredJobs, ...initial }, 'VAARG worker started');

  // Startup failure: exit non-zero when required dependencies are unreachable
  // and the operator has not opted into running degraded.
  const requireReady = (process.env.WORKER_REQUIRE_READY ?? 'true') !== 'false';
  if (requireReady && !initial.allReady) {
    const failed: DependencyStatus[] = [initial.database, initial.valkey].filter(
      (status) => status !== 'ready',
    );
    runtime.logger.error(
      { failedDependencies: failed },
      'Worker startup aborted: required dependencies are not ready',
    );
    await runtime.shutdown();
    process.exit(1);
  }

  // Keep the worker alive; re-probe dependencies on the configured interval.
  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      void runtime.report().then((report) => {
        if (!report.allReady) {
          runtime.logger.warn({ report }, 'Worker running with unready dependencies');
        }
      });
    }, configuration.valkey.pollIntervalMs);
    const stop = (): void => {
      clearInterval(interval);
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

void bootstrap();
