import {
  A2UI_PROTOCOL_VERSION,
  VAARG_A2UI_CATALOG_ID,
  buildVaargSurfaceId,
  type A2UiAgentToRendererMessage,
  type A2UiDeleteSurfaceMessage,
  type A2UiRawComponentWire,
  type A2UiSurfaceKind,
} from './a2ui.js';
import {
  applyAndValidateA2UiSurfaceMessages,
  type ValidatedA2UiSurfaceState,
} from './a2ui-validator.js';
import type {
  CatalogV1Comparison,
  CatalogV1ProductDetail,
} from './catalog.js';
import {
  adaptiveCompositionSchema,
  withinCompositionLimits,
  type AdaptiveComposition,
} from './composition.js';
import type { PartialCriteriaPatch } from './a2ui-actions.js';

export interface GuidedQuestionSpec {
  questionId: string;
  title: string;
  prompt: string;
  options: Array<{
    id: string;
    label: string;
    description?: string;
    criteriaPatch?: PartialCriteriaPatch;
  }>;
}

export interface VerifiedGalleryEnrichment {
  sectionId: string;
  productHandle: string;
  productTitle?: string;
  images: CatalogV1ProductDetail['images'];
  mediaCount: CatalogV1ProductDetail['mediaCount'];
}

export interface CompileA2UiSurfaceInput {
  composition: AdaptiveComposition;
  surfaceKind?: A2UiSurfaceKind;
  surfaceSubKey?: string;
  layout?: 'stack' | 'bento';
  personalizationApplied?: boolean;
  runId?: string | null;
  conversationId?: string;
  comparisonDetail?: CatalogV1Comparison;
  guidedQuestions?: GuidedQuestionSpec[];
  galleries?: VerifiedGalleryEnrichment[];
  verifiedProductIds?: ReadonlySet<string>;
  verifiedCollectionHandles?: ReadonlySet<string>;
}

export interface CompiledA2UiSurfaceBundle {
  surfaceId: string;
  catalogId: typeof VAARG_A2UI_CATALOG_ID;
  messages: A2UiAgentToRendererMessage[];
  validatedSurface: ValidatedA2UiSurfaceState;
}

function sanitizeNodeKey(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64) || 'node';
}

/**
 * FL07 Task 4 — Deterministic compiler from validated VAARG `AdaptiveComposition`
 * (and optional verified catalog enrichments) to official A2UI 1.0 messages:
 * `createSurface`, `updateDataModel`, and `updateComponents`.
 *
 * Uses RFC 6901 `{"@path": "/sections/..."}` bindings into the surface dataModel
 * so catalog entities live cleanly in the structured data model and every output
 * bundle passes full server security validation before emission.
 */
