import { describe, it, expect } from 'vitest';
import { StoreSchema, CreateStoreSchema, UpdateStoreSchema, StoreContextSchema } from './store';

describe('Store Schemas', () => {
  it('should validate StoreSchema', () => {
    const store = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      domain: 'shop.example.com',
      name: 'Test Store',
      defaultLocale: { languageCode: 'en', countryCode: 'US' },
      supportedLocales: [{ languageCode: 'en', countryCode: 'US' }],
      currency: 'USD',
      timezone: 'America/New_York',
      shopifyStoreDomain: 'test.myshopify.com',
      shopifyStorefrontToken: 'token',
      isActive: true,
      settings: {},
    };
    expect(() => StoreSchema.parse(store)).not.toThrow();
  });

  it('should validate CreateStoreSchema', () => {
    const input = {
      domain: 'shop.example.com',
      name: 'Test Store',
      defaultLocale: { languageCode: 'en', countryCode: 'US' },
      supportedLocales: [{ languageCode: 'en', countryCode: 'US' }],
      currency: 'USD',
      timezone: 'America/New_York',
      shopifyStoreDomain: 'test.myshopify.com',
      shopifyStorefrontToken: 'token',
      settings: {},
    };
    expect(() => CreateStoreSchema.parse(input)).not.toThrow();
  });

  it('should validate UpdateStoreSchema', () => {
    const input = { name: 'Updated Store', isActive: false };
    expect(() => UpdateStoreSchema.parse(input)).not.toThrow();
  });

  it('should validate StoreContextSchema', () => {
    const context = {
      storeId: '123e4567-e89b-12d3-a456-426614174000',
      locale: { languageCode: 'en', countryCode: 'US' },
      currency: 'USD',
    };
    expect(() => StoreContextSchema.parse(context)).not.toThrow();
  });
});
