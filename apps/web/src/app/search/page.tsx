import type { ReactElement } from 'react';
import type { StorefrontSearchResponse } from '@vaarg/shared';
import { CatalogStatus } from '../../components/CatalogStatus';
import { EmptyState, emptyKindForStatus } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { SearchViewReporter } from '../../components/ExperienceReporter';
import { ProductGrid } from '../../components/ProductCard';
import { SearchInput } from '../../components/SearchInput';
import { createCatalogClient } from '../../lib/catalog';
import { toStorefrontError } from '../../lib/errors';
import { t } from '../../lib/i18n';
import {
  parseListParams,
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

  const searchFilters: Record<string, string> = {};
  for (const key of ['mode','limit','available','priceMin','priceMax','collection','productType','vendor','attribute']) {
    const value = raw[key];
    if (typeof value === 'string' && value) searchFilters[key] = value;
  }
  const retryHref = `/search?${new URLSearchParams({ ...searchFilters, q: qRaw }).toString()}`;
  const head = (
    <section className="page-head">
      <h1>{t('search.title')}</h1>
      <SearchInput action="/search" defaultValue={qRaw} hidden={searchFilters} />
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
  let data: StorefrontSearchResponse;
  try {
    const query = { ...searchFilters, q: params.api.q!, mode: raw.mode === 'hybrid' ? 'hybrid' : 'lexical' };
    data = await createCatalogClient(host).experienceSearch(query);
  } catch (error) {
    return (
      <>
        {head}
        <ErrorState error={toStorefrontError(error)} retryHref={retryHref} />
      </>
    );
  }

  const catalogStatus = data.catalogStatus === 'OK' ? 'FRESH' : data.catalogStatus ?? 'NOT_SYNCED';
  return (
    <>
      {head}
      <SearchViewReporter query={data.query ?? qRaw} />
      <section className="page-head">
        <h2>{t('search.resultsFor', { q: data.query ?? qRaw })}</h2>
      </section>
      {data.status === 'DEGRADED_LEXICAL' ? <p role="status">{t('search.degraded')}</p> : null}
      {data.items.length === 0 ? (
        <EmptyState kind={emptyKindForStatus(catalogStatus)} />
      ) : (
        <>
          <CatalogStatus status={catalogStatus} completedAt={data.completedAt} />
          <ProductGrid products={data.items} />
          <p className="section">{t('search.bounded')}</p>
        </>
      )}
    </>
  );
}
