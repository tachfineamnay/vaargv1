import { cache, type ReactElement } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CatalogV1CollectionResponse } from '@vaarg/shared';
import { CatalogStatus } from '../../../components/CatalogStatus';
import { EmptyState, emptyKindForStatus } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { FilterPanel } from '../../../components/FilterPanel';
import { PaginationControl } from '../../../components/PaginationControl';
import { ProductGrid } from '../../../components/ProductCard';
import { createCatalogClient } from '../../../lib/catalog';
import { toStorefrontError } from '../../../lib/errors';
import { t } from '../../../lib/i18n';
import {
  currentListSearch,
  hasPreviousPage,
  nextPageListSearch,
  parseListParams,
  previousPageListSearch,
  type ListParams,
} from '../../../lib/params';
import { storefrontHost } from '../../../lib/storefront';

export const dynamic = 'force-dynamic';

const getCollectionDetail = cache(async (host: string, ref: string) => createCatalogClient(host).getCollection(ref));

export default async function CollectionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const { handle } = await params;
  const parsed = parseListParams(await searchParams, 'products');
  // The path is the collection authority — a conflicting `?collection=` is dropped.
  const api = { ...parsed.api };
  delete api.collection;
  const listParams: ListParams = { ...parsed, api };
  const baseHref = `/collections/${handle}`;
  const retryHref = `${baseHref}${currentListSearch(listParams)}`;

  let host: string;
  try {
    host = await storefrontHost();
  } catch (error) {
    return <ErrorState error={toStorefrontError(error)} retryHref={retryHref} />;
  }
  let collection: CatalogV1CollectionResponse;
  try {
    collection = await getCollectionDetail(host, handle);
  } catch (error) {
    const storefrontError = toStorefrontError(error);
    if (storefrontError.kind === 'not_found') notFound();
    return <ErrorState error={storefrontError} retryHref={baseHref} />;
  }

  const [listResult, filtersResult] = await Promise.allSettled([
    createCatalogClient(host).listCollectionProducts(handle, listParams.api),
    createCatalogClient(host).getFilters({ collection: handle }),
  ]);
  if (listResult.status === 'rejected') {
    return <ErrorState error={toStorefrontError(listResult.reason)} retryHref={retryHref} />;
  }
  const data = listResult.value;
  const filters = filtersResult.status === 'fulfilled' ? filtersResult.value : null;
  const nextHref = data.nextCursor ? `${baseHref}${nextPageListSearch(listParams, data.nextCursor)}` : null;
  const prevHref = hasPreviousPage(listParams) ? `${baseHref}${previousPageListSearch(listParams)}` : null;

  return (
    <>
      <section className="page-head">
        <nav className="breadcrumb">
          <Link href="/collections">← {t('nav.collections')}</Link>
        </nav>
        <h1>{collection.title}</h1>
        {collection.description ? <p className="page-head__text">{collection.description}</p> : null}
        <p className="card__meta">{collection.productCount}</p>
        <CatalogStatus
          status={collection.status}
          completedAt={collection.completedAt}
          generation={collection.generation}
        />
      </section>
      <div className="page-layout">
        <aside className="page-layout__aside">
          <FilterPanel
            action={baseHref}
            params={listParams}
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
