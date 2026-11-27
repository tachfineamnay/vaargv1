'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { ConsentPurpose, ConsentState } from '@vaarg/shared';
import type { StorefrontError } from '../lib/errors';
import { formatDateTime, t, type MessageKey } from '../lib/i18n';
import { getConsents, updateConsent } from '../lib/session-client';
import { useSession } from './SessionProvider';

const PURPOSES: ConsentPurpose[] = ['analytics', 'marketing_email', 'marketing_push', 'personalization', 'data_retention'];

const VIEW_LABEL: Record<string, MessageKey> = {
  loading: 'prefs.sessionLoading',
  active: 'prefs.sessionActive',
  anonymous: 'prefs.sessionAnonymous',
  expired: 'prefs.sessionExpired',
  error: 'prefs.sessionError',
};

/**
 * Preferences surface (FL04): session lifecycle actions plus consent
 * retrieval, explicit updates and withdrawal. Every outcome is the real API
 * response — including the identity-required rejection — never a local fake.
 */
export function PreferencesPanel(): ReactElement {
  const session = useSession();
  const [consents, setConsents] = useState<ConsentState | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<StorefrontError | null>(null);
  const [busy, setBusy] = useState(false);
  const sessionId = session.session?.sessionId;
  const view = session.view;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await getConsents();
      if (cancelled) return;
      if (result.ok) {
        setConsents(result.data.consents);
        setCustomerId(result.data.customerId);
        setConsentError(null);
      } else {
        setConsentError(result.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, view]);

  const update = useCallback(async (purpose: ConsentPurpose, granted: boolean) => {
    setBusy(true);
    const result = await updateConsent({ purpose, granted });
    if (result.ok) {
      setConsents(result.data.consents);
      setCustomerId(result.data.customerId);
      setConsentError(null);
    } else {
      setConsentError(result.error);
    }
    setBusy(false);
  }, []);

  const viewLabel = t(VIEW_LABEL[view] ?? 'prefs.sessionError');

  return (
    <div className="prefs" data-testid="preferences-panel">
      <section className="prefs__card">
        <h2>{t('prefs.session')}</h2>
        <p data-testid="session-view" data-view={view}>
          {viewLabel}
        </p>
        {session.session ? (
          <>
            <p className="prefs__meta">
              {t('prefs.sessionId')}: {session.session.sessionId.slice(0, 8)}…
            </p>
            <p className="prefs__meta">
              {t('prefs.expiresAt')}: {formatDateTime(session.session.expiresAt)}
            </p>
          </>
        ) : null}
        {session.error ? (
          <p className="state__detail" role="alert" data-testid="session-error">
            {session.error.message}
          </p>
        ) : null}
        <div className="prefs__actions">
          {view === 'active' ? (
            <>
              <button type="button" className="btn" onClick={() => void session.rotate()}>
                {t('prefs.refreshSession')}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => void session.revoke()}>
                {t('prefs.endSession')}
              </button>
            </>
          ) : null}
          {view === 'anonymous' ? (
            <button type="button" className="btn" onClick={() => void session.bootstrap()}>
              {t('prefs.createSession')}
            </button>
          ) : null}
          {view === 'expired' ? (
            <button type="button" className="btn" onClick={() => void session.bootstrap(true)}>
              {t('prefs.restoreSession')}
            </button>
          ) : null}
          {view === 'error' ? (
            <button type="button" className="btn" onClick={() => void session.refresh()}>
              {t('common.retry')}
            </button>
          ) : null}
        </div>
      </section>

      <section className="prefs__card">
        <h2>{t('prefs.consents')}</h2>
        <p className="prefs__hint">{t('prefs.consentsHint')}</p>
        {customerId === null ? (
          <p className="prefs__note" data-testid="prefs-not-linked">
            {t('prefs.notLinked')}
          </p>
        ) : null}
        {consentError ? (
          <p className="state__detail" role="alert" data-testid="consent-error">
            {consentError.message}
          </p>
        ) : null}
        <ul className="prefs__list">
          {PURPOSES.map((purpose) => {
            const state = consents ? consents[purpose] : null;
            const stateClass = state === true ? 'granted' : state === false ? 'withdrawn' : 'unset';
            return (
              <li key={purpose} data-testid={`consent-${purpose}`}>
                <span className="prefs__purpose">{t(`prefs.purpose.${purpose}`)}</span>
                <span className={`prefs__state prefs__state--${stateClass}`}>
                  {state === true ? t('prefs.granted') : state === false ? t('prefs.withdrawn') : t('prefs.notSet')}
                </span>
                <button
                  type="button"
                  className="btn btn--small"
                  aria-pressed={state === true}
                  disabled={view !== 'active' || busy}
                  onClick={() => void update(purpose, true)}
                >
                  {t('prefs.allow')}
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--ghost"
                  aria-pressed={state === false}
                  disabled={view !== 'active' || busy}
                  onClick={() => void update(purpose, false)}
                >
                  {t('prefs.withdraw')}
                </button>
              </li>
            );
          })}
        </ul>
        {view !== 'active' ? <p className="prefs__note">{t('prefs.sessionRequired')}</p> : null}
      </section>
    </div>
  );
}
