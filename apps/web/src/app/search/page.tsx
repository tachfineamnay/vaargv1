import type { ReactElement } from 'react';
import type { CatalogV1SearchResponse } from '@vaarg/shared';
import { CatalogStatus } from '../../components/CatalogStatus';
import { EmptyState, emptyKindForStatus } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { PaginationControl } from '../../components/PaginationControl';
import { ProductGrid } from '../../components/ProductCard';
import { SearchInput } from '../../components/SearchInput';
import { createCatalogClient } from '../../lib/catalog';
import { toStorefrontError } from '../../lib/errors';
import { t } from '../../lib/i18n';
import {
  currentListSearch,
  hasPreviousPage,
  nextPageListSearch,
  parseListParams,
  previousPageListSearch,
  type ListParams,
} from '../../lib/params';
import { storefrontHost } from '../../lib/storefront';

export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const raw = await searchParams;
  const qRaw = typeof raw.q === 'string' ? raw.q.trim() : '';
  const params: ListParams = parseListParams(raw, 'search');
  const retryHref = `/search${currentListSearch(params)}`;

  const head = (
    <section className="page-head">
      <h1>{t('search.title')}</h1>
      <SearchInput action="/search" defaultValue={qRaw} />
    </section>
  );

  // No query (or one that fails the shared contract): prompt, don't fetch.
  if (!qRaw || !params.api.q) {
    return (
      <>
        {head}
        <EmptyState kind="noSearch" />
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
  let data: CatalogV1SearchResponse;
  try {
    data = await createCatalogClient(host).searchProducts(params.api);
  } catch (error) {
    return (
      <>
        {head}
        <ErrorState error={toStorefrontError(error)} retryHref={retryHref} />
      </>
    );
  }

  const nextHref = data.nextCursor ? `/search${nextPageListSearch(params, data.nextCursor)}` : null;
  const prevHref = hasPreviousPage(params) ? `/search${previousPageListSearch(params)}` : null;
  return (
    <>
      {head}
      <section className="page-head">
        <h2>{t('search.resultsFor', { q: data.query })}</h2>
      </section>
      {data.items.length === 0 ? (
        <EmptyState kind={emptyKindForStatus(data.status)} />
      ) : (
        <>
          <CatalogStatus status={data.status} completedAt={data.completedAt} />
          <ProductGrid products={data.items} />
          <PaginationControl previousHref={prevHref} nextHref={nextHref} />
        </>
      )}
    </>
  );
}
