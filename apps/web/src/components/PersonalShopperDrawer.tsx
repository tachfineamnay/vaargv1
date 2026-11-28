'use client';

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import { t } from '../lib/i18n';
import { A2UiSurfaceRenderer } from './A2UiSurfaceRenderer';
import { useOptionalPersonalShopper } from './PersonalShopperProvider';
import { useOptionalSession } from './SessionProvider';

export function PersonalShopperTrigger(): ReactElement | null {
  const shopper = useOptionalPersonalShopper();
  if (!shopper) return null;

  return (
    <button
      type="button"
      className={`shopper-trigger ${shopper.isOpen ? 'shopper-trigger--active' : ''}`}
      data-testid="shopper-trigger"
      aria-expanded={shopper.isOpen}
      aria-controls="vaarg-personal-shopper-drawer"
      onClick={() => shopper.toggle()}
    >
      <span className="shopper-trigger__dot" aria-hidden="true" />
      <span>{t('shopper.trigger')}</span>
      {shopper.isStreaming ? (
        <span className="shopper-trigger__pulse" aria-hidden="true" />
      ) : null}
    </button>
  );
}

export function PersonalShopperDrawer(): ReactElement | null {
  const shopper = useOptionalPersonalShopper();
  const sessionState = useOptionalSession();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  const isOpen = shopper?.isOpen ?? false;

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        shopper?.close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, shopper]);

  useEffect(() => {
    if (!isOpen) return;
    feedEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [
    isOpen,
    shopper?.messages.length,
    shopper?.streamingText,
    shopper?.a2uiMessages.length,
  ]);

  if (!shopper || !isOpen) {
    return null;
  }

  const sessionId =
    sessionState?.view === 'active' ? (sessionState.session?.sessionId ?? '') : '';

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || shopper.isStreaming) return;
    setDraft('');
    void shopper.sendPrompt(trimmed);
  };

  const onTextareaKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const trimmed = draft.trim();
      if (!trimmed || shopper.isStreaming) return;
      setDraft('');
      void shopper.sendPrompt(trimmed);
    }
  };

  const compositionProposals = shopper.proposals.filter(
    (p) => p.proposalType === 'experience_composition',
  );

  return (
    <aside
      id="vaarg-personal-shopper-drawer"
      className="shopper-drawer"
      data-testid="personal-shopper-drawer"
      role="dialog"
      aria-modal="false"
      aria-label={t('shopper.title')}
    >
      <header className="shopper-drawer__header">
        <div>
          <h2 className="shopper-drawer__title">{t('shopper.title')}</h2>
          <p className="shopper-drawer__subtitle">{t('shopper.subtitle')}</p>
        </div>
        <div className="shopper-drawer__header-actions">
          {sessionId ? (
            <button
              type="button"
              className="btn btn--ghost shopper-drawer__icon-btn"
              data-testid="shopper-new-conversation"
              onClick={() => void shopper.startNewConversation()}
            >
              {t('shopper.newConversation')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost shopper-drawer__icon-btn"
            data-testid="shopper-close"
            aria-label={t('shopper.close')}
            onClick={() => shopper.close()}
          >
            ✕
          </button>
        </div>
      </header>

      <div className="shopper-drawer__body" aria-live="polite">
        {!sessionId ? (
          <div className="shopper-banner" data-testid="shopper-session-required">
            <p>{t('shopper.sessionRequired')}</p>
            {sessionState ? (
              <button
                type="button"
                className="btn"
                onClick={() => void sessionState.bootstrap()}
              >
                {t('prefs.createSession')}
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {shopper.messages.length === 0 && !shopper.isStreaming ? (
              <p className="shopper-empty" data-testid="shopper-empty-hint">
                {t('shopper.emptyHint')}
              </p>
            ) : null}

            <ol className="shopper-messages" data-testid="shopper-message-list">
              {shopper.messages.map((msg) => (
                <li
                  key={`${msg.sequence}-${msg.messageId}`}
                  className={`shopper-msg shopper-msg--${msg.role}`}
                  data-testid={`shopper-msg-${msg.role}`}
                >
                  <p className="shopper-msg__content">{msg.content}</p>
                </li>
              ))}

              {shopper.streamingText ? (
                <li
                  className="shopper-msg shopper-msg--assistant shopper-msg--streaming"
                  data-testid="shopper-streaming-message"
                >
                  <p className="shopper-msg__content">{shopper.streamingText}</p>
                </li>
              ) : null}
            </ol>

            {shopper.activeSteps.length > 0 ? (
              <div className="shopper-steps" data-testid="shopper-active-steps">
                {shopper.activeSteps.map((step) => (
                  <span key={step} className="chip shopper-step-chip">
                    {step}
                  </span>
                ))}
              </div>
            ) : shopper.isStreaming && !shopper.streamingText ? (
              <p className="shopper-status" data-testid="shopper-streaming-status">
                {t('shopper.streaming')}
              </p>
            ) : null}

            {shopper.isReconnecting ? (
              <p className="shopper-status" data-testid="shopper-reconnecting">
                {t('shopper.reconnecting')}
              </p>
            ) : null}

            {shopper.resyncedNotice ? (
              <p className="shopper-status" data-testid="shopper-resynced">
                {t('shopper.resynced')}
              </p>
            ) : null}

            {shopper.a2uiMessages.length > 0 ? (
              <div className="shopper-a2ui" data-testid="shopper-a2ui-container">
                <A2UiSurfaceRenderer
                  sessionId={sessionId}
                  messages={shopper.a2uiMessages}
                  compact
                  onAction={(env) => void shopper.handleA2UiAction(env)}
                />
              </div>
            ) : null}

            {compositionProposals.length > 0 ? (
              <div className="shopper-proposals" data-testid="shopper-proposals">
                {compositionProposals.map((prop) => (
                  <div key={prop.proposalId} className="shopper-proposal-card">
                    {prop.status === 'applied' ? (
                      <span className="badge badge--in">{t('shopper.publishedBadge')}</span>
                    ) : prop.status === 'stale' ? (
                      <span className="shopper-proposal-stale">
                        {t('shopper.staleProposal')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn shopper-publish-btn"
                        data-testid="shopper-publish-proposal"
                        onClick={() =>
                          void shopper.publishProposal(
                            prop.runId,
                            prop.proposalId,
                            prop.contextVersion,
                          )
                        }
                      >
                        {t('shopper.publishProposal')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : null}

            {shopper.runtimeUnavailable ? (
              <div
                className="shopper-banner shopper-banner--muted"
                data-testid="shopper-runtime-unavailable"
              >
                {t('shopper.unavailableRuntime')}
              </div>
            ) : null}

            {shopper.actionNotice ? (
              <div className="shopper-banner shopper-banner--muted" data-testid="shopper-action-notice">
                {shopper.actionNotice}
              </div>
            ) : null}

            {shopper.errorBanner ? (
              <div className="shopper-banner shopper-banner--error" data-testid="shopper-error">
                {shopper.errorBanner}
              </div>
            ) : null}

            <div ref={feedEndRef} />
          </>
        )}
      </div>

      {sessionId ? (
        <form className="shopper-drawer__composer" onSubmit={onSubmit}>
          <label htmlFor="shopper-prompt-input" className="sr-only">
            {t('shopper.inputLabel')}
          </label>
          <textarea
            id="shopper-prompt-input"
            ref={inputRef}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onTextareaKeyDown}
            placeholder={t('shopper.placeholder')}
            disabled={shopper.isStreaming}
            data-testid="shopper-input"
          />
          <div className="shopper-drawer__composer-actions">
            {shopper.isStreaming ? (
              <button
                type="button"
                className="btn btn--ghost"
                data-testid="shopper-stop"
                onClick={() => void shopper.stopActiveRun()}
              >
                {t('shopper.stop')}
              </button>
            ) : (
              <button
                type="submit"
                className="btn"
                disabled={!draft.trim()}
                data-testid="shopper-send"
              >
                {t('shopper.send')}
              </button>
            )}
          </div>
        </form>
      ) : null}
    </aside>
  );
}
