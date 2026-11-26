import { describe, expect, it } from 'vitest';
import { parseStorefrontBindings, resolveStorefront } from '../src/commerce/store-config.js';
const bindings = [{ host: 'paris.example', storeId: '00000000-0000-4000-8000-000000000001', country: 'FR', language: 'FR', currency: 'EUR', shopifyDomain: 'synthetic.myshopify.com', tokenEnv: 'SHOPIFY_TOKEN_SYNTHETIC' }];
describe('trusted storefront bindings', () => {
  it('selects only an exact configured host and its server-owned market', () => {
    const parsed = parseStorefrontBindings(bindings);
    expect(resolveStorefront(parsed, 'PARIS.EXAMPLE:443')).toEqual(bindings[0]);
    expect(resolveStorefront(parsed, 'evil.example')).toBeNull();
    expect(resolveStorefront(parsed, 'paris.example.evil.example')).toBeNull();
    expect(resolveStorefront(parsed, 'paris.example@evil.example')).toBeNull();
    expect(resolveStorefront(parsed, 'paris.example,evil.example')).toBeNull();
  });
  it('rejects duplicate hosts, malformed IDs and inconsistent store bindings', () => {
    expect(() => parseStorefrontBindings([...bindings, bindings[0]])).toThrow();
    expect(() => parseStorefrontBindings([{ ...bindings[0], storeId: 'not-a-uuid' }])).toThrow();
    expect(() => parseStorefrontBindings([...bindings, { ...bindings[0], host: 'other.example', shopifyDomain: 'other.myshopify.com' }])).toThrow();
    expect(() => parseStorefrontBindings([...bindings, { ...bindings[0], host: 'other.example', storeId:'00000000-0000-4000-8000-000000000002' }])).toThrow();
  });
});
