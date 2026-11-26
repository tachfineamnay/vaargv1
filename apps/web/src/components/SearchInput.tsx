import type { ReactElement } from 'react';
import { t } from '../lib/i18n';

/** GET-form search box — works without JavaScript. */
export function SearchInput({
  action,
  defaultValue,
  compact,
}: {
  action: string;
  defaultValue?: string | undefined;
  compact?: boolean | undefined;
}): ReactElement {
  return (
    <form
      className={compact ? 'search search--compact' : 'search'}
      action={action}
      method="get"
      role="search"
      data-testid="search-input"
    >
      <label className="search__label">
        <span className="sr-only">{t('search.title')}</span>
        <input
          type="search"
          name="q"
          defaultValue={defaultValue ?? ''}
          placeholder={t('search.placeholder')}
          maxLength={200}
        />
      </label>
      <button type="submit" className="btn">
        {t('search.submit')}
      </button>
    </form>
  );
}
