import type { ReactElement } from 'react';
import type { ApiStatus } from '../lib/api-client';

export function ApiStatusPanel({ status }: { status: ApiStatus }): ReactElement {
  const label =
    status.state === 'connected'
      ? `Connected to VAARG API (${status.version?.version ?? 'unknown'})`
      : status.state === 'invalid_response'
        ? 'API reachable but response failed contract validation'
        : 'VAARG API unreachable';

  const readinessSummary = status.readiness
    ? status.readiness.checks
        .map((check) => `${check.name}=${check.status}`)
        .join(', ')
    : undefined;

  return (
    <section
      className={`api-status api-status--${status.state}`}
      aria-live="polite"
      data-testid="api-status"
      data-state={status.state}
    >
      <p className="api-status__label" data-testid="api-status-label">
        {label}
      </p>
      {status.error ? (
        <p className="api-status__error" data-testid="api-status-error">
          {status.error}
        </p>
      ) : null}
      {readinessSummary ? (
        <p className="api-status__detail" data-testid="api-status-readiness">
          Readiness: {readinessSummary}
        </p>
      ) : null}
    </section>
  );
}
