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
  foreignKey,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { stores, customers } from './identity.js';
import { visitorSessions } from './experience.js';

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
    foreignKey({
      name: 'consent_records_store_customer_fk',
      columns: [table.storeId, table.customerId],
      foreignColumns: [customers.storeId, customers.customerId],
    }).onDelete('cascade'),
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
    foreignKey({
      name: 'marketing_permissions_store_customer_fk',
      columns: [table.storeId, table.customerId],
      foreignColumns: [customers.storeId, customers.customerId],
    }).onDelete('cascade'),
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
    foreignKey({
      name: 'privacy_requests_store_customer_fk',
      columns: [table.storeId, table.customerId],
      foreignColumns: [customers.storeId, customers.customerId],
    }).onDelete('cascade'),
  ],
);

/**
 * FL07-FIX 07 — session-scoped anonymous consent. Append-only evidence keyed
 * by the anonymous session (never a synthetic customer identity).
 */
export const anonymousConsentPurposeEnum = pgEnum('anonymous_consent_purpose', [
  'analytics',
  'personalization',
]);
export const anonymousConsentSourceEnum = pgEnum('anonymous_consent_source', [
  'user_action',
  'merchant_policy',
  'legal_basis',
]);

export const anonymousConsentRecords = pgTable(
  'anonymous_consent_records',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    recordId: uuid('record_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    purpose: anonymousConsentPurposeEnum('purpose').notNull(),
    granted: boolean('granted').notNull(),
    source: anonymousConsentSourceEnum('source').notNull(),
    note: text('note'),
    version: integer('version').notNull().default(1),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'anonymous_consent_records_pkey',
      columns: [table.storeId, table.recordId],
    }),
    foreignKey({
      name: 'anonymous_consent_records_store_session_fk',
      columns: [table.storeId, table.sessionId],
      foreignColumns: [visitorSessions.storeId, visitorSessions.sessionId],
    }).onDelete('cascade'),
    index('anonymous_consent_records_session_idx').on(
      table.storeId,
      table.sessionId,
      table.purpose,
      table.createdAt,
    ),
    index('anonymous_consent_records_expiry_idx').on(table.storeId, table.expiresAt),
  ],
);

export const anonymousConsentProjections = pgTable(
  'anonymous_consent_projections',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').notNull(),
    purpose: anonymousConsentPurposeEnum('purpose').notNull(),
    granted: boolean('granted').notNull(),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'anonymous_consent_projections_pkey',
      columns: [table.storeId, table.sessionId, table.purpose],
    }),
    foreignKey({
      name: 'anonymous_consent_projections_store_session_fk',
      columns: [table.storeId, table.sessionId],
      foreignColumns: [visitorSessions.storeId, visitorSessions.sessionId],
    }).onDelete('cascade'),
  ],
);

export type ConsentRecord = typeof consentRecords.$inferSelect;
export type NewConsentRecord = typeof consentRecords.$inferInsert;
export type MarketingPermission = typeof marketingPermissions.$inferSelect;
export type NewMarketingPermission = typeof marketingPermissions.$inferInsert;
export type PrivacyRequest = typeof privacyRequests.$inferSelect;
export type NewPrivacyRequest = typeof privacyRequests.$inferInsert;
export type AnonymousConsentRecord = typeof anonymousConsentRecords.$inferSelect;
export type NewAnonymousConsentRecord = typeof anonymousConsentRecords.$inferInsert;
export type AnonymousConsentProjection = typeof anonymousConsentProjections.$inferSelect;
export type NewAnonymousConsentProjection = typeof anonymousConsentProjections.$inferInsert;
