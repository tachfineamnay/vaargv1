import { describe, it, expect } from 'vitest';
import { createArgon2Hash, verifyArgon2Hash } from '../src/auth/passwords.js';

describe('argon2id password hashing (T07)', () => {
  it('hashes and verifies a correct password', async () => {
    const hash = await createArgon2Hash('correct-password-123');
    expect(hash).not.toContain('correct-password-123');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    const ok = await verifyArgon2Hash('correct-password-123', hash);
    expect(ok).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await createArgon2Hash('correct-password-123');
    const ok = await verifyArgon2Hash('wrong-password', hash);
    expect(ok).toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const h1 = await createArgon2Hash('same-password');
    const h2 = await createArgon2Hash('same-password');
    expect(h1).not.toBe(h2);
  });
});
