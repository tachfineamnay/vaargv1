import Link from 'next/link';
import type { ReactElement } from 'react';
import { COLLECTIONS } from '../lib/site';

export function CollectionGrid(): ReactElement {
  return (
    <section aria-label="Collections" className="collection-grid" data-testid="collection-grid">
      <ul>
        {COLLECTIONS.map((collection) => (
          <li key={collection.id} className="tile" data-testid={`collection-${collection.id}`}>
            <Link href={`/collections/${collection.id}`}>
              <h2>{collection.title}</h2>
              <p>{collection.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
