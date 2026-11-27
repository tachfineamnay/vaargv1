/* global process, console */
/**
 * Standalone stub API for the FL04 live smoke (no Docker required).
 * Serves the v1 catalog + session/consent shapes used by the storefront.
 * Usage: node test/support/smoke-stub.mjs [port]
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 4112);
const COMPLETED_AT = '2026-11-20T12:00:00.000Z';
const GENERATION = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const STORE_ID = '22222222-2222-4222-8222-222222222222';

const provenance = {
  source: 'shopify',
  shopifyId: 'gid://shopify/Product/123',
  generation: GENERATION,
  observedAt: COMPLETED_AT,
};

const summary = {
  id: 'gid://shopify/Product/123',
  handle: 'linen-shirt',
  title: 'Linen Shirt',
  productType: 'Shirt',
  vendor: 'Acme',
  tags: ['summer'],
  availableForSale: true,
  priceMin: { amount: '49.00', currencyCode: 'USD' },
  priceMax: { amount: '59.00', currencyCode: 'USD' },
  image: { url: 'https://cdn.example/shirt.jpg', altText: null },
  updatedAt: COMPLETED_AT,
  provenance,
};

const summary2 = {
  ...summary,
  id: 'gid://shopify/Product/456',
  handle: 'linen-dress',
  title: 'Linen Dress',
  priceMin: { amount: '79.00', currencyCode: 'USD' },
  priceMax: { amount: '79.00', currencyCode: 'USD' },
};

const collection = {
  id: 'gid://shopify/Collection/1',
  handle: 'summer',
  title: 'Summer',
  description: 'Summer picks',
  image: null,
  updatedAt: COMPLETED_AT,
  productCount: 2,
  provenance,
};

const detail = {
  summary,
  description: 'A breezy linen shirt.',
  options: [{ name: 'Size', values: ['S', 'M'] }],
  variants: [
    {
      id: 'gid://shopify/ProductVariant/456',
      title: 'S',
      sku: null,
      selectedOptions: [{ name: 'Size', value: 'S' }],
      availableForSale: true,
      quantityAvailable: 5,
      currentlyNotInStock: false,
      price: { amount: '49.00', currencyCode: 'USD' },
      compareAtPrice: null,
      image: null,
      position: 0,
    },
  ],
  images: [{ url: 'https://cdn.example/shirt.jpg', altText: null }],
  mediaCount: { image: 1, video: 0, externalVideo: 0, model3d: 0 },
  attributes: [{ source: 'option', name: 'Size', value: 'S', valueType: null }],
  publishedAt: COMPLETED_AT,
  status: 'FRESH',
  completedAt: COMPLETED_AT,
  generation: GENERATION,
};

const sessionEnvelope = {
  session: {
    sessionId: SESSION_ID,
    storeId: STORE_ID,
    customerId: null,
    context: 'default',
    status: 'active',
    expiresAt: '2026-12-01T00:00:00.000Z',
    createdAt: '2026-11-25T00:00:00.000Z',
  },
  tenant: {
    storeId: STORE_ID,
    host: 'smoke.example',
    country: 'US',
    language: 'EN',
    currency: 'USD',
    storeStatus: 'active',
    correlationId: 'smoke-correlation-1',
  },
};

const consents = {
  customerId: null,
  consents: {
    analytics: null,
    marketing_email: null,
    marketing_push: null,
    personalization: null,
    data_retention: null,
  },
};

function json(res, status, payload, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(payload));
}

createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (req.method === 'POST' && path === '/v1/sessions') {
    json(res, 200, sessionEnvelope, {
      'set-cookie': 'vaarg_visitor_session=smoke-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400',
    });
    return;
  }
  if (req.method === 'GET' && path === '/v1/sessions/current') {
    const hasCookie = String(req.headers.cookie ?? '').includes('vaarg_visitor_session=');
    if (!hasCookie) return json(res, 401, { error: { kind: 'unauthorized', message: 'No active visitor session', requestId: 'smoke' } });
    return json(res, 200, sessionEnvelope);
  }
  if (req.method === 'POST' && path === '/v1/sessions/rotate') {
    json(res, 200, sessionEnvelope, {
      'set-cookie': 'vaarg_visitor_session=smoke-rotated; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400',
    });
    return;
  }
  if (req.method === 'DELETE' && path === '/v1/sessions/current') return json(res, 200, { status: 'revoked' });
  if (req.method === 'GET' && path === '/v1/privacy/consents') return json(res, 200, consents);
  if (req.method === 'POST' && path === '/v1/privacy/consents') {
    if (!req.headers.origin) return json(res, 403, { error: { kind: 'forbidden', message: 'Same-origin Origin header required', requestId: 'smoke' } });
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let purpose = 'analytics';
      try {
        purpose = JSON.parse(body || '{}').purpose ?? purpose;
      } catch { /* default */ }
      json(res, 200, { customerId: null, consents: { ...consents.consents, [purpose]: true } });
    });
    return;
  }
  if (path.startsWith('/v1/catalog/products/') && path.endsWith('/related')) {
    return json(res, 200, { status: 'FRESH', completedAt: COMPLETED_AT, items: [{ summary: summary2, relation: 'collection', provenance: 'summer' }] });
  }
  if (path.startsWith('/v1/catalog/products/') && path.endsWith('/compatible-options')) {
    return json(res, 200, {
      status: 'FRESH',
      completedAt: COMPLETED_AT,
      product: { id: summary.id, handle: summary.handle, title: summary.title },
      options: [{ name: 'Size', values: ['S', 'M'] }],
      personalization: [],
      compatibility: 'UNKNOWN',
    });
  }
  if (path.startsWith('/v1/catalog/products/')) return json(res, 200, detail);
  if (path === '/v1/catalog/collections') return json(res, 200, { status: 'FRESH', completedAt: COMPLETED_AT, items: [collection], nextCursor: null });
  if (path.startsWith('/v1/catalog/collections/') && path.endsWith('/products')) {
    return json(res, 200, { status: 'FRESH', completedAt: COMPLETED_AT, sort: 'title-asc', currency: 'USD', items: [summary, summary2], nextCursor: null });
  }
  if (path.startsWith('/v1/catalog/collections/')) return json(res, 200, { ...collection, status: 'FRESH', completedAt: COMPLETED_AT, generation: GENERATION });
  if (path === '/v1/catalog/filters') {
    return json(res, 200, {
      status: 'FRESH',
      completedAt: COMPLETED_AT,
      currency: 'USD',
      priceRange: { min: '49.00', max: '79.00' },
      productTypes: [{ value: 'Shirt', count: 1 }],
      vendors: [{ value: 'Acme', count: 2 }],
      options: [{ name: 'Size', values: [{ value: 'S', count: 2 }] }],
      attributes: [],
    });
  }
  if (path === '/v1/catalog/compare') {
    return json(res, 200, {
      status: 'FRESH',
      completedAt: COMPLETED_AT,
      currency: 'USD',
      products: [
        { ref: summary.id, summary },
        { ref: summary2.id, summary: summary2 },
      ],
      rows: [
        { label: 'Vendor', values: ['Acme', 'Acme'] },
        { label: 'Price', values: ['49.00', '79.00'] },
      ],
    });
  }
  if (path === '/v1/catalog/search') return json(res, 200, { status: 'FRESH', completedAt: COMPLETED_AT, query: 'linen', items: [summary, summary2], nextCursor: null });
  if (path === '/v1/catalog/status') return json(res, 200, { status: 'FRESH', completedAt: COMPLETED_AT, generation: GENERATION });
  if (path === '/v1/catalog/products') return json(res, 200, { status: 'FRESH', completedAt: COMPLETED_AT, sort: 'title-asc', currency: 'USD', items: [summary, summary2], nextCursor: null });
  if (path === '/health/live') {
    return json(res, 200, { status: 'ok', service: 'api', version: '1.0.0', uptimeSeconds: 12, timestamp: COMPLETED_AT });
  }
  if (path === '/health/ready') {
    return json(res, 200, {
      status: 'ready',
      service: 'api',
      version: '1.0.0',
      checks: [{ name: 'database', status: 'ready', required: true }],
      timestamp: COMPLETED_AT,
    });
  }
  if (path === '/version') {
    return json(res, 200, { service: 'api', version: '1.0.0', node: process.version, env: 'production' });
  }
  json(res, 404, { error: { kind: 'not_found', message: `Unknown route ${path}`, requestId: 'smoke' } });
}).listen(port, '127.0.0.1', () => {
  console.log(`smoke stub api listening on http://127.0.0.1:${port}`);
});
