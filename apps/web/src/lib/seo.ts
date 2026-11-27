import type { Metadata } from 'next';

/** Absolute base URL when configured; null otherwise (no invented canonicals). */
export function absoluteBaseUrl(): string | null {
  const base = process.env.APP_BASE_URL;
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

export function storefrontMetadata(options: { title?: string; description?: string; path?: string }): Metadata {
  const metadata: Metadata = {};
  if (options.title) metadata.title = options.title;
  if (options.description) metadata.description = options.description;
  const base = absoluteBaseUrl();
  if (base && options.path) metadata.alternates = { canonical: new URL(options.path, base).toString() };
  return metadata;
}

/**
 * Product structured data — commercial fields only when the verified catalog
 * actually provides them; no invented ratings or reviews.
 */
export function productJsonLd(input: {
  title: string;
  description?: string;
  image?: string | null;
  price?: string | null;
  currency?: string | null;
  available: boolean;
}): string {
  const product: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.title,
  };
  if (input.description) product.description = input.description;
  if (input.image) product.image = [input.image];
  if (input.price && input.currency) {
    product.offers = {
      '@type': 'Offer',
      price: input.price,
      priceCurrency: input.currency,
      availability: input.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    };
  }
  return JSON.stringify(product).replace(/</g, '\\u003c');
}
