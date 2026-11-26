import type { Logger } from 'pino';

export interface JobContext {
  jobId: string;
  attempt: number;
}

export type JobHandler = (context: JobContext) => Promise<void>;

export interface JobDefinition {
  name: string;
  handler: JobHandler;
}

/**
 * Real job registry. No placeholder or fake-success jobs are registered in
 * P00; full durable workflow integration belongs to later missions.
 */
export class JobRunner {
  constructor(
    private readonly jobs: JobDefinition[],
    private readonly logger: Logger,
  ) {}

  get registeredJobs(): string[] {
    return this.jobs.map((job) => job.name);
  }

  async run(name: string, context: JobContext): Promise<void> {
    const job = this.jobs.find((entry) => entry.name === name);
    if (!job) {
      throw new Error(`Unknown job: ${name}`);
    }
    this.logger.info({ job: name, jobId: context.jobId, attempt: context.attempt }, 'Job started');
    try {
      await job.handler(context);
      this.logger.info({ job: name, jobId: context.jobId }, 'Job completed');
    } catch (error) {
      this.logger.error(
        {
          job: name,
          jobId: context.jobId,
          error: error instanceof Error ? error.message : 'Unknown failure',
        },
        'Job failed',
      );
      throw error;
    }
  }
}
