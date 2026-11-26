import type { ReactElement } from 'react';
import type { CatalogV1Attribute } from '@vaarg/shared';
import type { ProductOption } from '../lib/variants';
import { t } from '../lib/i18n';

/** Options and verified attributes as definition lists. */
export function ProductAttributes({
  attributes,
  options,
}: {
  attributes: CatalogV1Attribute[];
  options: ProductOption[];
}): ReactElement {
  return (
    <div className="attributes" data-testid="product-attributes">
      {options.length > 0 ? (
        <section>
          <h3>{t('product.options')}</h3>
          <dl>
            {options.map((option) => (
              <div key={option.name}>
                <dt>{option.name}</dt>
                <dd>{option.values.join(', ')}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {attributes.length > 0 ? (
        <section>
          <h3>{t('product.attributes')}</h3>
          <dl>
            {attributes.map((attribute, index) => (
              <div key={`${attribute.name}-${index}`}>
                <dt>
                  {attribute.name}
                  {attribute.source === 'metafield' ? ' · metafield' : ''}
                </dt>
                <dd>{attribute.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}
