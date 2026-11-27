import {
  adaptiveCompositionSchema,
  experienceContextResponseSchema,
  interactionIngestResultSchema,
  isStaleResponse,
  searchResultSchema,
  type AdaptiveComposition,
  type ExperienceContext,
  type InteractionEvent,
  type InteractionIngestResult,
  type RevisionEnvelope,
  type SearchResult,
} from '@vaarg/shared';
import { StorefrontError, storefrontErrorFromResponse } from './errors';

/**
 * FL05 browser experience client (Task 13). Calls the constrained
 * same-origin experience BFF routes, validates every payload with the
 * shared Zod contracts, and applies the SHARED stale-response rule
 * (`isStaleResponse`) before returning data: an obsolete contextVersion, an
 * older experienceRevision or another session's envelope is rejected, never
 * applied. This mirrors the server-side EXP-03 protections in the browser.
 */

export type ExperienceResult<T> = { ok: true; data: T } | { ok: false; error: StorefrontError };

/** One tab-scoped observable; SessionProvider owns identity, reporters publish
 * accepted changes, adaptive boundaries subscribe without moving UI state. */
let snapshot = { sessionId: null as string | null, epoch: 0, update: 0, suspended: false };
const listeners = new Set<() => void>();
const pending = new Map<AbortController, boolean>();
const serverSnapshot = snapshot;
export const subscribeExperience = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const experienceSnapshot = () => snapshot;
export const experienceServerSnapshot = () => serverSnapshot;
function emit(): void { for (const listener of listeners) listener(); }
export function cancelExperience(suspend = false, preserveKeepalive = false): void {
  for (const [controller, keepalive] of pending) {
    if (preserveKeepalive && keepalive) continue;
    controller.abort();
    pending.delete(controller);
  }
  snapshot = { ...snapshot, epoch: snapshot.epoch + 1, suspended: suspend || snapshot.suspended };
  emit();
}
export function bindExperienceSession(sessionId: string | null): void {
  if (snapshot.sessionId === sessionId) return;
  cancelExperience();
  lastApplied = null;
  snapshot = { sessionId, epoch: snapshot.epoch + 1, update: 0, suspended: false };
  emit();
}
function acceptedInteraction(): void {
  snapshot = { ...snapshot, update: snapshot.update + 1, suspended: false };
  emit();
}

/** Last applied revision envelope — module scope mirrors a single tab. */
let lastApplied: RevisionEnvelope | null = null;

export function setLastAppliedRevision(envelope: RevisionEnvelope | null): void {
  lastApplied = envelope;
}

export function lastAppliedRevision(): RevisionEnvelope | null {
  return lastApplied;
}

async function request<T>(
  path: string,
  init: RequestInit,
  parse: (raw: unknown) => T,
  options: { staleCheck?: (data: T) => RevisionEnvelope } = {},
): Promise<ExperienceResult<T>> {
  const identity = snapshot.sessionId ?? lastApplied?.sessionId ?? null;
  const epoch = snapshot.epoch;
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  pending.set(controller, init.keepalive === true);
  try {
    let response: Response;
    try {
      response = await fetch(path, { cache: 'no-store', ...init, signal: controller.signal });
    } catch {
      return { ok: false, error: new StorefrontError('network', 'Experience API unreachable') };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { ok: false, error: storefrontErrorFromResponse(response.status, text) };
    }
    let raw: unknown;
    try {
      const text = await response.text();
      raw = text ? JSON.parse(text) : null;
    } catch {
      return { ok: false, error: new StorefrontError('invalid_response', 'Malformed experience payload') };
    }
    try {
      if (controller.signal.aborted || epoch !== snapshot.epoch ||
          (snapshot.sessionId !== null && identity !== snapshot.sessionId)) {
        return { ok: false, error: new StorefrontError('conflict', 'Obsolete experience request') };
      }
      const data = parse(raw);
      if (options.staleCheck) {
        const envelope = options.staleCheck(data);
        // Unknown-session envelopes (pre-context bootstrap) cannot poison the
        // monotonic guard: they are applied but do not regress lastApplied.
        if (envelope.sessionId) {
          if ((identity && identity !== envelope.sessionId) || isStaleResponse(lastApplied, envelope)) {
            // EXP-03 browser half: an obsolete response is rejected, not applied.
            return { ok: false, error: new StorefrontError('conflict', 'Stale experience response rejected') };
          }
          lastApplied = envelope;
        }
      }
      return { ok: true, data };
    } catch {
      return { ok: false, error: new StorefrontError('invalid_response', 'Experience response failed contract validation') };
    }
  } finally {
    pending.delete(controller);
    init.signal?.removeEventListener('abort', abort);
  }
}

