/** Opt-in read-only provider check. Do not enable without an authorized test store. */
import { describe, it } from 'vitest';
import { createShopifyCommerce } from '../src/commerce/shopify.js';

const enabled = process.env.SHOPIFY_REAL_TEST === '1';
(enabled ? describe : describe.skip)('authorized real Storefront', () => {
  it('reads contextualized products and collections without mutating Shopify', async () => {
    const { SHOPIFY_DOMAIN: domain, SHOPIFY_STOREFRONT_TOKEN: token, SHOPIFY_COUNTRY: country, SHOPIFY_LANGUAGE: language, SHOPIFY_CURRENCY: currency } = process.env;
    if (!domain || !token || !country || !language || !currency) throw new Error('Required real test environment configuration is absent');
    const client = createShopifyCommerce({ domain, token, apiVersion: '2026-10' }, { expectedCurrency: currency });
    if (client.status !== 'READY') throw new Error('Storefront is not configured');
    const context = { country, language };
    const products = await client.port.products(context, null);
    await client.port.collections(context, null);
    if (products.nextCursor) await client.port.products(context, products.nextCursor);
  }, 60000);
});
