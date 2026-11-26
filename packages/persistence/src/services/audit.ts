import { auditLogs } from '../schema/operations.js';
import type { AppDb } from '../db/client.js';

/**
 * Append a redacted audit log entry. No secrets or raw transcripts — only
 * the action, actor, and a sanitized metadata payload (AC-29).
 */
export async function recordAudit(
  db: AppDb,
  storeId: string,
  actor: string,
  action: string,
  targetType?: string,
  targetId?: string,
  metadata?: unknown,
): Promise<void> {
  await db.insert(auditLogs).values({
    storeId,
    actor,
    action,
    targetType,
    targetId,
    metadata: metadata ? JSON.stringify(metadata) : null,
  });
}
