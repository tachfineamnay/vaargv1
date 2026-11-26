import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const storeStatusEnum = pgEnum('store_status', ['active', 'suspended', 'archived']);
export const merchantRoleEnum = pgEnum('merchant_role', ['owner', 'marketing', 'support']);
export const membershipStatusEnum = pgEnum('membership_status', ['active', 'revoked']);
export const customerStatusEnum = pgEnum('customer_status', ['active', 'deleted']);

/**
 * stores — top-level tenant. Every tenant-owned record references store_id.
 * store_id is the canonical store identifier (UUIDv7).
 */
export const stores = pgTable(
  'stores',
  {
    storeId: uuid('store_id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 120 }).notNull(),
    status: storeStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('stores_slug_uidx').on(table.slug),
  ],
);

/**
 * merchant_users — a merchant identity account. Stored credentials are
 * argon2id hashes only (no plaintext). Belongs to exactly one store via
 * store_id FK.
 */
export const merchantUsers = pgTable(
  'merchant_users',
  {
    merchantUserId: uuid('merchant_user_id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    email: varchar('email', { length: 320 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: varchar('display_name', { length: 200 }),
    status: membershipStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('merchant_users_store_email_uidx').on(table.storeId, table.email),
    index('merchant_users_store_idx').on(table.storeId),
  ],
);

/**
 * store_memberships — RBAC role grants. Composite (store_id, merchant_user_id)
 * ensures a membership cannot point across stores.
 */
export const storeMemberships = pgTable(
  'store_memberships',
  {
    membershipId: uuid('membership_id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    merchantUserId: uuid('merchant_user_id')
      .notNull()
      .references(() => merchantUsers.merchantUserId, { onDelete: 'cascade' }),
    role: merchantRoleEnum('role').notNull(),
    status: membershipStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('store_memberships_store_user_uidx').on(table.storeId, table.merchantUserId),
    index('store_memberships_store_role_idx').on(table.storeId, table.role),
  ],
);

/**
 * customers — internal customer identity, store-scoped.
 */
export const customers = pgTable(
  'customers',
  {
    customerId: uuid('customer_id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    externalId: varchar('external_id', { length: 191 }),
    email: varchar('email', { length: 320 }),
    status: customerStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('customers_store_external_uidx').on(table.storeId, table.externalId),
    index('customers_store_idx').on(table.storeId),
  ],
);

/**
 * customer_identities — external identity providers. Composite
 * (store_id, issuer, subject) uniqueness per PRD §9.1.
 */
export const customerIdentities = pgTable(
  'customer_identities',
  {
    identityId: uuid('identity_id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.customerId, { onDelete: 'cascade' }),
    issuer: varchar('issuer', { length: 120 }).notNull(),
    subject: varchar('subject', { length: 200 }).notNull(),
    verified: boolean('verified').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('customer_identities_store_issuer_subject_uidx').on(
      table.storeId,
      table.issuer,
      table.subject,
    ),
    index('customer_identities_store_customer_idx').on(table.storeId, table.customerId),
  ],
);

export type Store = typeof stores.$inferSelect;
export type NewStore = typeof stores.$inferInsert;
export type MerchantUser = typeof merchantUsers.$inferSelect;
export type NewMerchantUser = typeof merchantUsers.$inferInsert;
export type StoreMembership = typeof storeMemberships.$inferSelect;
export type NewStoreMembership = typeof storeMemberships.$inferInsert;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type CustomerIdentity = typeof customerIdentities.$inferSelect;
export type NewCustomerIdentity = typeof customerIdentities.$inferInsert;
