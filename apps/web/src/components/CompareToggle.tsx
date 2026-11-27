'use client';

import type { ReactElement } from 'react';
import { MAX_COMPARE, useCompare } from './CompareProvider';
import { t } from '../lib/i18n';

/** Add/remove a product from the comparison selection. */
export function CompareToggle({ id }: { id: string }): ReactElement {
  const compare = useCompare();
  const selected = compare.has(id);
  const full = compare.ids.length >= MAX_COMPARE && !selected;
  return (
    <button
      type="button"
      className={`btn btn--small${selected ? ' btn--active' : ''}`}
      data-testid="compare-toggle"
      aria-pressed={selected}
      disabled={full}
      {...(full ? { title: t('product.compareFull') } : {})}
      onClick={() => compare.toggle(id)}
    >
      {selected ? t('product.removeCompare') : t('product.addCompare')}
    </button>
  );
}
