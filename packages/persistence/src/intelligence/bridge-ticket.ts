import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '@vaarg/shared';
import { z } from 'zod';

const bridgeTicketPayloadSchema = z
  .object({
    v: z.literal(1),
    storeId: z.string().uuid(),
    rootRunId: z.string().uuid(),
    conversationId: z.string().uuid(),
    sessionId: z.string().uuid(),
    preventiveHooksVerified: z.boolean(),
    iat: z.number().int().positive(),
    exp: z.number().int().positive(),
  })
  .strict();

export type RunBridgeTicketClaims = z.infer<typeof bridgeTicketPayloadSchema>;

function assertSecret(secret: string): void {
  if (!secret || secret.trim().length < 32) {
    throw AppError.unavailable(
      'HERMES_BRIDGE_NOT_CONFIGURED: HERMES_TOOL_BRIDGE_SECRET must be at least 32 characters',
    );
  }
}

export function issueRunBridgeTicket(
  secret: string,
  claims: Omit<RunBridgeTicketClaims, 'v' | 'iat' | 'exp'> & { ttlMs: number },
  nowMs = Date.now(),
): string {
  assertSecret(secret);
  const ttlMs = Math.max(1_000, Math.min(300_000, Math.trunc(claims.ttlMs)));
  const payload: RunBridgeTicketClaims = {
    v: 1,
    storeId: claims.storeId,
    rootRunId: claims.rootRunId,
    conversationId: claims.conversationId,
    sessionId: claims.sessionId,
    preventiveHooksVerified: claims.preventiveHooksVerified,
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor((nowMs + ttlMs) / 1000) + 5,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(body, 'utf8').digest('base64url');
  return `${body}.${sig}`;
}

export function verifyRunBridgeTicket(
  secret: string,
  ticket: string,
  nowMs = Date.now(),
): RunBridgeTicketClaims {
  assertSecret(secret);
  const parts = ticket.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw AppError.unauthorized('INVALID_BRIDGE_TICKET: Malformed bridge ticket');
  }
  const [body, providedSig] = parts;
  const expectedSig = createHmac('sha256', secret).update(body, 'utf8').digest('base64url');
  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw AppError.unauthorized('INVALID_BRIDGE_TICKET: Signature verification failed');
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw AppError.unauthorized('INVALID_BRIDGE_TICKET: Invalid payload encoding');
  }

  const parsed = bridgeTicketPayloadSchema.safeParse(rawJson);
  if (!parsed.success) {
    throw AppError.unauthorized('INVALID_BRIDGE_TICKET: Claims failed validation');
  }
  if (parsed.data.exp < Math.floor(nowMs / 1000)) {
    throw AppError.unauthorized('EXPIRED_BRIDGE_TICKET: Run bridge ticket has expired');
  }
  return parsed.data;
}

export function verifySharedBridgeSecret(expectedSecret: string | undefined, authHeader: string | undefined): void {
  if (!expectedSecret || expectedSecret.trim().length < 32) {
    throw AppError.unavailable('HERMES_BRIDGE_NOT_CONFIGURED: Bridge secret is not configured');
  }
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw AppError.unauthorized('BRIDGE_AUTH_REQUIRED: Missing Bearer token on internal Hermes bridge');
  }
  const provided = authHeader.slice('Bearer '.length).trim();
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expectedSecret.trim(), 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw AppError.unauthorized('BRIDGE_AUTH_INVALID: Invalid internal Hermes bridge token');
  }
}
