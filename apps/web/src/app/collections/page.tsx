import type { ReactElement } from 'react';
import { SITE_CONFIG } from '../../lib/site';

export const metadata = { title: `${SITE_CONFIG.name} · Collections` };

export default function CollectionsPage(): ReactElement {
  return (
    <section data-testid="collections-page">
      <h1>Collections</h1>
      <p>
        Curated product families. Real catalogue data is loaded from Shopify in a later mission;
        no products or prices are invented here.
      </p>
    </section>
  );
}
