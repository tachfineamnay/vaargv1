import {
  consentStateResponseSchema,
  sessionEnvelopeSchema,
  type ConsentPurpose,
  type ConsentStateResponse,
  type SessionEnvelope,
} from '@vaarg/shared';
import { StorefrontError, storefrontErrorFromResponse } from './errors';

/** Browser-side calls to the constrained same-origin session/consent BFF. */
export type BffResult<T> = { ok: true; data: T } | { ok: false; error: StorefrontError };

async function request<T>(path: string, init: RequestInit, parse: (raw: unknown) => T): Promise<BffResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return { ok: false, error: new StorefrontError('network', 'Storefront session API unreachable') };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { ok: false, error: storefrontErrorFromResponse(response.status, text) };
  }
  let raw: unknown;
  try {
    const text = await response.text();
    raw = text ? JSON.parse(text) : null;
  } catch {
    return { ok: false, error: new StorefrontError('invalid_response', 'Malformed session API payload', { status: response.status }) };
  }
  try {
    return { ok: true, data: parse(raw) };
  } catch {
    return { ok: false, error: new StorefrontError('invalid_response', 'Session API response failed contract validation', { status: response.status }) };
  }
}

const jsonHeaders = { accept: 'application/json', 'content-type': 'application/json' };

export function getSession(): Promise<BffResult<SessionEnvelope>> {
  return request('/api/session', { headers: { accept: 'application/json' } }, (raw) => sessionEnvelopeSchema.parse(raw));
}

export function bootstrapSession(body: { context?: string; ttlSeconds?: number } = {}): Promise<BffResult<SessionEnvelope>> {
  return request('/api/session', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }, (raw) =>
    sessionEnvelopeSchema.parse(raw),
  );
}

export function rotateSession(): Promise<BffResult<SessionEnvelope>> {
  return request('/api/session/rotate', { method: 'POST', headers: { accept: 'application/json' } }, (raw) =>
    sessionEnvelopeSchema.parse(raw),
  );
}

export function revokeSession(): Promise<BffResult<{ status: string }>> {
  return request('/api/session', { method: 'DELETE', headers: { accept: 'application/json' } }, (raw) => {
    if (raw && typeof raw === 'object' && 'status' in raw) return { status: String((raw as { status: unknown }).status) };
    throw new StorefrontError('invalid_response', 'Unexpected revoke payload');
  });
}

export function getConsents(): Promise<BffResult<ConsentStateResponse>> {
  return request('/api/consent', { headers: { accept: 'application/json' } }, (raw) => consentStateResponseSchema.parse(raw));
}

export function updateConsent(body: { purpose: ConsentPurpose; granted: boolean; note?: string }): Promise<BffResult<ConsentStateResponse>> {
  return request('/api/consent', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }, (raw) =>
    consentStateResponseSchema.parse(raw),
  );
}
