import type { ReactElement } from 'react';
import { catalogV1SortSchema, type CatalogV1Sort } from '@vaarg/shared';
import { t } from '../lib/i18n';

const SORTS: CatalogV1Sort[] = catalogV1SortSchema.options;

/** Sort radio group — rendered inside a filter form (no JavaScript required). */
export function SortControl({ value }: { value: string }): ReactElement {
  return (
    <fieldset className="sort-control" data-testid="sort-control">
      <legend>{t('filters.sort')}</legend>
      <div className="sort-control__options">
        {SORTS.map((sort) => (
          <label key={sort} className="chip">
            <input
              type="radio"
              name="sort"
              value={sort}
              defaultChecked={value === sort}
            />
            {t(`sort.${sort}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
