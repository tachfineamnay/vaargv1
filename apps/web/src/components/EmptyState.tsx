import type { ReactElement } from 'react';
import Link from 'next/link';
import { t, type MessageKey } from '../lib/i18n';

export type EmptyStateKind =
  | 'notConfigured'
  | 'notSynced'
  | 'noResults'
  | 'noSearch'
  | 'noCollections'
  | 'compareFew'
  | 'notFound';

const COPY: Record<EmptyStateKind, { title: MessageKey; description: MessageKey }> = {
  notConfigured: { title: 'empty.notConfigured.title', description: 'empty.notConfigured.description' },
  notSynced: { title: 'empty.notSynced.title', description: 'empty.notSynced.description' },
  noResults: { title: 'empty.noResults.title', description: 'empty.noResults.description' },
  noSearch: { title: 'empty.noSearch.title', description: 'empty.noSearch.description' },
  noCollections: { title: 'empty.noCollections.title', description: 'empty.noCollections.description' },
  compareFew: { title: 'empty.compareFew.title', description: 'empty.compareFew.description' },
  notFound: { title: 'empty.notFound.title', description: 'empty.notFound.description' },
};

/** Map a list availability status to the matching empty-state kind. */
export function emptyKindForStatus(status: string): EmptyStateKind {
  if (status === 'NOT_CONFIGURED') return 'notConfigured';
  if (status === 'NOT_SYNCED' || status === 'IN_PROGRESS') return 'notSynced';
  return 'noResults';
}

export function EmptyState({
  kind,
  title,
  description,
  actionHref,
  actionLabel,
}: {
  kind: EmptyStateKind;
  title?: string | undefined;
  description?: string | undefined;
  actionHref?: string | undefined;
  actionLabel?: string | undefined;
}): ReactElement {
  return (
    <section className="state state--empty" data-testid="empty-state" data-kind={kind} aria-live="polite">
      <h2>{title ?? t(COPY[kind].title)}</h2>
      <p>{description ?? t(COPY[kind].description)}</p>
      {actionHref ? (
        <Link className="btn" href={actionHref}>
          {actionLabel ?? t('common.backHome')}
        </Link>
      ) : null}
    </section>
  );
}
