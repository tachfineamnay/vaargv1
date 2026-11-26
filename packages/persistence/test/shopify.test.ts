import { describe, expect, it, vi } from 'vitest';
import { createShopifyCommerce, CommerceError } from '../src/commerce/shopify.js';

const config = { domain: 'example.myshopify.com', token: 'synthetic-token', apiVersion: '2026-10' };
const context = { country: 'FR', language: 'FR' };
const page = { data: { localization: { country: { currency: { isoCode: 'EUR' } } }, products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }, extensions: { context } };

describe('Storefront adapter', () => {
  it('reports absent configuration explicitly', () => {
    expect(createShopifyCommerce(undefined)).toEqual({ status: 'NOT_CONFIGURED' });
  });
  it('sends a versioned, contextualized request and validates its applied market', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(page), { status: 200 }));
    const client = createShopifyCommerce(config, { fetcher });
    if (client.status !== 'READY') throw new Error('expected ready');
    expect((await client.port.products(context, null)).items).toEqual([]);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://example.myshopify.com/api/2026-10/graphql.json');
    expect(JSON.parse(String(init?.body)).variables).toMatchObject({ country: 'FR', language: 'FR', after: null });
  });
  it('rejects a different applied market and partial GraphQL errors', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ ...page, extensions: { context: { country: 'US', language: 'EN' } } })));
    const client = createShopifyCommerce(config, { fetcher });
    if (client.status !== 'READY') throw new Error('expected ready');
    await expect(client.port.products(context, null)).rejects.toBeInstanceOf(CommerceError);
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ ...page, errors: [{ message: 'denied', extensions: { code: 'ACCESS_DENIED' } }] })));
    await expect(client.port.products(context, null)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });
  it('retries throttles only within the configured bound', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ errors: [{ message: 'throttled', extensions: { code: 'THROTTLED' } }] })));
    const client = createShopifyCommerce(config, { fetcher, retryDelay: async () => undefined, maxAttempts: 2 });
    if (client.status !== 'READY') throw new Error('expected ready');
    await expect(client.port.products(context, null)).rejects.toMatchObject({ code: 'THROTTLED' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects a variant price in a currency inconsistent with the applied market', async () => {
    const product = { id: 'gid://shopify/Product/1', handle: 'synthetic', title: 'Synthetic', description: '', productType: '', vendor: '', tags: [], updatedAt: '2026-01-01T00:00:00Z', availableForSale: true, variants: { nodes: [{ id: 'gid://shopify/ProductVariant/1', title: 'S', availableForSale: true, price: { amount: '10.00', currencyCode: 'USD' }, selectedOptions: [] }], pageInfo: { hasNextPage: false, endCursor: null } }, images: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, media: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } };
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ ...page, data: { ...page.data, products: { ...page.data.products, nodes: [product] } } })));
    const client = createShopifyCommerce(config, { fetcher });
    if (client.status !== 'READY') throw new Error('expected ready');
    await expect(client.port.products(context, null)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('does not retry permanent authorization errors', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ errors: [{ message: 'denied', extensions: { code: 'ACCESS_DENIED' } }] })));
    const client = createShopifyCommerce(config, { fetcher, retryDelay: async () => undefined });
    if (client.status !== 'READY') throw new Error('expected ready');
    await expect(client.port.products(context, null)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('paces sequential requests within a client instance', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(10000);
    try {
      const delay = vi.fn(async (_ms: number) => undefined);
      const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(page)));
      const client = createShopifyCommerce(config, { fetcher, retryDelay: delay });
      if (client.status !== 'READY') throw new Error('expected ready');
      await client.port.products(context, null);
      await client.port.products(context, null);
      expect(delay).toHaveBeenCalledWith(250);
    } finally { now.mockRestore(); }
  });

  it('retains collection product identifiers across nested pages', async () => {
    const first = { data: { collections: { nodes: [{ id: 'gid://shopify/Collection/1', handle: 'synthetic', title: 'Synthetic', description: '', updatedAt: '2026-01-01T00:00:00Z', image: null, products: { nodes: [{ id: 'gid://shopify/Product/1' }], pageInfo: { hasNextPage: true, endCursor: 'next' } } }], pageInfo: { hasNextPage: false, endCursor: null } } }, extensions: { context } };
    const second = { data: { node: { id: 'gid://shopify/Collection/1', products: { nodes: [{ id: 'gid://shopify/Product/2' }], pageInfo: { hasNextPage: false, endCursor: null } } } }, extensions: { context } };
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(fetcher.mock.calls.length === 1 ? first : second)));
    const client = createShopifyCommerce(config, { fetcher, retryDelay: async () => undefined });
    if (client.status !== 'READY') throw new Error('expected ready');
    expect((await client.port.collections(context, null)).items[0]).toMatchObject({ products: { nodes: [{ id: 'gid://shopify/Product/1' }, { id: 'gid://shopify/Product/2' }] } });
  });

  it('retains non-image media returned by Shopify', async () => {
    const product = { id: 'gid://shopify/Product/1', handle: 'synthetic', title: 'Synthetic', description: '', productType: '', vendor: '', tags: [], updatedAt: '2026-01-01T00:00:00Z', availableForSale: true, variants: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, images: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, media: { nodes: [{ __typename: 'ExternalVideo', id: 'gid://shopify/ExternalVideo/1', mediaContentType: 'EXTERNAL_VIDEO', alt: null, previewImage: null, originUrl: 'https://example.com/video' }], pageInfo: { hasNextPage: false, endCursor: null } } };
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ ...page, data: { ...page.data, products: { ...page.data.products, nodes: [product] } } })));
    const client = createShopifyCommerce(config, { fetcher });
    if (client.status !== 'READY') throw new Error('expected ready');
    expect((await client.port.products(context, null)).items[0]).toMatchObject({ media: { nodes: [{ mediaContentType: 'EXTERNAL_VIDEO', originUrl: 'https://example.com/video' }] } });
  });

});
