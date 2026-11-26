import { describe, it, expect } from 'vitest';
import {
  createSessionSchema,
  merchantLoginSchema,
  recordConsentSchema,
  receiveWebhookSchema,
  eventEnvelopeSchema,
  safeValidate,
} from '../src/validation/schemas.js';

describe('Zod API boundaries (T13)', () => {
  it('accepts a valid create-session request', () => {
    const data = createSessionSchema.parse({
      storeSlug: 'my-store',
      context: 'checkout',
      ttlSeconds: 3600,
    });
    expect(data.context).toBe('checkout');
    expect(data.ttlSeconds).toBe(3600);
  });

  it('rejects an invalid slug', () => {
    const result = safeValidate(createSessionSchema, {
      storeSlug: 'INVALID_SLUG',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a short merchant password', () => {
    const result = safeValidate(merchantLoginSchema, {
      storeSlug: 'my-store',
      email: 'a@b.com',
      password: 'short',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid email', () => {
    const result = safeValidate(merchantLoginSchema, {
      storeSlug: 'my-store',
      email: 'not-an-email',
      password: 'longpassword',
    });
    expect(result.ok).toBe(false);
  });

  it('validates consent records with a valid purpose', () => {
    const id = '00000000-0000-7000-8000-000000000001';
    const result = safeValidate(recordConsentSchema, {
      customerId: id,
      purpose: 'marketing_email',
      granted: true,
      source: 'user_action',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown consent purpose', () => {
    const result = safeValidate(recordConsentSchema, {
      customerId: '00000000-0000-7000-8000-000000000001',
      purpose: 'not_a_purpose',
      granted: true,
      source: 'user_action',
    });
    expect(result.ok).toBe(false);
  });

  it('validates a webhook receipt', () => {
    const result = safeValidate(receiveWebhookSchema, {
      provider: 'stripe',
      providerEventId: 'evt_123',
      eventType: 'payment.intent.succeeded',
      payload: { id: 'pi_123' },
    });
    expect(result.ok).toBe(true);
  });

  it('validates an event envelope', () => {
    const result = safeValidate(eventEnvelopeSchema, {
      eventId: '00000000-0000-7000-8000-000000000001',
      eventType: 'order.created',
      occurredAt: '2026-01-01T00:00:00Z',
      storeId: '00000000-0000-7000-8000-000000000002',
      data: { orderId: 'o_1' },
    });
    expect(result.ok).toBe(true);
  });
});
