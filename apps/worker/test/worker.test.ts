import { describe, expect, it } from 'vitest';
import { JobRunner } from '../src/jobs/job-runner.js';
import { createJsonLogger } from '@vaarg/shared';

describe('worker job runner', () => {
  it('executes registered jobs and records lifecycle events', async () => {
    const logger = createJsonLogger({ level: 'error' });
    const calls: string[] = [];
    const runner = new JobRunner(
      [
        {
          name: 'noop',
          handler: async (context) => {
            calls.push(`noop:${context.jobId}`);
          },
        },
      ],
      logger,
    );

    expect(runner.registeredJobs).toEqual(['noop']);
    await runner.run('noop', { jobId: 'job-1', attempt: 1 });
    expect(calls).toEqual(['noop:job-1']);
  });

  it('rejects unknown jobs without executing anything', async () => {
    const logger = createJsonLogger({ level: 'error' });
    const runner = new JobRunner([], logger);
    await expect(runner.run('missing', { jobId: 'x', attempt: 1 })).rejects.toThrow(
      'Unknown job: missing',
    );
  });

  it('propagates handler failures after logging them', async () => {
    const logger = createJsonLogger({ level: 'error' });
    const runner = new JobRunner(
      [
        {
          name: 'boom',
          handler: async () => {
            throw new Error('handler exploded');
          },
        },
      ],
      logger,
    );
    await expect(runner.run('boom', { jobId: 'y', attempt: 2 })).rejects.toThrow(
      'handler exploded',
    );
  });
});
