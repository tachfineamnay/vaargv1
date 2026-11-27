import { cache, type ReactElement } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ProductDetail, type SettledSection } from '../../../components/ProductDetail';
import { ErrorState } from '../../../components/ErrorState';
import { createCatalogClient } from '../../../lib/catalog';
import { toStorefrontError } from '../../../lib/errors';
import { storefrontHost } from '../../../lib/storefront';
import { storefrontMetadata } from '../../../lib/seo';
import { SITE_CONFIG } from '../../../lib/site';

export const dynamic = 'force-dynamic';

const getProductDetail = cache(async (host: string, ref: string) => createCatalogClient(host).getProduct(ref));

async function resolveHost(): Promise<string> {
  return storefrontHost();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  try {
    const host = await resolveHost();
    const detail = await getProductDetail(host, handle);
    return storefrontMetadata({
      title: `${detail.summary.title} · ${SITE_CONFIG.name}`,
      description: detail.description || detail.summary.title,
      path: `/products/${detail.summary.handle}`,
    });
  } catch {
    return storefrontMetadata({ title: SITE_CONFIG.name });
  }
}

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const { handle } = await params;
  const raw = await searchParams;
  const variantId = typeof raw.variant === 'string' ? raw.variant : undefined;

  // Base query without `variant` — the selector owns that parameter.
  const baseParams = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'variant') continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (first) baseParams.set(key, first);
  }
  const baseSearch = baseParams.toString();

  let host: string;
  try {
    host = await resolveHost();
  } catch (error) {
    return <ErrorState error={toStorefrontError(error)} retryHref={`/products/${handle}`} />;
  }

  let detail: Awaited<ReturnType<typeof getProductDetail>>;
  try {
    detail = await getProductDetail(host, handle);
  } catch (error) {
    const storefrontError = toStorefrontError(error);
    if (storefrontError.kind === 'not_found') notFound();
    return <ErrorState error={storefrontError} retryHref={`/products/${handle}`} />;
  }

  const client = createCatalogClient(host);
  const [relatedResult, compatibleResult] = await Promise.allSettled([
    client.getRelatedProducts(handle, { limit: '6' }),
    client.getCompatibleOptions(handle),
  ]);
  const related: SettledSection<Awaited<ReturnType<typeof client.getRelatedProducts>>> =
    relatedResult.status === 'fulfilled'
      ? { ok: true, data: relatedResult.value }
      : { ok: false, error: toStorefrontError(relatedResult.reason) };
  const compatible: SettledSection<Awaited<ReturnType<typeof client.getCompatibleOptions>>> =
    compatibleResult.status === 'fulfilled'
      ? { ok: true, data: compatibleResult.value }
      : { ok: false, error: toStorefrontError(compatibleResult.reason) };

  return <ProductDetail detail={detail} variantParam={variantId} baseSearch={baseSearch} related={related} compatible={compatible} />;
}
