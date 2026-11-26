import type { MetadataRoute } from 'next';
import { createCatalogClient } from '../lib/catalog';
import { absoluteBaseUrl } from '../lib/seo';
import { storefrontHost } from '../lib/storefront';

export const dynamic = 'force-dynamic';

/**
 * Sitemap from verified catalog data; when the API is unreachable it falls
 * back to the static browse surfaces so the file always stays valid.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = absoluteBaseUrl() ?? 'http://localhost:3000';
  const entries: MetadataRoute.Sitemap = [
    { url: new URL('/', base).toString(), changeFrequency: 'daily', priority: 1 },
    { url: new URL('/collections', base).toString(), changeFrequency: 'daily', priority: 0.8 },
    { url: new URL('/products', base).toString(), changeFrequency: 'daily', priority: 0.8 },
    { url: new URL('/search', base).toString(), changeFrequency: 'weekly', priority: 0.4 },
  ];
  try {
    const host = await storefrontHost();
    const client = createCatalogClient(host);
    const [collections, products] = await Promise.all([
      client.listCollections({ limit: '50' }),
      client.listProducts({ limit: '50' }),
    ]);
    for (const collection of collections.items) {
      entries.push({
        url: new URL(`/collections/${collection.handle}`, base).toString(),
        lastModified: collection.updatedAt,
        changeFrequency: 'weekly',
        priority: 0.6,
      });
    }
    for (const product of products.items) {
      entries.push({
        url: new URL(`/products/${product.handle}`, base).toString(),
        lastModified: product.updatedAt,
        changeFrequency: 'weekly',
        priority: 0.5,
      });
    }
  } catch {
    // Static entries only — build/runtime without API access stays valid.
  }
  return entries;
}
