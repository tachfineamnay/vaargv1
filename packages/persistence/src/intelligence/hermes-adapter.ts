import {
  AppError,
  FORBIDDEN_RUNTIME_TOOLS,
  HERMES_PINNED_VERSION,
  stripHiddenReasoning,
  type AgentPort,
  type AgentRunEvent,
  type AgentRunHandle,
  type AgentRunRuntimeMetadata,
  type AgentRunSnapshot,
  type AgentRunStatus,
  type AgentRunUsageSnapshot,
  type AgentRuntimeCapabilities,
  type AgentRuntimeReadiness,
  type CancelAgentRunRequest,
  type CancelAgentRunResult,
  type GetAgentRunRequest,
  type ObserveAgentRunRequest,
  type StartAgentRunRequest,
} from '@vaarg/shared';
import { z } from 'zod';

export interface HermesAdapterConfig {
  enabled: boolean;
  baseUrl: string | undefined;
  apiKey: string | undefined;
  requestTimeoutMs: number;
  sseIdleTimeoutMs: number;
  sseMaxEvents: number;
  sseMaxFrameBytes: number;
  requirePreventivePlugin: boolean;
}

export function loadHermesAdapterConfig(
  env: Record<string, string | undefined> = process.env,
): HermesAdapterConfig {
  const enabled = env.HERMES_ENABLED === 'true';
  const baseUrl = env.HERMES_API_URL?.trim() || env.HERMES_BASE_URL?.trim() || undefined;
  const apiKey = env.HERMES_API_SERVER_KEY?.trim() || undefined;
  const requestTimeoutMs = Math.min(
    120_000,
    Math.max(1_000, Number.parseInt(env.HERMES_REQUEST_TIMEOUT_MS ?? '15000', 10) || 15_000),
  );
  const sseIdleTimeoutMs = Math.min(
    120_000,
    Math.max(1_000, Number.parseInt(env.HERMES_SSE_IDLE_TIMEOUT_MS ?? '30000', 10) || 30_000),
  );
  return {
    enabled,
    baseUrl,
    apiKey,
    requestTimeoutMs,
    sseIdleTimeoutMs,
    sseMaxEvents: 500,
    sseMaxFrameBytes: 131_072,
    requirePreventivePlugin: env.HERMES_REQUIRE_PREVENTIVE_PLUGIN !== 'false',
  };
}

// ============================================================================
// Wire Schemas Verified Against NousResearch/hermes-agent v0.23.4
// ============================================================================

const hermesCreateRunResponseSchema = z.object({
  run_id: z.string().min(1).max(200),
  status: z.string().min(1).max(64),
});

const hermesUsageWireSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().default(0),
    output_tokens: z.number().int().nonnegative().default(0),
    total_tokens: z.number().int().nonnegative().default(0),
    cache_read_tokens: z.number().int().nonnegative().optional(),
    cache_write_tokens: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const hermesRuntimeWireSchema = z
  .object({
    provider: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    route_source: z.string().nullable().optional(),
    requested: z
      .object({
        provider: z.string().nullable().optional(),
        model: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const hermesRunStatusResponseSchema = z
  .object({
    object: z.string().optional(),
    run_id: z.string().min(1).max(200),
    status: z.string().min(1).max(64),
    session_id: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    output: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
    partial: z.boolean().optional(),
    interrupted: z.boolean().optional(),
    turn_exit_reason: z.string().nullable().optional(),
    usage: hermesUsageWireSchema.nullable().optional(),
    runtime: hermesRuntimeWireSchema.nullable().optional(),
  })
  .passthrough();

const hermesStopRunResponseSchema = z
  .object({
    run_id: z.string().optional(),
    status: z.string().min(1).max(64),
  })
  .passthrough();

const hermesCapabilitiesWireSchema = z
  .object({
    version: z.string().optional(),
    features: z
      .object({
        run_submission: z.boolean().optional(),
        run_status: z.boolean().optional(),
        run_events_sse: z.boolean().optional(),
        run_stop: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    vaarg_confinement_plugin: z
      .object({
        active: z.boolean(),
        preventive_hooks: z.boolean(),
      })
      .optional(),
    fallback_providers: z.array(z.unknown()).optional(),
  })
  .passthrough();

const hermesToolsetsWireSchema = z
  .object({
    object: z.literal('list').optional(),
    data: z.array(
      z
        .object({
          name: z.string(),
          enabled: z.boolean(),
          configured: z.boolean().optional(),
          tools: z.array(z.string()).default([]),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const hermesSseFrameWireSchema = z
  .object({
    event: z.string().min(1).max(80),
    run_id: z.string().min(1).max(200),
    timestamp: z.number().optional(),
    seq: z.number().int().nonnegative().optional(),
  })
  .passthrough();

function mapHermesStatus(rawStatus: string, interrupted?: boolean): AgentRunStatus {
  switch (rawStatus) {
    case 'queued':
      return 'queued';
    case 'started':
    case 'running':
    case 'waiting_for_approval':
      return 'running';
    case 'stopping':
      return 'cancelling';
    case 'completed':
      return interrupted ? 'cancelled' : 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'interrupted':
      return 'cancelled';
    case 'failed':
      return 'failed';
    case 'unknown':
      return 'unknown';
    default:
      return 'unknown';
  }
}

function mapUsage(raw: z.infer<typeof hermesUsageWireSchema> | null | undefined): AgentRunUsageSnapshot | null {
  if (!raw) return null;
  const cacheRead = raw.cache_read_tokens ?? 0;
  const cacheWrite = raw.cache_write_tokens ?? 0;
  const total = raw.total_tokens > 0 ? raw.total_tokens : raw.input_tokens + raw.output_tokens;
  return {
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    totalTokens: total,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  };
}

function mapRuntime(
  raw: z.infer<typeof hermesRuntimeWireSchema> | null | undefined,
): AgentRunRuntimeMetadata | null {
  if (!raw) return null;
  return {
    provider: raw.provider ?? null,
    model: raw.model ?? null,
    routeSource: raw.route_source ?? null,
    requestedProvider: raw.requested?.provider ?? null,
    requestedModel: raw.requested?.model ?? null,
  };
}

function validateVisibleAsciiKey(key: string, label: string, maxLen: number): string {
  const trimmed = key.trim();
  if (trimmed.length < 1 || trimmed.length > maxLen || !/^[\x21-\x7E]+$/.test(trimmed)) {
    throw AppError.badRequest(`INVALID_${label}: Must be 1..${maxLen} visible ASCII characters`);
  }
  return trimmed;
}

export class HermesAgentAdapter implements AgentPort {
  private readonly config: HermesAdapterConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: HermesAdapterConfig, fetchImpl: typeof fetch = globalThis.fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  private isConfigured(): boolean {
    return Boolean(
      this.config.enabled &&
        this.config.baseUrl &&
        this.config.apiKey &&
        !this.config.apiKey.toLowerCase().includes('replace_me'),
    );
  }

  private assertConfigured(): { baseUrl: string; apiKey: string } {
    if (!this.isConfigured() || !this.config.baseUrl || !this.config.apiKey) {
      throw AppError.unavailable(
        'AGENT_RUNTIME_NOT_CONFIGURED: Hermes runtime is not configured or enabled',
      );
    }
    return {
      baseUrl: this.config.baseUrl.replace(/\/+$/, ''),
      apiKey: this.config.apiKey,
    };
  }

  private buildSignal(timeoutMs: number, callerSignal?: AbortSignal): {
    signal: AbortSignal;
    cleanup: () => void;
  } {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`Hermes request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const onAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal) {
      if (callerSignal.aborted) {
        clearTimeout(timer);
        controller.abort(callerSignal.reason);
      } else {
        callerSignal.addEventListener('abort', onAbort, { once: true });
      }
    }
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer);
        if (callerSignal) {
          callerSignal.removeEventListener('abort', onAbort);
        }
      },
    };
  }

  private mapHttpError(status: number, bodyText: string, operation: string): AppError {
    let code = '';
    try {
      const parsed = JSON.parse(bodyText) as { error?: { code?: string; message?: string } | string };
      if (typeof parsed.error === 'string') {
        code = parsed.error;
      } else if (parsed.error && typeof parsed.error.code === 'string') {
        code = parsed.error.code;
      }
    } catch {
      // ignore non-json error body
    }

    if (status === 401 || status === 403) {
      return AppError.unavailable(`HERMES_AUTH_REJECTED: ${operation} rejected (${status})`);
    }
    if (status === 404) {
      return AppError.notFound(`HERMES_RUN_NOT_FOUND: ${operation}`);
    }
    if (status === 409) {
      return AppError.conflict(`HERMES_CONFLICT:${code ? ` ${code}` : ''} during ${operation}`);
    }
    if (status === 429) {
      return AppError.unavailable(`HERMES_CAPACITY_EXCEEDED: ${operation} rate/concurrency limited`);
    }
    return AppError.unavailable(`HERMES_UPSTREAM_ERROR: ${operation} failed with HTTP ${status}`);
  }

  async startRun(request: StartAgentRunRequest): Promise<AgentRunHandle> {
    const { baseUrl, apiKey } = this.assertConfigured();
    const idempotencyKey = validateVisibleAsciiKey(
      request.idempotencyKey,
      'IDEMPOTENCY_KEY',
      255,
    );
    const sessionKey = validateVisibleAsciiKey(
      request.hermesSessionKey,
      'HERMES_SESSION_KEY',
      255,
    );
    const timeoutMs = Math.min(this.config.requestTimeoutMs, Math.max(1_000, request.timeoutMs));
    const { signal, cleanup } = this.buildSignal(timeoutMs, request.signal);

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey,
        'X-Hermes-Session-Key': sessionKey,
        'X-Correlation-Id': request.correlationId,
      };
      if (request.bridgeMetadata) {
        for (const [k, v] of Object.entries(request.bridgeMetadata)) {
          if (/^X-Vaarg-[A-Za-z0-9-]+$/.test(k) && !/[\r\n\0]/.test(v)) {
            headers[k] = v;
          }
        }
      }

      const body = {
        input: request.input,
        session_id: request.hermesSessionId,
        instructions: request.instructions,
        conversation_history: request.conversationHistory,
        model: request.model,
        provider: request.provider,
        model_options: {
          max_tokens: request.maxOutputTokens,
        },
      };

      const res = await this.fetchImpl(`${baseUrl}/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });

      const text = await res.text();
      if (!res.ok) {
        throw this.mapHttpError(res.status, text, 'startRun');
      }

      const parsed = hermesCreateRunResponseSchema.parse(JSON.parse(text));
      const replayed = res.headers.get('idempotency-replayed') === 'true';
      return {
        internalRunId: request.internalRunId,
        externalRunId: parsed.run_id,
        status: parsed.status === 'queued' ? 'queued' : 'running',
        replayed,
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw AppError.unavailable(
        `HERMES_TRANSPORT_ERROR: Failed to start run (${err instanceof Error ? err.message : 'unknown'})`,
      );
    } finally {
      cleanup();
    }
  }

  async getRun(request: GetAgentRunRequest): Promise<AgentRunSnapshot> {
    const { baseUrl, apiKey } = this.assertConfigured();
    const timeoutMs = request.timeoutMs ?? this.config.requestTimeoutMs;
    const { signal, cleanup } = this.buildSignal(timeoutMs, request.signal);

    try {
      const res = await this.fetchImpl(
        `${baseUrl}/v1/runs/${encodeURIComponent(request.externalRunId)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
          signal,
        },
      );
      const text = await res.text();
      if (!res.ok) {
        throw this.mapHttpError(res.status, text, 'getRun');
      }
      const parsed = hermesRunStatusResponseSchema.parse(JSON.parse(text));
      return {
        externalRunId: parsed.run_id,
        status: mapHermesStatus(parsed.status, parsed.interrupted),
        rawStatus: parsed.status,
        sessionId: parsed.session_id ?? null,
        output: parsed.output ? stripHiddenReasoning(parsed.output) : null,
        error: parsed.error ?? null,
        partial: Boolean(parsed.partial),
        interrupted: Boolean(parsed.interrupted),
        turnExitReason: parsed.turn_exit_reason ?? null,
        usage: mapUsage(parsed.usage),
        runtime: mapRuntime(parsed.runtime),
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw AppError.unavailable(
        `HERMES_TRANSPORT_ERROR: Failed to query run (${err instanceof Error ? err.message : 'unknown'})`,
      );
    } finally {
      cleanup();
    }
  }

  async cancelRun(request: CancelAgentRunRequest): Promise<CancelAgentRunResult> {
    const { baseUrl, apiKey } = this.assertConfigured();
    const timeoutMs = request.timeoutMs ?? this.config.requestTimeoutMs;
    const { signal, cleanup } = this.buildSignal(timeoutMs, request.signal);

    try {
      const res = await this.fetchImpl(
        `${baseUrl}/v1/runs/${encodeURIComponent(request.externalRunId)}/stop`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
          signal,
        },
      );
      const text = await res.text();
      if (res.status === 409) {
        const snapshot = await this.getRun({
          internalRunId: request.internalRunId,
          externalRunId: request.externalRunId,
          timeoutMs,
        });
        return {
          externalRunId: request.externalRunId,
          accepted: false,
          status: snapshot.status,
        };
      }
      if (!res.ok) {
        throw this.mapHttpError(res.status, text, 'cancelRun');
      }
      const parsed = hermesStopRunResponseSchema.parse(JSON.parse(text));
      return {
        externalRunId: request.externalRunId,
        accepted: parsed.status === 'stopping' || parsed.status === 'cancelled',
        status:
          parsed.status === 'stopping'
            ? 'cancelling'
            : mapHermesStatus(parsed.status, false),
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw AppError.unavailable(
        `HERMES_TRANSPORT_ERROR: Failed to cancel run (${err instanceof Error ? err.message : 'unknown'})`,
      );
    } finally {
      cleanup();
    }
  }

  async *observeRun(request: ObserveAgentRunRequest): AsyncIterable<AgentRunEvent> {
    const { baseUrl, apiKey } = this.assertConfigured();
    const totalTimeoutMs = request.totalTimeoutMs ?? 90_000;
    const idleTimeoutMs = request.idleTimeoutMs ?? this.config.sseIdleTimeoutMs;
    const maxEvents = Math.min(this.config.sseMaxEvents, request.maxEvents ?? this.config.sseMaxEvents);

    const { signal, cleanup } = this.buildSignal(totalTimeoutMs, request.signal);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'text/event-stream',
    };
    const url = new URL(`${baseUrl}/v1/runs/${encodeURIComponent(request.externalRunId)}/events`);
    if (request.afterSeq !== undefined && request.afterSeq >= 0) {
      headers['Last-Event-ID'] = String(request.afterSeq);
      url.searchParams.set('last_seq', String(request.afterSeq));
    }

    try {
      const res = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers,
        signal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        throw this.mapHttpError(res.status, text, 'observeRun');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let emittedCount = 0;
      let streamClosed = false;

      const readNextChunk = async (): Promise<{ done: boolean; value?: Uint8Array }> => {
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => {
              idleTimer = setTimeout(
                () => reject(new Error(`Hermes SSE idle timeout after ${idleTimeoutMs}ms`)),
                idleTimeoutMs,
              );
            }),
          ]);
        } finally {
          if (idleTimer) clearTimeout(idleTimer);
        }
      };

      while (!streamClosed && emittedCount < maxEvents) {
        const { done, value } = await readNextChunk();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > this.config.sseMaxFrameBytes * 2) {
          await reader.cancel('SSE buffer limit exceeded');
          throw AppError.unavailable('HERMES_SSE_FRAME_TOO_LARGE: Exceeded maximum bounded SSE buffer');
        }

        let boundaryIdx = buffer.indexOf('\n\n');
        while (boundaryIdx !== -1) {
          const rawFrame = buffer.slice(0, boundaryIdx);
          buffer = buffer.slice(boundaryIdx + 2);
          boundaryIdx = buffer.indexOf('\n\n');

          if (rawFrame.length > this.config.sseMaxFrameBytes) {
            await reader.cancel('SSE frame size exceeded');
            throw AppError.unavailable('HERMES_SSE_FRAME_TOO_LARGE: Frame exceeded size limit');
          }

          const lines = rawFrame.split(/\r?\n/);
          const dataLines: string[] = [];
          let lastIdSeq: number | undefined;
          let sawCloseComment = false;

          for (const line of lines) {
            if (line.startsWith(':')) {
              if (line.includes('stream closed')) {
                sawCloseComment = true;
              }
              continue;
            }
            if (line.startsWith('id:')) {
              const parsedId = Number.parseInt(line.slice(3).trim(), 10);
              if (Number.isFinite(parsedId) && parsedId >= 0) {
                lastIdSeq = parsedId;
              }
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trimStart());
            }
          }

          if (sawCloseComment) {
            streamClosed = true;
            break;
          }
          if (dataLines.length === 0) {
            continue;
          }

          const jsonText = dataLines.join('\n');
          let parsedObj: unknown;
          try {
            parsedObj = JSON.parse(jsonText);
          } catch {
            continue;
          }

          const frameResult = hermesSseFrameWireSchema.safeParse(parsedObj);
          if (!frameResult.success) continue;
          const frame = frameResult.data;
          const seq = frame.seq ?? lastIdSeq ?? 0;
          const timestamp = frame.timestamp ?? Date.now() / 1000;

          // Explicitly drop hidden model reasoning frames (`reasoning.available`)
          if (frame.event === 'reasoning.available') {
            continue;
          }

          const mapped = this.mapSseEvent(frame, seq, timestamp);
          if (mapped) {
            emittedCount += 1;
            yield mapped;
            if (mapped.type === 'run.terminal') {
              streamClosed = true;
              break;
            }
          }
        }
      }

      await reader.cancel().catch(() => undefined);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw AppError.unavailable(
        `HERMES_SSE_ERROR: ${err instanceof Error ? err.message : 'stream failed'}`,
      );
    } finally {
      cleanup();
    }
  }

  private mapSseEvent(
    frame: z.infer<typeof hermesSseFrameWireSchema>,
    seq: number,
    timestamp: number,
  ): AgentRunEvent | null {
    const raw = frame as Record<string, unknown>;
    switch (frame.event) {
      case 'message.delta':
        return {
          type: 'message.delta',
          externalRunId: frame.run_id,
          seq,
          timestamp,
          delta: typeof raw.delta === 'string' ? stripHiddenReasoning(raw.delta) : '',
        };
      case 'message.interim':
        return {
          type: 'message.interim',
          externalRunId: frame.run_id,
          seq,
          timestamp,
          text: typeof raw.text === 'string' ? stripHiddenReasoning(raw.text) : '',
        };
      case 'tool.started':
        return {
          type: 'tool.started',
          externalRunId: frame.run_id,
          seq,
          timestamp,
          tool: typeof raw.tool === 'string' ? raw.tool : 'unknown',
          toolCallId: typeof raw.tool_call_id === 'string' ? raw.tool_call_id : null,
        };
      case 'tool.completed':
        return {
          type: 'tool.completed',
          externalRunId: frame.run_id,
          seq,
          timestamp,
          tool: typeof raw.tool === 'string' ? raw.tool : 'unknown',
          toolCallId: typeof raw.tool_call_id === 'string' ? raw.tool_call_id : null,
          durationMs:
            typeof raw.duration === 'number' && Number.isFinite(raw.duration)
              ? Math.round(raw.duration)
              : null,
          failed: Boolean(raw.error),
        };
      case 'subagent.start':
        return {
          type: 'subagent.start',
          externalRunId: frame.run_id,
          seq,
          timestamp,
          subagentId: typeof raw.subagent_id === 'string' ? raw.subagent_id : 'unknown',
          childSessionId: typeof raw.child_session_id === 'string' ? raw.child_session_id : null,
          delegationId: typeof raw.delegation_id === 'string' ? raw.delegation_id : null,
          depth: typeof raw.depth === 'number' ? raw.depth : 1,
          model: typeof raw.model === 'string' ? raw.model : null,
        };
      case 'subagent.complete':
        return {
          type: 'subagent.complete',
          externalRunId: frame.run_id,
          seq,
          timestamp,
          subagentId: typeof raw.subagent_id === 'string' ? raw.subagent_id : 'unknown',
          childSessionId: typeof raw.child_session_id === 'string' ? raw.child_session_id : null,
          delegationId: typeof raw.delegation_id === 'string' ? raw.delegation_id : null,
          status: typeof raw.status === 'string' ? raw.status : 'completed',
          inputTokens: typeof raw.input_tokens === 'number' ? raw.input_tokens : 0,
          outputTokens: typeof raw.output_tokens === 'number' ? raw.output_tokens : 0,
          apiCalls: typeof raw.api_calls === 'number' ? raw.api_calls : 0,
          costUsd: typeof raw.cost_usd === 'number' ? raw.cost_usd : 0,
        };
      case 'replay.truncated':
        return {
          type: 'replay.truncated',
          externalRunId: frame.run_id,
          seq,
          timestamp,
          oldestRetainedSeq:
            typeof raw.oldest_retained_seq === 'number' ? raw.oldest_retained_seq : 0,
          requestedSeq: typeof raw.requested_seq === 'number' ? raw.requested_seq : 0,
        };
      case 'run.completed':
      case 'run.failed':
      case 'run.cancelled':
      case 'run.interrupted': {
        const usageParsed = hermesUsageWireSchema.safeParse(raw.usage);
        return {
          type: 'run.terminal',
          externalRunId: frame.run_id,
          seq,
          timestamp,
          status:
            frame.event === 'run.completed'
              ? 'completed'
              : frame.event === 'run.failed'
                ? 'failed'
                : 'cancelled',
          output: typeof raw.output === 'string' ? stripHiddenReasoning(raw.output) : null,
          error: typeof raw.error === 'string' ? raw.error : null,
          usage: usageParsed.success ? mapUsage(usageParsed.data) : null,
        };
      }
      default:
        return null;
    }
  }

  async runtimeCapabilities(callerSignal?: AbortSignal): Promise<AgentRuntimeCapabilities> {
    if (!this.isConfigured() || !this.config.baseUrl || !this.config.apiKey) {
      return {
        status: 'NOT_CONFIGURED',
        runtimeName: 'hermes',
        pinnedVersion: HERMES_PINNED_VERSION,
        reportedVersion: null,
        runSubmission: false,
        runStatus: false,
        runEventsSse: false,
        runStop: false,
        preventiveHooksVerified: false,
        delegationSupported: false,
        delegationLimitationReason: 'Hermes runtime is not configured (HERMES_ENABLED=false or credentials absent).',
        enabledToolsets: [],
        forbiddenToolsDetected: [],
        implicitFallbackDetected: false,
      };
    }

    const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
    const apiKey = this.config.apiKey;
    const { signal, cleanup } = this.buildSignal(this.config.requestTimeoutMs, callerSignal);

    try {
      const authHeaders = {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      };
      const [capRes, toolsetsRes] = await Promise.all([
        this.fetchImpl(`${baseUrl}/v1/capabilities`, { method: 'GET', headers: authHeaders, signal }),
        this.fetchImpl(`${baseUrl}/v1/toolsets`, { method: 'GET', headers: authHeaders, signal }),
      ]);

      if (!capRes.ok || !toolsetsRes.ok) {
        return {
          status: 'UNAVAILABLE',
          runtimeName: 'hermes',
          pinnedVersion: HERMES_PINNED_VERSION,
          reportedVersion: null,
          runSubmission: false,
          runStatus: false,
          runEventsSse: false,
          runStop: false,
          preventiveHooksVerified: false,
          delegationSupported: false,
          delegationLimitationReason: `Hermes capability inspection failed (${capRes.status}/${toolsetsRes.status}).`,
          enabledToolsets: [],
          forbiddenToolsDetected: [],
          implicitFallbackDetected: false,
        };
      }

      const capJson = hermesCapabilitiesWireSchema.parse(await capRes.json());
      const toolsetsJson = hermesToolsetsWireSchema.parse(await toolsetsRes.json());

      const enabledToolsets: string[] = [];
      const forbiddenToolsDetected = new Set<string>();
      let vaargPluginToolsetPresent = false;

      for (const ts of toolsetsJson.data) {
        if (!ts.enabled) continue;
        enabledToolsets.push(ts.name);
        if (ts.name === 'vaarg_confinement' || ts.name === 'vaarg_broker') {
          vaargPluginToolsetPresent = true;
        }
        if (FORBIDDEN_RUNTIME_TOOLS.has(ts.name)) {
          forbiddenToolsDetected.add(ts.name);
        }
        for (const toolName of ts.tools) {
          if (FORBIDDEN_RUNTIME_TOOLS.has(toolName)) {
            forbiddenToolsDetected.add(toolName);
          }
        }
      }

      const pluginHeaderAttested = capRes.headers.get('x-vaarg-confinement') === 'active';
      const preventiveHooksVerified = Boolean(
        (capJson.vaarg_confinement_plugin?.active &&
          capJson.vaarg_confinement_plugin?.preventive_hooks) ||
          (vaargPluginToolsetPresent && pluginHeaderAttested),
      );
      const implicitFallbackDetected = Boolean(
        capJson.fallback_providers && capJson.fallback_providers.length > 0,
      );

      const unsafe = forbiddenToolsDetected.size > 0 || implicitFallbackDetected;
      const delegationSupported =
        !unsafe &&
        enabledToolsets.includes('delegation') &&
        (preventiveHooksVerified || !this.config.requirePreventivePlugin);

      const delegationLimitationReason = unsafe
        ? `Unsafe runtime confinement detected: ${[...forbiddenToolsDetected].join(', ') || 'implicit fallback enabled'}`
        : !preventiveHooksVerified
          ? 'Preventive budget and child-registration hooks (vaarg-confinement plugin) are not attested on Hermes; unrestricted delegation is disabled.'
          : !enabledToolsets.includes('delegation')
            ? 'Hermes delegation toolset is not enabled on runtime.'
            : null;

      return {
        status: unsafe ? 'UNSAFE_CONFINEMENT' : 'AVAILABLE',
        runtimeName: 'hermes',
        pinnedVersion: HERMES_PINNED_VERSION,
        reportedVersion: capJson.version ?? null,
        runSubmission: capJson.features?.run_submission ?? true,
        runStatus: capJson.features?.run_status ?? true,
        runEventsSse: capJson.features?.run_events_sse ?? true,
        runStop: capJson.features?.run_stop ?? true,
        preventiveHooksVerified,
        delegationSupported,
        delegationLimitationReason,
        enabledToolsets,
        forbiddenToolsDetected: [...forbiddenToolsDetected],
        implicitFallbackDetected,
      };
    } catch (err) {
      return {
        status: 'UNAVAILABLE',
        runtimeName: 'hermes',
        pinnedVersion: HERMES_PINNED_VERSION,
        reportedVersion: null,
        runSubmission: false,
        runStatus: false,
        runEventsSse: false,
        runStop: false,
        preventiveHooksVerified: false,
        delegationSupported: false,
        delegationLimitationReason: err instanceof Error ? err.message : 'Hermes unreachable',
        enabledToolsets: [],
        forbiddenToolsDetected: [],
        implicitFallbackDetected: false,
      };
    } finally {
      cleanup();
    }
  }

  async readiness(signal?: AbortSignal): Promise<AgentRuntimeReadiness> {
    const capabilities = await this.runtimeCapabilities(signal);
    if (capabilities.status === 'NOT_CONFIGURED') {
      return {
        status: 'NOT_CONFIGURED',
        detail: 'Hermes runtime disabled or unconfigured; deterministic storefront remains active.',
        capabilities,
      };
    }
    if (capabilities.status !== 'AVAILABLE' || !capabilities.runSubmission || !capabilities.runStatus) {
      return {
        status: 'NOT_READY',
        detail:
          capabilities.delegationLimitationReason ??
          `Hermes runtime status is ${capabilities.status}`,
        capabilities,
      };
    }
    return {
      status: 'READY',
      detail: `Hermes ${capabilities.reportedVersion ?? capabilities.pinnedVersion} ready`,
      capabilities,
    };
  }
}
