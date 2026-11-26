import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Stub API for FL04 tests: a real local HTTP server speaking the v1 wire
 * shapes, used both as the BFF's upstream (VAARG_API_BASE_URL) and for
 * header/cookie/Origin assertions.
 */
export interface StubRecordedRequest {
  method: string;
  path: string;
  host: string | null;
  origin: string | null;
  cookie: string | null;
  body: string;
}

export interface StubApi {
  url: string;
  port: number;
  requests: StubRecordedRequest[];
  close(): Promise<void>;
}

export type StubHandler = (
  request: StubRecordedRequest,
  response: ServerResponse,
) => void;

function sendJson(response: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(body);
}

export function errorBody(kind: string, message: string, requestId = 'stub-request'): Record<string, unknown> {
  return { error: { kind, message, requestId } };
}

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const STORE_ID = '22222222-2222-4222-8222-222222222222';

export function sessionEnvelopeFixture(overrides: { customerId?: string | null; status?: string } = {}) {
  return {
    session: {
      sessionId: SESSION_ID,
      storeId: STORE_ID,
      customerId: overrides.customerId === undefined ? null : overrides.customerId,
      context: 'default',
      status: overrides.status ?? 'active',
      expiresAt: '2026-12-01T00:00:00.000Z',
      createdAt: '2026-11-25T00:00:00.000Z',
    },
    tenant: {
      storeId: STORE_ID,
      host: 'synthetic.example',
      country: 'US',
      language: 'EN',
      currency: 'USD',
      storeStatus: 'active',
      correlationId: 'stub-correlation-1',
    },
  };
}

export function consentStateFixture(overrides: Record<string, boolean | null> = {}) {
  return {
    customerId: null,
    consents: {
      analytics: null,
      marketing_email: null,
      marketing_push: null,
      personalization: null,
      data_retention: null,
      ...overrides,
    },
  };
}

function defaultHandler(request: StubRecordedRequest, response: ServerResponse): void {
  const hasSessionCookie = (request.cookie ?? '').includes('vaarg_visitor_session=');
  if (request.method === 'POST' && request.path === '/v1/sessions') {
    sendJson(response, 200, sessionEnvelopeFixture(), {
      'set-cookie': 'vaarg_visitor_session=stub-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400',
    });
    return;
  }
  if (request.method === 'GET' && request.path === '/v1/sessions/current') {
    if (!hasSessionCookie) {
      sendJson(response, 401, errorBody('unauthorized', 'No active visitor session'));
      return;
    }
    sendJson(response, 200, sessionEnvelopeFixture());
    return;
  }
  if (request.method === 'DELETE' && request.path === '/v1/sessions/current') {
    sendJson(response, 200, { status: 'revoked' });
    return;
  }
  if (request.method === 'POST' && request.path === '/v1/sessions/rotate') {
    sendJson(response, 200, sessionEnvelopeFixture(), {
      'set-cookie': 'vaarg_visitor_session=rotated-token; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400',
    });
    return;
  }
  if (request.method === 'GET' && request.path === '/v1/privacy/consents') {
    sendJson(response, 200, consentStateFixture());
    return;
  }
  if (request.method === 'POST' && request.path === '/v1/privacy/consents') {
    // Mirror the API's CSRF boundary: Origin must be present.
    if (!request.origin) {
      sendJson(response, 403, errorBody('forbidden', 'Same-origin Origin header required'));
      return;
    }
    let purpose = 'analytics';
    try {
      const parsed = JSON.parse(request.body || '{}') as { purpose?: string };
      if (parsed.purpose) purpose = parsed.purpose;
    } catch {
      /* keep default */
    }
    sendJson(response, 200, consentStateFixture({ [purpose]: true }));
    return;
  }
  if (request.method === 'GET' && request.path.startsWith('/v1/catalog/')) {
    sendJson(response, 200, catalogRouteFixture(request.path.split('?')[0] ?? request.path));
    return;
  }
  sendJson(response, 404, errorBody('not_found', 'Unknown route'));
}

