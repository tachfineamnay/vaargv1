import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from '../src/catalog/catalog.service.js';
import type { DatabaseClient } from '../src/infra/database-client.js';
import type { StorefrontBinding } from '@vaarg/persistence';
import type { ValkeyClient } from '../src/infra/valkey-client.js';
const read = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => vi.fn());
const execute = vi.hoisted(() => vi.fn());
vi.mock('@vaarg/persistence', async (original) => ({ ...await original<typeof import('@vaarg/persistence')>(), readCatalogProjection: read, createDb: vi.fn(() => ({})), withStoreContext: vi.fn(async (_db, _id, fn) => fn({})), resolveMerchantSession: auth, executeCatalogStep: execute }));
const binding: StorefrontBinding = { host:'synthetic.example', storeId:'00000000-0000-4000-8000-000000000001', country:'FR', language:'FR', currency:'EUR', shopifyDomain:'synthetic.myshopify.com', tokenEnv:'SHOPIFY_SYNTHETIC' };
const database = { getPool: () => ({}) } as unknown as DatabaseClient;
const valkey = { getRateClient: () => ({}) } as unknown as ValkeyClient;
describe('catalog tenant boundary', () => {
  it('returns NOT_CONFIGURED when no host bindings exist', async () => {
    const service = new CatalogService(database, [], valkey);
    expect(await service.list({}, 'synthetic.example', 'product')).toMatchObject({ status:'NOT_CONFIGURED' });
  });
  it('rejects unknown hosts and client-supplied tenant overrides', async () => {
    const service = new CatalogService(database, [binding], valkey);
    await expect(service.list({}, 'evil.example', 'product')).rejects.toThrow();
    await expect(service.list({ storeId: 'other' }, 'synthetic.example', 'product')).rejects.toThrow();
  });
  it('passes only the server binding to the scoped reader', async () => {
    process.env.SHOPIFY_SYNTHETIC = 'synthetic-only';
    try {
      read.mockResolvedValue({ status:'FRESH', completedAt:'2026-01-01T00:00:00.000Z', items:[], nextCursor:null });
      const service = new CatalogService(database, [binding], valkey);
      const result = await service.list({ limit:'5' }, 'synthetic.example', 'product');
      expect(result.status).toBe('FRESH');
      expect(read).toHaveBeenCalledWith(expect.anything(), { storeId:binding.storeId, country:'FR', language:'FR' }, expect.objectContaining({ kind:'product',limit:5 }));
    } finally { delete process.env.SHOPIFY_SYNTHETIC; }
  });
  it('requires an active authorized merchant for sync operations', async () => {
    const service = new CatalogService(database, [binding], valkey);
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
