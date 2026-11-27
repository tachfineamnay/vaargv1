import type { ReactElement } from 'react';
import { CatalogStatus } from '../../components/CatalogStatus';
import { EmptyState, emptyKindForStatus } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { FilterPanel } from '../../components/FilterPanel';
import { PaginationControl } from '../../components/PaginationControl';
import { ProductGrid } from '../../components/ProductCard';
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

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const params: ListParams = parseListParams(await searchParams, 'products');
  const retryHref = `/products${currentListSearch(params)}`;
  let host: string;
  try {
    host = await storefrontHost();
  } catch (error) {
    return <ErrorState error={toStorefrontError(error)} retryHref={retryHref} />;
  }
  const client = createCatalogClient(host);
  const [listResult, filtersResult] = await Promise.allSettled([
    client.listProducts(params.api),
    client.getFilters(params.api.collection ? { collection: params.api.collection } : undefined),
  ]);
  if (listResult.status === 'rejected') {
    return <ErrorState error={toStorefrontError(listResult.reason)} retryHref={retryHref} />;
  }
  const data = listResult.value;
  const filters = filtersResult.status === 'fulfilled' ? filtersResult.value : null;
  const nextHref = data.nextCursor ? `/products${nextPageListSearch(params, data.nextCursor)}` : null;
  const prevHref = hasPreviousPage(params) ? `/products${previousPageListSearch(params)}` : null;

  return (
    <>
      <section className="page-head">
        <h1>{t('nav.products')}</h1>
      </section>
      <div className="page-layout">
        <aside className="page-layout__aside">
          <FilterPanel
            action="/products"
            params={params}
            filters={filters}
            filtersUnavailable={filtersResult.status === 'rejected'}
          />
        </aside>
        <div className="page-layout__main">
          {data.items.length === 0 ? (
            <EmptyState kind={emptyKindForStatus(data.status)} />
          ) : (
            <>
              <CatalogStatus status={data.status} completedAt={data.completedAt} />
              <ProductGrid products={data.items} />
              <PaginationControl previousHref={prevHref} nextHref={nextHref} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
