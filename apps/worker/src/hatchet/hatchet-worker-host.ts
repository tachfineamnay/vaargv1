import { Worker, type HatchetClient } from '@hatchet-dev/typescript-sdk';
import type pino from 'pino';
import type { ImplementedWorkflowName } from '@vaarg/shared';
import {
  createHatchetSdkClient,
  resolveHatchetSdkConfig,
} from '@vaarg/persistence';
import {
  buildRegisteredHatchetWorkflows,
  type HatchetWorkflowRuntimeDeps,
} from './hatchet-workflows.js';

export interface HatchetWorkerHost {
  readonly status: 'NOT_CONFIGURED' | 'CONFIGURED' | 'RUNNING' | 'STOPPED';
  readonly registeredWorkflows: readonly ImplementedWorkflowName[];
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createHatchetWorkerHost(
  deps: HatchetWorkflowRuntimeDeps,
  logger: pino.Logger,
): HatchetWorkerHost {
  const resolved = resolveHatchetSdkConfig(deps.env);
  if (resolved.status === 'NOT_CONFIGURED') {
    const built = buildRegisteredHatchetWorkflows(deps);
    logger.info({ detail: resolved.detail }, 'Hatchet SDK worker not configured; skipping engine connect');
    return {
      status: 'NOT_CONFIGURED',
      registeredWorkflows: built.names,
      async start() {
        // No-op when Hatchet is disabled/unconfigured
      },
      async stop() {
        // No-op
      },
    };
  }

  let currentStatus: 'CONFIGURED' | 'RUNNING' | 'STOPPED' = 'CONFIGURED';
  const client: HatchetClient = createHatchetSdkClient(resolved.config);
  const built = buildRegisteredHatchetWorkflows(deps, client);
  let hatchetWorker: Worker | null = null;
  let runLoopPromise: Promise<void> | null = null;

  return {
    get status() {
      return currentStatus;
    },
    registeredWorkflows: built.names,
    async start() {
      if (currentStatus === 'RUNNING') return;
      hatchetWorker = await Worker.create(client, resolved.config.workerName, {
        slots: resolved.config.workerSlots,
        handleKill: false,
      });
      await hatchetWorker.registerWorkflows(built.declarations);
      runLoopPromise = hatchetWorker.start().catch((err: unknown) => {
        logger.error({ err }, 'Hatchet worker loop exited with error');
      });
      await hatchetWorker.waitUntilReady(15_000);
      currentStatus = 'RUNNING';
      logger.info(
        {
          workerName: resolved.config.workerName,
          workflows: built.names,
        },
        'Hatchet SDK worker started and registered workflows',
      );
    },
    async stop() {
      if (!hatchetWorker || currentStatus === 'STOPPED') {
        currentStatus = 'STOPPED';
        return;
      }
      await hatchetWorker.stop();
      if (runLoopPromise) {
        await runLoopPromise.catch(() => undefined);
      }
      currentStatus = 'STOPPED';
      logger.info('Hatchet SDK worker stopped');
    },
  };
}
