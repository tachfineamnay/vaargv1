import Link from 'next/link';
import type { ReactElement } from 'react';
import { NAVIGATION, SITE_CONFIG } from '../lib/site';

export function SiteHeader(): ReactElement {
  return (
    <header className="site-header" data-testid="site-header">
      <Link href="/" className="brand" aria-label={`${SITE_CONFIG.name} home`}>
        {SITE_CONFIG.name}
      </Link>
      <nav aria-label="Primary" className="site-nav">
        <ul>
          {NAVIGATION.map((item) => (
            <li key={item.href}>
              <Link href={item.href}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
