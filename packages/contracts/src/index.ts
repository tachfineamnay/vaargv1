import { z } from 'zod';

const dependencyStatus = z.enum(['up', 'down']);
export const readinessSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  dependencies: z.object({ postgres: dependencyStatus, valkey: dependencyStatus }),
}).refine(value => value.status !== 'ready' || Object.values(value.dependencies).every(status => status === 'up'));
export const errorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1),
});
export type Readiness = z.infer<typeof readinessSchema>;
export type ApiError = z.infer<typeof errorSchema>;