const jsonHeaders = { accept: 'application/json', 'content-type': 'application/json' };

export function fetchExperienceContext(): Promise<ExperienceResult<ExperienceContext>> {
  return request(
    '/api/experience/context',
    { headers: { accept: 'application/json' } },
    (raw) => experienceContextResponseSchema.parse(raw).context,
    {
      staleCheck: (context) => ({
        sessionId: context.session.sessionId,
        contextVersion: context.contextVersion,
        experienceRevision: context.experienceRevision,
      }),
    },
  );
}

export async function ingestInteractions(
  events: InteractionEvent[],
  expectedContextVersion?: number,
  options: { keepalive?: boolean } = {},
): Promise<ExperienceResult<InteractionIngestResult>> {
  const sessionId = snapshot.sessionId ?? lastApplied?.sessionId ?? '';
  const result = await request(
    '/api/experience/events',
    {
      method: 'POST',
      headers: jsonHeaders,
      // `keepalive` lets navigation-triggered reports (search, filters)
      // survive the page transition without debouncing or dropping them.
      keepalive: options.keepalive ?? false,
      body: JSON.stringify({
        events,
        ...(expectedContextVersion !== undefined ? { expectedContextVersion } : {}),
      }),
    },
    (raw) => interactionIngestResultSchema.parse(raw),
    {
      // Ingest results carry no session id (server scoped them); monotonic
      // ordering uses the last applied envelope's session when known.
      staleCheck: (result) => ({
        sessionId,
        contextVersion: result.contextVersion,
        experienceRevision: result.experienceRevision,
      }),
    },
  );
  if (result.ok && result.data.accepted > 0) acceptedInteraction();
  return result;
}

export function fetchExperienceSearch(
  params: Record<string, string>,
): Promise<ExperienceResult<SearchResult>> {
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, value]) => value.length > 0)),
  ).toString();
  return request(
    `/api/experience/search${query ? `?${query}` : ''}`,
    { headers: { accept: 'application/json' } },
    (raw) => searchResultSchema.parse(raw),
  );
}

export function fetchExperienceComposition(
  compare?: string[],
  signal?: AbortSignal,
): Promise<ExperienceResult<AdaptiveComposition>> {
  const query = compare && compare.length >= 2 ? `?compare=${encodeURIComponent(compare.join(','))}` : '';
  return request(
    `/api/experience/composition${query}`,
    { headers: { accept: 'application/json' }, ...(signal ? { signal } : {}) },
    (raw) => adaptiveCompositionSchema.parse(raw),
    {
      staleCheck: (composition) => ({
        sessionId: composition.sessionId,
        contextVersion: composition.contextVersion,
        experienceRevision: composition.experienceRevision,
      }),
    },
  );
}

export function refreshExperienceComposition(input: {
  expectedContextVersion?: number;
  compare?: string[];
}): Promise<ExperienceResult<AdaptiveComposition>> {
  return request(
    '/api/experience/refresh',
    { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) },
    (raw) => adaptiveCompositionSchema.parse(raw),
    {
      staleCheck: (composition) => ({
        sessionId: composition.sessionId,
        contextVersion: composition.contextVersion,
        experienceRevision: composition.experienceRevision,
      }),
    },
  );
}

export function resetExploration(): Promise<ExperienceResult<InteractionIngestResult>> {
  cancelExperience(true);
  const sessionId = snapshot.sessionId ?? lastApplied?.sessionId ?? '';
  return request(
    '/api/experience/reset',
    { method: 'POST', headers: jsonHeaders, body: '{}' },
    (raw) => interactionIngestResultSchema.parse(raw),
    {
      staleCheck: (result) => ({
        sessionId,
        contextVersion: result.contextVersion,
        experienceRevision: result.experienceRevision,
      }),
    },
  );
}
