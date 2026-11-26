import { z } from 'zod';
import { AppError } from './errors.js';

/**
 * FL02 application contracts. Domain-level, framework-independent Zod
 * contracts shared by the API, persistence and future modules (experience,
 * conversations, cart, personalization, marketing). Nothing here imports
 * NestJS, Drizzle or Shopify.
 */

// ---------------------------------------------------------------------------
// Identity, roles and permissions
// ---------------------------------------------------------------------------

export const merchantRoleSchema = z.enum(['owner', 'marketing', 'support']);
export type MerchantRole = z.infer<typeof merchantRoleSchema>;

export const permissionSchema = z.enum([
  'catalog:read',
  'catalog:sync',
  'customers:read',
  'consents:read',
  'consents:write',
  'sessions:manage',
  'identity:manage',
]);
export type Permission = z.infer<typeof permissionSchema>;

/** Server-side RBAC map. The server is the only authority for grants. */
export const ROLE_PERMISSIONS: Readonly<Record<MerchantRole, readonly Permission[]>> = Object.freeze({
  owner: [
    'catalog:read',
    'catalog:sync',
    'customers:read',
    'consents:read',
    'consents:write',
    'sessions:manage',
    'identity:manage',
  ],
  marketing: ['catalog:read', 'catalog:sync', 'customers:read', 'consents:read', 'consents:write'],
  support: ['catalog:read', 'sessions:manage', 'consents:read'],
});

export function permissionsForRole(role: MerchantRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function roleHasPermission(role: MerchantRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

// ---------------------------------------------------------------------------
// Tenant context
// ---------------------------------------------------------------------------

export const storeStatusSchema = z.enum(['active', 'suspended', 'archived']);
export type StoreStatus = z.infer<typeof storeStatusSchema>;

export const storefrontHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i, 'invalid host');

export const correlationIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, 'unsafe correlation id');

/**
 * Server-resolved tenant authority. Produced only from operator-configured
 * storefront bindings plus verified store state; never from client-supplied
 * store ids.
 */
