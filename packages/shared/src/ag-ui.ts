import {
  EventType,
  PROTOCOL_VERSION as AG_UI_PROTOCOL_VERSION,
  type AGUIEvent,
  type BaseEvent,
  type JsonPatchOperation,
} from '@ag-ui/core';
import { EventSchema } from '@ag-ui/core/schemas';
import { z } from 'zod';
import { isValidA2UiAgentMessage } from './a2ui-validator.js';
import { explorationCriteriaSchema, experienceMarketSchema } from './experience.js';

export { AG_UI_PROTOCOL_VERSION, EventSchema, EventType };
export type { AGUIEvent, BaseEvent, JsonPatchOperation };

/**
 * Explicit versioned VAARG custom event namespaces carried inside AG-UI `EventType.CUSTOM`.
 */
export const VAARG_AGUI_CUSTOM_EVENTS = Object.freeze({
  A2UI_MESSAGE: 'vaarg.a2ui.v1.message',
  PROPOSAL_READY: 'vaarg.proposal.v1.ready',
  RESYNC_REQUIRED: 'vaarg.run.v1.resync_required',
  CONTEXT_SYNC: 'vaarg.context.v1.sync',
} as const);

/**
 * AG-UI event types that MUST NEVER be emitted to browsers (hidden reasoning,
 * encrypted reasoning, raw provider frames, or raw tool-call argument streams).
 */
export const FORBIDDEN_BROWSER_AGUI_EVENT_TYPES: ReadonlySet<string> = new Set([
  EventType.REASONING_START,
  EventType.REASONING_MESSAGE_START,
  EventType.REASONING_MESSAGE_CONTENT,
  EventType.REASONING_MESSAGE_END,
  EventType.REASONING_MESSAGE_CHUNK,
  EventType.REASONING_END,
  EventType.REASONING_ENCRYPTED_VALUE,
  EventType.RAW,
  EventType.TOOL_CALL_ARGS,
  EventType.TOOL_CALL_CHUNK,
]);

export const vaargAgUiStateSnapshotSchema = z
  .object({
    sessionId: z.string().uuid(),
    conversationId: z.string().uuid(),
    runId: z.string().uuid(),
    contextVersion: z.number().int().nonnegative(),
    experienceRevision: z.number().int().nonnegative(),
    market: experienceMarketSchema,
    exploration: explorationCriteriaSchema,
    comparisonProductIds: z.array(z.string().startsWith('gid://shopify/Product/')).max(4),
    personalizationGranted: z.boolean(),
    delegationStatus: z.enum(['ENABLED', 'DISABLED_CAPABILITY_LIMITATION', 'NOT_REQUESTED']),
    activeProposalIds: z.array(z.string().uuid()).max(20),
    publishedExperienceRevision: z.number().int().nonnegative().nullable(),
    stale: z.boolean(),
  })
  .strict();
export type VaargAgUiStateSnapshot = z.infer<typeof vaargAgUiStateSnapshotSchema>;

/**
 * Computes a minimal RFC 6902 JSON Patch (`STATE_DELTA`) between two validated
 * `VaargAgUiStateSnapshot` objects so clients synchronize monotonically.
 */
export function computeAgUiStateDelta(
  previous: VaargAgUiStateSnapshot,
  next: VaargAgUiStateSnapshot,
): JsonPatchOperation[] {
  const ops: JsonPatchOperation[] = [];
  const keys = Object.keys(next) as Array<keyof VaargAgUiStateSnapshot>;
  for (const key of keys) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      ops.push({
        op: 'replace',
        path: `/${String(key)}`,
        value: next[key],
      });
    }
  }
  return ops;
}

/**
 * Validates that an AG-UI event conforms to the official `@ag-ui/core@1.0.5`
 * `EventSchema` AND obeys VAARG's browser confinement rules:
 * - Zero reasoning events, raw events, or raw tool argument streams;
 * - `TEXT_MESSAGE_*` never attributed to a child specialist (`subagentRunId` forbidden);
 * - `CUSTOM` events restricted to explicit `vaarg.*` versioned namespaces;
 * - `vaarg.a2ui.v1.message` custom events validated as A2UI 1.0 wire messages.
 */
