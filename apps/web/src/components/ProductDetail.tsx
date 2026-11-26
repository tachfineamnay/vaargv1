import type { ReactElement } from 'react';
import Link from 'next/link';
import type { CatalogV1CompatibleOptions, CatalogV1ProductDetailResponse, CatalogV1Related } from '@vaarg/shared';
import type { StorefrontError } from '../lib/errors';
import { productJsonLd } from '../lib/seo';
import { t } from '../lib/i18n';
import { CatalogStatus } from './CatalogStatus';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { ProductAttributes } from './ProductAttributes';
import { ProductGallery } from './ProductGallery';
import { Recommendations } from './Recommendations';
import { VariantSelector } from './VariantSelector';

export type SettledSection<T> = { ok: true; data: T } | { ok: false; error: StorefrontError };

/** Full product detail composition: gallery, variants, data, related, compatibility. */
export function ProductDetail({
  detail,
  variantParam,
  baseSearch,
  related,
  compatible,
}: {
  detail: CatalogV1ProductDetailResponse;
  variantParam?: string | undefined;
  baseSearch: string;
  related: SettledSection<CatalogV1Related>;
  compatible: SettledSection<CatalogV1CompatibleOptions>;
}): ReactElement {
  const { summary } = detail;
  const jsonLd = productJsonLd({
    title: summary.title,
    description: detail.description,
    image: summary.image?.url ?? null,
    price: summary.priceMin?.amount ?? null,
    currency: summary.priceMin?.currencyCode ?? null,
    available: summary.availableForSale,
  });
  return (
    <div className="product-detail" data-testid="product-detail">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <nav className="product-detail__breadcrumb">
        <Link href="/products">← {t('product.backToProducts')}</Link>
      </nav>
      <div className="product-detail__layout">
        <ProductGallery images={detail.images} mediaCount={detail.mediaCount} />
        <div className="product-detail__info">
          <h1>{summary.title}</h1>
          <p className="card__meta">
            {summary.vendor}
            {summary.productType ? ` · ${summary.productType}` : ''}
          </p>
          <VariantSelector
            options={detail.options}
            variants={detail.variants}
            initialVariantId={variantParam}
            productPriceMin={summary.priceMin}
            productPriceMax={summary.priceMax}
            productAvailable={summary.availableForSale}
            pathname={`/products/${summary.handle}`}
            baseSearch={baseSearch}
          />
          <CatalogStatus status={detail.status} completedAt={detail.completedAt} generation={detail.generation} />
          <section className="product-detail__description">
            <h2>{t('product.description')}</h2>
            <p>{detail.description || t('product.noDescription')}</p>
          </section>
          <ProductAttributes attributes={detail.attributes} options={detail.options} />
        </div>
      </div>

      <section className="product-detail__related">
        <h2>{t('product.related')}</h2>
        {related.ok ? (
          related.data.items.length > 0 ? (
            <Recommendations items={related.data.items} />
          ) : (
            <EmptyState kind="noResults" />
          )
        ) : (
          <ErrorState error={related.error} retryHref={`/products/${summary.handle}`} />
        )}
      </section>

      {compatible.ok ? (
        compatible.data.personalization.length > 0 || compatible.data.options.length > 0 ? (
          <section className="product-detail__compat" data-testid="compatibility-panel">
            <h2>{t('product.compatibility')}</h2>
            <p>
              <strong>{compatible.data.compatibility}</strong> — {t('product.compatibilityUnknown')}
            </p>
            {compatible.data.personalization.length > 0 ? (
              <>
                <h3>{t('product.personalization')}</h3>
                <dl>
                  {compatible.data.personalization.map((entry, index) => (
                    <div key={`${entry.namespace}.${entry.key}-${index}`}>
                      <dt>
                        {entry.namespace}.{entry.key}
                      </dt>
                      <dd>{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : null}
          </section>
        ) : null
      ) : (
        <ErrorState error={compatible.error} retryHref={`/products/${summary.handle}`} />
      )}
    </div>
  );
}
