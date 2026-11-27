'use client';

import type { ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { useCompare } from './CompareProvider';
import { t } from '../lib/i18n';

/** Remove one column from the comparison, updating the URL deterministically. */
export function CompareRemoveButton({ index, ids }: { index: number; ids: string[] }): ReactElement {
  const router = useRouter();
  const compare = useCompare();
  return (
    <button
      type="button"
      className="btn btn--small btn--ghost"
      data-testid="compare-remove"
      onClick={() => {
        const removed = ids[index];
        if (removed) compare.remove(removed);
        const next = ids.filter((_, position) => position !== index);
        router.replace(next.length >= 2 ? `/compare?ids=${encodeURIComponent(next.join(','))}` : '/compare');
      }}
    >
      {t('compare.remove')}
    </button>
  );
}
