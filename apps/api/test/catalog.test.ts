import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from '../src/catalog/catalog.service.js';
import type { DatabaseClient } from '../src/infra/database-client.js';
import type { StorefrontBinding } from '@vaarg/persistence';
import type { ValkeyClient } from '../src/infra/valkey-client.js';
const read = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => vi.fn());
const execute = vi.hoisted(() => vi.fn());
const readV1List = vi.hoisted(() => vi.fn());
const readV1Detail = vi.hoisted(() => vi.fn());
vi.mock('@vaarg/persistence', async (original) => ({
  ...await original<typeof import('@vaarg/persistence')>(),
  readCatalogProjection: read,
  createDb: vi.fn(() => ({})),
  withStoreContext: vi.fn(async (_db, _id, fn) => fn({})),
  resolveMerchantSession: auth,
  executeCatalogStep: execute,
  listCatalogProductsV1: readV1List,
  getCatalogProductV1: readV1Detail,
}));
const binding: StorefrontBinding = { host:'synthetic.example', storeId:'00000000-0000-4000-8000-000000000001', country:'FR', language:'FR', currency:'EUR', shopifyDomain:'synthetic.myshopify.com', tokenEnv:'SHOPIFY_SYNTHETIC' };
const database = { getPool: () => ({}) } as unknown as DatabaseClient;
const valkey = { getRateClient: () => ({}) } as unknown as ValkeyClient;
const tenantContext = (bindings: StorefrontBinding[], host: unknown) => {
  const resolved = bindings.find((entry) => entry.host === host);
  if (!resolved) throw new Error('UNKNOWN_HOST');
  return { storeId: resolved.storeId, host: resolved.host, country: resolved.country, language: resolved.language, currency: resolved.currency, storeStatus: 'active' as const, correlationId: 'req-fl03-test' };
};
/** Same shared boundary the Nest container injects, reduced for direct tests. */
const tenantsOf = (bindings: StorefrontBinding[]) => ({
  identify: (host: unknown) => bindings.find((entry) => entry.host === host) ?? null,
  resolve: async (host: unknown) => tenantContext(bindings, host),
});
const merchantAuthOf = () => ({
  authorizeMerchant: auth,
  login: vi.fn(async () => ({ token: 'x'.repeat(43), expiresAt: new Date() })),
  logout: vi.fn(async () => ({ status: 'revoked' as const })),
  resolveIdentity: vi.fn(async () => null),
});
const serviceOf = (bindings: StorefrontBinding[]) => new CatalogService(database, bindings, tenantsOf(bindings) as never, merchantAuthOf() as never, valkey);
describe('catalog tenant boundary', () => {
  it('returns NOT_CONFIGURED when no host bindings exist', async () => {
    const service = serviceOf([]);
    expect(await service.list({}, 'synthetic.example', 'product')).toMatchObject({ status:'NOT_CONFIGURED' });
  });
  it('rejects unknown hosts and client-supplied tenant overrides', async () => {
    const service = serviceOf([binding]);
    await expect(service.list({}, 'evil.example', 'product')).rejects.toThrow();
    await expect(service.list({ storeId: 'other' }, 'synthetic.example', 'product')).rejects.toThrow();
  });
  it('passes only the server binding to the scoped reader', async () => {
    process.env.SHOPIFY_SYNTHETIC = 'synthetic-only';
    try {
      read.mockResolvedValue({ status:'FRESH', completedAt:'2026-01-01T00:00:00.000Z', items:[], nextCursor:null });
      const service = serviceOf([binding]);
      const result = await service.list({ limit:'5' }, 'synthetic.example', 'product');
      expect(result.status).toBe('FRESH');
      expect(read).toHaveBeenCalledWith(expect.anything(), { storeId:binding.storeId, country:'FR', language:'FR' }, expect.objectContaining({ kind:'product',limit:5 }));
    } finally { delete process.env.SHOPIFY_SYNTHETIC; }
  });
  it('requires an active authorized merchant for sync operations', async () => {
    const service = serviceOf([binding]);
    await expect(service.sync('synthetic.example', undefined, 'status')).rejects.toThrow();
    auth.mockResolvedValue(null);
    await expect(service.sync('synthetic.example', `Bearer ${'x'.repeat(43)}`, 'start')).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
    auth.mockResolvedValue({ storeId: binding.storeId, role: 'owner' });
    execute.mockResolvedValue({ status: 'STARTED_OR_RESUMED', completedAt: null });
    expect((await service.sync('synthetic.example', `Bearer ${'x'.repeat(43)}`, 'start')).status).toBe('STARTED_OR_RESUMED');
    execute.mockResolvedValue({ status: 'products', completedAt: null });
    expect((await service.sync('synthetic.example', `Bearer ${'x'.repeat(43)}`, 'step')).status).toBe('products');
    const abort = new AbortController(); abort.abort();
    execute.mockClear();
    await expect(service.sync('synthetic.example', `Bearer ${'x'.repeat(43)}`, 'step', abort.signal)).rejects.toThrow('CANCELLED');
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('v1 catalog application API', () => {
  it('reports NOT_CONFIGURED without provider configuration', async () => {
    const service = serviceOf([binding]);
    const result = await service.listProductsV1('synthetic.example', 'req-fl03-test', {});
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.items).toEqual([]);
    await expect(service.getProductV1('synthetic.example', 'req-fl03-test', 'item-1')).rejects.toThrow();
  });
  it('rejects unknown hosts and foreign market currencies before any read', async () => {
    const service = serviceOf([binding]);
    await expect(service.listProductsV1('evil.example', 'req-fl03-test', {})).rejects.toThrow('UNKNOWN_HOST');
    await expect(service.listProductsV1('synthetic.example', 'req-fl03-test', { currency: 'USD' })).rejects.toThrow();
    // price filters default to the server-owned market currency
    expect((await service.listProductsV1('synthetic.example', 'req-fl03-test', { priceMin: '1' })).status).toBe('NOT_CONFIGURED');
  });
  it('lists curated products through the shared v1 read model', async () => {
    process.env.SHOPIFY_SYNTHETIC = 'synthetic-only';
    try {
      readV1List.mockResolvedValue({ status: 'FRESH', completedAt: '2026-01-01T00:00:00.000Z', sort: 'title-asc', currency: 'EUR', items: [], nextCursor: null });
      const service = serviceOf([binding]);
      const result = await service.listProductsV1('synthetic.example', 'req-fl03-test', { limit: '5', sort: 'title-asc', priceMin: '10.00', priceMax: '20.00' });
      expect(result.status).toBe('FRESH');
      expect(readV1List).toHaveBeenCalledWith(expect.anything(), { storeId: binding.storeId, country: 'FR', language: 'FR' }, expect.objectContaining({ limit: 5, currency: 'EUR', priceMin: '10.00', priceMax: '20.00' }), expect.any(Number));
    } finally { delete process.env.SHOPIFY_SYNTHETIC; }
  });
  it('returns product detail by handle and by stable numeric reference', async () => {
    process.env.SHOPIFY_SYNTHETIC = 'synthetic-only';
    try {
      readV1Detail.mockResolvedValue(null);
      const service = serviceOf([binding]);
      await expect(service.getProductV1('synthetic.example', 'req-fl03-test', 'item-1')).rejects.toThrow();
      expect(readV1Detail).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'item-1', expect.any(Number));
      readV1Detail.mockClear();
      await expect(service.getProductV1('synthetic.example', 'req-fl03-test', '123')).rejects.toThrow();
      expect(readV1Detail).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'gid://shopify/Product/123', expect.any(Number));
    } finally { delete process.env.SHOPIFY_SYNTHETIC; }
  });
});
