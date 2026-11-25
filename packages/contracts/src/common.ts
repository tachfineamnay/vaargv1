// Common shared types and utilities

import { z } from 'zod';

/**
 * Base entity fields
 */
export const EntityBaseSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type EntityBase = z.infer<typeof EntityBaseSchema>;

/**
 * Pagination
 */
export const PaginationParamsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationParams = z.infer<typeof PaginationParamsSchema>;

// Helper for creating paginated response schemas
export function createPaginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    totalPages: z.number().int().nonnegative(),
  });
}

export type PaginatedResponse<T> = z.infer<ReturnType<typeof createPaginatedResponseSchema<z.ZodTypeAny>>>;

/**
 * Money - exact decimal handling
 */
export const MoneySchema = z.object({
  amount: z.string(), // Store as string to preserve precision
  currencyCode: z.string().length(3).toUpperCase(),
});

export type Money = z.infer<typeof MoneySchema>;

/**
 * Locale/Market
 */
export const LocaleSchema = z.object({
  languageCode: z.string().length(2).toLowerCase(),
  countryCode: z.string().length(2).toUpperCase().optional(),
});

export type Locale = z.infer<typeof LocaleSchema>;

/**
 * API Error Response
 */
export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().uuid().optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * API Success Response Wrapper
 */
export function createApiSuccessSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema,
    requestId: z.string().uuid().optional(),
  });
}

export interface ApiSuccess<T> {
  data: T;
  requestId?: string;
}
