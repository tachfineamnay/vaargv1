import { eq } from 'drizzle-orm';
import { outboxEvents } from '../schema/operations.js';

type OutboxEventStatus = 'pending' | 'dispatched' | 'failed' | 'dead';
import type { AppDb } from '../db/client.js';

/**
 * Append an event to the transactional outbox. This MUST be called inside
 * the same transaction as the business change it describes, so the outbox
 * row and the change commit atomically (PRD §9.1).
 */
export async function appendOutboxEvent(
  db: AppDb,
  storeId: string,
  eventType: string,
  payload: unknown,
): Promise<string> {
  const [event] = await db
    .insert(outboxEvents)
    .values({
      storeId,
      eventType,
      payload: JSON.stringify(payload),
    })
    .returning({ eventId: outboxEvents.eventId });
  return event!.eventId;
}

/** Fetch pending events for dispatch (within store scope). */
export async function fetchPendingEvents(
  db: AppDb,
  storeId: string,
  limit = 100,
) {
  return db.query.outboxEvents.findMany({
    where: eq(outboxEvents.storeId, storeId),
    limit,
  });
}

/** Mark an event dispatched. */
export async function markEventDispatched(
  db: AppDb,
  _storeId: string,
  eventId: string,
): Promise<void> {
  await db
    .update(outboxEvents)
    .set({ status: 'dispatched' as OutboxEventStatus, dispatchedAt: new Date() })
    .where(eq(outboxEvents.eventId, eventId));
}

/** Mark an event failed and increment attempts. */
export async function markEventFailed(
  db: AppDb,
  _storeId: string,
  eventId: string,
  error: string,
): Promise<void> {
  const event = await db.query.outboxEvents.findFirst({
    where: eq(outboxEvents.eventId, eventId),
  });
  const attempts = (event?.attempts ?? 0) + 1;
  const status: OutboxEventStatus = attempts >= 5 ? 'dead' : 'failed';
  await db
    .update(outboxEvents)
    .set({ status, attempts, lastError: error })
    .where(eq(outboxEvents.eventId, eventId));
}
