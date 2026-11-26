import { describe, expect, it } from 'vitest';
import { parseStorefrontHost, storefrontOrigin } from '../src/lib/host';

describe('parseStorefrontHost', () => {
  it('accepts the request host as-is', () => {
    expect(parseStorefrontHost('synthetic.example')).toBe('synthetic.example');
    expect(parseStorefrontHost('store-two.vaarg.shop')).toBe('store-two.vaarg.shop');
  });

  it('normalizes case and port noise', () => {
    expect(parseStorefrontHost('Store-Two.Example')).toBe('store-two.example');
  });

  it('prefers x-forwarded-host only for loopback hosts (dev proxies)', () => {
    expect(parseStorefrontHost('localhost:3000', 'synthetic.example')).toBe('synthetic.example');
    // Production-like hosts ignore x-forwarded-host (client-controlled).
    expect(parseStorefrontHost('synthetic.example', 'evil.example')).toBe('synthetic.example');
    expect(parseStorefrontHost('synthetic.example', null)).toBe('synthetic.example');
  });

  it('rejects invalid hosts with invalid_host', () => {
    expect(() => parseStorefrontHost(null)).toThrowError(/Invalid storefront host/);
    expect(() => parseStorefrontHost('')).toThrowError(/Invalid storefront host/);
    expect(() => parseStorefrontHost('bad host!')).toThrowError(/Invalid storefront host/);
    expect(() => parseStorefrontHost('host with spaces')).toThrowError(/Invalid storefront host/);
  });
});

describe('storefrontOrigin', () => {
  it('uses https and strips the port', () => {
    expect(storefrontOrigin('synthetic.example')).toBe('https://synthetic.example');
    expect(storefrontOrigin('localhost:3000')).toBe('https://localhost');
  });
});
