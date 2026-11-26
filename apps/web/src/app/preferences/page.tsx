import type { ReactElement } from 'react';
import { PreferencesPanel } from '../../components/PreferencesPanel';
import { t } from '../../lib/i18n';

export const dynamic = 'force-dynamic';

export default function PreferencesPage(): ReactElement {
  return (
    <>
      <section className="page-head">
        <h1>{t('prefs.title')}</h1>
      </section>
      <PreferencesPanel />
    </>
  );
}
