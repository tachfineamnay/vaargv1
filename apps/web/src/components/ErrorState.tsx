import type { ReactElement } from 'react';
import Link from 'next/link';
import type { StorefrontError, StorefrontErrorKind } from '../lib/errors';
import { t, type MessageKey } from '../lib/i18n';

const KIND_COPY: Record<StorefrontErrorKind, MessageKey> = {
  network: 'error.network',
  timeout: 'error.timeout',
  invalid_response: 'error.invalidResponse',
  invalid_host: 'error.invalidHost',
  unknown_storefront: 'error.unknownStorefront',
  not_configured: 'error.notConfigured',
  bad_request: 'error.badRequest',
  unauthorized: 'error.unauthorized',
  forbidden: 'error.forbidden',
  not_found: 'error.notFound',
  conflict: 'error.conflict',
  unprocessable: 'error.unprocessable',
  unavailable: 'error.unavailable',
  internal: 'error.internal',
};

export interface ErrorStateInput {
  kind: StorefrontErrorKind;
  message: string;
  requestId?: string | undefined;
}

/** Accepts a StorefrontError or a plain structural equivalent (error boundaries). */
export function ErrorState({
  error,
  retryHref,
}: {
  error: StorefrontError | ErrorStateInput;
  retryHref?: string | undefined;
}): ReactElement {
  const kind: StorefrontErrorKind = error.kind;
  const friendly = t(KIND_COPY[kind] ?? 'error.internal');
  const detail = error.message && error.message !== friendly ? error.message : '';
  const requestId = 'requestId' in error ? error.requestId : undefined;
  return (
    <section className="state state--error" data-testid="error-state" data-kind={kind} role="alert">
      <h2>{t('error.title')}</h2>
      <p data-testid="error-copy">{friendly}</p>
      {detail ? <p className="state__detail">{detail}</p> : null}
      {requestId ? (
        <p className="state__meta">
          {t('error.requestId')}: {requestId}
        </p>
      ) : null}
      {retryHref ? (
        <Link className="btn" href={retryHref}>
          {t('common.retry')}
        </Link>
      ) : null}
    </section>
  );
}
