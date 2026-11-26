import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { stores, customers } from './identity.js';

export const sessionStatusEnum = pgEnum('session_status', [
  'active',
  'expired',
  'rotated',
  'revoked',
]);

/**
 * visitor_sessions — anonymous visitor sessions. Store-scoped. Token is
 * stored hashed; rotation creates a new row and revokes the old.
 */
export const visitorSessions = pgTable(
  'visitor_sessions',
  {
    sessionId: uuid('session_id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.customerId, {
      onDelete: 'set null',
    }),
    tokenHash: varchar('token_hash', { length: 128 }).notNull(),
    status: sessionStatusEnum('status').notNull().default('active'),
    context: varchar('context', { length: 32 }).notNull().default('default'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    rotatedFrom: uuid('rotated_from'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('visitor_sessions_store_token_hash_uidx').on(table.storeId, table.tokenHash),
    foreignKey({ name: 'visitor_sessions_store_customer_fk', columns: [table.storeId, table.customerId], foreignColumns: [customers.storeId, customers.customerId] }),
    index('visitor_sessions_store_status_idx').on(table.storeId, table.status),
    index('visitor_sessions_store_customer_idx').on(table.storeId, table.customerId),
  ],
);

export type VisitorSession = typeof visitorSessions.$inferSelect;
export type NewVisitorSession = typeof visitorSessions.$inferInsert;
