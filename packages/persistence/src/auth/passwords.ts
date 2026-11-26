import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id password hashing via @node-rs/argon2 (prebuilt native binding).
 * No plaintext credentials are ever stored. Argon2id (algorithm id = 2)
 * with the library's recommended defaults.
 */
// Argon2id algorithm id = 2 (matches @node-rs/argon2 Algorithm.Argon2id).
const ARGON2_OPTS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
  algorithm: 2,
} as const;

export async function createArgon2Hash(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS);
}

export async function verifyArgon2Hash(
  password: string,
  hashed: string,
): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}
