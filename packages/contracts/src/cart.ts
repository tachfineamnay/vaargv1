// Cart and checkout types

import { z } from 'zod';
import { EntityBaseSchema, MoneySchema, LocaleSchema, createPaginatedResponseSchema } from './common';

/**
 * Cart Line Item
 */
export const CartLineSchema = z.object({
  id: z.string().uuid(), // Cart line ID (not variant ID)
  variantId: z.string().uuid(),
  quantity: z.number().int().positive(),
  attributes: z.record(z.string(), z.string()).default({}), // Engraving, custom options
  unitPrice: MoneySchema,
  totalPrice: MoneySchema,
  // Denormalized for performance
  productTitle: z.string(),
  variantTitle: z.string(),
  productHandle: z.string(),
  variantSku: z.string().optional(),
  imageUrl: z.string().url().optional(),
});

export type CartLine = z.infer<typeof CartLineSchema>;

/**
 * Cart
 */
export const CartSchema = EntityBaseSchema.extend({
  storeId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  sessionId: z.string().optional(),
  lines: z.array(CartLineSchema).default([]),
  locale: LocaleSchema,
  currency: z.string().length(3).toUpperCase(),
  subtotal: MoneySchema,
  totalTax: MoneySchema.optional(),
  total: MoneySchema,
  checkoutUrl: z.string().url().optional(), // Shopify checkout URL
  note: z.string().optional(),
  attributes: z.record(z.string(), z.string()).default({}),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

export type Cart = z.infer<typeof CartSchema>;

/**
 * Cart Operations
 */
export const AddToCartSchema = z.object({
  variantId: z.string().uuid(),
  quantity: z.number().int().positive().default(1),
  attributes: z.record(z.string(), z.string()).default({}),
});

export type AddToCartInput = z.infer<typeof AddToCartSchema>;

export const UpdateCartLineSchema = z.object({
  lineId: z.string().uuid(),
  quantity: z.number().int().nonnegative(), // 0 = remove
  attributes: z.record(z.string(), z.string()).optional(),
});

export type UpdateCartLineInput = z.infer<typeof UpdateCartLineSchema>;

/**
 * Shopify Checkout Redirect
 */
export const ShopifyCheckoutRedirectSchema = z.object({
  checkoutUrl: z.string().url(),
  cartToken: z.string(), // For webhook correlation
  expiresAt: z.string().datetime({ offset: true }),
});

export type ShopifyCheckoutRedirect = z.infer<typeof ShopifyCheckoutRedirectSchema>;
