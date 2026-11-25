import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  decimal,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Stores
export const stores = pgTable(
  'stores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    domain: varchar('domain', { length: 255 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    defaultLocale: jsonb('default_locale').notNull(),
    supportedLocales: jsonb('supported_locales').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    timezone: varchar('timezone', { length: 100 }).notNull(),
    shopifyStoreDomain: varchar('shopify_store_domain', { length: 255 }).notNull(),
    shopifyStorefrontToken: varchar('shopify_storefront_token', { length: 255 }).notNull(),
    isActive: boolean('is_active').default(true),
    settings: jsonb('settings').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    domainIdx: uniqueIndex('stores_domain_idx').on(table.domain),
    activeIdx: index('stores_active_idx').on(table.isActive),
  })
);

export const storeConfigs = pgTable(
  'store_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 255 }).notNull(),
    value: jsonb('value').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    storeKeyIdx: uniqueIndex('store_configs_store_key_idx').on(table.storeId, table.key),
  })
);

// Customers
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    firstName: varchar('first_name', { length: 100 }),
    lastName: varchar('last_name', { length: 100 }),
    defaultLocale: jsonb('default_locale'),
    defaultCurrency: varchar('default_currency', { length: 3 }),
    acceptsMarketing: boolean('accepts_marketing').default(false),
    marketingConsentAt: timestamp('marketing_consent_at', { withTimezone: true }),
    marketingConsentIp: varchar('marketing_consent_ip', { length: 45 }),
    isAnonymous: boolean('is_anonymous').default(false),
    shopifyCustomerId: varchar('shopify_customer_id', { length: 100 }),
    tags: text('tags').array().default([]),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    storeEmailIdx: uniqueIndex('customers_store_email_idx')
      .on(table.storeId, table.email)
      .where(sql`email IS NOT NULL`),
    storeShopifyIdx: uniqueIndex('customers_store_shopify_idx')
      .on(table.storeId, table.shopifyCustomerId)
      .where(sql`shopify_customer_id IS NOT NULL`),
    storeIdx: index('customers_store_idx').on(table.storeId),
  })
);

export const customerMemory = pgTable(
  'customer_memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    namespace: varchar('namespace', { length: 100 }).notNull(),
    key: varchar('key', { length: 255 }).notNull(),
    value: jsonb('value').notNull(),
    provenance: varchar('provenance', { length: 50 }).notNull(),
    source: varchar('source', { length: 255 }),
    confidence: decimal('confidence', { precision: 3, scale: 2 }).default('1.00'),
    isNegativePreference: boolean('is_negative_preference').default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    customerNamespaceKeyIdx: uniqueIndex('customer_memory_customer_namespace_key_idx').on(
      table.customerId,
      table.namespace,
      table.key
    ),
    storeIdx: index('customer_memory_store_idx').on(table.storeId),
    expiresIdx: index('customer_memory_expires_idx').on(table.expiresAt),
  })
);

export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    purpose: varchar('purpose', { length: 50 }).notNull(),
    granted: boolean('granted').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    source: varchar('source', { length: 100 }).notNull(),
    ipAddress: varchar('ip_address', { length: 45 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    customerPurposeIdx: uniqueIndex('consents_customer_purpose_idx').on(
      table.customerId,
      table.purpose
    ),
  })
);

export const purchaseProjections = pgTable(
  'purchase_projections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    productId: uuid('product_id'),
    collectionId: uuid('collection_id'),
    predictedProbability: decimal('predicted_probability', { precision: 4, scale: 3 }).notNull(),
    predictedTimeframeDays: integer('predicted_timeframe_days').notNull(),
    modelVersion: varchar('model_version', { length: 50 }).notNull(),
    features: jsonb('features').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    customerIdx: index('purchase_projections_customer_idx').on(table.customerId),
    expiresIdx: index('purchase_projections_expires_idx').on(table.expiresAt),
  })
);

export const workflowBookkeeping = pgTable(
  'workflow_bookkeeping',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    workflowId: uuid('workflow_id').notNull(),
    workflowName: varchar('workflow_name', { length: 255 }).notNull(),
    status: varchar('status', { length: 50 }).notNull(),
    input: jsonb('input').notNull(),
    output: jsonb('output'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    customerWorkflowIdx: index('workflow_bookkeeping_customer_workflow_idx').on(
      table.customerId,
      table.workflowId
    ),
    workflowIdx: index('workflow_bookkeeping_workflow_idx').on(table.workflowId),
  })
);

