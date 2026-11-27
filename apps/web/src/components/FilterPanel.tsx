import type { ReactElement } from 'react';
import type { CatalogV1Filters } from '@vaarg/shared';
import type { ListParams } from '../lib/params';
import { t } from '../lib/i18n';
import { FilterReporter } from './ExperienceReporter';
import { SortControl } from './SortControl';

/**
 * Server-rendered GET filter form (FL04). Every control submits to the
 * current path; cursor/trail are intentionally not submitted, so applying
 * filters deterministically resets to the first page.
 */
export function FilterPanel({
  action,
  params,
  filters,
  filtersUnavailable,
}: {
  action: string;
  params: ListParams;
  filters: CatalogV1Filters | null | undefined;
  filtersUnavailable?: boolean | undefined;
}): ReactElement {
  const ui = params.ui;
  const attributeGroups = filters ? [...filters.options, ...filters.attributes] : [];
  return (
    <form className="filter-panel" method="get" action={action} data-testid="filter-panel">
      <FilterReporter />
      <SortControl value={ui.sort} />

      <div className="filter-panel__field">
        <label>
          {t('filters.keyword')}
          <input type="text" name="q" defaultValue={ui.q} maxLength={200} />
        </label>
      </div>

      <fieldset className="filter-panel__group">
        <legend>{t('filters.availability')}</legend>
        <label className="chip">
          <input type="radio" name="available" value="" defaultChecked={ui.available === ''} />
          {t('filters.any')}
        </label>
        <label className="chip">
          <input type="radio" name="available" value="true" defaultChecked={ui.available === 'true'} />
          {t('filters.inStock')}
        </label>
        <label className="chip">
          <input type="radio" name="available" value="false" defaultChecked={ui.available === 'false'} />
          {t('filters.outOfStock')}
        </label>
      </fieldset>

      {filters ? (
        <>
          <div className="filter-panel__field">
            <label>
              {t('filters.productType')}
              <select name="productType" defaultValue={ui.productType}>
                <option value="">{t('filters.any')}</option>
                {filters.productTypes.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.value} ({entry.count})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="filter-panel__field">
            <label>
              {t('filters.vendor')}
              <select name="vendor" defaultValue={ui.vendor}>
                <option value="">{t('filters.any')}</option>
                {filters.vendors.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.value} ({entry.count})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      ) : null}

      <div className="filter-panel__row">
        <label>
          {t('filters.priceMin')}
          <input type="text" inputMode="decimal" name="priceMin" defaultValue={ui.priceMin} maxLength={20} />
        </label>
        <label>
          {t('filters.priceMax')}
          <input type="text" inputMode="decimal" name="priceMax" defaultValue={ui.priceMax} maxLength={20} />
        </label>
      </div>

      {attributeGroups.length > 0 ? (
        <fieldset className="filter-panel__group">
          <legend>{t('filters.attribute')}</legend>
          <label className="chip">
            <input type="radio" name="attribute" value="" defaultChecked={ui.attribute === ''} />
            {t('filters.any')}
          </label>
          {attributeGroups.map((group) =>
            group.values.map((entry) => {
              const wire = `${group.name}:${entry.value}`;
              return (
                <label key={wire} className="chip">
                  <input
                    type="radio"
                    name="attribute"
                    value={wire}
                    defaultChecked={ui.attribute === wire}
                  />
                  {group.name}: {entry.value} ({entry.count})
                </label>
              );
            }),
          )}
        </fieldset>
      ) : null}

      {ui.collection ? <input type="hidden" name="collection" value={ui.collection} /> : null}
      {ui.limit ? <input type="hidden" name="limit" value={ui.limit} /> : null}

      {filtersUnavailable ? (
        <p className="filter-panel__warn" role="status">
          {t('filters.facetsUnavailable')}
        </p>
      ) : null}

      <button type="submit" className="btn">
        {t('common.apply')}
      </button>
    </form>
  );
}
