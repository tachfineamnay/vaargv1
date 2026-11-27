import type { ReactElement } from 'react';
import type { CatalogV1Price } from '@vaarg/shared';
import { formatMoney, t } from '../lib/i18n';

export function PriceDisplay({
  priceMin,
  priceMax,
  compareAtPrice,
}: {
  priceMin?: CatalogV1Price | null | undefined;
  priceMax?: CatalogV1Price | null | undefined;
  compareAtPrice?: CatalogV1Price | null | undefined;
}): ReactElement | null {
  if (!priceMin && !priceMax) return null;
  let text: string;
  if (priceMin && priceMax) {
    text =
      priceMin.amount === priceMax.amount && priceMin.currencyCode === priceMax.currencyCode
        ? formatMoney(priceMin)
        : `${formatMoney(priceMin)} – ${formatMoney(priceMax)}`;
  } else {
    const single = priceMin ?? priceMax;
    if (!single) return null;
    text = formatMoney(single);
  }
  return (
    <p className="price" data-testid="price">
      <span className="price__current">{text}</span>
      {compareAtPrice ? (
        <span className="price__was">
          {t('product.compareAt')} {formatMoney(compareAtPrice)}
        </span>
      ) : null}
    </p>
  );
}
