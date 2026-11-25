// Product catalog types

import { z } from 'zod';
import { EntityBaseSchema, MoneySchema } from './common';

/**
 * Product
 */
export const ProductSchema = EntityBaseSchema.extend({
  storeId: z.string().uuid(),
  handle: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  descriptionHtml: z.string().optional(),
  vendor: z.string().optional(),
  productType: z.string().optional(),
  tags: z.array(z.string()).default([]),
  status: z.enum(['active', 'archived', 'draft']).default('active'),
  publishedAt: z.string().datetime({ offset: true }).optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  shopifyProductId: z.string().optional(), // GraphQL ID or REST ID
  shopifyProductGid: z.string().optional(), // Full GID
});

export type Product = z.infer<typeof ProductSchema>;

/**
 * Product Variant
 */
export const ProductVariantSchema = EntityBaseSchema.extend({
  storeId: z.string().uuid(),
  productId: z.string().uuid(),
  title: z.string().min(1),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  price: MoneySchema,
  compareAtPrice: MoneySchema.optional(),
  cost: MoneySchema.optional(),
  inventoryQuantity: z.number().int().default(0),
  inventoryPolicy: z.enum(['deny', 'continue']).default('deny'),
  inventoryManagement: z.enum(['shopify', 'not_tracked']).default('shopify'),
  weight: z.number().optional(),
  weightUnit: z.enum(['g', 'kg', 'oz', 'lb']).default('g'),
  requiresShipping: z.boolean().default(true),
  taxable: z.boolean().default(true),
  option1: z.string().optional(),
  option2: z.string().optional(),
  option3: z.string().optional(),
  position: z.number().int().default(1),
  shopifyVariantId: z.string().optional(),
  shopifyVariantGid: z.string().optional(),
});

export type ProductVariant = z.infer<typeof ProductVariantSchema>;

/**
 * Product Image/Media
 */
export const ProductMediaSchema = EntityBaseSchema.extend({
  storeId: z.string().uuid(),
  productId: z.string().uuid(),
  variantIds: z.array(z.string().uuid()).default([]),
  alt: z.string().optional(),
  mediaType: z.enum(['image', 'video', 'model_3d', 'external_video']),
  url: z.string().url(),
  position: z.number().int().default(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  shopifyMediaId: z.string().optional(),
  shopifyMediaGid: z.string().optional(),
});

export type ProductMedia = z.infer<typeof ProductMediaSchema>;

/**
 * Collection
 */
export const CollectionSchema = EntityBaseSchema.extend({
  storeId: z.string().uuid(),
  handle: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  descriptionHtml: z.string().optional(),
  imageUrl: z.string().url().optional(),
  sortOrder: z
    .enum([
      'manual',
      'best_selling',
      'title_ascending',
      'title_descending',
      'price_ascending',
      'price_descending',
      'created_ascending',
      'created_descending',
    ])
    .default('manual'),
  isPublished: z.boolean().default(false),
  publishedAt: z.string().datetime({ offset: true }).optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  shopifyCollectionId: z.string().optional(),
  shopifyCollectionGid: z.string().optional(),
  ruleSet: z.record(z.string(), z.unknown()).optional(), // For smart collections
});

export type Collection = z.infer<typeof CollectionSchema>;

/**
 * Product with variants and media (for detailed views)
 */
export const ProductDetailSchema = ProductSchema.extend({
  variants: z.array(ProductVariantSchema),
  media: z.array(ProductMediaSchema),
  collections: z.array(CollectionSchema),
  availableForSale: z.boolean(),
  totalInventory: z.number().int().nonnegative(),
  priceRange: z.object({
    min: MoneySchema,
    max: MoneySchema,
  }),
});

export type ProductDetail = z.infer<typeof ProductDetailSchema>;

/**
 * Engraving Option
 */
export const EngravingOptionSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  maxCharacters: z.number().int().positive(),
  priceDelta: MoneySchema,
  allowedCharacters: z.string().optional(), // Regex pattern
  previewTemplate: z.string().optional(), // SVG/template for preview
  isRequired: z.boolean().default(false),
});

export type EngravingOption = z.infer<typeof EngravingOptionSchema>;
