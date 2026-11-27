import type { ReactElement } from 'react';
import Link from 'next/link';
import type { CatalogV1Collection } from '@vaarg/shared';

/** Compact collection tile used by the home category section. */
export function CategoryTile({ collection }: { collection: CatalogV1Collection }): ReactElement {
  return (
    <Link className="tile" href={`/collections/${collection.handle}`} data-testid="category-tile">
      {collection.image ? (
        <img
          src={collection.image.url}
          alt={collection.image.altText ?? collection.title}
          width={480}
          height={360}
          loading="lazy"
        />
      ) : (
        <span className="tile__placeholder" aria-hidden="true" />
      )}
      <span className="tile__title">{collection.title}</span>
      <span className="tile__count">{collection.productCount}</span>
    </Link>
  );
}

/** Grid of category tiles. */
export function CategoryTileGrid({ collections }: { collections: CatalogV1Collection[] }): ReactElement {
  return (
    <div className="grid grid--tiles">
      {collections.map((collection) => (
        <CategoryTile key={collection.id} collection={collection} />
      ))}
    </div>
  );
}
