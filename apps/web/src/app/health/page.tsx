import type { ReactElement } from 'react';

export const dynamic = 'force-dynamic';

export default function WebHealthPage(): ReactElement {
  const status = process.env.NODE_ENV ?? 'development';
  return (
    <section data-testid="web-health">
      <h1>Service status</h1>
      <ul>
        <li data-testid="health-env">environment: {status}</li>
        <li data-testid="health-web">web: operational</li>
      </ul>
    </section>
  );
}
