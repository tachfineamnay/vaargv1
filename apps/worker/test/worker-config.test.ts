import { describe, expect, it } from 'vitest';
import { loadWorkerConfiguration } from '../src/infra/worker-config.js';

describe('worker configuration', () => {
  it('loads explicit dependency wiring', () => {
    const config = loadWorkerConfiguration({
      NODE_ENV: 'test',
      PORT: '5010',
      DATABASE_URL: 'postgres://localhost:5432/vaarg',
      VALKEY_URL: 'redis://localhost:6379',
      HATCHET_ENABLED: 'true',
      HATCHET_URL: 'https://hatchet.example',
      HATCHET_TOKEN: 'synthetic-token',
    } as NodeJS.ProcessEnv);

    expect(config.app.port).toBe(5010);
    expect(config.database.url).toBe('postgres://localhost:5432/vaarg');
    expect(config.valkey.keyPrefix).toBe('vaarg:');
    expect(config.valkey.pollIntervalMs).toBe(5000);
    expect(config.hatchet).toEqual({
      url: 'https://hatchet.example',
      token: 'synthetic-token',
      enabled: true,
    });
  });

  it('fails loudly on missing required dependencies', () => {
    expect(() =>
      loadWorkerConfiguration({ NODE_ENV: 'test' } as NodeJS.ProcessEnv),
    ).toThrow(/DATABASE_URL/);
  });

  it('defaults Hatchet to disabled until explicitly enabled', () => {
    const config = loadWorkerConfiguration({
      DATABASE_URL: 'postgres://localhost:5432/vaarg',
      VALKEY_URL: 'redis://localhost:6379',
    } as NodeJS.ProcessEnv);
    expect(config.hatchet.enabled).toBe(false);
  });
});
