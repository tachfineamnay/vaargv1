import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import './globals.css';
import { SiteHeader } from '../components/SiteHeader';
import { SITE_CONFIG } from '../lib/site';

export const metadata: Metadata = {
  title: `${SITE_CONFIG.name} — ${SITE_CONFIG.tagline}`,
  description: SITE_CONFIG.tagline,
  metadataBase: new URL(process.env.APP_BASE_URL ?? 'http://localhost:3000'),
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main>{children}</main>
        <footer className="site-footer">
          <p>
            {SITE_CONFIG.name} — Shopify owns transactions; VAARG owns the experience and
            consented memory.
          </p>
        </footer>
      </body>
    </html>
  );
}
