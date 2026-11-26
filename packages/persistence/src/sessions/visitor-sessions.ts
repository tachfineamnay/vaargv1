import { eq, and, lt } from 'drizzle-orm';
import { visitorSessions } from '../schema/experience.js';
import { generateSessionToken, hashToken } from '../auth/merchant-auth.js';
import type { AppDb } from '../db/client.js';

/** Default anonymous session lifetime (24h). */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface VisitorSessionRecord {
  sessionId: string;
  storeId: string;
  customerId: string | null;
  status: string;
  context: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Create an anonymous visitor session scoped to a store. The raw token is
 * returned once; only its hash is stored.
 */
export async function createVisitorSession(
  db: AppDb,
  storeId: string,
  customerId: string | null = null,
  context: string = 'default',
  ttlMs: number = SESSION_TTL_MS,
): Promise<{ sessionId: string; token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ttlMs);

  const [session] = await db
    .insert(visitorSessions)
    .values({ storeId, customerId, tokenHash, context, expiresAt })
    .returning();

  return { sessionId: session!.sessionId, token, expiresAt };
}

/** Resolve a session by token hash within the store scope. */
export async function resolveVisitorSession(
  db: AppDb,
  storeId: string,
  token: string,
): Promise<VisitorSessionRecord | null> {
  const tokenHash = hashToken(token);
  const session = await db.query.visitorSessions.findFirst({
    where: and(
      eq(visitorSessions.storeId, storeId),
      eq(visitorSessions.tokenHash, tokenHash),
    ),
  });
  if (!session) return null;

  // Expiry check: expired sessions are marked and treated as absent.
  if (session.expiresAt.getTime() <= Date.now() && session.status === 'active') {
    await db
      .update(visitorSessions)
      .set({ status: 'expired' })
      .where(eq(visitorSessions.sessionId, session.sessionId));
    return null;
  }
  return session;
}

/**
 * Rotate a session: revoke the old token and issue a fresh one. This is the
 * session rotation required for security (PRD §11).
 */
export async function rotateVisitorSession(
  db: AppDb,
  storeId: string,
  oldToken: string,
  ttlMs: number = SESSION_TTL_MS,
): Promise<{ sessionId: string; token: string; expiresAt: Date } | null> {
  const oldHash = hashToken(oldToken);
  const oldSession = await db.query.visitorSessions.findFirst({
    where: and(
      eq(visitorSessions.storeId, storeId),
      eq(visitorSessions.tokenHash, oldHash),
    ),
  });
  if (!oldSession || oldSession.status !== 'active') return null;

  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ttlMs);

  await db
    .update(visitorSessions)
    .set({ status: 'rotated' })
    .where(eq(visitorSessions.sessionId, oldSession.sessionId));

  const [session] = await db
    .insert(visitorSessions)
    .values({
      storeId,
      customerId: oldSession.customerId,
      tokenHash,
      context: oldSession.context,
      expiresAt,
      rotatedFrom: oldSession.sessionId,
    })
    .returning();

  return { sessionId: session!.sessionId, token, expiresAt };
}

/** Revoke a session by id (within store scope). */
export async function revokeVisitorSession(
  db: AppDb,
  storeId: string,
  sessionId: string,
): Promise<boolean> {
  const rows = await db
    .update(visitorSessions)
    .set({ status: 'revoked' })
    .where(
      and(
        eq(visitorSessions.storeId, storeId),
        eq(visitorSessions.sessionId, sessionId),
      ),
    )
    .returning({ sessionId: visitorSessions.sessionId });
  return rows.length > 0;
}

/** List expired sessions for cleanup (within store scope). */
export async function listExpiredSessions(
  db: AppDb,
  storeId: string,
): Promise<VisitorSessionRecord[]> {
  return db.query.visitorSessions.findMany({
    where: and(
      eq(visitorSessions.storeId, storeId),
      eq(visitorSessions.status, 'active'),
      lt(visitorSessions.expiresAt, new Date()),
    ),
  });
}