// Products
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    handle: varchar('handle', { length: 255 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    descriptionHtml: text('description_html'),
    vendor: varchar('vendor', { length: 255 }),
    productType: varchar('product_type', { length: 255 }),
    tags: text('tags').array().default([]),
    status: varchar('status', { length: 50 }).default('active'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    seoTitle: varchar('seo_title', { length: 255 }),
    seoDescription: varchar('seo_description', { length: 255 }),
    shopifyProductId: varchar('shopify_product_id', { length: 100 }),
    shopifyProductGid: varchar('shopify_product_gid', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    storeHandleIdx: uniqueIndex('products_store_handle_idx').on(table.storeId, table.handle),
    storeStatusIdx: index('products_store_status_idx').on(table.storeId, table.status),
  })
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    sku: varchar('sku', { length: 100 }),
    barcode: varchar('barcode', { length: 100 }),
    price: jsonb('price').notNull(),
    compareAtPrice: jsonb('compare_at_price'),
    cost: jsonb('cost'),
    inventoryQuantity: integer('inventory_quantity').default(0),
    inventoryPolicy: varchar('inventory_policy', { length: 20 }).default('deny'),
    inventoryManagement: varchar('inventory_management', { length: 20 }).default('shopify'),
    weight: decimal('weight', { precision: 10, scale: 2 }),
    weightUnit: varchar('weight_unit', { length: 10 }).default('g'),
    requiresShipping: boolean('requires_shipping').default(true),
    taxable: boolean('taxable').default(true),
    option1: varchar('option1', { length: 100 }),
    option2: varchar('option2', { length: 100 }),
    option3: varchar('option3', { length: 100 }),
    position: integer('position').default(1),
    shopifyVariantId: varchar('shopify_variant_id', { length: 100 }),
    shopifyVariantGid: varchar('shopify_variant_gid', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    storeProductIdx: index('product_variants_store_product_idx').on(table.storeId, table.productId),
    skuIdx: uniqueIndex('product_variants_sku_idx')
      .on(table.sku)
      .where(sql`sku IS NOT NULL`),
  })
);

export const productMedia = pgTable(
  'product_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantIds: uuid('variant_ids').array().default([]),
    alt: varchar('alt', { length: 255 }),
    mediaType: varchar('media_type', { length: 20 }).notNull(),
    url: varchar('url', { length: 500 }).notNull(),
    position: integer('position').default(1),
    width: integer('width'),
    height: integer('height'),
    shopifyMediaId: varchar('shopify_media_id', { length: 100 }),
    shopifyMediaGid: varchar('shopify_media_gid', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    storeProductIdx: index('product_media_store_product_idx').on(table.storeId, table.productId),
  })
);

export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    handle: varchar('handle', { length: 255 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    descriptionHtml: text('description_html'),
    imageUrl: varchar('image_url', { length: 500 }),
    sortOrder: varchar('sort_order', { length: 50 }).default('manual'),
    isPublished: boolean('is_published').default(false),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    seoTitle: varchar('seo_title', { length: 255 }),
    seoDescription: varchar('seo_description', { length: 255 }),
    shopifyCollectionId: varchar('shopify_collection_id', { length: 100 }),
    shopifyCollectionGid: varchar('shopify_collection_gid', { length: 255 }),
    ruleSet: jsonb('rule_set'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    storeHandleIdx: uniqueIndex('collections_store_handle_idx').on(table.storeId, table.handle),
  })
);

export const collectionProducts = pgTable(
  'collection_products',
  {
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    position: integer('position').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.collectionId, table.productId] }),
  })
);