export function validateSafeAgUiEvent(raw: unknown): {
  ok: true;
  event: AGUIEvent;
} | {
  ok: false;
  reason: string;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'AG-UI event must be an object' };
  }
  const typeVal = (raw as Record<string, unknown>).type;
  if (typeof typeVal !== 'string' || FORBIDDEN_BROWSER_AGUI_EVENT_TYPES.has(typeVal)) {
    return {
      ok: false,
      reason: `AG-UI event type "${String(typeVal)}" is forbidden on the visitor boundary`,
    };
  }

  const parsed = EventSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: `Official @ag-ui/core EventSchema rejected event: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    };
  }

  const event = parsed.data;
  if (
    (event.type === EventType.TEXT_MESSAGE_START ||
      event.type === EventType.TEXT_MESSAGE_CONTENT ||
      event.type === EventType.TEXT_MESSAGE_END ||
      event.type === EventType.TEXT_MESSAGE_CHUNK) &&
    event.subagentRunId !== undefined
  ) {
    return {
      ok: false,
      reason: 'Only the Master Personal Shopper may emit visitor-facing text messages',
    };
  }

  if (event.type === EventType.CUSTOM) {
    const allowedCustom = new Set<string>(Object.values(VAARG_AGUI_CUSTOM_EVENTS));
    if (!allowedCustom.has(event.name)) {
      return {
        ok: false,
        reason: `Unrecognized custom AG-UI event namespace "${event.name}"`,
      };
    }
    if (
      event.name === VAARG_AGUI_CUSTOM_EVENTS.A2UI_MESSAGE &&
      !isValidA2UiAgentMessage(event.value)
    ) {
      return {
        ok: false,
        reason: 'Custom A2UI event payload failed A2UI 1.0 wire security check',
      };
    }
  }

  return { ok: true, event: event as unknown as AGUIEvent };
}

export interface PersistedAgUiStreamEnvelope {
  eventSeq: number;
  eventId: string;
  runId: string;
  event: AGUIEvent;
}

/**
 * Parses an SSE stream cursor (`Last-Event-ID` or `afterSeq`), supporting either
 * plain integer sequences (`"12"`) or scoped IDs (`"<runId>:12"`).
 */
export function parseAgUiStreamCursor(
  rawCursor: string | null | undefined,
  expectedRunId?: string,
): number {
  if (!rawCursor) return 0;
  const trimmed = rawCursor.trim();
  if (!trimmed) return 0;
  if (/^\d+$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
  }
  const colonIdx = trimmed.lastIndexOf(':');
  if (colonIdx > 0) {
    const prefix = trimmed.slice(0, colonIdx);
    const seqPart = trimmed.slice(colonIdx + 1);
    if (expectedRunId && prefix !== expectedRunId) return 0;
    if (/^\d+$/.test(seqPart)) {
      const n = Number.parseInt(seqPart, 10);
      return Number.isSafeInteger(n) && n >= 0 ? n : 0;
    }
  }
  return 0;
}

export interface ParsedSseFrame {
  id: string | null;
  seq: number;
  comment: string | null;
  event: AGUIEvent | null;
}

/**
 * Incremental browser/client SSE frame parser for AG-UI streams.
 */
export function parseSseFrameBlock(rawFrame: string, expectedRunId?: string): ParsedSseFrame {
  const lines = rawFrame.split(/\r?\n/);
  let id: string | null = null;
  const comments: string[] = [];
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith(':')) {
      comments.push(line.slice(1).trim());
      continue;
    }
    if (line.startsWith('id:')) {
      id = line.slice(3).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  const seq = parseAgUiStreamCursor(id, expectedRunId);
  if (dataLines.length === 0) {
    return {
      id,
      seq,
      comment: comments.length > 0 ? comments.join('\n') : null,
      event: null,
    };
  }

  try {
    const parsedJson = JSON.parse(dataLines.join('\n')) as unknown;
    const checked = validateSafeAgUiEvent(parsedJson);
    if (!checked.ok) {
      return { id, seq, comment: null, event: null };
    }
    return { id, seq, comment: null, event: checked.event };
  } catch {
    return { id, seq, comment: null, event: null };
  }
}
