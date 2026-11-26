import type { Logger } from '@vaarg/shared';

export interface JobContext {
  jobId: string;
  attempt: number;
}

export type JobHandler = (context: JobContext) => Promise<void>;

export interface JobDefinition {
  name: string;
  handler: JobHandler;
}

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
    this.logger.info(`Job started`, { job: name, jobId: context.jobId, attempt: context.attempt });
    try {
      await job.handler(context);
      this.logger.info(`Job completed`, { job: name, jobId: context.jobId });
    } catch (error) {
      this.logger.error(`Job failed`, {
        job: name,
        jobId: context.jobId,
        error: error instanceof Error ? error.message : 'Unknown failure',
      });
      throw error;
    }
  }
}
