'use client';

import Link from 'next/link';
import { useMemo, type ReactElement } from 'react';
import {
  A2UI_PROTOCOL_VERSION,
  applyAndValidateA2UiSurfaceMessages,
  type A2UiAction,
  type A2UiAgentToRendererMessage,
  type A2UiRendererActionEnvelope,
  type ResolvedVaargA2UiComponent,
  type ValidatedA2UiSurfaceState,
} from '@vaarg/shared';
import { formatDateTime, t } from '../lib/i18n';
import { CategoryTileGrid } from './CategoryTile';
import { CollectionGrid } from './CollectionCard';
import { ProductCard, ProductGrid } from './ProductCard';
import { ProductComparator } from './ProductComparator';
import { ProductGallery } from './ProductGallery';
import { Recommendations } from './Recommendations';

export interface A2UiSurfaceRendererProps {
  sessionId: string;
  messages: A2UiAgentToRendererMessage[];
  personalizationGranted?: boolean;
  compact?: boolean;
  onAction?: (envelope: A2UiRendererActionEnvelope) => void;
}

function createActionEnvelope(
  surfaceId: string,
  sourceComponentId: string,
  action: A2UiAction,
): A2UiRendererActionEnvelope {
  return {
    version: A2UI_PROTOCOL_VERSION,
    action: {
      name: action.event.name,
      surfaceId,
      sourceComponentId,
      timestamp: new Date().toISOString(),
      context: (action.event.context ?? {}) as Record<string, unknown>,
      ...(typeof action.event.userMessage === 'string'
        ? { userMessage: action.event.userMessage }
        : {}),
    },
  };
}

