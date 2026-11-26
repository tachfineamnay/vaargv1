import { eq, and, sql, type SQL } from 'drizzle-orm';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import {
  merchantUsers,
  storeMemberships,
  merchantSessions,
} from '../schema/identity.js';

import { verifyArgon2Hash } from './passwords.js';
import type { AppDb } from '../db/client.js';

type MerchantRole = 'owner' | 'marketing' | 'support';
const MERCHANT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
// Public synthetic hash: equal-cost verification when the account is absent.
const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$JrMrkgBb02qa4mWjZFSpMQ$dQCnb/8uGIqcqkZlonq+FkxUHqkBAFn+bHFxiLTbdQU';

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
  sessionId: string;
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
 * opaque token is stored only as a digest in the scoped session table.
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
    await verifyArgon2Hash(password, DUMMY_HASH);
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

  const token = generateSessionToken();
  await db.insert(merchantSessions).values({ storeId, merchantUserId: user.merchantUserId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + MERCHANT_SESSION_TTL_MS) });
  return {
    storeId,
    merchantUserId: user.merchantUserId,
    role: membership.role,
    token,
  };
}

/** Membership and account status are checked on every session use. */
export async function resolveMerchantSession(db: AppDb, storeId: string, token: string): Promise<MerchantIdentity | null> {
  return findActiveMerchantSession(db, storeId, eq(merchantSessions.tokenHash, hashToken(token)));
}

/** Revalidate the originating session without putting its bearer token in a job. */
export async function resolveMerchantSessionId(db: AppDb, storeId: string, sessionId: string): Promise<MerchantIdentity | null> {
  return findActiveMerchantSession(db, storeId, eq(merchantSessions.sessionId, sessionId));
}

async function findActiveMerchantSession(db: AppDb, storeId: string, selector: SQL): Promise<MerchantIdentity | null> {
  const [identity] = await db.select({ sessionId: merchantSessions.sessionId, merchantUserId: merchantUsers.merchantUserId, storeId: merchantUsers.storeId, email: merchantUsers.email, role: storeMemberships.role, status: merchantUsers.status })
    .from(merchantSessions)
    .innerJoin(merchantUsers, and(eq(merchantUsers.storeId, merchantSessions.storeId), eq(merchantUsers.merchantUserId, merchantSessions.merchantUserId), eq(merchantUsers.status, 'active')))
    .innerJoin(storeMemberships, and(eq(storeMemberships.storeId, merchantSessions.storeId), eq(storeMemberships.merchantUserId, merchantSessions.merchantUserId), eq(storeMemberships.status, 'active')))
    .where(and(eq(merchantSessions.storeId, storeId), selector, eq(merchantSessions.status, 'active'), sql`${merchantSessions.expiresAt} > now()`));
  return identity ?? null;
}

/** One SQL statement atomically consumes the old token and inserts its successor. */
export async function rotateMerchantSession(db: AppDb, storeId: string, oldToken: string): Promise<{ token: string; expiresAt: Date } | null> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + MERCHANT_SESSION_TTL_MS);
  const result = await db.execute<{ session_id: string }>(sql`
    WITH old AS (
      UPDATE merchant_sessions s SET status = 'rotated'
      WHERE s.store_id = ${storeId} AND s.token_hash = ${hashToken(oldToken)} AND s.status = 'active' AND s.expires_at > now()
        AND EXISTS (SELECT 1 FROM merchant_users u JOIN store_memberships m ON m.store_id = u.store_id AND m.merchant_user_id = u.merchant_user_id
          WHERE u.store_id = s.store_id AND u.merchant_user_id = s.merchant_user_id AND u.status = 'active' AND m.status = 'active')
      RETURNING s.session_id, s.store_id, s.merchant_user_id
    )
    INSERT INTO merchant_sessions(store_id, merchant_user_id, token_hash, expires_at, rotated_from)
    SELECT store_id, merchant_user_id, ${hashToken(token)}, ${expiresAt}, session_id FROM old RETURNING session_id
  `);
  return result.rows.length ? { token, expiresAt } : null;
}

export async function revokeMerchantSession(db: AppDb, storeId: string, token: string): Promise<boolean> {
  const rows = await db.update(merchantSessions).set({ status: 'revoked' }).where(and(eq(merchantSessions.storeId, storeId), eq(merchantSessions.tokenHash, hashToken(token)), eq(merchantSessions.status, 'active'))).returning({ sessionId: merchantSessions.sessionId });
  return rows.length > 0;
}

/** Get the active role for a merchant user in a store. */
export async function getMerchantRole(
  db: AppDb,
  storeId: string,
  merchantUserId: string,
): Promise<MerchantRole | null> {
  const [m] = await db.select({ role: storeMemberships.role }).from(storeMemberships)
    .innerJoin(merchantUsers, and(
      eq(merchantUsers.storeId, storeMemberships.storeId),
      eq(merchantUsers.merchantUserId, storeMemberships.merchantUserId),
      eq(merchantUsers.status, 'active'),
    )).where(and(
      eq(storeMemberships.storeId, storeId),
      eq(storeMemberships.merchantUserId, merchantUserId),
      eq(storeMemberships.status, 'active'),
    ));
  return m?.role ?? null;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
