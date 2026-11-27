import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bindExperienceSession, cancelExperience, experienceSnapshot, fetchExperienceComposition,
  ingestInteractions, lastAppliedRevision, resetExploration, subscribeExperience,
} from '../src/lib/experience-client';
import type { AdaptiveComposition } from '@vaarg/shared';

const sessionId = '00000000-0000-4000-8000-0000000000aa';
const composition = (contextVersion = 1): AdaptiveComposition => ({
  sessionId, contextVersion, experienceRevision: 0, mode: 'adaptive', adaptationReason: 'explicit_criteria',
  freshness: '2026-11-27T10:00:00.000Z', sections: [{ id: 'suggestions', component: 'SuggestionChips', chips: [{ label: 'Rings', href: '/collections/rings' }] }],
});
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const accepted = { accepted: 1, duplicates: 0, rejected: 0, contextVersion: 1, experienceRevision: 0 };

afterEach(() => { bindExperienceSession(null); vi.unstubAllGlobals(); });

describe('FL05-FIX observable request lifecycle', () => {
  it('notifies every accepted interaction, not duplicate-only responses', async () => {
    bindExperienceSession(sessionId);
    const listener = vi.fn();
    const unsubscribe = subscribeExperience(listener);
    vi.stubGlobal('fetch', vi.fn(async () => json(accepted)));
    await ingestInteractions([{ eventId: crypto.randomUUID(), type: 'category_selected', category: 'rings' }]);
    expect(listener).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...accepted, accepted: 0, duplicates: 1 })));
    await ingestInteractions([{ eventId: crypto.randomUUID(), type: 'search_submitted', query: 'ring' }]);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('rejects responses from the old session and resets revision tracking on rotation', async () => {
    bindExperienceSession(sessionId);
    let finish!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_path, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>(resolve => { finish = resolve; });
    }));
    const pending = fetchExperienceComposition();
    bindExperienceSession('00000000-0000-4000-8000-0000000000bb');
    expect(signal?.aborted).toBe(true);
    finish(json(composition(99))); // Simulates a transport ignoring cancellation.
    expect((await pending).ok).toBe(false);
    expect(lastAppliedRevision()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...composition(0), sessionId: experienceSnapshot().sessionId })));
    expect((await fetchExperienceComposition()).ok).toBe(true);
    expect(lastAppliedRevision()?.contextVersion).toBe(0);
  });

  it('cancels in-flight composition on reset and keeps adaptive content suspended', async () => {
    bindExperienceSession(sessionId);
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn((path: string) => path.endsWith('/reset')
      ? Promise.resolve(json(accepted))
      : new Promise<Response>(resolve => { finish = resolve; })));
    const pending = fetchExperienceComposition();
    expect((await resetExploration()).ok).toBe(true);
    finish(json(composition(0)));
    expect((await pending).ok).toBe(false);
    expect(experienceSnapshot().suspended).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...accepted, contextVersion: 2 })));
    await ingestInteractions([{ eventId: crypto.randomUUID(), type: 'search_submitted', query: 'new exploration' }]);
    expect(experienceSnapshot().suspended).toBe(false);
  });

  it('rejects pending ingest after navigation instead of rebinding it to the new revision', async () => {
    bindExperienceSession(sessionId);
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const pending = ingestInteractions([{ eventId: crypto.randomUUID(), type: 'search_submitted', query: 'old page' }]);
    cancelExperience();
    finish(json({ ...accepted, contextVersion: 100 }));
    expect((await pending).ok).toBe(false);
    expect(experienceSnapshot().update).toBe(0);
  });

  it('preserves navigation keepalive delivery while refusing its obsolete response', async () => {
    bindExperienceSession(sessionId);
    let finish!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_path, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>(resolve => { finish = resolve; });
    }));
    const pending = ingestInteractions([{ eventId: crypto.randomUUID(), type: 'category_selected', category: 'rings' }], undefined, { keepalive: true });
    cancelExperience(false, true);
    expect(signal?.aborted).toBe(false);
    finish(json(accepted));
    expect((await pending).ok).toBe(false);
    expect(experienceSnapshot().update).toBe(0);
  });

  it('passes AbortController cancellation through to fetch', async () => {
    bindExperienceSession(sessionId);
    const controller = new AbortController();
    let finish!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_path, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>(resolve => { finish = resolve; });
    }));
    const pending = fetchExperienceComposition(undefined, controller.signal);
    controller.abort();
    expect(signal?.aborted).toBe(true);
    finish(json(composition()));
    expect((await pending).ok).toBe(false);
  });
});
