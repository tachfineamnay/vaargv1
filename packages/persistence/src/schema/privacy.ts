import {
  pgTable,
  integer,
  uuid,
  text,
  timestamp,
  boolean,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { stores, customers } from './identity.js';

export const consentPurposeEnum = pgEnum('consent_purpose', [
  'analytics',
  'marketing_email',
  'marketing_push',
  'personalization',
  'data_retention',
]);
export const consentSourceEnum = pgEnum('consent_source', [
  'user_action',
  'implicit',
  'merchant_policy',
  'legal_basis',
]);
export const privacyRequestTypeEnum = pgEnum('privacy_request_type', [
  'access',
  'rectification',
  'erasure',
  'portability',
  'objection',
]);
export const privacyRequestStatusEnum = pgEnum('privacy_request_status', [
  'pending',
  'in_progress',
  'completed',
  'denied',
]);

/**
 * consent_records — append-only history of consent choices per purpose.
 * Per PRD §9: append-only, with provenance, purpose, date, version.
 */
export const consentRecords = pgTable(
  'consent_records',
  {
    consentId: uuid('consent_id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.customerId, { onDelete: 'cascade' }),
    purpose: consentPurposeEnum('purpose').notNull(),
    granted: boolean('granted').notNull(),
    source: consentSourceEnum('source').notNull(),
    version: integer('version').notNull().default(1),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('consent_records_store_customer_idx').on(table.storeId, table.customerId),
    index('consent_records_store_purpose_idx').on(table.storeId, table.purpose),
  ],
);

/**
 * marketing_permissions — effective projection of consent, per purpose/channel.
 * Coherent and checked at dispatch time per PRD §9.
 */
export const marketingPermissions = pgTable(
  'marketing_permissions',
  {
    permissionId: uuid('permission_id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.customerId, { onDelete: 'cascade' }),
    purpose: consentPurposeEnum('purpose').notNull(),
    granted: boolean('granted').notNull(),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('marketing_permissions_store_customer_purpose_uidx').on(
      table.storeId,
      table.customerId,
      table.purpose,
    ),
  ],
);

/**
 * privacy_requests — access/rectification/erasure/portability/objection requests.
 */
export const privacyRequests = pgTable(
  'privacy_requests',
  {
    requestId: uuid('request_id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.customerId, { onDelete: 'cascade' }),
    type: privacyRequestTypeEnum('type').notNull(),
    status: privacyRequestStatusEnum('status').notNull().default('pending'),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('privacy_requests_store_customer_idx').on(table.storeId, table.customerId),
  ],
);


export type ConsentRecord = typeof consentRecords.$inferSelect;
export type NewConsentRecord = typeof consentRecords.$inferInsert;
export type MarketingPermission = typeof marketingPermissions.$inferSelect;
export type NewMarketingPermission = typeof marketingPermissions.$inferInsert;
export type PrivacyRequest = typeof privacyRequests.$inferSelect;
export type NewPrivacyRequest = typeof privacyRequests.$inferInsert;
