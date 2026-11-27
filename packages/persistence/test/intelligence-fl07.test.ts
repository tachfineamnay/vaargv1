import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_TOOL_CAPABILITIES } from '@vaarg/shared';
import {
  ConfinementAttestationRegistry,
  HatchetWorkflowDispatcher,
  HermesAgentAdapter,
  loadHermesAdapterConfig,
  signRuntimeAttestationPayload,
} from '../src/index.js';

const BRIDGE_SECRET = 'bridge-secret-0123456789abcdef0123456789abcdef';
const API_KEY_SECRET = 'hermes-server-key-0123456789abcdef0123456789';

describe('FL07 Persistence — Cryptographic Confinement Attestation, Streaming Deltas & Continuation Status', () => {
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (s) => new Promise<void>((resolve) => s.close(() => resolve())),
      ),
    );
  });

  it('certifies confinement via out-of-band signed runtime attestation even when Hermes strips plugin headers, and preserves delta whitespace', async () => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/v1/capabilities') {
        // Upstream Hermes strips custom headers; self-reported JSON alone MUST NOT certify confinement!
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            version: '0.23.4',
            fallback_providers: [],
            vaarg_confinement_plugin: { active: true, preventive_hooks: true },
            features: {
              run_submission: true,
              run_status: true,
              run_events_sse: true,
              run_stop: true,
            },
          }),
        );
        return;
      }
      if (req.url === '/v1/toolsets') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            data: [
              { name: 'delegation', enabled: true, tools: ['delegate_task'] },
              { name: 'vaarg_confinement', enabled: true, tools: ['search_catalog'] },
            ],
          }),
        );
        return;
      }
      if (req.url?.startsWith('/v1/runs/hermes-stream-1/events')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(
          'data: {"event":"reasoning.available","run_id":"hermes-stream-1","reasoning":"SECRET PLAN"}\n\n',
        );
        res.write(
          'data: {"event":"message.delta","run_id":"hermes-stream-1","delta":"<think>secret</think>We carry "}\n\n',
        );
        res.write(
          'data: {"event":"message.delta","run_id":"hermes-stream-1","delta":"grounded Signet Rings."}\n\n',
        );
        res.write(
          'data: {"event":"run.completed","run_id":"hermes-stream-1","status":"completed","output":"We carry grounded Signet Rings."}\n\n',
        );
        res.end();
        return;
      }
      res.writeHead(404).end();
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const registry = new ConfinementAttestationRegistry();
    const cfg = loadHermesAdapterConfig({
      HERMES_ENABLED: 'true',
      HERMES_BASE_URL: `http://127.0.0.1:${port}`,
      HERMES_API_SERVER_KEY: API_KEY_SECRET,
      HERMES_TOOL_BRIDGE_SECRET: BRIDGE_SECRET,
    });
    const adapter = new HermesAgentAdapter(cfg, fetch, registry);

    // 1. Fails closed BEFORE signed runtime attestation is registered
    const unattested = await adapter.runtimeCapabilities();
    expect(unattested.status).toBe('UNSAFE_CONFINEMENT');
    expect(unattested.preventiveHooksVerified).toBe(false);

    // 2. Rejects forged signature on ConfinementAttestationRegistry
    const nowMs = Date.now();
    const basePayload = {
      runtimeInstanceId: 'hermes-instance-1',
      hermesVersion: '0.23.4',
      pluginVersion: '1.1.0',
      activeHooks: [
        'pre_tool_call',
        'pre_api_request',
        'post_api_request',
        'subagent_start',
        'subagent_stop',
      ],
      registeredCapabilities: [...ACTIVE_TOOL_CAPABILITIES],
      forbiddenToolsBlocked: true,
      timestampMs: nowMs,
    };
    expect(() =>
      registry.recordVerifiedAttestation(BRIDGE_SECRET, {
        ...basePayload,
        signature: '0'.repeat(64),
      }),
    ).toThrow();

    // 3. Accepts valid cryptographic HMAC-SHA256 attestation and certifies runtimeCapabilities()
    const validSig = signRuntimeAttestationPayload(BRIDGE_SECRET, basePayload);
    registry.recordVerifiedAttestation(BRIDGE_SECRET, {
      ...basePayload,
      signature: validSig,
    });
    const certified = await adapter.runtimeCapabilities();
    expect(certified.status).toBe('AVAILABLE');
    expect(certified.preventiveHooksVerified).toBe(true);

    // 4. Streaming delta preserves natural inter-word spacing and strips hidden reasoning
    const deltas: string[] = [];
    for await (const ev of adapter.observeRun({
      internalRunId: '00000000-0000-4000-8000-000000000011',
      externalRunId: 'hermes-stream-1',
    })) {
      if (ev.type === 'message.delta') {
        deltas.push(ev.delta);
      }
    }
    expect(deltas).toEqual(['We carry ', 'grounded Signet Rings.']);
    expect(deltas.join('')).toBe('We carry grounded Signet Rings.');
  });

  it('preserves continuation_required status when Hatchet task poll reports SUCCEEDED on a partial catalog slice', async () => {
    const storeId = '00000000-0000-4000-8000-000000000001';
    const executionId = '00000000-0000-4000-8000-000000000055';
    const fakeRow = {
      execution_id: executionId,
      store_id: storeId,
      workflow_name: 'vaarg.catalog.sync',
      idempotency_key: 'sync-cont-test',
      correlation_id: 'corr-1',
      concurrency_key: 'store:1:market:FR:FR',
      hatchet_workflow_run_id: 'hatchet-run-cont-1',
      outbox_event_id: null,
      status: 'continuation_required',
      payload_hash: 'abc',
      result_summary: {
        status: 'CONTINUATION_REQUIRED',
        pagesProcessed: 50,
        continuationDispatched: true,
        nextExecutionId: '00000000-0000-4000-8000-000000000056',
      },
      attempts: 1,
      last_error: null,
      submitted_at: new Date('2026-11-27T12:00:00.000Z'),
      started_at: new Date('2026-11-27T12:00:01.000Z'),
      completed_at: new Date('2026-11-27T12:00:10.000Z'),
      created_at: new Date('2026-11-27T12:00:00.000Z'),
      updated_at: new Date('2026-11-27T12:00:10.000Z'),
    };

    const querySpy = vi.fn(async (sql: string) => {
      if (sql === 'COMMIT') {
        return { command: 'COMMIT', rows: [] };
      }
      if (sql.includes('AS unsafe')) {
        return { rows: [{ unsafe: false }] };
      }
      if (sql.includes('SELECT * FROM workflow_executions')) {
        return { rows: [fakeRow] };
      }
      return { rows: [] };
    });

    const fakePool = {
      connect: async () => ({
        query: querySpy,
        release: () => undefined,
      }),
    } as unknown as import('pg').Pool;

    const dispatcher = new HatchetWorkflowDispatcher(
      fakePool,
      {
        triggerWorkflowNoWait: vi.fn(),
        getRunStatus: vi.fn(async () => 'SUCCEEDED'),
        cancelRun: vi.fn(),
      },
      { status: 'READY', detail: 'ok' },
    );

    const record = await dispatcher.getWorkflowExecution(storeId, executionId);
    expect(record?.status).toBe('continuation_required');
    expect(record?.resultSummary).toMatchObject({
      status: 'CONTINUATION_REQUIRED',
      continuationDispatched: true,
    });
  });
});
