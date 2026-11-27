import { describe, expect, it } from 'vitest';
import {
  A2UI_PROTOCOL_VERSION,
  AG_UI_PROTOCOL_VERSION,
  EventType,
  VAARG_A2UI_CATALOG_DEFINITION,
  VAARG_A2UI_CATALOG_ID,
  VAARG_AGUI_CUSTOM_EVENTS,
  adaptiveCompositionSchema,
  applyAndValidateA2UiSurfaceMessages,
  buildVaargSurfaceId,
  compileCompositionToA2UiMessages,
  computeAgUiStateDelta,
  emptyExplorationCriteria,
  parseAgUiStreamCursor,
  parseSseFrameBlock,
  redactStreamingDelta,
  vaargAgUiStateSnapshotSchema,
  validateControlledUiAction,
  validateSafeAgUiEvent,
} from '../src/index.js';

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';
const OTHER_SESSION_ID = '00000000-0000-4000-8000-0000000000bb';
const CONV_ID = '00000000-0000-4000-8000-0000000000cc';
const RUN_ID = '00000000-0000-4000-8000-0000000000dd';
const PRODUCT_GID_1 = 'gid://shopify/Product/1001';
const PRODUCT_GID_2 = 'gid://shopify/Product/1002';

function makeProductSummary(id: string, handle: string, title: string) {
  return {
    id,
    handle,
    title,
    productType: 'Rings',
    vendor: 'VAARG Atelier',
    tags: ['gold'],
    availableForSale: true,
    priceMin: { amount: '420.00', currencyCode: 'EUR' },
    priceMax: { amount: '420.00', currencyCode: 'EUR' },
    image: {
      url: 'https://cdn.shopify.com/s/files/1/0001/products/ring.jpg',
      altText: title,
    },
    updatedAt: '2026-11-27T12:00:00.000Z',
    provenance: {
      source: 'shopify' as const,
      shopifyId: id,
      generation: '00000000-0000-4000-8000-000000000001',
      observedAt: '2026-11-27T12:00:00.000Z',
    },
  };
}

