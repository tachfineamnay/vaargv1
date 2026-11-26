import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/** Contract only: no HTTP endpoint, subscription or Admin API ingestion is enabled. */
export const shopifyWebhookEnvelopeSchema = z.object({
  storeId: z.uuid(),
  eventId: z.string().min(1).max(200),
  topic: z.string().min(1).max(120),
  shopDomain: z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
});
/** Verify HMAC over untouched request bytes before parsing or storing anything. */
export function verifyShopifyWebhook(body: Uint8Array, signature: string, secret: string): boolean {
  if (!secret || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const received = Buffer.from(signature, 'base64');
  const expected = createHmac('sha256', secret).update(body).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}
