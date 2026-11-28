'use client';

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import {
  compileCompositionToA2UiMessages,
  type A2UiAgentToRendererMessage,
} from '@vaarg/shared';
import {
  experienceServerSnapshot,
  experienceSnapshot,
  fetchExperienceA2Ui,
  fetchExperienceComposition,
  resetExploration,
  subscribeExperience,
} from '../lib/experience-client';
import { t } from '../lib/i18n';
import { A2UiSurfaceRenderer } from './A2UiSurfaceRenderer';
import { useCompare } from './CompareProvider';
import { useOptionalPersonalShopper } from './PersonalShopperProvider';
import { useOptionalSession } from './SessionProvider';

/**
 * Adaptive content boundary (FL05/FL07). Below the semantic boundary marker,
 * the client fetches the server-validated A2UI 1.0 adaptive composition bundle
 * once the visitor session is active, validates it against the VAARG A2UI 1.0
 * security/catalog schema, and renders grounded storefront primitives.
 * Stale revisions are rejected monotonically (EXP-03).
 */
export function AdaptiveSectionBoundary(): ReactElement {
  const session = useOptionalSession();
  const compare = useCompare();
  const shopper = useOptionalPersonalShopper();
  const [a2uiMessages, setA2UiMessages] = useState<A2UiAgentToRendererMessage[]>([]);

  const compareKey = compare.ids.join(',');
  const experience = useSyncExternalStore(
    subscribeExperience,
    experienceSnapshot,
    experienceServerSnapshot,
  );
  const activeSessionId = session?.session?.sessionId ?? '';

  useEffect(() => {
    if (
      session?.view !== 'active' ||
      !activeSessionId ||
      experience.sessionId !== activeSessionId ||
      experience.suspended
    ) {
      setA2UiMessages([]);
      return;
    }

    const controller = new AbortController();
    const ids = compareKey.split(',').filter((entry) => entry.length > 0);
    const compareIds = ids.length >= 2 ? ids : undefined;

    void (async () => {
      const a2uiResult = await fetchExperienceA2Ui(compareIds, controller.signal);
      if (controller.signal.aborted) return;

      if (a2uiResult.ok && a2uiResult.data.messages.length > 0) {
        setA2UiMessages(a2uiResult.data.messages);
        return;
      }

      // Fallback for mocked composition-only environments: compile validated composition to A2UI 1.0
      const compResult = await fetchExperienceComposition(compareIds, controller.signal);
      if (controller.signal.aborted || !compResult.ok) {
        return;
      }
      try {
        const compiled = compileCompositionToA2UiMessages({
          composition: compResult.data,
          surfaceKind: 'adaptive',
        });
        if (!controller.signal.aborted) {
          setA2UiMessages(compiled.messages);
        }
      } catch {
        // Leave conventional page untouched on compilation error
      }
    })();

    return () => {
      controller.abort();
    };
  }, [session?.view, activeSessionId, compareKey, experience]);

  const returnToGeneral = useCallback((): void => {
    void resetExploration();
    setA2UiMessages([]);
  }, []);

  return (
    <>
      <div
        className="section section--adaptive-boundary"
        data-section="adaptive-boundary"
        data-testid="adaptive-boundary"
        aria-label={t('boundary.label')}
      />
      {activeSessionId && a2uiMessages.length > 0 ? (
        <div className="section section--adaptive-a2ui" data-testid="adaptive-a2ui-root">
          <A2UiSurfaceRenderer
            sessionId={activeSessionId}
            messages={a2uiMessages}
            {...(shopper
              ? { onAction: (env) => void shopper.handleA2UiAction(env) }
              : {})}
          />
        </div>
      ) : null}
      {a2uiMessages.length > 0 ? (
        <div className="section section--adaptive-actions" data-testid="adaptive-actions">
          <button type="button" className="btn btn--ghost" onClick={returnToGeneral}>
            {t('adaptive.returnToGeneral')}
          </button>
        </div>
      ) : null}
    </>
  );
}
