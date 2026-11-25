import { Worker, Job } from 'bullmq';
import { logger } from '../config/logger';
import { config } from '../config/env';

// Job types
export interface EmailJobData {
  to: string;
  subject: string;
  template: string;
  data: Record<string, unknown>;
}

export interface SyncJobData {
  storeId: string;
  resource: 'products' | 'collections' | 'customers' | 'orders';
  since?: string;
}

export interface WebhookJobData {
  storeId: string;
  topic: string;
  payload: Record<string, unknown>;
  hmac: string;
}

export interface ProjectionJobData {
  customerId: string;
  storeId: string;
}

export interface CleanupJobData {
  storeId?: string;
  olderThanDays: number;
}

type JobData = EmailJobData | SyncJobData | WebhookJobData | ProjectionJobData | CleanupJobData;

function createWorker(name: string, processor: (job: Job<JobData>) => Promise<void>) {
  return new Worker(name, processor, {
    connection: { host: 'localhost', port: 6379 }, // Will be overridden
    concurrency: config.WORKER_CONCURRENCY,
  });
  
  // Set default job options separately
  // Note: In BullMQ 5, defaultJobOptions is set on the queue, not worker
}

// Email jobs
const emailWorker = createWorker('emails', async (job) => {
  const { to, subject, template, data } = job.data as EmailJobData;
  logger.info({ jobId: job.id, to, template }, 'Processing email job');
  
  // TODO: Implement actual email sending (P09)
  await new Promise(resolve => setTimeout(resolve, 100));
  
  logger.info({ jobId: job.id }, 'Email job completed');
});

// Sync jobs
const syncWorker = createWorker('sync', async (job) => {
  const { storeId, resource, since } = job.data as SyncJobData;
  logger.info({ jobId: job.id, storeId, resource }, 'Processing sync job');
  
  // TODO: Implement Shopify sync (P02)
  await new Promise(resolve => setTimeout(resolve, 500));
  
  logger.info({ jobId: job.id }, 'Sync job completed');
});

// Webhook jobs
const webhookWorker = createWorker('webhooks', async (job) => {
  const { storeId, topic, payload } = job.data as WebhookJobData;
  logger.info({ jobId: job.id, storeId, topic }, 'Processing webhook job');
  
  // TODO: Implement webhook processing (P02)
  await new Promise(resolve => setTimeout(resolve, 50));
  
  logger.info({ jobId: job.id }, 'Webhook job completed');
});

// Projection jobs
const projectionWorker = createWorker('projections', async (job) => {
  const { customerId, storeId } = job.data as ProjectionJobData;
  logger.info({ jobId: job.id, customerId, storeId }, 'Processing projection job');
  
  // TODO: Implement purchase projection (P07)
  await new Promise(resolve => setTimeout(resolve, 200));
  
  logger.info({ jobId: job.id }, 'Projection job completed');
});

// Cleanup jobs
const cleanupWorker = createWorker('cleanup', async (job) => {
  const { storeId, olderThanDays } = job.data as CleanupJobData;
  logger.info({ jobId: job.id, storeId, olderThanDays }, 'Processing cleanup job');
  
  // TODO: Implement data cleanup (P10)
  await new Promise(resolve => setTimeout(resolve, 100));
  
  logger.info({ jobId: job.id }, 'Cleanup job completed');
});

export function registerJobs(connection: any) {
  // Override connection for all workers
  const workers: Worker[] = [emailWorker, syncWorker, webhookWorker, projectionWorker, cleanupWorker];
  
  for (const worker of workers) {
    worker.opts.connection = connection;
    worker.on('completed', (job) => {
      logger.debug({ jobId: job.id, queue: worker.name }, 'Job completed');
    });
    worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, queue: worker.name, error: err?.message }, 'Job failed');
    });
  }
  
  return workers;
}

// Queue helpers for enqueueing jobs
export const queues = {
  emails: 'emails',
  sync: 'sync',
  webhooks: 'webhooks',
  projections: 'projections',
  cleanup: 'cleanup',
};
