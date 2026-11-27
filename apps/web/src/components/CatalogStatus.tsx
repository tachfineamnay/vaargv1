import type { ReactElement } from 'react';
import { formatDateTime, t, type MessageKey } from '../lib/i18n';

type AvailabilityStatus = 'NOT_CONFIGURED' | 'NOT_SYNCED' | 'IN_PROGRESS' | 'STALE' | 'FRESH';

const STATUS_COPY: Record<AvailabilityStatus, MessageKey> = {
  NOT_CONFIGURED: 'status.NOT_CONFIGURED',
  NOT_SYNCED: 'status.NOT_SYNCED',
  IN_PROGRESS: 'status.IN_PROGRESS',
  STALE: 'status.STALE',
  FRESH: 'status.FRESH',
};

/** Catalog freshness/status surface with stable data attributes for tests. */
export function CatalogStatus({
  status,
  completedAt,
  generation,
}: {
  status: AvailabilityStatus | string;
  completedAt?: string | null | undefined;
  generation?: string | null | undefined;
}): ReactElement {
  const key = STATUS_COPY[status as AvailabilityStatus] ?? 'status.NOT_SYNCED';
  return (
    <p
      className="catalog-status"
      data-testid="catalog-status"
      data-status={status}
      aria-live="polite"
    >
      <span className={`catalog-status__dot catalog-status__dot--${String(status).toLowerCase()}`} aria-hidden="true" />
      {t(key)}
      {completedAt ? (
        <span className="catalog-status__time">
          {' · '}
          {t('status.updatedAt')} {formatDateTime(completedAt)}
        </span>
      ) : null}
      {generation ? (
        <span className="catalog-status__generation">
          {' · '}
          {t('status.generation')} {generation.slice(0, 8)}
        </span>
      ) : null}
    </p>
  );
}