describe('FL07 A2UI 1.0 Catalog, Compiler & Fail-Closed Security Validator', () => {
  const sampleComposition = adaptiveCompositionSchema.parse({
    sessionId: SESSION_ID,
    contextVersion: 3,
    experienceRevision: 1,
    mode: 'adaptive',
    adaptationReason: 'explicit_criteria',
    freshness: '2026-11-27T12:00:00.000Z',
    sections: [
      {
        id: 'featured-rings',
        component: 'ProductGrid',
        title: 'Grounded Gold Rings',
        products: [
          makeProductSummary(PRODUCT_GID_1, 'signet-ring', 'Signet Ring'),
          makeProductSummary(PRODUCT_GID_2, 'band-ring', 'Band Ring'),
        ],
        footerHref: '/collections/rings',
        footerLabel: 'All rings',
      },
      {
        id: 'chips-refine',
        component: 'SuggestionChips',
        chips: [{ label: 'Rings', href: '/collections/rings' }],
      },
    ],
  });

  it('exports official A2UI 1.0 catalog definition and compiles grounded surfaces with @path bindings', () => {
    expect(VAARG_A2UI_CATALOG_DEFINITION.protocolVersion).toBe('1.0');
    expect(VAARG_A2UI_CATALOG_DEFINITION.catalogId).toBe(VAARG_A2UI_CATALOG_ID);

    const compiled = compileCompositionToA2UiMessages({
      composition: sampleComposition,
      surfaceKind: 'shopper',
      surfaceSubKey: CONV_ID,
      runId: RUN_ID,
      conversationId: CONV_ID,
      galleries: [
        {
          sectionId: 'ring-gallery',
          productHandle: 'signet-ring',
          productTitle: 'Signet Ring',
          images: [
            {
              url: 'https://cdn.shopify.com/s/files/1/0001/products/ring.jpg',
              altText: 'Signet Ring',
            },
          ],
          mediaCount: { image: 1, video: 0, externalVideo: 0, model3d: 0 },
        },
      ],
      guidedQuestions: [
        {
          questionId: 'metal-choice',
          title: 'Preferred finish',
          prompt: 'Which finish are you exploring?',
          options: [
            {
              id: 'yellow-gold',
              label: '18k Yellow Gold',
              criteriaPatch: { query: 'yellow gold' },
            },
          ],
        },
      ],
      verifiedProductIds: new Set([PRODUCT_GID_1, PRODUCT_GID_2]),
    });

    expect(compiled.messages).toHaveLength(3);
    expect(compiled.messages[0]).toHaveProperty('createSurface');
    expect(compiled.messages[1]).toHaveProperty('updateDataModel');
    expect(compiled.messages[2]).toHaveProperty('updateComponents');
    expect(compiled.validatedSurface.rootId).toBe('root');
    expect(compiled.validatedSurface.componentsById.size).toBe(5);
  });

  it('rejects unknown components, future FL08 components, renderer RPC, XSS/HTML, cycles, cross-session surfaces, and unverified products', () => {
    const valid = compileCompositionToA2UiMessages({
      composition: sampleComposition,
      surfaceKind: 'adaptive',
    });

    // 1. Cross-session surface rejection
    const wrongSession = applyAndValidateA2UiSurfaceMessages(valid.messages, {
      expectedSessionId: OTHER_SESSION_ID,
    });
    expect(wrongSession.ok).toBe(false);
    if (!wrongSession.ok) expect(wrongSession.code).toBe('SURFACE_OWNERSHIP_MISMATCH');

    // 2. Stale revision rejection
    const staleCheck = applyAndValidateA2UiSurfaceMessages(valid.messages, {
      expectedSessionId: SESSION_ID,
      currentRevision: { sessionId: SESSION_ID, contextVersion: 4, experienceRevision: 2 },
    });
    expect(staleCheck.ok).toBe(false);
    if (!staleCheck.ok) expect(staleCheck.code).toBe('STALE_SURFACE_REJECTED');

    // 3. Consent withdrawn rejection for personalized surface
    const consentWithdrawn = applyAndValidateA2UiSurfaceMessages(valid.messages, {
      expectedSessionId: SESSION_ID,
      personalizationGranted: false,
    });
    expect(consentWithdrawn.ok).toBe(false);
    if (!consentWithdrawn.ok) expect(consentWithdrawn.code).toBe('CONSENT_WITHDRAWN');

    // 4. Future FL08 component rejection
    const futureComp = structuredClone(valid.messages);
    const updateMsg = futureComp[2] as { updateComponents: { components: Array<Record<string, unknown>> } };
    updateMsg.updateComponents.components.push({
      id: 'sec-cart',
      component: 'CartSummary',
    });
    (updateMsg.updateComponents.components[0]!.children as string[]).push('sec-cart');
    const futureRes = applyAndValidateA2UiSurfaceMessages(futureComp, {
      expectedSessionId: SESSION_ID,
    });
    expect(futureRes.ok).toBe(false);
    if (!futureRes.ok) expect(futureRes.code).toBe('UNSUPPORTED_FUTURE_COMPONENT');

    // 5. Renderer RPC rejection (`callRendererFunction`)
    const rpcRes = applyAndValidateA2UiSurfaceMessages(
      [
        {
          version: A2UI_PROTOCOL_VERSION,
          callRendererFunction: { callId: '1', name: 'evalJs', args: {} },
        } as unknown as (typeof valid.messages)[number],
      ],
      { expectedSessionId: SESSION_ID },
    );
    expect(rpcRes.ok).toBe(false);
    if (!rpcRes.ok) expect(rpcRes.code).toBe('UNSUPPORTED_RENDERER_FUNCTION');

    // 6. Executable script / HTML injection rejection
    const xssMessages = structuredClone(valid.messages);
    const xssUpdate = xssMessages[2] as { updateComponents: { components: Array<Record<string, unknown>> } };
    xssUpdate.updateComponents.components[1]!.title = '<script>alert(1)</script>';
    const xssRes = applyAndValidateA2UiSurfaceMessages(xssMessages, {
      expectedSessionId: SESSION_ID,
    });
    expect(xssRes.ok).toBe(false);
    if (!xssRes.ok) expect(xssRes.code).toBe('FORBIDDEN_PAYLOAD_CONTENT');

    // 7. Unverified product GID rejection
    const ungroundedRes = applyAndValidateA2UiSurfaceMessages(valid.messages, {
      expectedSessionId: SESSION_ID,
      verifiedProductIds: new Set([PRODUCT_GID_1]), // PRODUCT_GID_2 missing!
    });
    expect(ungroundedRes.ok).toBe(false);
    if (!ungroundedRes.ok) expect(ungroundedRes.code).toBe('UNVERIFIED_CATALOG_REFERENCE');
  });
});