export const tenantContextSchema = z.strictObject({
  storeId: z.uuid(),
  host: storefrontHostSchema,
  country: z.string().regex(/^[A-Z]{2}$/),
  language: z.string().regex(/^[A-Z]{2,3}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  storeStatus: storeStatusSchema,
  correlationId: correlationIdSchema,
});
export type TenantContext = z.infer<typeof tenantContextSchema>;

// ---------------------------------------------------------------------------
// Merchant identity (safe DTO — never contains tokens or password hashes)
// ---------------------------------------------------------------------------

export const merchantIdentitySchema = z.strictObject({
  merchantUserId: z.uuid(),
  storeId: z.uuid(),
  email: z.string().max(320),
  role: merchantRoleSchema,
  sessionId: z.uuid(),
  permissions: z.array(permissionSchema),
});
export type MerchantIdentity = z.infer<typeof merchantIdentitySchema>;

// ---------------------------------------------------------------------------
// Visitor session and session context
// ---------------------------------------------------------------------------

export const sessionContextKindSchema = z.enum(['default', 'checkout', 'account', 'support']);
export type SessionContextKind = z.infer<typeof sessionContextKindSchema>;

export const visitorSessionSchema = z.strictObject({
  sessionId: z.uuid(),
  storeId: z.uuid(),
  customerId: z.uuid().nullable(),
  context: sessionContextKindSchema,
  status: z.enum(['active', 'expired', 'rotated', 'revoked']),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type VisitorSession = z.infer<typeof visitorSessionSchema>;

/**
 * Request-scoped session context handed to future adaptive experience,
 * conversation, cart and personalization modules.
 */
export const sessionContextSchema = z.strictObject({
  correlationId: correlationIdSchema,
  tenant: tenantContextSchema,
  session: visitorSessionSchema.nullable(),
  merchant: merchantIdentitySchema.nullable(),
  customerId: z.uuid().nullable(),
});
export type SessionContext = z.infer<typeof sessionContextSchema>;

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/** Vocabulary matches the persistence `consent_purpose` enum. */
export const consentPurposeSchema = z.enum([
  'analytics',
  'marketing_email',
  'marketing_push',
  'personalization',
  'data_retention',
]);
export type ConsentPurpose = z.infer<typeof consentPurposeSchema>;

export const consentSourceSchema = z.enum([
  'user_action',
  'implicit',
  'merchant_policy',
  'legal_basis',
]);
export type ConsentSource = z.infer<typeof consentSourceSchema>;

/** Effective per-purpose permission projection. `null` = never decided. */
export const consentStateSchema = z.object({
  analytics: z.boolean().nullable(),
  marketing_email: z.boolean().nullable(),
  marketing_push: z.boolean().nullable(),
  personalization: z.boolean().nullable(),
  data_retention: z.boolean().nullable(),
});
export type ConsentState = z.infer<typeof consentStateSchema>;

export const emptyConsentState = (): ConsentState => ({
  analytics: null,
  marketing_email: null,
  marketing_push: null,
  personalization: null,
  data_retention: null,
});

/** Purpose-based permission check reused by future memory/marketing modules. */
export function isPurposeGranted(state: ConsentState, purpose: ConsentPurpose): boolean {
  return state[purpose] === true;
}

export function assertPurposeGranted(
  state: ConsentState,
  purpose: ConsentPurpose,
  message = `Consent required for ${purpose}`,
): void {
  if (!isPurposeGranted(state, purpose)) throw AppError.forbidden(message);
}

// ---------------------------------------------------------------------------
// HTTP request/response contracts for FL02 endpoints
// ---------------------------------------------------------------------------

export const createSessionRequestSchema = z.strictObject({
  context: sessionContextKindSchema.optional(),
  ttlSeconds: z.number().int().min(60).max(60 * 60 * 24 * 30).optional(),
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const sessionEnvelopeSchema = z.strictObject({
  session: visitorSessionSchema,
  tenant: tenantContextSchema,
});
export type SessionEnvelope = z.infer<typeof sessionEnvelopeSchema>;

export const merchantLoginV1RequestSchema = z.strictObject({
  email: z.email().max(320),
  password: z.string().min(8).max(200),
});
export type MerchantLoginV1Request = z.infer<typeof merchantLoginV1RequestSchema>;

export const bearerTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const merchantAuthResponseSchema = z.strictObject({
  identity: merchantIdentitySchema,
  token: bearerTokenSchema,
});
export type MerchantAuthResponse = z.infer<typeof merchantAuthResponseSchema>;

export const merchantIdentityResponseSchema = z.strictObject({
  identity: merchantIdentitySchema,
});
export type MerchantIdentityResponse = z.infer<typeof merchantIdentityResponseSchema>;

export const consentUpdateRequestSchema = z.strictObject({
  purpose: consentPurposeSchema,
  granted: z.boolean(),
  source: consentSourceSchema.optional(),
  note: z.string().max(1000).optional(),
  customerId: z.uuid().optional(),
});
export type ConsentUpdateRequest = z.infer<typeof consentUpdateRequestSchema>;

export const consentStateResponseSchema = z.strictObject({
  customerId: z.uuid().nullable(),
  consents: consentStateSchema,
});
export type ConsentStateResponse = z.infer<typeof consentStateResponseSchema>;

// ---------------------------------------------------------------------------
// Structured application errors (stable code envelope)
// ---------------------------------------------------------------------------

export const appErrorKindSchema = z.enum([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'unprocessable',
  'unavailable',
  'internal',
]);
export type AppErrorKindName = z.infer<typeof appErrorKindSchema>;

export const appErrorBodySchema = z.object({
  error: z.object({
    kind: appErrorKindSchema,
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});
export type AppErrorBodyContract = z.infer<typeof appErrorBodySchema>;
