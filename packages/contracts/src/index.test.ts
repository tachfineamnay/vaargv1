import { describe, expect, it } from 'vitest';
import { readinessSchema, errorSchema } from './index.js';
describe('runtime contracts', () => {
  it('accepts healthy readiness and rejects missing dependency status', () => {
    expect(readinessSchema.safeParse({status:'ready', dependencies:{postgres:'up',valkey:'up'}}).success).toBe(true);
    expect(readinessSchema.safeParse({status:'ready', dependencies:{postgres:'up'}}).success).toBe(false);
  });
  it('requires a correlation identifier for errors', () => {
    expect(errorSchema.safeParse({code:'UNAVAILABLE',message:'Unavailable',requestId:'r1'}).success).toBe(true);
    expect(errorSchema.safeParse({code:'UNAVAILABLE',message:'Unavailable'}).success).toBe(false);
  });
});
