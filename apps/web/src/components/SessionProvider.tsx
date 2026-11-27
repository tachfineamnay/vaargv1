'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { SessionEnvelope } from '@vaarg/shared';
import type { StorefrontError } from '../lib/errors';
import { bootstrapSession, getSession, revokeSession, rotateSession } from '../lib/session-client';

/**
 * Visitor session lifecycle (FL04): bootstrap on first load, current-session
 * retrieval, expiry handling with automatic recovery, rotate and revoke.
 * Only non-sensitive session metadata is held in React state — the session
 * token itself lives in the HttpOnly cookie and never reaches JavaScript.
 */
export type SessionView = 'loading' | 'active' | 'anonymous' | 'expired' | 'error';

export interface SessionState {
  view: SessionView;
  session: SessionEnvelope['session'] | null;
  tenant: SessionEnvelope['tenant'] | null;
  error: StorefrontError | null;
}

export interface SessionContextValue extends SessionState {
  bootstrap(fromExpired?: boolean): Promise<void>;
  refresh(): Promise<void>;
  rotate(): Promise<void>;
  revoke(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

export function SessionProvider({ children }: { children: ReactNode }): ReactElement {
  const [state, setState] = useState<SessionState>({ view: 'loading', session: null, tenant: null, error: null });
  const startedRef = useRef(false);

  const applyEnvelope = useCallback((envelope: SessionEnvelope) => {
    setState({ view: 'active', session: envelope.session, tenant: envelope.tenant, error: null });
  }, []);

  const bootstrap = useCallback(
    async (fromExpired = false) => {
      const result = await bootstrapSession();
      if (result.ok) {
        applyEnvelope(result.data);
        return;
      }
      setState((current) => ({
        ...current,
        view: fromExpired && current.view === 'expired' ? 'expired' : 'error',
        error: result.error,
      }));
    },
    [applyEnvelope],
  );

  const refresh = useCallback(async () => {
    const result = await getSession();
    if (result.ok) {
      applyEnvelope(result.data);
      return;
    }
    if (result.error.kind === 'unauthorized') {
      await bootstrap();
      return;
    }
    setState({ view: 'error', session: null, tenant: null, error: result.error });
  }, [applyEnvelope, bootstrap]);

  const rotate = useCallback(async () => {
    const result = await rotateSession();
    if (result.ok) {
      applyEnvelope(result.data);
      return;
    }
    if (result.error.kind === 'unauthorized') {
      await bootstrap();
      return;
    }
    setState((current) => ({ ...current, error: result.error }));
  }, [applyEnvelope, bootstrap]);

  const revoke = useCallback(async () => {
    const result = await revokeSession();
    if (result.ok || result.error.kind === 'unauthorized') {
      setState({ view: 'anonymous', session: null, tenant: null, error: null });
      return;
    }
    setState((current) => ({ ...current, error: result.error }));
  }, []);

  // Bootstrap once on mount (GET current → POST when anonymous).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void refresh();
  }, [refresh]);

  // Expiration handling: flip to `expired` at expiresAt and attempt recovery.
  useEffect(() => {
    const session = state.session;
    if (state.view !== 'active' || !session) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const remaining = Date.parse(session.expiresAt) - Date.now();
      if (remaining <= 0) {
        if (cancelled) return;
        setState((current) => (current.view === 'active' ? { ...current, view: 'expired' } : current));
        void bootstrap(true);
        return;
      }
      timer = setTimeout(schedule, Math.min(remaining, 2_000_000_000));
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [state.view, state.session, bootstrap]);

  const value: SessionContextValue = { ...state, bootstrap, refresh, rotate, revoke };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
