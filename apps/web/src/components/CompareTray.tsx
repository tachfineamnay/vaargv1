'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { useCompare } from './CompareProvider';
import { t } from '../lib/i18n';

/** Floating selection tray shown while a comparison is being assembled. */
export function CompareTray(): ReactElement | null {
  const compare = useCompare();
  if (compare.ids.length === 0) return null;
  return (
    <div className="compare-tray" data-testid="compare-tray" role="status">
      <span>{t('compare.trayCount', { count: compare.ids.length })}</span>
      <Link className="btn" href={`/compare?ids=${encodeURIComponent(compare.ids.join(','))}`}>
        {t('compare.trayCta')}
      </Link>
      <button type="button" className="btn btn--ghost" onClick={compare.clear}>
        {t('common.clear')}
      </button>
    </div>
  );
}
