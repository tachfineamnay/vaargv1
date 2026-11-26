import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  boolean,
  integer,
  numeric,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { stores } from './identity.js';

/**
 * FL03 catalog model. The imported Shopify snapshots (catalog_imports /
 * catalog_projection, migrations 0002/0008/0009) are the provider evidence;
 * every table below is a derived, rebuildable, market-scoped read projection
 * synchronized in the same checkpoint transaction as the imported page.
 * Shopify stays the only commercial truth; nothing here feeds back to the
 * provider. Scope key is (store_id, country, language), so these rows are
 * also the localized product content per market.
 */

/** Durable import generation state (existing FL02 mechanism, preserved). */
export const catalogImports = pgTable('catalog_imports', {
  storeId: uuid('store_id').notNull().references(() => stores.storeId, { onDelete: 'cascade' }),
  country: varchar('country', { length: 2 }).notNull(),
  language: varchar('language', { length: 3 }).notNull(),
  generation: uuid('generation').notNull(),
  phase: varchar('phase', { length: 20 }).notNull(),
  cursor: text('cursor'),
  cursorHistory: text('cursor_history').array().notNull().default([]),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  leaseToken: uuid('lease_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.storeId, table.country, table.language], name: 'catalog_imports_pkey' }),
]);

/** Raw provider evidence per market (existing mechanism, preserved). */
export const catalogProjection = pgTable('catalog_projection', {
  storeId: uuid('store_id').notNull(),
  country: varchar('country', { length: 2 }).notNull(),
  language: varchar('language', { length: 3 }).notNull(),
  kind: varchar('kind', { length: 20 }).notNull(),
  shopifyId: text('shopify_id').notNull(),
  payload: jsonb('payload').notNull(),
  seenGeneration: uuid('seen_generation').notNull(),
  visible: boolean('visible').notNull().default(true),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.storeId, table.country, table.language, table.kind, table.shopifyId], name: 'catalog_projection_pkey' }),
  index('catalog_projection_visible_idx').on(table.storeId, table.country, table.language, table.kind, table.visible),
]);

/** Durable job receipts (existing FL02 mechanism, preserved). */
export const catalogJobReceipts = pgTable('catalog_job_receipts', {
  storeId: uuid('store_id').notNull(),
  jobId: uuid('job_id').notNull(),
  country: varchar('country', { length: 2 }).notNull(),
  language: varchar('language', { length: 3 }).notNull(),
  action: varchar('action', { length: 10 }).notNull(),
  generation: uuid('generation').notNull(),
  phase: varchar('phase', { length: 20 }).notNull(),
  cursor: text('cursor'),
  cursorHistory: text('cursor_history').array().notNull().default([]),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.storeId, table.jobId], name: 'catalog_job_receipts_pkey' }),
]);

/** Normalized product rows (one per store+market+product). */
export const catalogProducts = pgTable('catalog_products', {
  storeId: uuid('store_id').notNull().references(() => stores.storeId, { onDelete: 'cascade' }),
  country: varchar('country', { length: 2 }).notNull(),
  language: varchar('language', { length: 3 }).notNull(),
  productGid: text('product_gid').notNull(),
  handle: varchar('handle', { length: 255 }).notNull(),
  title: text('title').notNull(),
  titleNormalized: text('title_normalized').notNull(),
  description: text('description').notNull(),
  descriptionNormalized: text('description_normalized').notNull(),
  productType: text('product_type').notNull(),
  vendor: text('vendor').notNull(),
  tags: text('tags').array().notNull().default([]),
  options: jsonb('options').notNull().default([]),
  availableForSale: boolean('available_for_sale').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  providerUpdatedAt: timestamp('provider_updated_at', { withTimezone: true }).notNull(),
  generation: uuid('generation').notNull(),
  visible: boolean('visible').notNull().default(true),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.storeId, table.country, table.language, table.productGid], name: 'catalog_products_pkey' }),
  uniqueIndex('catalog_products_handle_uidx').on(table.storeId, table.country, table.language, table.handle),
  index('catalog_products_visible_idx').on(table.storeId, table.country, table.language, table.visible),
  index('catalog_products_title_idx').on(table.storeId, table.country, table.language, table.visible, table.title),
  index('catalog_products_type_idx').on(table.storeId, table.country, table.language, table.visible, table.productType),
  index('catalog_products_vendor_idx').on(table.storeId, table.country, table.language, table.visible, table.vendor),
  index('catalog_products_generation_idx').on(table.storeId, table.country, table.language, table.generation),
]);

/** Market-scoped variant rows carrying the market price/availability snapshot. */
export const catalogVariants = pgTable('catalog_variants', {
  storeId: uuid('store_id').notNull(),
  country: varchar('country', { length: 2 }).notNull(),
  language: varchar('language', { length: 3 }).notNull(),
  variantGid: text('variant_gid').notNull(),
  productGid: text('product_gid').notNull(),
  position: integer('position').notNull().default(0),
  title: text('title').notNull(),
  sku: varchar('sku', { length: 255 }),
  selectedOptions: jsonb('selected_options').notNull().default([]),
  availableForSale: boolean('available_for_sale').notNull(),
  currentlyNotInStock: boolean('currently_not_in_stock').notNull().default(false),
  quantityAvailable: integer('quantity_available'),
  priceAmount: numeric('price_amount', { precision: 20, scale: 6 }).notNull(),
  compareAtAmount: numeric('compare_at_amount', { precision: 20, scale: 6 }),
  currency: varchar('currency', { length: 3 }).notNull(),
  imageUrl: text('image_url'),
  imageAlt: text('image_alt'),
  generation: uuid('generation').notNull(),
  visible: boolean('visible').notNull().default(true),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.storeId, table.country, table.language, table.variantGid], name: 'catalog_variants_pkey' }),
  index('catalog_variants_product_idx').on(table.storeId, table.country, table.language, table.productGid, table.visible, table.position),
  index('catalog_variants_price_idx').on(table.storeId, table.country, table.language, table.visible, table.currency, table.priceAmount),
  index('catalog_variants_generation_idx').on(table.storeId, table.country, table.language, table.generation),
]);

