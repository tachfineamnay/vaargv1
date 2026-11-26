import { describe, expect, it } from 'vitest';
import { CatalogService } from '../src/catalog/catalog.service.js';

describe('catalog configuration status', () => {
  it('does not present an echo as a configured catalog', async () => {
    expect(await new CatalogService().list({}, 'demo')).toEqual({ status: 'NOT_CONFIGURED' });
  });
});
