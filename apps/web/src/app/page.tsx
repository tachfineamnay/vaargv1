import { Fragment, type ReactElement } from 'react';
import { AdaptiveSectionBoundary } from '../components/AdaptiveSectionBoundary';
import { SectionRenderer } from '../components/SectionRenderer';
import { createCatalogClient } from '../lib/catalog';
import { buildHomeSections } from '../lib/composition';
import { toStorefrontError } from '../lib/errors';
import { storefrontHost } from '../lib/storefront';

export const dynamic = 'force-dynamic';

export default async function HomePage(): Promise<ReactElement> {
  let host: string;
  try {
    host = await storefrontHost();
  } catch (error) {
    return <SectionRenderer section={{ id: 'host', type: 'state-error', error: toStorefrontError(error) }} />;
  }
  const client = createCatalogClient(host);
  const results = await Promise.allSettled([
    client.listCollections({ limit: '6' }),
    client.listProducts({ limit: '8', sort: 'updated-desc' }),
  ]);
  const sections = buildHomeSections({ collections: results[0], products: results[1] });
  return (
    <>
      {sections.map((section) => (
        <Fragment key={section.id}>
          <SectionRenderer section={section} />
          {section.id === 'recent' ? <AdaptiveSectionBoundary /> : null}
        </Fragment>
      ))}
    </>
  );
}