describe('FL07 Official AG-UI 1.0.5 Codec, Whitespace Delta Preservation & Action Allowlist', () => {
  it('preserves natural inter-word whitespace in streaming deltas while stripping hidden reasoning', () => {
    expect(redactStreamingDelta('<think>internal plan</think>Here ')).toBe('Here ');
    expect(redactStreamingDelta('are ')).toBe('are ');
    expect(redactStreamingDelta('two grounded rings.')).toBe('two grounded rings.');
    const joined =
      redactStreamingDelta('<think>plan</think>Here ') +
      redactStreamingDelta('are ') +
      redactStreamingDelta('two grounded rings.');
    expect(joined).toBe('Here are two grounded rings.');
  });

  it('enforces @ag-ui/core@1.0.5 EventSchema and blocks reasoning, raw, and specialist text events', () => {
    const now = Date.now();
    expect(
      validateSafeAgUiEvent({
        type: EventType.RUN_STARTED,
        threadId: CONV_ID,
        runId: RUN_ID,
        protocolVersion: AG_UI_PROTOCOL_VERSION,
        timestamp: now,
      }).ok,
    ).toBe(true);

    // Blocks REASONING_MESSAGE_CONTENT
    expect(
      validateSafeAgUiEvent({
        type: EventType.REASONING_MESSAGE_CONTENT,
        messageId: 'm1',
        delta: 'secret chain of thought',
        timestamp: now,
      }).ok,
    ).toBe(false);

    // Blocks specialist subagent from directly addressing visitor
    expect(
      validateSafeAgUiEvent({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: 'm1',
        delta: 'hi',
        subagentRunId: 'child-1',
        timestamp: now,
      }).ok,
    ).toBe(false);

    // Computes RFC 6902 STATE_DELTA cleanly
    const s1 = vaargAgUiStateSnapshotSchema.parse({
      sessionId: SESSION_ID,
      conversationId: CONV_ID,
      runId: RUN_ID,
      contextVersion: 1,
      experienceRevision: 0,
      market: { country: 'FR', language: 'FR', currency: 'EUR' },
      exploration: emptyExplorationCriteria(),
      comparisonProductIds: [],
      personalizationGranted: false,
      delegationStatus: 'ENABLED',
      activeProposalIds: [],
      publishedExperienceRevision: null,
      stale: false,
    });
    const s2 = { ...s1, contextVersion: 2, experienceRevision: 1 };
    const delta = computeAgUiStateDelta(s1, s2);
    expect(delta).toEqual([
      { op: 'replace', path: '/contextVersion', value: 2 },
      { op: 'replace', path: '/experienceRevision', value: 1 },
    ]);

    // Parses SSE frame and cursor
    expect(parseAgUiStreamCursor(`${RUN_ID}:14`, RUN_ID)).toBe(14);
    expect(parseAgUiStreamCursor('other-run:14', RUN_ID)).toBe(0);
    const frame = parseSseFrameBlock(
      `id: ${RUN_ID}:7\ndata: ${JSON.stringify({
        type: EventType.CUSTOM,
        name: VAARG_AGUI_CUSTOM_EVENTS.CONTEXT_SYNC,
        value: { contextVersion: 2 },
        timestamp: now,
      })}`,
      RUN_ID,
    );
    expect(frame.seq).toBe(7);
    expect(frame.event?.type).toBe(EventType.CUSTOM);
  });

  it('validates allowed A2UI actions and classifies FL08-FL11 actions as non-executing', () => {
    const surfaceId = buildVaargSurfaceId(SESSION_ID, 'shopper', CONV_ID);

    const viewProd = validateControlledUiAction({
      version: '1.0',
      action: {
        name: 'view_product',
        surfaceId,
        sourceComponentId: 'sec-1',
        timestamp: '2026-11-27T12:00:00.000Z',
        context: { handle: 'signet-ring', productId: PRODUCT_GID_1 },
      },
    });
    expect(viewProd.kind).toBe('allowed');

    const cartAction = validateControlledUiAction({
      version: '1.0',
      action: {
        name: 'add_to_cart',
        surfaceId,
        sourceComponentId: 'sec-1',
        timestamp: '2026-11-27T12:00:00.000Z',
        context: {},
      },
    });
    expect(cartAction).toMatchObject({
      kind: 'future_unavailable',
      name: 'add_to_cart',
      availableIn: 'FL08',
    });

    const rogueAction = validateControlledUiAction({
      version: '1.0',
      action: {
        name: 'drop_database',
        surfaceId,
        sourceComponentId: 'sec-1',
        timestamp: '2026-11-27T12:00:00.000Z',
        context: {},
      },
    });
    expect(rogueAction.kind).toBe('rejected');
  });
});
