import { z } from 'zod';

/**
 * Zod 4 API boundaries. All external inputs are validated at the edge before
 * they reach the persistence layer (PRD §10). Schemas enforce shape, type,
 * length, and range constraints so invalid data never reaches PostgreSQL.
 */

// ---- Common ----
export const uuidSchema = z
  .string()
  .uuid()
  .describe('A UUID string');

export const emailSchema = z
  .string()
  .email()
  .max(320)
  .describe('A valid email address');

export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase alphanumeric with dashes');

// ---- Sessions (PRD §10 POST /sessions) ----
export const createSessionSchema = z.object({
  storeSlug: slugSchema,
  context: z
    .enum(['default', 'checkout', 'account', 'support'])
    .optional()
    .default('default'),
  ttlSeconds: z
    .number()
    .int()
    .min(60)
    .max(60 * 60 * 24 * 30)
    .optional()
    .describe('Session TTL in seconds (60s to 30d)'),
});
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

// ---- Merchant authentication ----
export const merchantLoginSchema = z.object({
  storeSlug: slugSchema,
  email: emailSchema,
  password: z.string().min(8).max(200),
});
export type MerchantLoginInput = z.infer<typeof merchantLoginSchema>;

// ---- Consent (PRD §10 consents) ----
export const consentPurposeSchema = z.enum([
  'analytics',
  'marketing_email',
  'marketing_push',
  'personalization',
  'data_retention',
]);
export const consentSourceSchema = z.enum([
  'user_action',
  'implicit',
  'merchant_policy',
  'legal_basis',
]);

export const recordConsentSchema = z.object({
  customerId: uuidSchema,
  purpose: consentPurposeSchema,
  granted: z.boolean(),
  source: consentSourceSchema,
  note: z.string().max(1000).optional(),
});
export type RecordConsentInput = z.infer<typeof recordConsentSchema>;

// ---- Webhook inbox (PRD §10 webhooks inbox) ----
export const receiveWebhookSchema = z.object({
  provider: z.string().min(1).max(60),
  providerEventId: z.string().min(1).max(200),
  eventType: z.string().min(1).max(120),
  payload: z.unknown(),
});
export type ReceiveWebhookInput = z.infer<typeof receiveWebhookSchema>;

// ---- Event envelope (PRD §10) ----
export const eventEnvelopeSchema = z.object({
  eventId: uuidSchema,
  eventType: z.string().min(1).max(120),
  occurredAt: z.string().datetime(),
  storeId: uuidSchema,
  data: z.unknown(),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

// ---- Privacy request ----
export const createPrivacyRequestSchema = z.object({
  customerId: uuidSchema,
  type: z.enum(['access', 'rectification', 'erasure', 'portability', 'objection']),
  detail: z.string().max(2000).optional(),
});
export type CreatePrivacyRequestInput = z.infer<typeof createPrivacyRequestSchema>;

// ---- Idempotency ----
export const idempotencyKeySchema = z.object({
  scope: z.enum(['merchant_auth', 'session_event', 'webhook', 'order', 'custom']),
  key: z.string().min(1).max(200),
  payload: z.unknown(),
});
export type IdempotencyKeyInput = z.infer<typeof idempotencyKeySchema>;

// ---- API versioning helper ----
export const apiVersionSchema = z.enum(['v1']);

/** Validate an unknown value against a schema; throws on invalid input. */
export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  return schema.parse(input);
}

/** Safe validate that returns the parsed value or throws a structured error. */
export function safeValidate<T>(
  schema: z.ZodType<T>,
  input: unknown,
): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues.map((i) => i.message).join('; ') };
}
