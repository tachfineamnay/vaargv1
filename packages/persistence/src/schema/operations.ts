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

export const outboxEventStatusEnum = pgEnum('outbox_event_status', [
  'pending',
  'dispatched',
  'failed',
  'dead',
]);
export const idempotencyScopeEnum = pgEnum('idempotency_scope', [
  'merchant_auth',
  'session_event',
  'webhook',
  'order',
  'custom',
]);

/**
 * outbox_events — transactional outbox. Written in the same transaction as
 * the business change; the worker dispatches and marks dispatched. Per PRD
 * §9.1: outbox lives in the business transaction.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    eventId: uuid('event_id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 120 }).notNull(),
    payload: text('payload').notNull(),
    status: outboxEventStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  },
  (table) => [
    index('outbox_events_store_status_idx').on(table.storeId, table.status),
    index('outbox_events_status_created_idx').on(table.status, table.createdAt),
  ],
);

/**
 * idempotency_keys — deduplication of external/mutating operations.
 * Unique on (scope, principal, payload_hash) per PRD §9.1.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    keyId: uuid('key_id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    scope: idempotencyScopeEnum('scope').notNull(),
    principal: varchar('principal', { length: 200 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    response: text('response'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idempotency_keys_scope_principal_key_uidx').on(
      table.storeId,
      table.scope,
      table.principal,
      table.idempotencyKey,
    ),
  ],
);

/**
 * audit_logs — append-only, redacted audit trail. No secrets or raw
 * transcripts per AC-29.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    logId: uuid('log_id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    actor: varchar('actor', { length: 200 }).notNull(),
    action: varchar('action', { length: 120 }).notNull(),
    targetType: varchar('target_type', { length: 120 }),
    targetId: varchar('target_id', { length: 200 }),
    metadata: text('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_store_actor_idx').on(table.storeId, table.actor),
    index('audit_logs_store_created_idx').on(table.storeId, table.createdAt),
  ],
);


export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