export async function startStubApi(handler: StubHandler = defaultHandler): Promise<StubApi> {
  const requests: StubRecordedRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const record: StubRecordedRequest = {
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        host: typeof req.headers.host === 'string' ? req.headers.host : null,
        origin: typeof req.headers.origin === 'string' ? req.headers.origin : null,
        cookie: typeof req.headers.cookie === 'string' ? req.headers.cookie : null,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(record);
      handler(record, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

// ---------------------------------------------------------------------------
// Catalog v1 fixtures (strict wire shapes from @vaarg/shared).
// ---------------------------------------------------------------------------

const GENERATION = '33333333-3333-4333-8333-333333333333';
const OBSERVED_AT = '2026-11-20T12:00:00.000Z';

export function provenanceFixture() {
  return {
    source: 'shopify' as const,
    shopifyId: 'gid://shopify/Product/123',
    generation: GENERATION,
    observedAt: OBSERVED_AT,
  };
}

export function productSummaryFixture(overrides: Record<string, unknown> = {}) {
  return {
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
    updatedAt: OBSERVED_AT,
    provenance: provenanceFixture(),
    ...overrides,
  };
}

export function collectionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gid://shopify/Collection/1',
    handle: 'summer',
    title: 'Summer',
    description: 'Summer picks',
    image: null,
    updatedAt: OBSERVED_AT,
    productCount: 3,
    provenance: provenanceFixture(),
    ...overrides,
  };
}

export function productListFixture(overrides: Record<string, unknown> = {}) {
  return {
    status: 'FRESH',
    completedAt: OBSERVED_AT,
    sort: 'title-asc',
    currency: 'USD',
    items: [productSummaryFixture()],
    nextCursor: null,
    ...overrides,
  };
}

export function collectionsFixture(overrides: Record<string, unknown> = {}) {
  return {
    status: 'FRESH',
    completedAt: OBSERVED_AT,
    items: [collectionFixture()],
    nextCursor: null,
    ...overrides,
  };
}

export function productDetailFixture(overrides: Record<string, unknown> = {}) {
  return {
    summary: productSummaryFixture(),
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
    publishedAt: OBSERVED_AT,
    status: 'FRESH',
    completedAt: OBSERVED_AT,
    generation: GENERATION,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Catalog route fixtures served by the default stub handler.
// ---------------------------------------------------------------------------

const COMPLETED_AT = '2026-11-20T12:00:00.000Z';

export function searchFixture(overrides: Record<string, unknown> = {}) {
  return {
    status: 'FRESH',
    completedAt: COMPLETED_AT,
    query: 'linen',
    items: [productSummaryFixture()],
    nextCursor: null,
    ...overrides,
  };
}

export function filtersFixture(overrides: Record<string, unknown> = {}) {
  return {
    status: 'FRESH',
    completedAt: COMPLETED_AT,
    currency: 'USD',
    priceRange: { min: '10.00', max: '99.00' },
    productTypes: [{ value: 'Shirt', count: 2 }],
    vendors: [{ value: 'Acme', count: 2 }],
    options: [{ name: 'Size', values: [{ value: 'S', count: 1 }, { value: 'M', count: 1 }] }],
    attributes: [{ name: 'Color', values: [{ value: 'Blue', count: 1 }] }],
    ...overrides,
  };
}

export function comparisonFixture(overrides: Record<string, unknown> = {}) {
  return {
    status: 'FRESH',
    completedAt: COMPLETED_AT,
    currency: 'USD',
    products: [
      { ref: 'gid://shopify/Product/123', summary: productSummaryFixture() },
      { ref: 'gid://shopify/Product/456', summary: null },
    ],
    rows: [
      { label: 'Vendor', values: ['Acme', null] },
      { label: 'Price', values: ['49.00', '59.00'] },
    ],
    ...overrides,
  };
}

export function relatedFixture(overrides: Record<string, unknown> = {}) {
  return {
    status: 'FRESH',
    completedAt: COMPLETED_AT,
    items: [
      {
        summary: productSummaryFixture({ id: 'gid://shopify/Product/789', handle: 'linen-dress', title: 'Linen Dress' }),
        relation: 'collection',
        provenance: 'summer',
      },
    ],
    ...overrides,
  };
}

export function compatibleFixture(overrides: Record<string, unknown> = {}) {
  return {
    status: 'FRESH',
    completedAt: COMPLETED_AT,
    product: { id: 'gid://shopify/Product/123', handle: 'linen-shirt', title: 'Linen Shirt' },
    options: [{ name: 'Size', values: ['S', 'M'] }],
    personalization: [
      {
        namespace: 'vaarg',
        key: 'note',
        type: 'single_line_text_field',
        value: 'Gift wrap',
        source: provenanceFixture(),
      },
    ],
    compatibility: 'UNKNOWN',
    ...overrides,
  };
}

function catalogRouteFixture(path: string): Record<string, unknown> {
  if (path === '/v1/catalog/products') return productListFixture();
  if (path === '/v1/catalog/search') return searchFixture();
  if (path === '/v1/catalog/filters') return filtersFixture();
  if (path === '/v1/catalog/compare') return comparisonFixture();
  if (path === '/v1/catalog/status') {
    return { status: 'FRESH', completedAt: COMPLETED_AT, generation: GENERATION };
  }
  if (/^\/v1\/catalog\/products\/[^/]+\/related$/.test(path)) return relatedFixture();
  if (/^\/v1\/catalog\/products\/[^/]+\/compatible-options$/.test(path)) return compatibleFixture();
  if (/^\/v1\/catalog\/products\/[^/]+$/.test(path)) return productDetailFixture();
  if (/^\/v1\/catalog\/collections$/.test(path)) return collectionsFixture();
  if (/^\/v1\/catalog\/collections\/[^/]+\/products$/.test(path)) return productListFixture();
  if (/^\/v1\/catalog\/collections\/[^/]+$/.test(path)) {
    return { ...collectionFixture(), status: 'FRESH', completedAt: COMPLETED_AT, generation: GENERATION };
  }
  return errorBody('not_found', 'Unknown catalog route') as Record<string, unknown>;
}
