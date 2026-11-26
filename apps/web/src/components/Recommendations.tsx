import type { ReactElement } from 'react';
import Link from 'next/link';
import type { CatalogV1Related } from '@vaarg/shared';
import { t } from '../lib/i18n';
import { ProductCard } from './ProductCard';

type RelatedItem = CatalogV1Related['items'][number];

function ProvenanceNote({ relation, provenance }: { relation: RelatedItem['relation']; provenance: string }): ReactElement {
  if (relation === 'product_type') {
    return (
      <Link className="chip" href={`/products?productType=${encodeURIComponent(provenance)}`}>
        {t('product.relatedProductType', { value: provenance })}
      </Link>
    );
  }
  return <span className="chip">{t('product.relatedCollection')}</span>;
}

/** Related products with explicit, visible provenance (never implied). */
export function Recommendations({ items }: { items: RelatedItem[] }): ReactElement {
  return (
    <div className="grid grid--products" data-testid="recommendations">
      {items.map((item) => (
        <ProductCard
          key={item.summary.id}
          product={item.summary}
          note={<ProvenanceNote relation={item.relation} provenance={item.provenance} />}
        />
      ))}
    </div>
  );
}
