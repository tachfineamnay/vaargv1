import { describe, it, expect } from 'vitest';
import { MemorySessionStore } from '../src/sessions/valkey/memory-session-store.js';

describe('Session store (T12)', () => {
  it('stores and retrieves a session value', async () => {
    const store = new MemorySessionStore();
    await store.set('sid', 'token-abc', 60);
    expect(await store.get('sid')).toBe('token-abc');
  });

  it('returns null for an absent session', async () => {
    const store = new MemorySessionStore();
    expect(await store.get('missing')).toBeNull();
  });

  it('deletes a session', async () => {
    const store = new MemorySessionStore();
    await store.set('sid', 'token', 60);
    await store.del('sid');
    expect(await store.get('sid')).toBeNull();
  });

  it('setNx only sets when absent', async () => {
    const store = new MemorySessionStore();
    const first = await store.setNx('sid', 'v1', 60);
    expect(first).toBe(true);
    const second = await store.setNx('sid', 'v2', 60);
    expect(second).toBe(false);
    expect(await store.get('sid')).toBe('v1');
  });

  it('expires a session after TTL', async () => {
    const store = new MemorySessionStore();
    await store.set('sid', 'token', 0); // zero TTL -> immediately expired
    expect(await store.get('sid')).toBeNull();
  });
});
