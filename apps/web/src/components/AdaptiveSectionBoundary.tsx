'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { adaptiveToSections } from '../lib/adaptive';
import type { Section } from '../lib/composition';
import { fetchExperienceComposition, resetExploration } from '../lib/experience-client';
import { t } from '../lib/i18n';
import { useCompare } from './CompareProvider';
import { SectionRenderer } from './SectionRenderer';
import { useOptionalSession } from './SessionProvider';

/**
 * Adaptive content boundary (FL05). The marker stays a semantic, testable
 * anchor; below it the client fetches the server composition once the
 * visitor session is active, validates it against the shared contract and
 * renders the mapped sections with stable keys. Stale revisions are
 * rejected (EXP-03 browser half). A visible action returns the visitor to
 * general exploration (server-side exploration reset). No permanent
 * loading screen: until data arrives only the conventional page shows.
 */
export function AdaptiveSectionBoundary(): ReactElement {
  const session = useOptionalSession();
  const compare = useCompare();
  const [sections, setSections] = useState<Section[]>([]);

  const compareKey = compare.ids.join(',');
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (session?.view !== 'active') return;
    // One load per compare-selection signature (initial load included).
    if (loadedKeyRef.current === compareKey) return;
    loadedKeyRef.current = compareKey;
    let cancelled = false;
    const ids = compareKey.split(',').filter((entry) => entry.length > 0);
    const compareIds = ids.length >= 2 ? ids : undefined;
    void (async () => {
      const result = await fetchExperienceComposition(compareIds);
      if (cancelled || !result.ok) {
        // Optional content: a failure or stale rejection leaves the
        // conventional page untouched (no error wall, no loading screen).
        return;
      }
      const mapped = adaptiveToSections(result.data.sections);
      if (!cancelled) setSections(mapped);
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.view, compareKey]);

  const returnToGeneral = useCallback((): void => {
    // Fire the server-side reset (ingests exploration_reset, bumps the
    // context version) and drop adaptive content locally. Cart, scroll,
    // focus and variants are untouched.
    void resetExploration();
    setSections([]);
  }, []);

  return (
    <>
      <div
        className="section section--adaptive-boundary"
        data-section="adaptive-boundary"
        data-testid="adaptive-boundary"
        aria-label={t('boundary.label')}
      />
      {sections.map((section) => (
        <SectionRenderer key={section.id} section={section} />
      ))}
      {sections.length > 0 ? (
        <div className="section section--adaptive-actions" data-testid="adaptive-actions">
          <button type="button" className="btn btn--ghost" onClick={returnToGeneral}>
            {t('adaptive.returnToGeneral')}
          </button>
        </div>
      ) : null}
    </>
  );
}
