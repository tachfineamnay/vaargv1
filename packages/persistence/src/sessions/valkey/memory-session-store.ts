import type { SessionStore } from './session-store.js';

interface Entry {
  value: string;
  expiresAt: number;
}

/**
 * In-memory session store for unit tests. This backs only the ephemeral
 * session/token cache — it is NOT a substitute for PostgreSQL-backed data
 * guarantees (tenant isolation, persistence, RLS all live in PostgreSQL).
 */
export class MemorySessionStore implements SessionStore {
  private store = new Map<string, Entry>();

  async set(sessionId: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(sessionId, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async get(sessionId: string): Promise<string | null> {
    const entry = this.store.get(sessionId);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(sessionId);
      return null;
    }
    return entry.value;
  }

  async del(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
  }

  async setNx(sessionId: string, value: string, ttlSeconds: number): Promise<boolean> {
    const existing = await this.get(sessionId);
    if (existing !== null) return false;
    await this.set(sessionId, value, ttlSeconds);
    return true;
  }

  async expire(sessionId: string, ttlSeconds: number): Promise<boolean> {
    const entry = this.store.get(sessionId);
    if (!entry || entry.expiresAt <= Date.now()) return false;
    entry.expiresAt = Date.now() + ttlSeconds * 1000;
    return true;
  }
}
