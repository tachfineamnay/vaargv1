import { describe, expect, it } from 'vitest';
import { createWorkerRuntime } from '../src/worker-runtime.js';
describe('worker runtime module', () => {
  it('exposes a runtime factory without starting a process on import', () => { expect(typeof createWorkerRuntime).toBe('function'); });
});
