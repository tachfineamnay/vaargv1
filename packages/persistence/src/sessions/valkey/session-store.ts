/**
 * Session store abstraction backed by Valkey (Redis-compatible).
 *
 * This interface is deliberately transport-agnostic so the API layer can
 * depend on it without importing a Redis client. The Valkey implementation
 * below uses `ioredis`-style command semantics via a minimal command surface,
 * keeping the store small and testable.
 */

export interface SessionStore {
  /** Store a session value keyed by session id, with a TTL in seconds. */
  set(sessionId: string, value: string, ttlSeconds: number): Promise<void>;
  /** Read a session value. Returns null if absent or expired. */
  get(sessionId: string): Promise<string | null>;
  /** Delete a session value (revocation). */
  del(sessionId: string): Promise<void>;
  /** Atomically set-if-absent (used for session rotation guards). */
  setNx(sessionId: string, value: string, ttlSeconds: number): Promise<boolean>;
  /** Extend a session TTL (sliding expiration). */
  expire(sessionId: string, ttlSeconds: number): Promise<boolean>;
}

export interface ValkeySessionStoreConfig {
  /** Valkey/Redis connection URL, e.g. redis://host:6379 */
  url: string;
  /** Default session TTL in seconds. */
  defaultTtlSeconds: number;
  /** Key prefix for all session keys. */
  keyPrefix: string;
}

/**
 * Valkey-backed session store. Uses the `valkey` npm package's command
 * surface (GET/SET/SETNX/DEL/EXPIRE). The dependency is loaded lazily so
 * the package stays importable even when Valkey is not connected.
 */
export class ValkeySessionStore implements SessionStore {
  private client: unknown;
  private readonly config: ValkeySessionStoreConfig;

  constructor(config: ValkeySessionStoreConfig) {
    this.config = config;
  }

  /** Connect to Valkey. Loads the client lazily on first use. */
  async connect(): Promise<void> {
    if (this.client) return;
    // Lazy import: the valkey client is an optional peer at runtime.
    const mod = await import('ioredis').catch(() => null);
    if (!mod) {
      throw new Error(
        'Valkey client (ioredis) is not installed; install ioredis to use ValkeySessionStore',
      );
    }
    // ioredis exports a Redis class compatible with Valkey.
    const modNs = mod as {
      default?: { new (url: string, opts?: Record<string, unknown>): unknown };
      Redis?: { new (url: string, opts?: Record<string, unknown>): unknown };
    };
    const RedisCtor = modNs.default ?? modNs.Redis;
    if (typeof RedisCtor !== 'function') {
      throw new Error('ioredis Redis constructor not found');
    }
    this.client = new RedisCtor(this.config.url);
  }

  private key(sessionId: string): string {
    return `${this.config.keyPrefix}:${sessionId}`;
  }

  private cmd(...args: (string | number)[]): Promise<unknown> {
    if (!this.client) {
      throw new Error('ValkeySessionStore is not connected; call connect() first');
    }
    // The ioredis client exposes .call() for raw commands.
    return (this.client as { call: (...a: unknown[]) => Promise<unknown> }).call(
      ...args,
    );
  }

  async set(sessionId: string, value: string, ttlSeconds: number): Promise<void> {
    await this.cmd('SET', this.key(sessionId), value, 'EX', ttlSeconds);
  }

  async get(sessionId: string): Promise<string | null> {
    const result = await this.cmd('GET', this.key(sessionId));
    return (result as string | null) ?? null;
  }

  async del(sessionId: string): Promise<void> {
    await this.cmd('DEL', this.key(sessionId));
  }

  async setNx(sessionId: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.cmd(
      'SET',
      this.key(sessionId),
      value,
      'EX',
      ttlSeconds,
      'NX',
    );
    // ioredis returns 'OK' when set, null when not set.
    return result === 'OK' || result === 1;
  }

  async expire(sessionId: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.cmd('EXPIRE', this.key(sessionId), ttlSeconds);
    return Number(result) === 1;
  }

  async close(): Promise<void> {
    if (this.client && typeof (this.client as { quit?: () => Promise<void> }).quit === 'function') {
      await (this.client as { quit: () => Promise<void> }).quit();
    }
    this.client = undefined;
  }
}
