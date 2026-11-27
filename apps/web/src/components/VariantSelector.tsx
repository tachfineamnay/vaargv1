'use client';

import { useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import type { CatalogV1Price, CatalogV1Variant } from '@vaarg/shared';
import {
  findVariant,
  initialSelection,
  isSelectionComplete,
  type OptionSelection,
  type ProductOption,
} from '../lib/variants';
import { t } from '../lib/i18n';
import { AvailabilityIndicator } from './AvailabilityIndicator';
import { PriceDisplay } from './PriceDisplay';

/**
 * Deterministic variant selection: the choice lives in controlled state and is
 * mirrored into `?variant=` for shareable URLs. A combination that matches no
 * variant is reported as unavailable — a different variant is never silently
 * substituted, and an unavailable variant is never preselected when an
 * available one exists.
 */
export function VariantSelector({
  options,
  variants,
  initialVariantId,
  productPriceMin,
  productPriceMax,
  productAvailable,
  pathname,
  baseSearch,
}: {
  options: ProductOption[];
  variants: CatalogV1Variant[];
  initialVariantId?: string | undefined;
  productPriceMin: CatalogV1Price | null;
  productPriceMax: CatalogV1Price | null;
  productAvailable: boolean;
  pathname: string;
  baseSearch: string;
}): ReactElement {
  const router = useRouter();
  const [selection, setSelection] = useState<OptionSelection | null>(() =>
    initialSelection(variants, options, initialVariantId),
  );
  const selectedVariant = selection ? findVariant(variants, options, selection) : null;
  const complete = selection !== null && isSelectionComplete(options, selection);

  const choose = (name: string, value: string): void => {
    const next: OptionSelection = { ...(selection ?? {}), [name]: value };
    setSelection(next);
    const resolved = findVariant(variants, options, next);
    const search = new URLSearchParams(baseSearch.startsWith('?') ? baseSearch.slice(1) : baseSearch);
    if (resolved) search.set('variant', resolved.id);
    else search.delete('variant');
    const query = search.toString();
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  };

  return (
    <div className="variant-selector" data-testid="variant-selector">
      {options.map((option) => (
        <fieldset key={option.name} className="variant-selector__option">
          <legend>{option.name}</legend>
          <div className="variant-selector__values">
            {option.values.map((value) => (
              <label key={value} className={`chip${selection?.[option.name] === value ? ' chip--active' : ''}`}>
                <input
                  type="radio"
                  name={`option-${option.name}`}
                  value={value}
                  checked={selection?.[option.name] === value}
                  onChange={() => choose(option.name, value)}
                />
                {value}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="variant-selector__summary">
        {selectedVariant ? (
          <>
            <PriceDisplay
              priceMin={selectedVariant.price}
              priceMax={selectedVariant.price}
              compareAtPrice={selectedVariant.compareAtPrice}
            />
            <AvailabilityIndicator
              available={selectedVariant.availableForSale}
              quantity={selectedVariant.quantityAvailable}
            />
          </>
        ) : (
          <>
            {complete ? (
              <p className="variant-selector__warn" role="status" data-testid="combination-unavailable">
                {t('product.combinationUnavailable')}
              </p>
            ) : (
              <p className="variant-selector__hint">{t('product.selectOptions')}</p>
            )}
            <PriceDisplay priceMin={productPriceMin} priceMax={productPriceMax} />
            <AvailabilityIndicator available={productAvailable} />
          </>
        )}
      </div>
    </div>
  );
}
