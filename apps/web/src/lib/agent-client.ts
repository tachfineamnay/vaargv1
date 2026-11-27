import {
  EventType,
  VAARG_AGUI_CUSTOM_EVENTS,
  agentRunRecordSchema,
  agentUiActionResponseSchema,
  conversationMessageSchema,
  conversationSchema,
  conversationSummarySchema,
  parseSseFrameBlock,
  publishRunCompositionResultSchema,
  vaargAgUiStateSnapshotSchema,
  validatedAgentRunResultSchema,
  type A2UiAgentToRendererMessage,
  type A2UiRendererActionEnvelope,
  type AGUIEvent,
  type AgentRunRecord,
  type AgentUiActionResponse,
  type Conversation,
  type ConversationMessage,
  type ConversationSummary,
  type PublishRunCompositionInput,
  type PublishRunCompositionResult,
  type VaargAgUiStateSnapshot,
  type ValidatedAgentRunResult,
} from '@vaarg/shared';
import { StorefrontError, storefrontErrorFromResponse } from './errors';
import { notifyServerExperienceSync } from './experience-client';

export type AgentClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: StorefrontError };

const JSON_HEADERS = {
  accept: 'application/json',
  'content-type': 'application/json',
};

async function jsonRequest<T>(
  path: string,
  init: RequestInit,
  parse: (raw: unknown) => T,
): Promise<AgentClientResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, { cache: 'no-store', ...init });
  } catch {
    return { ok: false, error: new StorefrontError('network', 'Personal Shopper unreachable') };
  }

  const text = await response.text().catch(() => '');
  if (!response.ok) {
    return { ok: false, error: storefrontErrorFromResponse(response.status, text) };
  }

  try {
    const raw: unknown = text ? JSON.parse(text) : null;
    return { ok: true, data: parse(raw) };
  } catch {
    return {
      ok: false,
      error: new StorefrontError('invalid_response', 'Malformed Personal Shopper payload'),
    };
  }
}

export interface ActiveSessionConversationBundle {
  conversation: Conversation | null;
  messages: ConversationMessage[];
  summary: ConversationSummary | null;
  a2uiMessages: A2UiAgentToRendererMessage[];
}

export function fetchActiveConversation(
  signal?: AbortSignal,
): Promise<AgentClientResult<ActiveSessionConversationBundle>> {
  return jsonRequest(
    '/api/conversations/active',
    { headers: { accept: 'application/json' }, ...(signal ? { signal } : {}) },
    (raw) => {
      const obj = (raw ?? {}) as Record<string, unknown>;
      return {
        conversation: obj.conversation ? conversationSchema.parse(obj.conversation) : null,
        messages: Array.isArray(obj.messages)
          ? obj.messages.map((m) => conversationMessageSchema.parse(m))
          : [],
        summary: obj.summary ? conversationSummarySchema.parse(obj.summary) : null,
        a2uiMessages: Array.isArray(obj.a2uiMessages)
          ? (obj.a2uiMessages as A2UiAgentToRendererMessage[])
          : [],
      };
    },
  );
}

export function createConversation(options?: {
  reuseActive?: boolean;
}): Promise<AgentClientResult<Conversation>> {
  return jsonRequest(
    '/api/conversations',
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ reuseActive: options?.reuseActive ?? true }),
    },
    (raw) => conversationSchema.parse((raw as Record<string, unknown>).conversation),
  );
}

export function submitConversationMessage(params: {
  conversationId: string;
  content: string;
  idempotencyKey: string;
}): Promise<
  AgentClientResult<{ message: ConversationMessage; contextVersion: number; replayed: boolean }>
> {
  return jsonRequest(
    `/api/conversations/${encodeURIComponent(params.conversationId)}/messages`,
    {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        'Idempotency-Key': params.idempotencyKey,
      },
      body: JSON.stringify({
        content: params.content,
        idempotencyKey: params.idempotencyKey,
      }),
    },
    (raw) => {
      const obj = raw as Record<string, unknown>;
      return {
        message: conversationMessageSchema.parse(obj.message),
        contextVersion: Number(obj.contextVersion),
        replayed: Boolean(obj.replayed),
      };
    },
  );
}

