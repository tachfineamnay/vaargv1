import type { ReactElement } from 'react';
import type { CatalogV1Status } from '@vaarg/shared';
import { ApiStatusPanel } from '../../components/ApiStatusPanel';
import { CatalogStatus } from '../../components/CatalogStatus';
import { probeApiStatus } from '../../lib/api-client';
import { createCatalogClient } from '../../lib/catalog';
import { toStorefrontError, type StorefrontError } from '../../lib/errors';
import { storefrontHost } from '../../lib/storefront';

export const dynamic = 'force-dynamic';

export default async function WebHealthPage(): Promise<ReactElement> {
  const status = process.env.NODE_ENV ?? 'development';
  const probe = await probeApiStatus();
  let catalogStatus: CatalogV1Status | null = null;
  let catalogError: StorefrontError | null = null;
  try {
    const host = await storefrontHost();
    catalogStatus = await createCatalogClient(host).getCatalogStatus();
  } catch (error) {
    catalogError = toStorefrontError(error);
  }
  return (
    <section data-testid="web-health">
      <h1>Service status</h1>
      <ul>
        <li data-testid="health-env">environment: {status}</li>
        <li data-testid="health-web">web: operational</li>
      </ul>
      <ApiStatusPanel status={probe} />
      {catalogStatus ? (
        <CatalogStatus
          status={catalogStatus.status}
          completedAt={catalogStatus.completedAt}
          generation={catalogStatus.generation}
        />
      ) : catalogError ? (
        <p data-testid="catalog-status-error">{catalogError.message}</p>
      ) : null}
    </section>
  );
}
