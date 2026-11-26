import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyShopifyWebhook } from '../src/commerce/webhook.js';

describe('future webhook boundary', () => {
  it('authenticates the original bytes and rejects modifications', () => {
    const body = Buffer.from('{"synthetic":true}');
    const secret = 'synthetic-test-secret';
    const signature = createHmac('sha256', secret).update(body).digest('base64');
    expect(verifyShopifyWebhook(body, signature, secret)).toBe(true);
    expect(verifyShopifyWebhook(Buffer.from('{"synthetic":false}'), signature, secret)).toBe(false);
    expect(verifyShopifyWebhook(body, 'invalid', secret)).toBe(false);
  });
});
