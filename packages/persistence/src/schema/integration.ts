import {
  pgTable,
  integer,
  uuid,
  varchar,
  text,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { stores } from './identity.js';

export const webhookStatusEnum = pgEnum('webhook_status', [
  'received',
  'processing',
  'processed',
  'failed',
  'duplicate',
]);

/**
 * webhook_inbox — durable webhook receipt. Unique on (store_id,
 * provider_event_id) per PRD §9.1, giving dedup on replay.
 */
export const webhookInbox = pgTable(
  'webhook_inbox',
  {
    inboxId: uuid('inbox_id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 60 }).notNull(),
    providerEventId: varchar('provider_event_id', { length: 200 }).notNull(),
    eventType: varchar('event_type', { length: 120 }).notNull(),
    payload: text('payload').notNull(),
    status: webhookStatusEnum('status').notNull().default('received'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('webhook_inbox_store_provider_event_uidx').on(
      table.storeId,
      table.provider,
      table.providerEventId,
    ),
    index('webhook_inbox_store_status_idx').on(table.storeId, table.status),
  ],
);


export type WebhookInbox = typeof webhookInbox.$inferSelect;
export type NewWebhookInbox = typeof webhookInbox.$inferInsert;
