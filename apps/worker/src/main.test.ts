import { describe, expect, it, vi } from 'vitest';
import { startWorker } from './lifecycle';

describe('worker lifecycle', () => {
  it('checks readiness before starting and closes on shutdown', async () => {
    const connection = { connect: vi.fn().mockResolvedValue(undefined), ping: vi.fn().mockResolvedValue('PONG'), quit: vi.fn().mockResolvedValue('OK') };
    const stop = await startWorker(connection);
    expect(connection.ping).toHaveBeenCalledOnce();
    await stop();
    expect(connection.quit).toHaveBeenCalledOnce();
  });
  it('fails startup if the dependency is unavailable', async () => {
    const connection = { connect: vi.fn().mockRejectedValue(new Error('unavailable')), ping: vi.fn(), quit: vi.fn() };
    await expect(startWorker(connection)).rejects.toThrow('unavailable');
  });
});
