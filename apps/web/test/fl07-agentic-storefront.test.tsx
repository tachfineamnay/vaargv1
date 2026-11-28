import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AG_UI_PROTOCOL_VERSION,
  EventType,
  VAARG_AGUI_CUSTOM_EVENTS,
  adaptiveCompositionSchema,
  compileCompositionToA2UiMessages,
  emptyExplorationCriteria,
} from '@vaarg/shared';
import { GET as getRunEventsBff } from '../src/app/api/agent/runs/[runId]/events/route';
import { GET as getRunResultBff } from '../src/app/api/agent/runs/[runId]/result/route';
import { POST as postActionsBff } from '../src/app/api/agent/actions/route';
import { A2UiSurfaceRenderer } from '../src/components/A2UiSurfaceRenderer';
import { CompareProvider } from '../src/components/CompareProvider';
import { consumeAgUiRunStream } from '../src/lib/agent-client';
import {
  bindExperienceSession,
  lastAppliedRevision,
  notifyServerExperienceSync,
  setLastAppliedRevision,
} from '../src/lib/experience-client';

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa';
const OTHER_SESSION_ID = '00000000-0000-4000-8000-0000000000bb';
const CONV_ID = '00000000-0000-4000-8000-0000000000cc';
const RUN_ID = '00000000-0000-4000-8000-0000000000dd';

