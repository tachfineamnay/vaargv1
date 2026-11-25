import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { EntityBaseSchema, MoneySchema, LocaleSchema, PaginationParamsSchema, createPaginatedResponseSchema, createApiSuccessSchema, ApiErrorSchema } from './common';

describe('Common Schemas', () => {
  it('should validate EntityBaseSchema', () => {
    const entity = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    expect(() => EntityBaseSchema.parse(entity)).not.toThrow();
  });

  it('should validate MoneySchema', () => {
    const money = { amount: '100.00', currencyCode: 'USD' };
    expect(() => MoneySchema.parse(money)).not.toThrow();
  });

  it('should validate LocaleSchema', () => {
    const locale = { languageCode: 'en', countryCode: 'US' };
    expect(() => LocaleSchema.parse(locale)).not.toThrow();
  });

  it('should validate PaginationParamsSchema', () => {
    const params = { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' as const };
    expect(() => PaginationParamsSchema.parse(params)).not.toThrow();
  });

  it('should create PaginatedResponseSchema', () => {
    const itemSchema = z.object({ id: z.string() });
    const schema = createPaginatedResponseSchema(itemSchema);
    const response = {
      items: [{ id: '1' }],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    };
    expect(() => schema.parse(response)).not.toThrow();
  });

  it('should create ApiSuccessSchema', () => {
    const dataSchema = z.object({ name: z.string() });
    const schema = createApiSuccessSchema(dataSchema);
    const response = { data: { name: 'test' }, requestId: '123e4567-e89b-12d3-a456-426614174000' };
    expect(() => schema.parse(response)).not.toThrow();
  });

  it('should validate ApiErrorSchema', () => {
    const error = { code: 'NOT_FOUND', message: 'Resource not found' };
    expect(() => ApiErrorSchema.parse(error)).not.toThrow();
  });
});
