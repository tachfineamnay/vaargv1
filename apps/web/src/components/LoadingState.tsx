import type { ReactElement } from 'react';
import { t } from '../lib/i18n';

export function LoadingState(): ReactElement {
  return (
    <section className="state state--loading" data-testid="loading-state" aria-busy="true" aria-live="polite">
      <p>{t('common.loading')}</p>
    </section>
  );
}
