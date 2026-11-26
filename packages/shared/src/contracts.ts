import { z } from 'zod';
import { AppError } from './errors.js';

export const REQUEST_ID_SCHEMA = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, 'request id may only contain safe token characters');

export const timestampSchema = z.string().datetime({ offset: true });

/**
 * Dependency status for a single infrastructure component.
 * Contracts reject contradictory combinations through refinements.
 */
export const dependencyStatusSchema = z.enum([
  'ready',
  'not_ready',
  'unknown',
  'enabled',
  'disabled',
]);

export const dependencyStatus = dependencyStatusSchema;

export const readinessCheckSchema = z.object({
  name: z.string().min(1).max(64),
  status: dependencyStatusSchema,
  detail: z.string().max(512).optional(),
  latencyMs: z.number().nonnegative().optional(),
  required: z.boolean().default(true),
});

export const readinessStatusSchema = z.enum(['ready', 'not_ready']);

/**
 * Readiness payload. A component marked `required: true` that is not
 * `ready` must force the overall status to `not_ready`. Refinements reject
 * contradictory payloads (overall `ready` while a required check is
 * `not_ready`/`unknown`, or `not_ready` while every required check is ready).
 */
export const readinessSchema = z
  .object({
    status: readinessStatusSchema,
    service: z.string().min(1),
    version: z.string().min(1),
    checks: z.array(readinessCheckSchema),
    timestamp: timestampSchema,
  })
  .refine(
    (value) => {
      const required = value.checks.filter((check) => check.required);
      const anyRequiredNotReady = required.some(
        (check) => check.status === 'not_ready' || check.status === 'unknown',
      );
      const allRequiredReady =
        required.length > 0 && required.every((check) => check.status === 'ready');
      if (value.status === 'ready' && anyRequiredNotReady) {
        return false;
      }
      if (value.status === 'not_ready' && allRequiredReady) {
        return false;
      }
      return true;
    },
    {
      message:
        'Contradictory readiness state: overall status must agree with the required checks',
      path: ['status'],
    },
  );

export const LIVENESS_SCHEMA_NAME = 'liveness';

export const livenessSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string().min(1),
  version: z.string().min(1),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: timestampSchema,
});

export const versionSchema = z.object({
  service: z.string().min(1),
  version: z.string().min(1),
  node: z.string().min(1),
  env: z.enum(['development', 'test', 'production']),
});

export const echoRequestSchema = z.object({
  message: z.string().min(1).max(512),
});

export const echoResponseSchema = z.object({
  message: z.string(),
  storeId: z.string().min(1),
  receivedAt: timestampSchema,
});

export const catalogQuerySchema = z.object({
  q: z.string().min(1).max(200).optional(),
  limit: z.number().int().positive().max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
});

export type Health = z.infer<typeof livenessSchema>;
export type Readiness = z.infer<typeof readinessSchema>;
export type ReadinessCheck = z.infer<typeof readinessCheckSchema>;
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;
export type Version = z.infer<typeof versionSchema>;
export type CatalogList = z.infer<typeof echoResponseSchema>;

export function assertValid(
  schema: z.ZodTypeAny,
  payload: unknown,
  message = 'Request failed validation',
): void {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw AppError.badRequest(message, result.error.issues);
  }
}

export function parseOrThrow<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  payload: unknown,
  message = 'Request failed validation',
): z.infer<TSchema> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw AppError.badRequest(message, result.error.issues);
  }
  return result.data;
}
