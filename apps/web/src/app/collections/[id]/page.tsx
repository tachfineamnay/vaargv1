import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { COLLECTIONS, SITE_CONFIG } from '../../../lib/site';

export function generateStaticParams(): { params: { id: string } }[] {
  return COLLECTIONS.map((collection) => ({ params: { id: collection.id } }));
}

export function generateMetadata({ params }: { params: { id: string } }): { title: string } {
  const collection = COLLECTIONS.find((entry) => entry.id === params.id);
  return {
    title: collection ? `${SITE_CONFIG.name} · ${collection.title}` : `${SITE_CONFIG.name}`,
  };
}

export default function CollectionPage({ params }: { params: { id: string } }): ReactElement {
  const collection = COLLECTIONS.find((entry) => entry.id === params.id);
  if (!collection) {
    notFound();
  }
  return (
    <article data-testid="collection-page">
      <h1>{collection?.title}</h1>
      <p>{collection?.description}</p>
    </article>
  );
}
