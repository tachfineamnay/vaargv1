import type { ReactElement } from 'react';
import Link from 'next/link';
import type { CatalogV1Collection } from '@vaarg/shared';

/** Full collection card used on the collections listing. */
export function CollectionCard({ collection }: { collection: CatalogV1Collection }): ReactElement {
  return (
    <article className="card card--collection" data-testid="collection-card">
      <Link className="card__media" href={`/collections/${collection.handle}`}>
        {collection.image ? (
          <img
            src={collection.image.url}
            alt={collection.image.altText ?? collection.title}
            width={480}
            height={320}
            loading="lazy"
          />
        ) : (
          <span className="tile__placeholder" aria-hidden="true" />
        )}
      </Link>
      <div className="card__body">
        <h2 className="card__title">
          <Link href={`/collections/${collection.handle}`}>{collection.title}</Link>
        </h2>
        {collection.description ? <p className="card__text">{collection.description}</p> : null}
        <p className="card__meta">{collection.productCount}</p>
      </div>
    </article>
  );
}

/** Responsive collection grid. */
export function CollectionGrid({ collections }: { collections: CatalogV1Collection[] }): ReactElement {
  return (
    <div className="grid grid--collections">
      {collections.map((collection) => (
        <CollectionCard key={collection.id} collection={collection} />
      ))}
    </div>
  );
}
