import { z } from 'zod';
import { AppError } from './errors.js';

export const REQUEST_ID_SCHEMA = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, 'request id may only contain safe token characters');

export const timestampSchema = z.string().datetime({ offset: true });

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string().min(1),
  version: z.string().min(1),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: timestampSchema,
});

export const readinessComponentSchema = z.object({
  name: z.string().min(1).max(64),
  status: z.enum(['ready', 'not_ready', 'unknown']),
  detail: z.string().max(512).optional(),
  latencyMs: z.number().nonnegative().optional(),
});

export const readinessSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  service: z.string().min(1),
  version: z.string().min(1),
  checks: z.array(readinessComponentSchema),
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

export const catalogItemSchema = z.object({
  id: z.string().min(1).max(191),
  storeId: z.string().min(1).max(64),
  title: z.string().min(1).max(255),
  status: z.enum(['active', 'draft', 'archived']),
});

export const catalogQuerySchema = z.object({
  q: z.string().min(1).max(200).optional(),
  limit: z.number().int().positive().max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
});

export const catalogListSchema = z.object({
  items: z.array(catalogItemSchema),
  nextCursor: z.string().min(1).max(512).nullable(),
});

export const inboxEventSchema = z.object({
  id: z.string().min(1).max(128),
  storeId: z.string().min(1).max(64),
  kind: z.string().min(1).max(128),
  payload: z.unknown(),
  receivedAt: timestampSchema,
});

export type CatalogList = z.infer<typeof catalogListSchema>;
export type Version = z.infer<typeof versionSchema>;
export type Health = z.infer<typeof healthSchema>;
export type Readiness = z.infer<typeof readinessSchema>;
export type CatalogItem = z.infer<typeof catalogItemSchema>;
export type InboxEvent = z.infer<typeof inboxEventSchema>;

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