export function compileCompositionToA2UiMessages(
  input: CompileA2UiSurfaceInput,
): CompiledA2UiSurfaceBundle {
  const composition = adaptiveCompositionSchema.parse(input.composition);
  if (!withinCompositionLimits(composition)) {
    throw new Error('COMPOSITION_LIMITS_EXCEEDED: Cannot compile oversized AdaptiveComposition');
  }

  const surfaceKind = input.surfaceKind ?? 'adaptive';
  const surfaceId = buildVaargSurfaceId(
    composition.sessionId,
    surfaceKind,
    input.surfaceSubKey,
  );

  const sectionsData: Record<string, unknown> = {};
  const childIds: string[] = [];
  const components: A2UiRawComponentWire[] = [];

  for (let idx = 0; idx < composition.sections.length; idx += 1) {
    const section = composition.sections[idx]!;
    const key = `s${idx}_${sanitizeNodeKey(section.id)}`;
    const compId = `sec-${sanitizeNodeKey(section.id)}`;
    childIds.push(compId);

    switch (section.component) {
      case 'CategoryTile': {
        sectionsData[key] = { collections: section.collections };
        components.push({
          id: compId,
          component: 'CategoryTile',
          collections: { '@path': `/sections/${key}/collections` },
        });
        break;
      }
      case 'CollectionGrid': {
        sectionsData[key] = { collections: section.collections };
        components.push({
          id: compId,
          component: 'CollectionGrid',
          title: section.title,
          collections: { '@path': `/sections/${key}/collections` },
        });
        break;
      }
      case 'ProductGrid': {
        sectionsData[key] = { products: section.products };
        components.push({
          id: compId,
          component: 'ProductGrid',
          title: section.title,
          products: { '@path': `/sections/${key}/products` },
          ...(section.footerHref ? { footerHref: section.footerHref } : {}),
          ...(section.footerLabel ? { footerLabel: section.footerLabel } : {}),
        });
        break;
      }
      case 'ProductCard': {
        sectionsData[key] = { product: section.product };
        components.push({
          id: compId,
          component: 'ProductCard',
          product: { '@path': `/sections/${key}/product` },
          action: {
            event: {
              name: 'view_product',
              context: {
                handle: section.product.handle,
                productId: section.product.id,
              },
            },
          },
        });
        break;
      }
      case 'Recommendations': {
        const items = section.products.map((summary, itemIdx) => ({
          summary,
          relation: 'shared_collection' as const,
          provenance: section.reasonCodes?.[itemIdx] ?? 'catalog_match',
        }));
        sectionsData[key] = {
          products: section.products,
          items,
          ...(section.reasonCodes ? { reasonCodes: section.reasonCodes } : {}),
        };
        components.push({
          id: compId,
          component: 'Recommendations',
          title: section.title,
          products: { '@path': `/sections/${key}/products` },
          items: { '@path': `/sections/${key}/items` },
          ...(section.reasonCodes
            ? { reasonCodes: { '@path': `/sections/${key}/reasonCodes` } }
            : {}),
        });
        break;
      }
      case 'ProductComparator': {
        sectionsData[key] = {
          products: section.products,
          ...(input.comparisonDetail ? { comparison: input.comparisonDetail } : {}),
        };
        components.push({
          id: compId,
          component: 'ProductComparator',
          products: { '@path': `/sections/${key}/products` },
          ...(input.comparisonDetail
            ? { comparison: { '@path': `/sections/${key}/comparison` } }
            : {}),
        });
        break;
      }
      case 'SuggestionChips': {
        const chips = section.chips.map((chip, chipIdx) => ({
          id: `chip-${chipIdx}`,
          label: chip.label,
          href: chip.href,
        }));
        sectionsData[key] = { chips };
        components.push({
          id: compId,
          component: 'SuggestionChips',
          chips: { '@path': `/sections/${key}/chips` },
        });
        break;
      }
    }
  }

  if (input.galleries) {
    for (let gIdx = 0; gIdx < input.galleries.length; gIdx += 1) {
      const gal: VerifiedGalleryEnrichment = input.galleries[gIdx]!;
      if (childIds.length >= 12) break;
      const key = `gal${gIdx}_${sanitizeNodeKey(gal.sectionId)}`;
      const compId = `gal-${sanitizeNodeKey(gal.sectionId)}`;
      childIds.push(compId);
      sectionsData[key] = {
        images: gal.images,
        mediaCount: gal.mediaCount,
      };
      components.push({
        id: compId,
        component: 'ProductGallery',
        productHandle: gal.productHandle,
        ...(gal.productTitle ? { productTitle: gal.productTitle } : {}),
        images: { '@path': `/sections/${key}/images` },
        mediaCount: { '@path': `/sections/${key}/mediaCount` },
      });
    }
  }

  if (input.guidedQuestions) {
    for (let qIdx = 0; qIdx < input.guidedQuestions.length; qIdx += 1) {
      const q: GuidedQuestionSpec = input.guidedQuestions[qIdx]!;
      if (childIds.length >= 12) break;
      const key = `q${qIdx}_${sanitizeNodeKey(q.questionId)}`;
      const compId = `guided-${sanitizeNodeKey(q.questionId)}`;
      childIds.push(compId);
      const options = q.options.slice(0, 6).map((opt: GuidedQuestionSpec['options'][number]) => ({
        id: opt.id,
        label: opt.label,
        ...(opt.description ? { description: opt.description } : {}),
        action: {
          event: {
            name: 'answer_guided_question' as const,
            userMessage: opt.label,
            context: {
              questionId: q.questionId,
              optionId: opt.id,
              label: opt.label,
              ...(input.conversationId ? { conversationId: input.conversationId } : {}),
              ...(opt.criteriaPatch ? { criteriaPatch: opt.criteriaPatch } : {}),
              submitReply: true,
            },
          },
        },
      }));
      sectionsData[key] = { options };
      components.push({
        id: compId,
        component: 'GuidedQuestions',
        questionId: q.questionId,
        title: q.title,
        prompt: q.prompt,
        options: { '@path': `/sections/${key}/options` },
      });
    }
  }

  const rootComponent: A2UiRawComponentWire = {
    id: 'root',
    component: 'AdaptiveBento',
    layout: input.layout ?? (childIds.length > 1 ? 'bento' : 'stack'),
    children: childIds,
  };

  const personalizationApplied =
    input.personalizationApplied ?? composition.mode === 'adaptive';

  const messages: A2UiAgentToRendererMessage[] = [
    {
      version: A2UI_PROTOCOL_VERSION,
      createSurface: {
        surfaceId,
        catalogId: VAARG_A2UI_CATALOG_ID,
        sendDataModel: false,
        metadata: {
          sessionId: composition.sessionId,
          contextVersion: composition.contextVersion,
          experienceRevision: composition.experienceRevision,
          surfaceKind,
          freshness: composition.freshness,
          personalizationApplied,
          ...(input.runId !== undefined ? { runId: input.runId } : {}),
        },
      },
    },
    {
      version: A2UI_PROTOCOL_VERSION,
      updateDataModel: {
        surfaceId,
        path: '/',
        value: {
          sections: sectionsData,
        },
      },
    },
    {
      version: A2UI_PROTOCOL_VERSION,
      updateComponents: {
        surfaceId,
        components: [rootComponent, ...components],
      },
    },
  ];

  const verified = applyAndValidateA2UiSurfaceMessages(messages, {
    expectedSessionId: composition.sessionId,
    ...(input.verifiedProductIds ? { verifiedProductIds: input.verifiedProductIds } : {}),
    ...(input.verifiedCollectionHandles
      ? { verifiedCollectionHandles: input.verifiedCollectionHandles }
      : {}),
  });
  if (!verified.ok) {
    throw new Error(`A2UI_COMPILE_VALIDATION_FAILED [${verified.code}]: ${verified.message}`);
  }
  const validatedSurface = verified.value.get(surfaceId);
  if (!validatedSurface) {
    throw new Error('A2UI_COMPILE_VALIDATION_FAILED: Missing compiled surface');
  }

  return {
    surfaceId,
    catalogId: VAARG_A2UI_CATALOG_ID,
    messages,
    validatedSurface,
  };
}

export function compileDeleteSurfaceMessage(
  sessionId: string,
  surfaceKind: A2UiSurfaceKind,
  surfaceSubKey?: string,
): A2UiDeleteSurfaceMessage {
  return {
    version: A2UI_PROTOCOL_VERSION,
    deleteSurface: {
      surfaceId: buildVaargSurfaceId(sessionId, surfaceKind, surfaceSubKey),
    },
  };
}
