import { eq, and } from 'drizzle-orm';
import { webhookInbox } from '../schema/integration.js';
import type { AppDb } from '../db/client.js';

export interface WebhookResult {
  inboxId: string;
  status: 'received' | 'duplicate';
}

/**
 * Receive a webhook event. Dedup is enforced by the unique index on
 * (store_id, provider, provider_event_id), without aborting the transaction.
 */
export async function receiveWebhook(
  db: AppDb,
  storeId: string,
  provider: string,
  providerEventId: string,
  eventType: string,
  payload: unknown,
): Promise<WebhookResult> {
    const [row] = await db
      .insert(webhookInbox)
      .values({
        storeId,
        provider,
        providerEventId,
        eventType,
        payload: JSON.stringify(payload),
      })
      .onConflictDoNothing({ target: [webhookInbox.storeId, webhookInbox.provider, webhookInbox.providerEventId] })
      .returning({ inboxId: webhookInbox.inboxId });
    if (row) return { inboxId: row.inboxId, status: 'received' };
    const existing = await db.query.webhookInbox.findFirst({
      where: and(eq(webhookInbox.storeId, storeId), eq(webhookInbox.provider, provider), eq(webhookInbox.providerEventId, providerEventId)),
    });
    if (!existing) throw new Error('WEBHOOK_DUPLICATE_NOT_VISIBLE');
    return { inboxId: existing.inboxId, status: 'duplicate' };
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
