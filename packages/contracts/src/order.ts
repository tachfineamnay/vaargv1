// Order and checkout types

import { z } from 'zod';
import { EntityBaseSchema, MoneySchema, LocaleSchema, createPaginatedResponseSchema } from './common';

/**
 * Order Line Item
 */
export const OrderLineSchema = z.object({
  id: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  quantity: z.number().int().positive(),
  unitPrice: MoneySchema,
  totalPrice: MoneySchema,
  // Denormalized
  productTitle: z.string(),
  variantTitle: z.string(),
  productHandle: z.string(),
  variantSku: z.string().optional(),
  imageUrl: z.string().url().optional(),
  attributes: z.record(z.string(), z.string()).default({}), // Engraving text, etc.
  requiresShipping: z.boolean().default(true),
  taxable: z.boolean().default(true),
  taxLines: z
    .array(
      z.object({
        title: z.string(),
        rate: z.number(),
        price: MoneySchema,
      })
    )
    .default([]),
  discountAllocations: z
    .array(
      z.object({
        amount: MoneySchema,
        description: z.string(),
      })
    )
    .default([]),
});

export type OrderLine = z.infer<typeof OrderLineSchema>;

/**
 * Shipping Address
 */
export const AddressSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  address1: z.string().min(1),
  address2: z.string().optional(),
  city: z.string().min(1),
  province: z.string().optional(),
  provinceCode: z.string().optional(),
  country: z.string().min(1),
  countryCode: z.string().length(2).toUpperCase(),
  zip: z.string().min(1),
  phone: z.string().optional(),
  name: z.string().optional(),
});

export type Address = z.infer<typeof AddressSchema>;

/**
 * Order
 */
export const OrderSchema = EntityBaseSchema.extend({
  storeId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  orderNumber: z.number().int().positive(), // Sequential per store
  orderName: z.string(), // e.g., "#1001"
  financialStatus: z
    .enum([
      'pending',
      'authorized',
      'partially_paid',
      'paid',
      'partially_refunded',
      'refunded',
      'voided',
    ])
    .default('pending'),
  fulfillmentStatus: z
    .enum(['unfulfilled', 'partial', 'fulfilled', 'restocked'])
    .default('unfulfilled'),
  currency: z.string().length(3).toUpperCase(),
  locale: LocaleSchema,
  subtotal: MoneySchema,
  totalTax: MoneySchema,
  totalShipping: MoneySchema,
  totalDiscounts: MoneySchema,
  total: MoneySchema,
  totalOutstanding: MoneySchema,
  lines: z.array(OrderLineSchema),
  shippingAddress: AddressSchema.optional(),
  billingAddress: AddressSchema.optional(),
  shippingLines: z
    .array(
      z.object({
        title: z.string(),
        price: MoneySchema,
        carrierIdentifier: z.string().optional(),
        trackingNumber: z.string().optional(),
        trackingUrl: z.string().url().optional(),
      })
    )
    .default([]),
  note: z.string().optional(),
  tags: z.array(z.string()).default([]),
  riskLevel: z.enum(['low', 'medium', 'high']).optional(),
  shopifyOrderId: z.string().optional(),
  shopifyOrderGid: z.string().optional(),
  processedAt: z.string().datetime({ offset: true }).optional(),
  cancelledAt: z.string().datetime({ offset: true }).optional(),
  cancelReason: z.string().optional(),
});

export type Order = z.infer<typeof OrderSchema>;

/**
 * Refund
 */
export const RefundSchema = EntityBaseSchema.extend({
  storeId: z.string().uuid(),
  orderId: z.string().uuid(),
  lineItems: z.array(
    z.object({
      lineId: z.string().uuid(),
      quantity: z.number().int().positive(),
      restock: z.boolean().default(true),
    })
  ),
  totalRefunded: MoneySchema,
  note: z.string().optional(),
  processedAt: z.string().datetime({ offset: true }),
  shopifyRefundId: z.string().optional(),
});

export type Refund = z.infer<typeof RefundSchema>;
