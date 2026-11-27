import type { ReactElement } from 'react';
import Link from 'next/link';
import { NAVIGATION, SITE_CONFIG } from '../lib/site';
import { PersonalShopperTrigger } from './PersonalShopperDrawer';

/** Storefront header: brand + primary navigation + Personal Shopper trigger. */
export function StorefrontHeader(): ReactElement {
  return (
    <header className="site-header" data-testid="site-header">
      <Link href="/" className="brand" aria-label={`${SITE_CONFIG.name} home`}>
        {SITE_CONFIG.name}
      </Link>
      <div className="site-header__actions">
        <nav aria-label="Primary" className="site-nav">
          <ul>
            {NAVIGATION.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
        <PersonalShopperTrigger />
      </div>
    </header>
  );
}