export const engravingOptions = pgTable('engraving_options', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  maxCharacters: integer('max_characters').notNull(),
  priceDelta: jsonb('price_delta').notNull(),
  allowedCharacters: varchar('allowed_characters', { length: 500 }),
  previewTemplate: text('preview_template'),
  isRequired: boolean('is_required').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Cart
export const carts = pgTable(
  'carts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    sessionId: varchar('session_id', { length: 255 }),
    locale: jsonb('locale').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    subtotal: jsonb('subtotal').notNull(),
    totalTax: jsonb('total_tax'),
    total: jsonb('total').notNull(),
    checkoutUrl: varchar('checkout_url', { length: 500 }),
    note: text('note'),
    attributes: jsonb('attributes').default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    storeCustomerIdx: index('carts_store_customer_idx').on(table.storeId, table.customerId),
    storeSessionIdx: index('carts_store_session_idx').on(table.storeId, table.sessionId),
    expiresIdx: index('carts_expires_idx').on(table.expiresAt),
  })
);

export const cartLines = pgTable(
  'cart_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    attributes: jsonb('attributes').default({}),
    unitPrice: jsonb('unit_price').notNull(),
    totalPrice: jsonb('total_price').notNull(),
    productTitle: varchar('product_title', { length: 255 }).notNull(),
    variantTitle: varchar('variant_title', { length: 255 }).notNull(),
    productHandle: varchar('product_handle', { length: 255 }).notNull(),
    variantSku: varchar('variant_sku', { length: 100 }),
    imageUrl: varchar('image_url', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    cartVariantIdx: uniqueIndex('cart_lines_cart_variant_idx').on(table.cartId, table.variantId),
  })
);

// Orders
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 50 }),
    orderNumber: integer('order_number').notNull(),
    orderName: varchar('order_name', { length: 50 }).notNull(),
    financialStatus: varchar('financial_status', { length: 50 }).default('pending'),
    fulfillmentStatus: varchar('fulfillment_status', { length: 50 }).default('unfulfilled'),
    currency: varchar('currency', { length: 3 }).notNull(),
    locale: jsonb('locale').notNull(),
    subtotal: jsonb('subtotal').notNull(),
    totalTax: jsonb('total_tax').notNull(),
    totalShipping: jsonb('total_shipping').notNull(),
    totalDiscounts: jsonb('total_discounts').notNull(),
    total: jsonb('total').notNull(),
    totalOutstanding: jsonb('total_outstanding').notNull(),
    shippingAddress: jsonb('shipping_address'),
    billingAddress: jsonb('billing_address'),
    shippingLines: jsonb('shipping_lines').default([]),
    note: text('note'),
    tags: text('tags').array().default([]),
    riskLevel: varchar('risk_level', { length: 20 }),
    shopifyOrderId: varchar('shopify_order_id', { length: 100 }),
    shopifyOrderGid: varchar('shopify_order_gid', { length: 255 }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: varchar('cancel_reason', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    storeOrderNumberIdx: uniqueIndex('orders_store_order_number_idx').on(
      table.storeId,
      table.orderNumber
    ),
    storeCustomerIdx: index('orders_store_customer_idx').on(table.storeId, table.customerId),
    storeStatusIdx: index('orders_store_status_idx').on(
      table.storeId,
      table.financialStatus,
      table.fulfillmentStatus
    ),
  })
);

export const orderLines = pgTable('order_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
  quantity: integer('quantity').notNull(),
  unitPrice: jsonb('unit_price').notNull(),
  totalPrice: jsonb('total_price').notNull(),
  productTitle: varchar('product_title', { length: 255 }).notNull(),
  variantTitle: varchar('variant_title', { length: 255 }).notNull(),
  productHandle: varchar('product_handle', { length: 255 }).notNull(),
  variantSku: varchar('variant_sku', { length: 100 }),
  imageUrl: varchar('image_url', { length: 500 }),
  attributes: jsonb('attributes').default({}),
  requiresShipping: boolean('requires_shipping').default(true),
  taxable: boolean('taxable').default(true),
  taxLines: jsonb('tax_lines').default([]),
  discountAllocations: jsonb('discount_allocations').default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const refunds = pgTable('refunds', {
  id: uuid('id').primaryKey().defaultRandom(),
  storeId: uuid('store_id')
    .notNull()
    .references(() => stores.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  lineItems: jsonb('line_items').notNull(),
  totalRefunded: jsonb('total_refunded').notNull(),
  note: text('note'),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull(),
  shopifyRefundId: varchar('shopify_refund_id', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Type exports
export type Store = typeof stores.$inferSelect;
export type NewStore = typeof stores.$inferInsert;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Cart = typeof carts.$inferSelect;
export type NewCart = typeof carts.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
