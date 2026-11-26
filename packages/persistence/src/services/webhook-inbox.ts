import { eq, and } from 'drizzle-orm';
import { webhookInbox } from '../schema/integration.js';
import type { AppDb } from '../db/client.js';

export interface WebhookResult {
  inboxId: string;
  status: 'received' | 'duplicate';
}

/**
 * Receive a webhook event. Dedup is enforced by the unique index on
 * (store_id, provider, provider_event_id): a duplicate insert is caught and
 * reported as 'duplicate' rather than processed again.
 */
export async function receiveWebhook(
  db: AppDb,
  storeId: string,
  provider: string,
  providerEventId: string,
  eventType: string,
  payload: unknown,
): Promise<WebhookResult> {
  try {
    const [row] = await db
      .insert(webhookInbox)
      .values({
        storeId,
        provider,
        providerEventId,
        eventType,
        payload: JSON.stringify(payload),
      })
      .returning({ inboxId: webhookInbox.inboxId, status: webhookInbox.status });
    return { inboxId: row!.inboxId, status: 'received' };
  } catch (error) {
    // Unique violation → duplicate event.
    const msg = (error as Error).message;
    if (msg.includes('webhook_inbox_store_provider_event_uidx')) {
      return { inboxId: '', status: 'duplicate' };
    }
    throw error;
  }
}

/** Mark a webhook processed. */
export async function markWebhookProcessed(
  db: AppDb,
  storeId: string,
  inboxId: string,
): Promise<void> {
  await db
    .update(webhookInbox)
    .set({ status: 'processed', processedAt: new Date() })
    .where(and(eq(webhookInbox.storeId, storeId), eq(webhookInbox.inboxId, inboxId)));
}
