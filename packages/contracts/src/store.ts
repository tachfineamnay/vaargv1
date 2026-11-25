// Store isolation and configuration

import { z } from 'zod';
import { EntityBaseSchema, LocaleSchema } from './common';

/**
 * Store - Root isolation boundary
 */
export const StoreSchema = EntityBaseSchema.extend({
  domain: z.string().min(1), // e.g., "shop.example.com"
  name: z.string().min(1),
  defaultLocale: LocaleSchema,
  supportedLocales: z.array(LocaleSchema).min(1),
  currency: z.string().length(3).toUpperCase(), // Default currency
  timezone: z.string(), // IANA timezone
  shopifyStoreDomain: z.string().min(1), // myshop.myshopify.com
  shopifyStorefrontToken: z.string().min(1), // Public Storefront API token
  isActive: z.boolean().default(true),
  settings: z.record(z.string(), z.unknown()).default({}),
});

export type Store = z.infer<typeof StoreSchema>;

/**
 * Store Config - Per-store feature flags and settings
 */
export const StoreConfigSchema = EntityBaseSchema.extend({
  storeId: z.string().uuid(),
  key: z.string().min(1),
  value: z.unknown(),
  description: z.string().optional(),
});

export type StoreConfig = z.infer<typeof StoreConfigSchema>;

/**
 * Create Store Input
 */
export const CreateStoreSchema = z.object({
  domain: z.string().min(1),
  name: z.string().min(1),
  defaultLocale: LocaleSchema,
  supportedLocales: z.array(LocaleSchema).min(1),
  currency: z.string().length(3).toUpperCase(),
  timezone: z.string(),
  shopifyStoreDomain: z.string().min(1),
  shopifyStorefrontToken: z.string().min(1),
  settings: z.record(z.string(), z.unknown()).default({}),
});

export type CreateStoreInput = z.infer<typeof CreateStoreSchema>;

/**
 * Update Store Input
 */
export const UpdateStoreSchema = CreateStoreSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type UpdateStoreInput = z.infer<typeof UpdateStoreSchema>;

/**
 * Store Context - Runtime context for request isolation
 */
export const StoreContextSchema = z.object({
  storeId: z.string().uuid(),
  locale: LocaleSchema,
  currency: z.string().length(3).toUpperCase(),
  customerId: z.string().uuid().optional(), // Authenticated customer
  sessionId: z.string().optional(), // Anonymous session
});

export type StoreContext = z.infer<typeof StoreContextSchema>;
