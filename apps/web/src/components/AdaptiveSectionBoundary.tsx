import type { ReactElement } from 'react';
import { t } from '../lib/i18n';

/** Explicit marker where future adaptive sections are inserted (FL04 boundary). */
export function AdaptiveSectionBoundary(): ReactElement {
  return (
    <section
      className="section-boundary"
      data-section-boundary="adaptive"
      data-testid="adaptive-boundary"
      aria-label={t('boundary.label')}
    />
  );
}