export function startConversationRun(params: {
  conversationId: string;
  message?: string;
  triggerMessageId?: string;
  idempotencyKey: string;
}): Promise<
  AgentClientResult<{
    run: AgentRunRecord;
    delegationStatus: 'ENABLED' | 'DISABLED_CAPABILITY_LIMITATION';
    delegationLimitationReason: string | null;
  }>
> {
  return jsonRequest(
    `/api/conversations/${encodeURIComponent(params.conversationId)}/runs`,
    {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        'Idempotency-Key': params.idempotencyKey,
      },
      body: JSON.stringify({
        ...(params.message ? { message: params.message } : {}),
        ...(params.triggerMessageId ? { triggerMessageId: params.triggerMessageId } : {}),
        idempotencyKey: params.idempotencyKey,
      }),
    },
    (raw) => {
      const obj = raw as Record<string, unknown>;
      return {
        run: agentRunRecordSchema.parse(obj.run),
        delegationStatus:
          obj.delegationStatus === 'ENABLED' ? 'ENABLED' : 'DISABLED_CAPABILITY_LIMITATION',
        delegationLimitationReason:
          typeof obj.delegationLimitationReason === 'string'
            ? obj.delegationLimitationReason
            : null,
      };
    },
  );
}

export function fetchRunStatus(
  runId: string,
  signal?: AbortSignal,
): Promise<AgentClientResult<AgentRunRecord>> {
  return jsonRequest(
    `/api/agent/runs/${encodeURIComponent(runId)}`,
    { headers: { accept: 'application/json' }, ...(signal ? { signal } : {}) },
    (raw) => agentRunRecordSchema.parse((raw as Record<string, unknown>).run),
  );
}

export function fetchRunResult(
  runId: string,
  signal?: AbortSignal,
): Promise<
  AgentClientResult<ValidatedAgentRunResult & { a2uiMessages?: A2UiAgentToRendererMessage[] }>
> {
  return jsonRequest(
    `/api/agent/runs/${encodeURIComponent(runId)}/result`,
    { headers: { accept: 'application/json' }, ...(signal ? { signal } : {}) },
    (raw) => {
      const obj = raw as Record<string, unknown>;
      const validated = validatedAgentRunResultSchema.parse(obj);
      const a2uiMessages = Array.isArray(obj.a2uiMessages)
        ? (obj.a2uiMessages as A2UiAgentToRendererMessage[])
        : undefined;
      return {
        ...validated,
        ...(a2uiMessages ? { a2uiMessages } : {}),
      };
    },
  );
}

export async function publishRunComposition(
  runId: string,
  input: PublishRunCompositionInput & { sessionId?: string },
): Promise<AgentClientResult<PublishRunCompositionResult>> {
  const idem = input.idempotencyKey ?? `pub-${runId}-${input.proposalId ?? 'latest'}`;
  const res = await jsonRequest(
    `/api/agent/runs/${encodeURIComponent(runId)}/publish`,
    {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        'Idempotency-Key': idem,
      },
      body: JSON.stringify({
        ...(input.proposalId ? { proposalId: input.proposalId } : {}),
        ...(input.expectedContextVersion !== undefined
          ? { expectedContextVersion: input.expectedContextVersion }
          : {}),
        idempotencyKey: idem,
      }),
    },
    (raw) => publishRunCompositionResultSchema.parse(raw),
  );

  if (res.ok && res.data.published) {
    notifyServerExperienceSync({
      sessionId: res.data.composition.sessionId,
      contextVersion: res.data.contextVersion,
      experienceRevision: res.data.experienceRevision,
    });
  }
  return res;
}

export function cancelAgentRun(runId: string): Promise<AgentClientResult<AgentRunRecord>> {
  return jsonRequest(
    `/api/agent/runs/${encodeURIComponent(runId)}/cancel`,
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{}',
    },
    (raw) => agentRunRecordSchema.parse((raw as Record<string, unknown>).run),
  );
}

export async function dispatchControlledUiAction(params: {
  sessionId: string;
  envelope: A2UiRendererActionEnvelope;
  idempotencyKey: string;
}): Promise<AgentClientResult<AgentUiActionResponse>> {
  const res = await jsonRequest(
    '/api/agent/actions',
    {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        'Idempotency-Key': params.idempotencyKey,
      },
      body: JSON.stringify(params.envelope),
    },
    (raw) => agentUiActionResponseSchema.parse(raw),
  );

  if (res.ok && res.data.status === 'APPLIED') {
    notifyServerExperienceSync({
      sessionId: params.sessionId,
      contextVersion: res.data.contextVersion,
      experienceRevision: res.data.experienceRevision,
    });
  }
  return res;
}

