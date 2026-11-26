import { eq, and } from 'drizzle-orm';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import {
  merchantUsers,
  storeMemberships,
} from '../schema/identity.js';

import { verifyArgon2Hash } from './passwords.js';
import type { AppDb } from '../db/client.js';

type MerchantRole = 'owner' | 'marketing' | 'support';

/** Opaque session token: random bytes, never stored in plaintext. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Hash a token for storage/lookup (SHA-256 digest, not the raw token). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface MerchantAuthResult {
  storeId: string;
  merchantUserId: string;
  role: MerchantRole;
  token: string;
}

export interface MerchantIdentity {
  merchantUserId: string;
  storeId: string;
  email: string;
  role: MerchantRole;
  status: string;
}

/**
 * Authenticate a merchant by email + password within a store scope.
 *
 * This is REAL authentication: argon2id verification against the stored
 * password hash. There is no mock login and no identity bypass. The returned
 * opaque token must be stored (hashed) by the caller in a session store.
 */
export async function authenticateMerchant(
  db: AppDb,
  storeId: string,
  email: string,
  password: string,
): Promise<MerchantAuthResult | null> {
  const user = await db.query.merchantUsers.findFirst({
    where: and(
      eq(merchantUsers.storeId, storeId),
      eq(merchantUsers.email, email.toLowerCase()),
    ),
  });

  // Always run a verify to avoid leaking user existence via timing.
  if (!user) {
    await verifyArgon2Hash(password, 'dummy-hash-for-timing');
    return null;
  }

  const ok = await verifyArgon2Hash(password, user.passwordHash);
  if (!ok || user.status !== 'active') {
    return null;
  }

  const membership = await db.query.storeMemberships.findFirst({
    where: and(
      eq(storeMemberships.storeId, storeId),
      eq(storeMemberships.merchantUserId, user.merchantUserId),
    ),
  });
  if (!membership || membership.status !== 'active') {
    return null;
  }

  return {
    storeId,
    merchantUserId: user.merchantUserId,
    role: membership.role,
    token: generateSessionToken(),
  };
}

/** Get the active role for a merchant user in a store. */
export async function getMerchantRole(
  db: AppDb,
  storeId: string,
  merchantUserId: string,
): Promise<MerchantRole | null> {
  const m = await db.query.storeMemberships.findFirst({
    where: and(
      eq(storeMemberships.storeId, storeId),
      eq(storeMemberships.merchantUserId, merchantUserId),
    ),
  });
  return m?.role ?? null;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
