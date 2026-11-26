import type { ReactElement } from 'react';
import type { CatalogV1CollectionsResponse } from '@vaarg/shared';
import { CatalogStatus } from '../../components/CatalogStatus';
import { CollectionGrid } from '../../components/CollectionCard';
import { EmptyState, emptyKindForStatus } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { PaginationControl } from '../../components/PaginationControl';
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

function emptyKind(data: CatalogV1CollectionsResponse): ReturnType<typeof emptyKindForStatus> {
  if (data.status === 'NOT_CONFIGURED') return 'notConfigured';
  if (data.status === 'NOT_SYNCED' || data.status === 'IN_PROGRESS') return 'notSynced';
  return 'noCollections';
}

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactElement> {
  const params: ListParams = parseListParams(await searchParams, 'collections');
  const retryHref = `/collections${currentListSearch(params)}`;
  let host: string;
  try {
    host = await storefrontHost();
  } catch (error) {
    return <ErrorState error={toStorefrontError(error)} retryHref={retryHref} />;
  }
  let data: CatalogV1CollectionsResponse;
  try {
    data = await createCatalogClient(host).listCollections(params.api);
  } catch (error) {
    return <ErrorState error={toStorefrontError(error)} retryHref={retryHref} />;
  }
  const nextHref = data.nextCursor ? `/collections${nextPageListSearch(params, data.nextCursor)}` : null;
  const prevHref = hasPreviousPage(params) ? `/collections${previousPageListSearch(params)}` : null;
  return (
    <>
      <section className="page-head">
        <h1>{t('nav.collections')}</h1>
      </section>
      {data.items.length === 0 ? (
        <EmptyState kind={emptyKind(data)} />
      ) : (
        <>
          <CatalogStatus status={data.status} completedAt={data.completedAt} />
          <CollectionGrid collections={data.items} />
          <PaginationControl previousHref={prevHref} nextHref={nextHref} />
        </>
      )}
    </>
  );
}