export interface AgUiStreamHandlers {
  onTextDelta?: (delta: string, messageId: string) => void;
  onStepChange?: (stepName: string, active: boolean) => void;
  onToolEvent?: (toolName: string, status: 'started' | 'completed') => void;
  onA2UiMessage?: (message: A2UiAgentToRendererMessage) => void;
  onProposalReady?: (proposal: {
    proposalId: string;
    proposalType: string;
    status: string;
    requiresConfirmation: boolean;
    contextVersion: number;
  }) => void;
  onStateSync?: (state: VaargAgUiStateSnapshot) => void;
  onResyncRequired?: () => void;
  onReconnecting?: (attempt: number) => void;
  onTerminal?: (
    outcome:
      | { kind: 'finished'; status: 'success' | 'cancelled' }
      | { kind: 'error'; code: string | null; message: string },
  ) => void;
}

function applyStateDelta(
  current: VaargAgUiStateSnapshot | null,
  ops: Array<{ op: string; path: string; value?: unknown }>,
): VaargAgUiStateSnapshot | null {
  if (!current) return null;
  const clone: Record<string, unknown> = { ...current };
  for (const op of ops) {
    if ((op.op === 'replace' || op.op === 'add') && op.path.startsWith('/')) {
      const key = op.path.slice(1);
      clone[key] = op.value;
    }
  }
  const parsed = vaargAgUiStateSnapshotSchema.safeParse(clone);
  return parsed.success ? parsed.data : current;
}

/**
 * Consumes an AG-UI 1.0.5 SSE stream for `runId` with monotonic `eventSeq`
 * deduplication, `Last-Event-ID` cursor resume, bounded retry backoff, and
 * automatic `ExperienceContext` revision synchronization.
 */
