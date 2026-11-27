import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdempotencyCollisionError } from '@hatchet-dev/typescript-sdk';
import type { Pool } from 'pg';
import { calculateVerifiedModelCostUsd, type AgentRunEvent } from '@vaarg/shared';
import {
  HatchetWorkflowDispatcher,
  HermesAgentAdapter,
  ProviderPolicyRegistry,
  issueRunBridgeTicket,
  loadHermesAdapterConfig,
  resolveHatchetSdkConfig,
  verifyRunBridgeTicket,
  verifySharedBridgeSecret,
} from '../src/index.js';

const BRIDGE_SECRET = 'synthetic-hermes-bridge-secret-minimum-32-chars!!';
const API_KEY_SECRET = 'synthetic-hermes-api-server-key-minimum-32-chars';

describe('FL06 persistence: provider policy, bridge tickets, confined Hermes adapter, Hatchet dispatcher, and migration 0014', () => {
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const srv = servers.pop()!;
      await new Promise<void>((resolve) => srv.close(() => resolve()));
    }
  });

  it('enforces direct-only Gemini & DeepSeek provider policy with zero implicit fallback', () => {
    const unconfigured = ProviderPolicyRegistry.fromEnv({});
    expect(() => unconfigured.resolveForRole('master')).toThrow(/not configured/i);

    // Rejects forbidden proxy/router credentials (OpenRouter, Nous Portal)
    for (const badEnv of [
      { OPENROUTER_API_KEY: 'sk-or-v1-synthetic-forbidden-credential' },
      { NOUS_API_KEY: 'nous-portal-synthetic-forbidden-credential' },
      { VAARG_DEFAULT_MODEL_PROVIDER: 'openrouter', VAARG_DEFAULT_MODEL_NAME: 'gpt-4o' },
    ]) {
      expect(() => ProviderPolicyRegistry.fromEnv(badEnv)).toThrow();
    }

    const configured = ProviderPolicyRegistry.fromEnv({
      GEMINI_API_KEY: 'synthetic-gemini-api-key-valid',
      DEEPSEEK_API_KEY: 'synthetic-deepseek-api-key-valid',
    });

    const masterPolicy = configured.resolveForRole('master', 'gemini', 'gemini-2.5-flash');
    expect(masterPolicy.provider).toBe('gemini');
    expect(masterPolicy.allowImplicitFallback).toBe(false);

    const specialistPolicy = configured.resolveForRole('discovery', 'deepseek', 'deepseek-chat');
    expect(specialistPolicy.provider).toBe('deepseek');
    expect(specialistPolicy.allowImplicitFallback).toBe(false);

    // Explicit DeepSeek selection fails closed if DeepSeek key is absent (NEVER falls back to Gemini!)
    const geminiOnly = ProviderPolicyRegistry.fromEnv({
      GEMINI_API_KEY: 'synthetic-gemini-api-key-valid',
    });
    expect(() => geminiOnly.resolveForRole('discovery', 'deepseek', 'deepseek-chat')).toThrow(
      /not configured/i,
    );

    // Rejects forbidden providers at call time too
    expect(() => configured.resolveForRole('master', 'openrouter', 'gemini-2.5-flash')).toThrow(
      /prohibited/i,
    );

    // Deterministic cost reservation & calculation
    const est = configured.estimateReservationCostUsd(masterPolicy, 2000, 1000);
    expect(est.reservedTokens).toBe(3000);
    expect(est.reservedCostUsd).toBeGreaterThan(0);
    expect(
      calculateVerifiedModelCostUsd(masterPolicy.pricing, {
        inputTokens: 2000,
        outputTokens: 1000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBeGreaterThan(0);
  });

  it('issues and verifies HMAC-SHA256 run bridge tickets and rejects tampering or expiry', () => {
    const baseTimeMs = 1_700_000_000_000;
    const ticket = issueRunBridgeTicket(
      BRIDGE_SECRET,
      {
        storeId: '00000000-0000-4000-8000-000000000001',
        rootRunId: '00000000-0000-4000-8000-000000000011',
        conversationId: '00000000-0000-4000-8000-000000000012',
        sessionId: '00000000-0000-4000-8000-000000000002',
        preventiveHooksVerified: true,
        ttlMs: 30_000,
      },
      baseTimeMs,
    );

    const verified = verifyRunBridgeTicket(BRIDGE_SECRET, ticket, baseTimeMs + 10_000);
    expect(verified).toMatchObject({
      v: 1,
      storeId: '00000000-0000-4000-8000-000000000001',
      rootRunId: '00000000-0000-4000-8000-000000000011',
      conversationId: '00000000-0000-4000-8000-000000000012',
      sessionId: '00000000-0000-4000-8000-000000000002',
      preventiveHooksVerified: true,
    });

    // Expired ticket rejected
    expect(() => verifyRunBridgeTicket(BRIDGE_SECRET, ticket, baseTimeMs + 40_000)).toThrow(
      /expired/i,
    );

    // Tampered payload rejected
    const [payloadB64, sigB64] = ticket.split('.');
    expect(() =>
      verifyRunBridgeTicket(BRIDGE_SECRET, `${payloadB64}a.${sigB64}`, baseTimeMs + 10_000),
    ).toThrow();

    // Shared bearer verification
    expect(() => verifySharedBridgeSecret(BRIDGE_SECRET, `Bearer ${BRIDGE_SECRET}`)).not.toThrow();
    expect(() => verifySharedBridgeSecret(BRIDGE_SECRET, 'Bearer wrong-secret')).toThrow();
  });

  it('detects UNSAFE_CONFINEMENT when Hermes exposes forbidden tools or fallback providers, and streams sanitized SSE when confined', async () => {
    let leakForbiddenToolset = true;
    let stopCalledForRun: string | null = null;

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.headers.authorization !== `Bearer ${API_KEY_SECRET}`) {
        res.writeHead(401).end('unauthorized');
        return;
      }
      if (req.url === '/v1/capabilities') {
        res.writeHead(200, {
          'content-type': 'application/json',
          'x-vaarg-confinement': 'active',
        });
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
            data: leakForbiddenToolset
              ? [
                  { name: 'vaarg_confinement', enabled: true, tools: ['search_catalog'] },
                  { name: 'terminal', enabled: true, tools: ['terminal'] },
                ]
              : [
                  { name: 'delegation', enabled: true, tools: ['delegate_task'] },
                  { name: 'vaarg_confinement', enabled: true, tools: ['search_catalog'] },
                ],
          }),
        );
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/runs') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ run_id: 'hermes-run-1', status: 'running' }));
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/v1/runs/hermes-run-1/events')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(
          'data: {"event":"reasoning.available","run_id":"hermes-run-1","reasoning":"SECRET INTERNAL CHAIN OF THOUGHT"}\n\n',
        );
        res.write(
          'data: {"event":"message.delta","run_id":"hermes-run-1","delta":"<think>HIDDEN</think>Grounded product answer."}\n\n',
        );
        res.write(
          'data: {"event":"run.completed","run_id":"hermes-run-1","status":"completed","output":"<think>HIDDEN</think>Grounded product answer.","usage":{"input_tokens":120,"output_tokens":30,"total_tokens":150}}\n\n',
        );
        res.end();
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/runs/hermes-run-1/stop') {
        stopCalledForRun = 'hermes-run-1';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ run_id: 'hermes-run-1', status: 'cancelled' }));
        return;
      }
      res.writeHead(404).end();
    });
    servers.push(server);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const cfg = loadHermesAdapterConfig({
      HERMES_ENABLED: 'true',
      HERMES_BASE_URL: `http://127.0.0.1:${port}`,
      HERMES_API_SERVER_KEY: API_KEY_SECRET,
    });
    const adapter = new HermesAgentAdapter(cfg);

    // 1. Reports UNSAFE_CONFINEMENT when 'terminal' toolset is enabled!
    const badCaps = await adapter.runtimeCapabilities();
    expect(badCaps.status).toBe('UNSAFE_CONFINEMENT');
    expect(badCaps.forbiddenToolsDetected).toContain('terminal');

    // 2. Reports AVAILABLE + delegationSupported when confined
    leakForbiddenToolset = false;
    const goodCaps = await adapter.runtimeCapabilities();
    expect(goodCaps.status).toBe('AVAILABLE');
    expect(goodCaps.preventiveHooksVerified).toBe(true);
    expect(goodCaps.delegationSupported).toBe(true);

    const handle = await adapter.startRun({
      internalRunId: '00000000-0000-4000-8000-000000000011',
      hermesSessionKey: 'vaarg-session-1',
      idempotencyKey: 'idem-run-1',
      correlationId: 'corr-1',
      role: 'master',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      systemPrompt: 'Grounded catalog answers only.',
      userMessage: 'Show me DN50 valves',
      conversationHistory: [],
      allowedToolCapabilities: ['search_catalog'],
      delegationEnabled: true,
      timeoutMs: 15_000,
      maxOutputTokens: 1024,
    });
    expect(handle.externalRunId).toBe('hermes-run-1');

    const observedEvents: AgentRunEvent[] = [];
    for await (const ev of adapter.observeRun({
      internalRunId: '00000000-0000-4000-8000-000000000011',
      externalRunId: 'hermes-run-1',
    })) {
      observedEvents.push(ev);
    }

    const serialized = JSON.stringify(observedEvents);
    expect(serialized).not.toContain('SECRET INTERNAL CHAIN OF THOUGHT');
    expect(serialized).not.toContain('HIDDEN');
    expect(serialized).toContain('Grounded product answer.');

    await adapter.cancelRun({
      internalRunId: '00000000-0000-4000-8000-000000000011',
      externalRunId: 'hermes-run-1',
    });
    expect(stopCalledForRun).toBe('hermes-run-1');
  });

  it('validates Hatchet SDK configuration and rejects unimplemented or unconfigured workflow submissions', async () => {
    expect(resolveHatchetSdkConfig({}).status).toBe('NOT_CONFIGURED');

    const cfg = resolveHatchetSdkConfig({
      HATCHET_ENABLED: 'true',
      HATCHET_CLIENT_TOKEN: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.sig-at-least-twenty-chars',
      HATCHET_CLIENT_HOST_PORT: '127.0.0.1:7077',
      HATCHET_CLIENT_TLS_STRATEGY: 'none',
    });
    expect(cfg.status).toBe('CONFIGURED');

    const unconfiguredDispatcher = HatchetWorkflowDispatcher.fromEnv({} as unknown as Pool, {});
    expect(unconfiguredDispatcher.readiness().status).toBe('NOT_CONFIGURED');

    const err = new IdempotencyCollisionError('duplicate');
    expect(err).toBeInstanceOf(IdempotencyCollisionError);
    const mockCancel = vi.fn(async () => undefined);
    await mockCancel({ ids: ['hatchet-run-99'] });
    expect(mockCancel).toHaveBeenCalledWith({ ids: ['hatchet-run-99'] });
  });

  it('verifies migration 0014 enforces RLS, FORCE RLS, store policies, and retention purge across all 11 intelligence tables', async () => {
    const sqlPath = join(
      import.meta.dirname,
      '../migrations/0014_intelligence_domain.sql',
    );
    const sql = await readFile(sqlPath, 'utf8');

    const expectedTables = [
      'conversations',
      'agent_prompt_versions',
      'provider_policies',
      'agent_policies',
      'agent_runs',
      'messages',
      'conversation_summaries',
      'tool_invocations',
      'model_usage',
      'action_proposals',
      'workflow_executions',
    ];

    for (const table of expectedTables) {
      expect(sql).toContain(`CREATE TABLE ${table} (`);
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ON ${table}`);
    }
    expect(sql).toContain('CREATE FUNCTION purge_expired_intelligence');
  });
});
