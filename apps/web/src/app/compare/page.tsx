import type { ReactElement } from 'react';
import type { CatalogV1Comparison } from '@vaarg/shared';
import { CatalogStatus } from '../../components/CatalogStatus';
import { CompareSync } from '../../components/CompareSync';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { ProductComparator } from '../../components/ProductComparator';
import { createCatalogClient } from '../../lib/catalog';
import { toStorefrontError } from '../../lib/errors';
import { t } from '../../lib/i18n';
import { storefrontHost } from '../../lib/storefront';

export const dynamic = 'force-dynamic';

function parseCompareIds(raw: string): string[] {
  return [...new Set(raw.split(',').map((entry) => entry.trim()).filter(Boolean))].slice(0, 4);
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const raw = await searchParams;
  const ids = parseCompareIds(typeof raw.ids === 'string' ? raw.ids : '');
  const retryHref = ids.length >= 2 ? `/compare?ids=${encodeURIComponent(ids.join(','))}` : '/compare';

  const head = (
    <section className="page-head">
      <h1>{t('compare.title')}</h1>
    </section>
  );

  if (ids.length < 2) {
    return (
      <>
        {head}
        <EmptyState kind="compareFew" actionHref="/products" actionLabel={t('common.viewAll')} />
      </>
    );
  }

  let host: string;
  try {
    host = await storefrontHost();
  } catch (error) {
    return (
      <>
        {head}
        <ErrorState error={toStorefrontError(error)} retryHref={retryHref} />
      </>
    );
  }
  let comparison: CatalogV1Comparison;
  try {
    comparison = await createCatalogClient(host).compareProducts(ids);
  } catch (error) {
    return (
      <>
        {head}
        <ErrorState error={toStorefrontError(error)} retryHref={retryHref} />
      </>
    );
  }
  return (
    <>
      {head}
      <CompareSync ids={ids} />
      <CatalogStatus status={comparison.status} completedAt={comparison.completedAt} />
      <ProductComparator comparison={comparison} ids={ids} />
    </>
  );
}
