// Customer profile, memory, and consent

import { z } from 'zod';
import { EntityBaseSchema, LocaleSchema } from './common';

/**
 * Customer Profile
 */
export const CustomerProfileSchema = EntityBaseSchema.extend({
  storeId: z.string().uuid(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  defaultLocale: LocaleSchema.optional(),
  defaultCurrency: z.string().length(3).toUpperCase().optional(),
  acceptsMarketing: z.boolean().default(false),
  marketingConsentAt: z.string().datetime({ offset: true }).optional(),
  marketingConsentIp: z.string().optional(),
  isAnonymous: z.boolean().default(false),
  shopifyCustomerId: z.string().optional(), // Link to Shopify Customer
  tags: z.array(z.string()).default([]),
  note: z.string().optional(),
});

export type CustomerProfile = z.infer<typeof CustomerProfileSchema>;

/**
 * Customer Memory - Persistent facts with provenance
 */
export const MemoryFactSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  storeId: z.string().uuid(),
  namespace: z.string().min(1), // e.g., "preferences", "purchase_history", "gifts"
  key: z.string().min(1),
  value: z.unknown(),
  provenance: z.enum(['explicit', 'inferred', 'gift', 'purchase', 'merchant_note']),
  source: z.string().optional(), // e.g., "conversation_123", "order_456"
  confidence: z.number().min(0).max(1).default(1),
  isNegativePreference: z.boolean().default(false),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type MemoryFact = z.infer<typeof MemoryFactSchema>;

/**
 * Customer Consent
 */
export const ConsentSchema = EntityBaseSchema.extend({
  customerId: z.string().uuid(),
  storeId: z.string().uuid(),
  purpose: z.enum(['marketing', 'analytics', 'personalization', 'transactional', 'support']),
  granted: z.boolean(),
  grantedAt: z.string().datetime({ offset: true }).optional(),
  revokedAt: z.string().datetime({ offset: true }).optional(),
  source: z.string(), // e.g., "checkout", "account_settings", "email_footer"
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
});

export type Consent = z.infer<typeof ConsentSchema>;

/**
 * Purchase Projection - Predictive modeling
 */
export const PurchaseProjectionSchema = EntityBaseSchema.extend({
  customerId: z.string().uuid(),
  storeId: z.string().uuid(),
  productId: z.string().uuid().optional(),
  collectionId: z.string().uuid().optional(),
  predictedProbability: z.number().min(0).max(1),
  predictedTimeframeDays: z.number().int().positive(),
  modelVersion: z.string(),
  features: z.record(z.string(), z.number()),
  expiresAt: z.string().datetime({ offset: true }),
});

export type PurchaseProjection = z.infer<typeof PurchaseProjectionSchema>;

/**
 * Workflow Bookkeeping - For Hatchet durable workflows
 */
export const WorkflowBookkeepingSchema = EntityBaseSchema.extend({
  customerId: z.string().uuid(),
  storeId: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowName: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  startedAt: z.string().datetime({ offset: true }).optional(),
  completedAt: z.string().datetime({ offset: true }).optional(),
});

export type WorkflowBookkeeping = z.infer<typeof WorkflowBookkeepingSchema>;