function makeSummary(id: string, handle: string, title: string) {
  return {
    id,
    handle,
    title,
    productType: 'Rings',
    vendor: 'VAARG Atelier',
    tags: ['gold'],
    availableForSale: true,
    priceMin: { amount: '350.00', currencyCode: 'EUR' },
    priceMax: { amount: '350.00', currencyCode: 'EUR' },
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

describe('FL07 Web — Constrained BFF SSE Proxy, A2UI 1.0 Renderer & Unified Experience Sync', () => {
  const servers: Array<ReturnType<typeof createServer>> = [];
  const originalApiBase = process.env.API_BASE_URL;

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setLastAppliedRevision(null);
    bindExperienceSession(null);
    process.env.API_BASE_URL = originalApiBase;
    await Promise.all(
      servers.splice(0).map(
        (s) => new Promise<void>((resolve) => s.close(() => resolve())),
      ),
    );
  });

  it('enforces same-origin CSRF, blocks mutating GET ?publish=true, strips unrelated cookies, and forwards unbuffered SSE with Host + Last-Event-ID', async () => {
    // 1. Blocks ?publish=true on GET /api/agent/runs/[runId]/result
    const badGet = await getRunResultBff(
      new Request(`https://atelier.example.test/api/agent/runs/${RUN_ID}/result?publish=true`, {
        headers: { host: 'atelier.example.test' },
      }),
      { params: Promise.resolve({ runId: RUN_ID }) },
    );
    expect(badGet.status).toBe(400);

    // 2. Rejects cross-origin POST on /api/agent/actions
    const crossOriginPost = await postActionsBff(
      new Request('https://atelier.example.test/api/agent/actions', {
        method: 'POST',
        headers: {
          host: 'atelier.example.test',
          origin: 'https://evil.example.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      }),
    );
    expect(crossOriginPost.status).toBe(403);

    // 3. Unbuffered SSE forwarding preserves Host + Last-Event-ID and strips non-session cookies
    let capturedHeaders: IncomingMessage['headers'] = {};
    const upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
      capturedHeaders = req.headers;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'private, no-store',
      });
      res.write(
        `id: ${RUN_ID}:4\ndata: ${JSON.stringify({
          type: EventType.RUN_FINISHED,
          threadId: CONV_ID,
          runId: RUN_ID,
          outcome: { type: 'success' },
          timestamp: Date.now(),
        })}\n\n`,
      );
      res.end();
    });
    servers.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()));
    const addr = upstream.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    process.env.API_BASE_URL = `http://127.0.0.1:${port}`;

    const sseRes = await getRunEventsBff(
      new Request(`https://atelier.example.test/api/agent/runs/${RUN_ID}/events`, {
        headers: {
          host: 'atelier.example.test',
          cookie: '_ga=123; vaarg_visitor_session=tok_abc; merchant_secret=leak',
          'last-event-id': `${RUN_ID}:3`,
        },
      }),
      { params: Promise.resolve({ runId: RUN_ID }) },
    );
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get('content-type')).toContain('text/event-stream');
    const bodyText = await sseRes.text();
    expect(bodyText).toContain(`id: ${RUN_ID}:4`);
    expect(capturedHeaders.host).toBe('atelier.example.test');
    expect(capturedHeaders['last-event-id']).toBe(`${RUN_ID}:3`);
    expect(capturedHeaders.cookie).toBe('vaarg_visitor_session=tok_abc');
  });

  it('renders grounded A2UI 1.0 catalog surfaces onto VAARG components and fails closed on untrusted/cross-session surfaces', () => {
    const comp = adaptiveCompositionSchema.parse({
      sessionId: SESSION_ID,
      contextVersion: 2,
      experienceRevision: 1,
      mode: 'adaptive',
      adaptationReason: 'explicit_criteria',
      freshness: new Date().toISOString(),
      sections: [
        {
          id: 'rings-grid',
          component: 'ProductGrid',
          title: 'Atelier Gold Rings',
          products: [makeSummary('gid://shopify/Product/101', 'atelier-signet', 'Atelier Signet')],
        },
      ],
    });

    const compiled = compileCompositionToA2UiMessages({
      composition: comp,
      surfaceKind: 'adaptive',
      guidedQuestions: [
        {
          questionId: 'sizing',
          title: 'Ring sizing',
          prompt: 'Select your preferred band width',
          options: [{ id: 'narrow', label: '4mm Narrow Band' }],
        },
      ],
    });

    const html = renderToString(
      <CompareProvider>
        <A2UiSurfaceRenderer sessionId={SESSION_ID} messages={compiled.messages} />
      </CompareProvider>,
    );
    expect(html).toContain('Atelier Gold Rings');
    expect(html).toContain('Atelier Signet');
    expect(html).toContain('4mm Narrow Band');
    expect(html).toContain('data-testid="a2ui-freshness-badge"');

    // Cross-session surfaceId fails closed into non-executing status notice
    const foreignHtml = renderToString(
      <CompareProvider>
        <A2UiSurfaceRenderer sessionId={OTHER_SESSION_ID} messages={compiled.messages} />
      </CompareProvider>,
    );
    expect(foreignHtml).toContain('data-testid="a2ui-validation-fallback"');
    expect(foreignHtml).toContain('SURFACE_OWNERSHIP_MISMATCH');
  });

  it('consumes AG-UI SSE chunks, preserves delta spacing, deduplicates reconnects via Last-Event-ID, and synchronizes ExperienceContext monotonically', async () => {
    bindExperienceSession(SESSION_ID);
    const now = Date.now();
    let callCount = 0;
    const seenLastEventIds: Array<string | null> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        callCount += 1;
        const headers = new Headers(init?.headers);
        seenLastEventIds.push(headers.get('Last-Event-ID'));

        const encoder = new TextEncoder();
        if (callCount === 1) {
          // Simulate mid-stream disconnect after seq 3
          const frames = [
            `id: ${RUN_ID}:1\ndata: ${JSON.stringify({
              type: EventType.RUN_STARTED,
              threadId: CONV_ID,
              runId: RUN_ID,
              protocolVersion: AG_UI_PROTOCOL_VERSION,
              timestamp: now,
            })}\n\n`,
            `id: ${RUN_ID}:2\ndata: ${JSON.stringify({
              type: EventType.STATE_SNAPSHOT,
              snapshot: {
                sessionId: SESSION_ID,
                conversationId: CONV_ID,
                runId: RUN_ID,
                contextVersion: 4,
                experienceRevision: 2,
                market: { country: 'FR', language: 'FR', currency: 'EUR' },
                exploration: emptyExplorationCriteria(),
                comparisonProductIds: [],
                personalizationGranted: false,
                delegationStatus: 'ENABLED',
                activeProposalIds: [],
                publishedExperienceRevision: null,
                stale: false,
              },
              timestamp: now,
            })}\n\n`,
            `id: ${RUN_ID}:3\ndata: ${JSON.stringify({
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId: 'm1',
              delta: 'Here ',
              timestamp: now,
            })}\n\n`,
          ];
          return new Response(
            new ReadableStream({
              start(ctrl) {
                for (const f of frames) ctrl.enqueue(encoder.encode(f));
                ctrl.close();
              },
            }),
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
          );
        }

        // Reconnect replays seq 3 (must be deduplicated!) + seq 4 + seq 5 + terminal seq 6
        const resumeFrames = [
          `id: ${RUN_ID}:3\ndata: ${JSON.stringify({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: 'm1',
            delta: 'Here ',
            timestamp: now,
          })}\n\n`,
          `id: ${RUN_ID}:4\ndata: ${JSON.stringify({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: 'm1',
            delta: 'are grounded rings.',
            timestamp: now,
          })}\n\n`,
          `id: ${RUN_ID}:5\ndata: ${JSON.stringify({
            type: EventType.CUSTOM,
            name: VAARG_AGUI_CUSTOM_EVENTS.CONTEXT_SYNC,
            value: { contextVersion: 5, experienceRevision: 3 },
            timestamp: now,
          })}\n\n`,
          `id: ${RUN_ID}:6\ndata: ${JSON.stringify({
            type: EventType.RUN_FINISHED,
            threadId: CONV_ID,
            runId: RUN_ID,
            outcome: { type: 'success' },
            timestamp: now,
          })}\n\n`,
        ];
        return new Response(
          new ReadableStream({
            start(ctrl) {
              for (const f of resumeFrames) ctrl.enqueue(encoder.encode(f));
              ctrl.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      }),
    );

    let text = '';
    let terminalStatus: string | null = null;
    await consumeAgUiRunStream({
      runId: RUN_ID,
      signal: new AbortController().signal,
      handlers: {
        onTextDelta: (delta) => {
          text += delta;
        },
        onTerminal: (out) => {
          terminalStatus = out.kind === 'finished' ? out.status : 'error';
        },
      },
    });

    expect(seenLastEventIds).toEqual([null, `${RUN_ID}:3`]);
    expect(text).toBe('Here are grounded rings.');
    expect(terminalStatus).toBe('success');
    expect(lastAppliedRevision()).toEqual({
      sessionId: SESSION_ID,
      contextVersion: 5,
      experienceRevision: 3,
    });

    // Stale revision envelope cannot regress synchronized state
    expect(
      notifyServerExperienceSync({
        sessionId: SESSION_ID,
        contextVersion: 4,
        experienceRevision: 2,
      }),
    ).toBe(false);
    expect(lastAppliedRevision()).toEqual({
      sessionId: SESSION_ID,
      contextVersion: 5,
      experienceRevision: 3,
    });
  });
});