export async function consumeAgUiRunStream(params: {
  runId: string;
  signal: AbortSignal;
  handlers: AgUiStreamHandlers;
  maxReconnects?: number;
}): Promise<void> {
  const { runId, signal, handlers } = params;
  const maxReconnects = params.maxReconnects ?? 3;
  let lastSeq = 0;
  let lastEventId: string | null = null;
  let currentState: VaargAgUiStateSnapshot | null = null;
  let sawTerminal = false;
  let attempt = 0;
  const toolNamesByCallId = new Map<string, string>();

  const dispatchEvent = (event: AGUIEvent) => {
    switch (event.type) {
      case EventType.TEXT_MESSAGE_CONTENT: {
        const e = event as unknown as { messageId: string; delta: string };
        handlers.onTextDelta?.(e.delta, e.messageId);
        break;
      }
      case EventType.STEP_STARTED: {
        const e = event as unknown as { stepName: string };
        handlers.onStepChange?.(e.stepName, true);
        break;
      }
      case EventType.STEP_FINISHED: {
        const e = event as unknown as { stepName: string };
        handlers.onStepChange?.(e.stepName, false);
        break;
      }
      case EventType.TOOL_CALL_START: {
        const e = event as unknown as { toolCallId: string; toolCallName: string };
        toolNamesByCallId.set(e.toolCallId, e.toolCallName);
        handlers.onToolEvent?.(e.toolCallName, 'started');
        break;
      }
      case EventType.TOOL_CALL_END: {
        const e = event as unknown as { toolCallId: string };
        const name = toolNamesByCallId.get(e.toolCallId) ?? 'catalog';
        handlers.onToolEvent?.(name, 'completed');
        break;
      }
      case EventType.STATE_SNAPSHOT: {
        const e = event as unknown as { snapshot: unknown };
        const parsed = vaargAgUiStateSnapshotSchema.safeParse(e.snapshot);
        if (parsed.success) {
          currentState = parsed.data;
          notifyServerExperienceSync({
            sessionId: parsed.data.sessionId,
            contextVersion: parsed.data.contextVersion,
            experienceRevision: parsed.data.experienceRevision,
          });
          handlers.onStateSync?.(parsed.data);
        }
        break;
      }
      case EventType.STATE_DELTA: {
        const e = event as unknown as {
          delta: Array<{ op: string; path: string; value?: unknown }>;
        };
        const updated = applyStateDelta(currentState, e.delta);
        if (updated) {
          currentState = updated;
          notifyServerExperienceSync({
            sessionId: updated.sessionId,
            contextVersion: updated.contextVersion,
            experienceRevision: updated.experienceRevision,
          });
          handlers.onStateSync?.(updated);
        }
        break;
      }
      case EventType.CUSTOM: {
        const e = event as unknown as { name: string; value: unknown };
        if (e.name === VAARG_AGUI_CUSTOM_EVENTS.A2UI_MESSAGE && e.value) {
          handlers.onA2UiMessage?.(e.value as A2UiAgentToRendererMessage);
        } else if (
          e.name === VAARG_AGUI_CUSTOM_EVENTS.PROPOSAL_READY &&
          e.value &&
          typeof e.value === 'object'
        ) {
          const p = e.value as Record<string, unknown>;
          handlers.onProposalReady?.({
            proposalId: String(p.proposalId ?? ''),
            proposalType: String(p.proposalType ?? ''),
            status: String(p.status ?? 'proposed'),
            requiresConfirmation: Boolean(p.requiresConfirmation),
            contextVersion: Number(p.contextVersion ?? 0),
          });
        } else if (e.name === VAARG_AGUI_CUSTOM_EVENTS.RESYNC_REQUIRED) {
          handlers.onResyncRequired?.();
        } else if (
          e.name === VAARG_AGUI_CUSTOM_EVENTS.CONTEXT_SYNC &&
          e.value &&
          typeof e.value === 'object' &&
          currentState
        ) {
          const c = e.value as Record<string, unknown>;
          notifyServerExperienceSync({
            sessionId: currentState.sessionId,
            contextVersion: Number(c.contextVersion ?? currentState.contextVersion),
            experienceRevision: Number(c.experienceRevision ?? currentState.experienceRevision),
          });
        }
        break;
      }
      case EventType.RUN_FINISHED: {
        sawTerminal = true;
        const e = event as unknown as { outcome?: { type?: string } };
        handlers.onTerminal?.({
          kind: 'finished',
          status: e.outcome?.type === 'cancelled' ? 'cancelled' : 'success',
        });
        break;
      }
      case EventType.RUN_ERROR: {
        sawTerminal = true;
        const e = event as unknown as { message?: string; code?: string };
        handlers.onTerminal?.({
          kind: 'error',
          code: e.code ?? null,
          message: e.message ?? 'Personal Shopper run ended with an error.',
        });
        break;
      }
    }
  };

  while (!sawTerminal && !signal.aborted && attempt <= maxReconnects) {
    if (attempt > 0) {
      handlers.onReconnecting?.(attempt);
      const backoffMs = Math.min(2_500, 300 * 2 ** (attempt - 1));
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, backoffMs);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      if (signal.aborted) return;
    }

    const headers: Record<string, string> = { accept: 'text/event-stream' };
    if (lastEventId) headers['Last-Event-ID'] = lastEventId;
    const url =
      lastSeq > 0
        ? `/api/agent/runs/${encodeURIComponent(runId)}/events?afterSeq=${lastSeq}`
        : `/api/agent/runs/${encodeURIComponent(runId)}/events`;

    try {
      const response = await fetch(url, {
        headers,
        cache: 'no-store',
        signal,
      });

      if (!response.ok || !response.body) {
        attempt += 1;
        continue;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!sawTerminal && !signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIndex = buffer.indexOf('\n\n');
        while (sepIndex !== -1) {
          const rawBlock = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          const frame = parseSseFrameBlock(rawBlock, runId);
          if (frame.seq > 0) {
            if (frame.seq <= lastSeq) {
              sepIndex = buffer.indexOf('\n\n');
              continue;
            }
            lastSeq = frame.seq;
            if (frame.id) lastEventId = frame.id;
          }
          if (frame.event) {
            dispatchEvent(frame.event);
          }
          sepIndex = buffer.indexOf('\n\n');
        }
      }
    } catch {
      if (signal.aborted) return;
    }

    if (!sawTerminal && !signal.aborted) {
      attempt += 1;
    }
  }
}
