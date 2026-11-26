/**
 * Minimal type shim for `ioredis` (Valkey/Redis-compatible client).
 * The client is loaded lazily at runtime; this shim keeps the package
 * type-checkable without making ioredis a hard dependency. ioredis is
 * listed as an optionalDependency and is required only when Valkey is used.
 */
declare module 'ioredis' {
  export class Redis {
    constructor(url: string, options?: Record<string, unknown>);
    call(...args: unknown[]): Promise<unknown>;
    quit(): Promise<void>;
    on(event: string, listener: (...args: unknown[]) => void): void;
  }
  export default Redis;
}
