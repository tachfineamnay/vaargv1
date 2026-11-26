import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import type { CatalogV1ProductSummary } from '@vaarg/shared';
import { AvailabilityIndicator } from './AvailabilityIndicator';
import { CompareToggle } from './CompareToggle';
import { PriceDisplay } from './PriceDisplay';

/** Product card: verified summary data plus the compare toggle. */
export function ProductCard({ product, note }: { product: CatalogV1ProductSummary; note?: ReactNode }): ReactElement {
  return (
    <article className="card card--product" data-testid="product-card">
      <Link className="card__media" href={`/products/${product.handle}`}>
        {product.image ? (
          <img
            src={product.image.url}
            alt={product.image.altText ?? product.title}
            width={320}
            height={320}
            loading="lazy"
          />
        ) : (
          <span className="tile__placeholder" aria-hidden="true" />
        )}
      </Link>
      <div className="card__body">
        {note ? <p className="card__note">{note}</p> : null}
        <h3 className="card__title">
          <Link href={`/products/${product.handle}`}>{product.title}</Link>
        </h3>
        <p className="card__meta">
          {product.vendor}
          {product.productType ? ` · ${product.productType}` : ''}
        </p>
        <PriceDisplay priceMin={product.priceMin} priceMax={product.priceMax} />
        <AvailabilityIndicator available={product.availableForSale} />
        <CompareToggle id={product.id} />
      </div>
    </article>
  );
}

/** Responsive product grid. */
export function ProductGrid({ products }: { products: CatalogV1ProductSummary[] }): ReactElement {
  return (
    <div className="grid grid--products">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
