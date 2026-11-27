import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import './globals.css';
import { CompareProvider } from '../components/CompareProvider';
import { CompareTray } from '../components/CompareTray';
import { SessionProvider } from '../components/SessionProvider';
import { StorefrontFooter } from '../components/StorefrontFooter';
import { StorefrontHeader } from '../components/StorefrontHeader';
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
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SessionProvider>
          <CompareProvider>
            <StorefrontHeader />
            <main id="main">{children}</main>
            <CompareTray />
            <StorefrontFooter />
          </CompareProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
