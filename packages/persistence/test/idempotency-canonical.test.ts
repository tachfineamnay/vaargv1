import { describe, expect, it } from 'vitest';
import { payloadHash } from '../src/services/idempotency.js';
describe('canonical idempotency payload', () => {
  it('sorts nested object keys without losing fields or array order', () => {
    expect(payloadHash({ a: { x: 1, y: 2 } })).toBe(payloadHash({ a: { y: 2, x: 1 } }));
    expect(payloadHash({ a: { x: 1 } })).not.toBe(payloadHash({ a: { x: 2 } }));
    expect(payloadHash({ a: [1, 2] })).not.toBe(payloadHash({ a: [2, 1] }));
  });
});
