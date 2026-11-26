import type { ReactElement } from 'react';
import { ApiStatusPanel } from '../components/ApiStatusPanel';
import { probeApiStatus } from '../lib/api-client';
import { SITE_CONFIG } from '../lib/site';

export const dynamic = 'force-dynamic';

export default async function HomePage(): Promise<ReactElement> {
  const status = await probeApiStatus();

  return (
    <>
      <section className="hero" data-testid="hero">
        <p className="eyebrow">Industrial adaptive commerce</p>
        <h1>{SITE_CONFIG.name}</h1>
        <p>{SITE_CONFIG.tagline}</p>
      </section>
      <ApiStatusPanel status={status} />
      <section aria-label="Platform" className="platform" data-testid="platform">
        <h2>A storefront that adapts</h2>
        <p>
          Shopify remains the transaction authority. VAARG orchestrates the experience, the
          consented customer memory and the agent intelligence around it — without inventing
          products, prices or availability.
        </p>
      </section>
    </>
  );
}
