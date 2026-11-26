'use client';

import type { ReactElement } from 'react';
import { ErrorState } from '../components/ErrorState';
import { t } from '../lib/i18n';

/** Route-level safety net: unexpected failures get an honest error surface. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): ReactElement {
  return (
    <section className="page-head">
      <ErrorState error={{ kind: 'internal', message: error.message || 'Unexpected application error' }} />
      <button type="button" className="btn" onClick={reset}>
        {t('common.retry')}
      </button>
    </section>
  );
}
