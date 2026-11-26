import { pgTable, uuid, varchar, jsonb, timestamp, index, integer } from 'drizzle-orm/pg-core';
import { stores } from './identity.js';

/**
 * storefront_configs — versioned, store-specific configuration. Separate from
 * customer data per PRD §3.2. Configuration is versioned for preview/publish/
 * rollback; only the active revision is read at runtime.
 */
export const storefrontConfigs = pgTable(
  'storefront_configs',
  {
    configId: uuid('config_id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    market: varchar('market', { length: 32 }).notNull().default('default'),
    config: jsonb('config').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('storefront_configs_store_rev_idx').on(table.storeId, table.revision),
  ],
);


export type StorefrontConfig = typeof storefrontConfigs.$inferSelect;
export type NewStorefrontConfig = typeof storefrontConfigs.$inferInsert;