function renderComponentNode(
  surface: ValidatedA2UiSurfaceState,
  componentId: string,
  onAction: ((envelope: A2UiRendererActionEnvelope) => void) | undefined,
  depth = 0,
): ReactElement | null {
  if (depth > 6) return null;
  const node: ResolvedVaargA2UiComponent | undefined = surface.componentsById.get(componentId);
  if (!node) return null;

  const ariaLabel = node['@accessibility']?.label;

  switch (node.component) {
    case 'AdaptiveBento': {
      const ageMs = Date.now() - Date.parse(surface.metadata.freshness);
      const isFresh = Number.isFinite(ageMs) && ageMs <= 60 * 60 * 1000;
      return (
        <div
          key={node.id}
          className={`a2ui-bento a2ui-bento--${node.layout}`}
          data-testid={`a2ui-surface-${surface.metadata.surfaceKind}`}
          aria-label={ariaLabel}
        >
          <div className="a2ui-surface__meta">
            <span
              className={`badge a2ui-freshness a2ui-freshness--${isFresh ? 'fresh' : 'stale'}`}
              data-testid="a2ui-freshness-badge"
              title={formatDateTime(surface.metadata.freshness)}
            >
              {isFresh ? t('adaptive.freshness.fresh') : t('adaptive.freshness.stale')}
            </span>
            <span className="badge a2ui-mode" data-testid="a2ui-mode-badge">
              {surface.metadata.personalizationApplied
                ? t('adaptive.mode.adaptive')
                : t('adaptive.mode.baseline')}
            </span>
          </div>
          {node.title ? <h3 className="a2ui-bento__title">{node.title}</h3> : null}
          <div className="a2ui-bento__grid">
            {node.children.map((childId) =>
              renderComponentNode(surface, childId, onAction, depth + 1),
            )}
          </div>
        </div>
      );
    }

    case 'CategoryTile': {
      return (
        <section key={node.id} className="a2ui-cell" aria-label={ariaLabel ?? node.title}>
          {node.title ? (
            <div className="section__head">
              <h3>{node.title}</h3>
            </div>
          ) : null}
          <CategoryTileGrid collections={node.collections} />
        </section>
      );
    }

    case 'CollectionGrid': {
      return (
        <section key={node.id} className="a2ui-cell" aria-label={ariaLabel ?? node.title}>
          <div className="section__head">
            <h3>{node.title}</h3>
          </div>
          <CollectionGrid collections={node.collections} />
        </section>
      );
    }

    case 'ProductCard': {
      return (
        <div key={node.id} className="a2ui-cell a2ui-cell--card" aria-label={ariaLabel}>
          <ProductCard
            product={node.product}
            note={node.note ? <span className="card__note">{node.note}</span> : undefined}
          />
          {node.action && onAction ? (
            <button
              type="button"
              className="btn btn--ghost a2ui-card-action"
              onClick={() =>
                onAction(createActionEnvelope(surface.surfaceId, node.id, node.action!))
              }
            >
              {t('product.viewDetails')}
            </button>
          ) : null}
        </div>
      );
    }

    case 'ProductGrid': {
      return (
        <section
          key={node.id}
          className="a2ui-cell a2ui-cell--wide"
          aria-label={ariaLabel ?? node.title}
        >
          <div className="section__head">
            <h3>{node.title}</h3>
            {node.footerHref ? (
              <Link className="section__link" href={node.footerHref}>
                {node.footerLabel ?? t('common.viewAll')} →
              </Link>
            ) : null}
          </div>
          <ProductGrid products={node.products} />
        </section>
      );
    }

    case 'ProductGallery': {
      return (
        <section
          key={node.id}
          className="a2ui-cell"
          aria-label={ariaLabel ?? node.productTitle ?? node.productHandle}
        >
          {node.productTitle ? (
            <div className="section__head">
              <h3>{node.productTitle}</h3>
              <Link
                className="section__link"
                href={`/products/${encodeURIComponent(node.productHandle)}`}
              >
                {t('product.viewDetails')} →
              </Link>
            </div>
          ) : null}
          <ProductGallery images={node.images} mediaCount={node.mediaCount} />
        </section>
      );
    }

    case 'Recommendations': {
      const relatedItems =
        node.items && node.items.length > 0
          ? node.items.map((item) => ({
              summary: item.summary,
              relation:
                item.relation === 'product_type'
                  ? ('product_type' as const)
                  : ('collection' as const),
              provenance: item.provenance,
            }))
          : node.products.map((summary, idx) => ({
              summary,
              relation: 'collection' as const,
              provenance: node.reasonCodes?.[idx] ?? 'catalog_match',
            }));
      return (
        <section
          key={node.id}
          className="a2ui-cell a2ui-cell--wide"
          aria-label={ariaLabel ?? node.title}
        >
          <div className="section__head">
            <h3>{node.title}</h3>
          </div>
          <Recommendations items={relatedItems} />
        </section>
      );
    }

    case 'ProductComparator': {
      if (!node.comparison) {
        return (
          <section key={node.id} className="a2ui-cell a2ui-cell--wide" aria-label={ariaLabel}>
            <ProductGrid products={node.products} />
          </section>
        );
      }
      return (
        <section key={node.id} className="a2ui-cell a2ui-cell--wide" aria-label={ariaLabel}>
          <ProductComparator
            comparison={node.comparison}
            ids={node.products.map((p) => p.id)}
          />
        </section>
      );
    }

    case 'SuggestionChips': {
      return (
        <section key={node.id} className="a2ui-cell" aria-label={ariaLabel ?? node.title}>
          {node.title ? (
            <div className="section__head">
              <h3>{node.title}</h3>
            </div>
          ) : null}
          <div className="chip-row" data-testid="suggestion-chips">
            {node.chips.map((chip) => {
              if (chip.action && onAction) {
                return (
                  <button
                    key={chip.id}
                    type="button"
                    className="chip"
                    onClick={() =>
                      onAction(createActionEnvelope(surface.surfaceId, node.id, chip.action!))
                    }
                  >
                    {chip.label}
                  </button>
                );
              }
              if (chip.href) {
                return (
                  <Link key={chip.id} className="chip chip--link" href={chip.href}>
                    {chip.label}
                  </Link>
                );
              }
              return null;
            })}
          </div>
        </section>
      );
    }

    case 'GuidedQuestions': {
      return (
        <section
          key={node.id}
          className="a2ui-cell a2ui-guided"
          data-testid={`guided-question-${node.questionId}`}
          aria-label={ariaLabel ?? node.title}
        >
          <div className="a2ui-guided__header">
            <h3 className="a2ui-guided__title">{node.title}</h3>
            <p className="a2ui-guided__prompt">{node.prompt}</p>
          </div>
          <div className="a2ui-guided__options" role="group" aria-label={node.title}>
            {node.options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="a2ui-guided__option"
                onClick={() =>
                  onAction?.(createActionEnvelope(surface.surfaceId, node.id, opt.action))
                }
              >
                <span className="a2ui-guided__option-label">{opt.label}</span>
                {opt.description ? (
                  <span className="a2ui-guided__option-desc">{opt.description}</span>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      );
    }
  }
}

/**
 * Official A2UI 1.0 validated client surface renderer mapped onto VAARG's
 * verified storefront components. Fails closed on any schema, security,
 * ownership, or catalog violation without breaking conventional navigation.
 */
export function A2UiSurfaceRenderer({
  sessionId,
  messages,
  personalizationGranted,
  compact = false,
  onAction,
}: A2UiSurfaceRendererProps): ReactElement | null {
  const validated = useMemo(() => {
    if (!sessionId || messages.length === 0) {
      return { kind: 'empty' as const };
    }
    const res = applyAndValidateA2UiSurfaceMessages(messages, {
      expectedSessionId: sessionId,
      ...(personalizationGranted !== undefined ? { personalizationGranted } : {}),
    });
    if (!res.ok) {
      return { kind: 'invalid' as const, code: res.code };
    }
    const surfaces = Array.from(res.value.values());
    return surfaces.length > 0
      ? { kind: 'valid' as const, surfaces }
      : { kind: 'empty' as const };
  }, [sessionId, messages, personalizationGranted]);

  if (validated.kind === 'empty') {
    return null;
  }

  if (validated.kind === 'invalid') {
    return (
      <div
        className="a2ui-fallback"
        data-testid="a2ui-validation-fallback"
        data-error-code={validated.code}
        role="status"
      >
        {t('adaptive.validationFallback')}
      </div>
    );
  }

  return (
    <div className={`a2ui-surfaces ${compact ? 'a2ui-surfaces--compact' : ''}`}>
      {validated.surfaces.map((surface) => (
        <div key={surface.surfaceId} className="a2ui-surface">
          {renderComponentNode(surface, surface.rootId, onAction)}
        </div>
      ))}
    </div>
  );
}
