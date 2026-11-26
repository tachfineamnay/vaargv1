import { describe, expect, it } from 'vitest';
import {
  AppError,
  ROLE_PERMISSIONS,
  assertPurposeGranted,
  consentStateSchema,
  consentUpdateRequestSchema,
  createSessionRequestSchema,
  emptyConsentState,
  isPurposeGranted,
  merchantIdentitySchema,
  permissionsForRole,
  roleHasPermission,
  sessionContextSchema,
  tenantContextSchema,
} from '../src/index.js';

const tenant = {
  storeId: '00000000-0000-4000-8000-000000000001',
  host: 'synthetic.example',
  country: 'FR',
  language: 'FR',
  currency: 'EUR',
  storeStatus: 'active',
  correlationId: 'req-abcdef-xyz123',
};

describe('shared application contracts — tenant context', () => {
  it('accepts a server-resolved tenant context', () => {
    expect(tenantContextSchema.safeParse(tenant).success).toBe(true);
  });

  it('rejects unknown fields and invalid hosts', () => {
    expect(tenantContextSchema.safeParse({ ...tenant, storeId: 'client-supplied' }).success).toBe(false);
    expect(tenantContextSchema.safeParse({ ...tenant, evil: 1 }).success).toBe(false);
    expect(tenantContextSchema.safeParse({ ...tenant, host: 'not a host!' }).success).toBe(false);
    expect(tenantContextSchema.safeParse({ ...tenant, correlationId: 'x' }).success).toBe(false);
  });
});

describe('shared application contracts — identity and permissions', () => {
  it('never accepts password hashes or tokens in the identity DTO', () => {
    expect(
      merchantIdentitySchema.safeParse({
        merchantUserId: '00000000-0000-4000-8000-000000000002',
        storeId: tenant.storeId,
        email: 'owner@synthetic.example',
        role: 'owner',
        sessionId: '00000000-0000-4000-8000-000000000003',
        permissions: permissionsForRole('owner'),
        passwordHash: 'argon2…',
        token: 'raw',
      }).success,
    ).toBe(false);
  });

  it('maps roles to server-side permissions', () => {
    expect(roleHasPermission('owner', 'identity:manage')).toBe(true);
    expect(roleHasPermission('marketing', 'identity:manage')).toBe(false);
    expect(roleHasPermission('support', 'catalog:sync')).toBe(false);
    expect(ROLE_PERMISSIONS.support).toContain('consents:read');
    expect(permissionsForRole('marketing')).toEqual(ROLE_PERMISSIONS.marketing);
  });
});

describe('shared application contracts — sessions and consent', () => {
  it('rejects client-supplied tenant fields in session creation', () => {
    expect(createSessionRequestSchema.safeParse({ storeId: tenant.storeId }).success).toBe(false);
    expect(createSessionRequestSchema.safeParse({ context: 'checkout' }).success).toBe(true);
    expect(createSessionRequestSchema.safeParse({ ttlSeconds: 5 }).success).toBe(false);
  });

  it('builds a session context for future modules', () => {
    const parsed = sessionContextSchema.safeParse({
      correlationId: tenant.correlationId,
      tenant,
      session: null,
      merchant: null,
      customerId: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('treats undecided consents as not granted', () => {
    const state = emptyConsentState();
    expect(consentStateSchema.safeParse(state).success).toBe(true);
    expect(isPurposeGranted(state, 'analytics')).toBe(false);
    expect(() => assertPurposeGranted(state, 'marketing_email')).toThrow(AppError);
    state.marketing_email = true;
    expect(isPurposeGranted(state, 'marketing_email')).toBe(true);
    expect(() => assertPurposeGranted(state, 'analytics')).toThrow();
  });

  it('validates explicit consent updates and withdrawal', () => {
    expect(
      consentUpdateRequestSchema.safeParse({
        purpose: 'analytics',
        granted: false,
        source: 'user_action',
      }).success,
    ).toBe(true);
    expect(consentUpdateRequestSchema.safeParse({ purpose: 'everything', granted: true }).success).toBe(
      false,
    );
    expect(
      consentUpdateRequestSchema.safeParse({
        purpose: 'marketing_email',
        granted: true,
        customerId: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });
});
