import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ACTIVE_TOOL_CAPABILITIES,
  AppError,
  type HermesBridgeRuntimeAttestRequest,
} from '@vaarg/shared';
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

const REQUIRED_PREVENTIVE_HOOKS = [
  'pre_tool_call',
  'pre_api_request',
  'post_api_request',
  'subagent_start',
  'subagent_stop',
] as const;

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
  const sig = createHmac('sha256', secret.trim()).update(body, 'utf8').digest('base64url');
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
  const expectedSig = createHmac('sha256', secret.trim()).update(body, 'utf8').digest('base64url');
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

export function verifySharedBridgeSecret(
  expectedSecret: string | undefined,
  authHeader: string | undefined,
): void {
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

/**
 * Cryptographic HMAC-SHA256 challenge signature proving the target Hermes runtime
 * shares `HERMES_TOOL_BRIDGE_SECRET` and runs the VAARG confinement plugin.
 * Self-reported capability JSON fields or unsigned headers are NEVER accepted.
 */
export function signConfinementChallenge(
  secret: string,
  nonce: string,
  reportedVersion: string,
): string {
  assertSecret(secret);
  return createHmac('sha256', secret.trim())
    .update(`vaarg-confinement:v1:${nonce}:${reportedVersion}`, 'utf8')
    .digest('hex');
}

export function verifyConfinementChallengeSignature(
  secret: string | undefined,
  nonce: string,
  reportedVersion: string,
  providedSignature: string | null | undefined,
): boolean {
  if (!secret || secret.trim().length < 32 || !nonce || !providedSignature) {
    return false;
  }
  const expected = signConfinementChallenge(secret.trim(), nonce, reportedVersion);
  const a = Buffer.from(providedSignature.trim(), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signRuntimeAttestationPayload(
  secret: string,
  payload: Omit<HermesBridgeRuntimeAttestRequest, 'signature'>,
): string {
  assertSecret(secret);
  const canonical = [
    'vaarg-runtime-attest:v1',
    payload.runtimeInstanceId,
    payload.hermesVersion,
    payload.pluginVersion,
    [...payload.activeHooks].sort().join(','),
    [...payload.registeredCapabilities].sort().join(','),
    payload.forbiddenToolsBlocked ? '1' : '0',
    String(payload.timestampMs),
  ].join('|');
  return createHmac('sha256', secret.trim()).update(canonical, 'utf8').digest('hex');
}

export function verifyRuntimeAttestationPayload(
  secret: string | undefined,
  payload: HermesBridgeRuntimeAttestRequest,
  nowMs = Date.now(),
): { verified: boolean; reason: string | null } {
  if (!secret || secret.trim().length < 32) {
    return { verified: false, reason: 'HERMES_TOOL_BRIDGE_SECRET is not configured' };
  }
  if (Math.abs(nowMs - payload.timestampMs) > 120_000) {
    return { verified: false, reason: 'Runtime attestation timestamp is stale or skewed' };
  }
  if (!payload.forbiddenToolsBlocked) {
    return { verified: false, reason: 'Runtime attestation did not confirm forbiddenToolsBlocked' };
  }
  const hookSet = new Set(payload.activeHooks);
  for (const requiredHook of REQUIRED_PREVENTIVE_HOOKS) {
    if (!hookSet.has(requiredHook)) {
      return { verified: false, reason: `Missing required preventive hook "${requiredHook}"` };
    }
  }
  const capSet = new Set(payload.registeredCapabilities);
  for (const requiredCap of ACTIVE_TOOL_CAPABILITIES) {
    if (!capSet.has(requiredCap)) {
      return { verified: false, reason: `Missing required ToolBroker capability "${requiredCap}"` };
    }
  }

  const expectedSig = signRuntimeAttestationPayload(secret.trim(), payload);
  const a = Buffer.from(payload.signature.trim(), 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { verified: false, reason: 'Runtime attestation HMAC signature mismatch' };
  }
  return { verified: true, reason: null };
}

export interface AttestedRuntimeLease {
  runtimeInstanceId: string;
  hermesVersion: string;
  pluginVersion: string;
  verifiedAtMs: number;
  expiresAtMs: number;
}

/**
 * Server-held registry of cryptographically verified `vaarg-confinement` plugin
 * runtime attestations. Prevents unverified self-reported capability payloads
 * from ever certifying confinement.
 */
export class ConfinementAttestationRegistry {
  private readonly leases = new Map<string, AttestedRuntimeLease>();
  private readonly leaseTtlMs: number;

  constructor(leaseTtlMs = 300_000) {
    this.leaseTtlMs = leaseTtlMs;
  }

  recordVerifiedAttestation(
    secret: string | undefined,
    payload: HermesBridgeRuntimeAttestRequest,
    nowMs = Date.now(),
  ): AttestedRuntimeLease {
    const check = verifyRuntimeAttestationPayload(secret, payload, nowMs);
    if (!check.verified) {
      throw AppError.forbidden(
        `INVALID_RUNTIME_ATTESTATION: ${check.reason ?? 'Confinement attestation rejected'}`,
      );
    }
    const lease: AttestedRuntimeLease = {
      runtimeInstanceId: payload.runtimeInstanceId,
      hermesVersion: payload.hermesVersion,
      pluginVersion: payload.pluginVersion,
      verifiedAtMs: nowMs,
      expiresAtMs: nowMs + this.leaseTtlMs,
    };
    this.leases.set(payload.runtimeInstanceId, lease);
    return lease;
  }

  hasFreshAttestation(nowMs = Date.now()): boolean {
    for (const [id, lease] of this.leases.entries()) {
      if (lease.expiresAtMs <= nowMs) {
        this.leases.delete(id);
      } else {
        return true;
      }
    }
    return false;
  }
}