export const catalogProductMedia = pgTable('catalog_product_media', {
  storeId: uuid('store_id').notNull(),
  country: varchar('country', { length: 2 }).notNull(),
  language: varchar('language', { length: 3 }).notNull(),
  productGid: text('product_gid').notNull(),
  mediaId: text('media_id').notNull(),
  mediaType: varchar('media_type', { length: 20 }).notNull(),
  ordinal: integer('ordinal').notNull(),
  url: text('url').notNull(),
  alt: text('alt'),
  previewUrl: text('preview_url'),
  generation: uuid('generation').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.storeId, table.country, table.language, table.productGid, table.mediaId], name: 'catalog_product_media_pkey' }),
  index('catalog_product_media_product_idx').on(table.storeId, table.country, table.language, table.productGid, table.ordinal),
]);

/** Options and configured metafields only (facet/filter substrate). */
export const catalogProductAttributes = pgTable('catalog_product_attributes', {
  storeId: uuid('store_id').notNull(),
  country: varchar('country', { length: 2 }).notNull(),
  language: varchar('language', { length: 3 }).notNull(),
  productGid: text('product_gid').notNull(),
  source: varchar('source', { length: 10 }).notNull(),
  name: text('name').notNull(),
  value: text('value').notNull(),
  valueType: varchar('value_type', { length: 120 }),
  generation: uuid('generation').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.storeId, table.country, table.language, table.productGid, table.source, table.name, table.value], name: 'catalog_product_attributes_pkey' }),
  index('catalog_product_attributes_lookup_idx').on(table.storeId, table.country, table.language, table.source, table.name, table.value),
  index('catalog_product_attributes_product_idx').on(table.storeId, table.country, table.language, table.productGid),
]);

export const catalogCollections = pgTable('catalog_collections', {
  storeId: uuid('store_id').notNull(),
  country: varchar('country', { length: 2 }).notNull(),
  language: varchar('language', { length: 3 }).notNull(),
  collectionGid: text('collection_gid').notNull(),
  handle: varchar('handle', { length: 255 }).notNull(),
  title: text('title').notNull(),
  titleNormalized: text('title_normalized').notNull(),
  description: text('description').notNull(),
  imageUrl: text('image_url'),
  imageAlt: text('image_alt'),
  generation: uuid('generation').notNull(),
  visible: boolean('visible').notNull().default(true),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.storeId, table.country, table.language, table.collectionGid], name: 'catalog_collections_pkey' }),
  uniqueIndex('catalog_collections_handle_uidx').on(table.storeId, table.country, table.language, table.handle),
  index('catalog_collections_visible_idx').on(table.storeId, table.country, table.language, table.visible),
  index('catalog_collections_generation_idx').on(table.storeId, table.country, table.language, table.generation),
]);

/** Explicit product relationships: collection membership with provenance. */
export const catalogCollectionMembers = pgTable('catalog_collection_members', {
  storeId: uuid('store_id').notNull(),
  country: varchar('country', { length: 2 }).notNull(),
  language: varchar('language', { length: 3 }).notNull(),
  collectionGid: text('collection_gid').notNull(),
  productGid: text('product_gid').notNull(),
  generation: uuid('generation').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.storeId, table.country, table.language, table.collectionGid, table.productGid], name: 'catalog_collection_members_pkey' }),
  index('catalog_collection_members_product_idx').on(table.storeId, table.country, table.language, table.productGid),
]);

/** Rebuildable lexical search documents (FL04/FL05 substrate). */
export const catalogSearchDocuments = pgTable('catalog_search_documents', {
  storeId: uuid('store_id').notNull(),
  country: varchar('country', { length: 2 }).notNull(),
  language: varchar('language', { length: 3 }).notNull(),
  productGid: text('product_gid').notNull(),
  handle: varchar('handle', { length: 255 }).notNull(),
  titleNormalized: text('title_normalized').notNull(),
  bodyNormalized: text('body_normalized').notNull(),
  tagsNormalized: text('tags_normalized').array().notNull().default([]),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  generation: uuid('generation').notNull(),
  visible: boolean('visible').notNull().default(true),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.storeId, table.country, table.language, table.productGid], name: 'catalog_search_documents_pkey' }),
  index('catalog_search_documents_generation_idx').on(table.storeId, table.country, table.language, table.generation),
]);

export type CatalogImport = typeof catalogImports.$inferSelect;
export type CatalogProductRow = typeof catalogProducts.$inferSelect;
export type CatalogVariantRow = typeof catalogVariants.$inferSelect;
export type CatalogCollectionRow = typeof catalogCollections.$inferSelect;
export type CatalogSearchDocumentRow = typeof catalogSearchDocuments.$inferSelect;
