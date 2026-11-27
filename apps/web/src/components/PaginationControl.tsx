import type { ReactElement } from 'react';
import Link from 'next/link';
import { t } from '../lib/i18n';

/** Cursor pagination links (deterministic URLs; disabled ends rendered as text). */
export function PaginationControl({
  previousHref,
  nextHref,
  label,
}: {
  previousHref?: string | null | undefined;
  nextHref?: string | null | undefined;
  label?: string | undefined;
}): ReactElement | null {
  if (!previousHref && !nextHref) return null;
  return (
    <nav className="pagination" data-testid="pagination" aria-label={label ?? t('common.page')}>
      {previousHref ? (
        <Link className="btn btn--ghost" href={previousHref} rel="prev">
          ← {t('common.previous')}
        </Link>
      ) : (
        <span className="pagination__disabled" aria-disabled="true">
          ← {t('common.previous')}
        </span>
      )}
      {nextHref ? (
        <Link className="btn" href={nextHref} rel="next">
          {t('common.next')} →
        </Link>
      ) : (
        <span className="pagination__disabled" aria-disabled="true">
          {t('common.next')} →
        </span>
      )}
    </nav>
  );
}
