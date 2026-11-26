import type { ReactElement } from 'react';
import Link from 'next/link';
import { SITE_CONFIG } from '../lib/site';

export function StorefrontFooter(): ReactElement {
  return (
    <footer className="site-footer" data-testid="site-footer">
      <p>
        {SITE_CONFIG.name} — Shopify owns transactions; VAARG owns the experience and consented
        memory.
      </p>
      <nav aria-label="Footer">
        <ul>
          <li>
            <Link href="/preferences">Preferences</Link>
          </li>
          <li>
            <Link href="/health">Service status</Link>
          </li>
        </ul>
      </nav>
    </footer>
  );
}
