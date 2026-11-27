import { createServer } from 'node:http';
import { loadWorkerConfiguration } from './infra/worker-config.js';
import { createWorkerRuntime } from './worker-runtime.js';

async function bootstrap(): Promise<void> {
  const configuration = loadWorkerConfiguration();
  const runtime = await createWorkerRuntime();
  const initial = await runtime.report();
  if ((process.env.WORKER_REQUIRE_READY ?? 'true') !== 'false' && !initial.allReady) {
    runtime.logger.error('Worker startup aborted: required dependencies are not ready');
    await runtime.shutdown();
    process.exitCode = 1;
    return;
  }
  const port = Number(process.env.WORKER_PORT ?? '5010');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid WORKER_PORT');
  const server = createServer((req, res) => {
    if (req.url === '/health/live') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', revision: process.env.APP_VERSION ?? 'unknown' }));
    } else if (req.url === '/health/ready') {
      void runtime.report().then((report) => {
        res.writeHead(report.allReady ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: report.allReady ? 'ready' : 'not_ready', ...report }));
      }).catch(() => { res.writeHead(503); res.end(); });
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, configuration.app.host, resolve);
  });
  await runtime.hatchet.start();
  runtime.logger.info(
    {
      revision: process.env.APP_VERSION ?? 'unknown',
      jobs: runtime.runner.registeredJobs,
      hatchetStatus: runtime.hatchet.status,
      hatchetWorkflows: runtime.hatchet.registeredWorkflows,
    },
    'Worker started',
  );
  const interval = setInterval(() => {
    void runtime.report().then((report) => {
      if (!report.allReady) runtime.logger.warn({ report }, 'Worker running with unready dependencies');
    }).catch(() => runtime.logger.warn('Worker dependency check failed'));
  }, configuration.valkey.pollIntervalMs);
  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    clearInterval(interval);
    runtime.logger.info({ signal }, 'Worker shutting down');
    server.close(() => { void runtime.shutdown().then(() => { process.exitCode = 0; }).catch(() => { process.exitCode = 1; }); });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}
void bootstrap().catch(() => {
  console.error(JSON.stringify({ event: 'worker_startup_failed' }));
  process.exit(1);
});
