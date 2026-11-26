import { describe, expect, it } from 'vitest';
import {
  APP_ENV_SCHEMA,
  AppError,
  catalogQuerySchema,
  catalogV1ProductsQuerySchema,
  createJsonLogger,
  echoRequestSchema,
  LIVENESS_SCHEMA_NAME,
  parseAppEnv,
  readinessSchema,
  statusForKind,
  STORE_ID_SCHEMA,
  storeContextSchema,
  versionSchema,
} from '../src/index.js';

const now = new Date().toISOString();

describe('shared contracts — runtime configuration', () => {
  it('validates safe app environment and applies defaults', () => {
    const parsed = parseAppEnv({ NODE_ENV: 'production', PORT: '8080' });
    expect(parsed.port).toBe(8080);
    expect(parsed.host).toBe('0.0.0.0');
    expect(parsed.logLevel).toBe('info');
    expect(parsed.nodeEnv).toBe('production');
  });

  it('rejects unsafe ports and environments', () => {
    expect(APP_ENV_SCHEMA.safeParse({ PORT: '0' }).success).toBe(false);
    expect(APP_ENV_SCHEMA.safeParse({ NODE_ENV: 'staging' }).success).toBe(false);
    expect(APP_ENV_SCHEMA.safeParse({ PORT: 'abc' }).success).toBe(false);
    expect(APP_ENV_SCHEMA.safeParse({ PORT: '65536' }).success).toBe(false);
  });
});

describe('shared contracts — store context', () => {
  it('validates store contexts without leaking arbitrary strings', () => {
    expect(STORE_ID_SCHEMA.safeParse('store_a-1').success).toBe(true);
    expect(STORE_ID_SCHEMA.safeParse('store/../etc').success).toBe(false);
    expect(storeContextSchema.parse({ storeId: 'main' }).market).toBe('default');
  });
});

describe('shared contracts — readiness contradiction rejection', () => {
  const baseChecks = [
    { name: 'database', status: 'ready' as const, required: true },
    { name: 'valkey', status: 'ready' as const, required: true },
  ];

  it('accepts a coherent ready payload', () => {
    const result = readinessSchema.safeParse({
      status: 'ready',
      service: 'api',
      version: '1.0.0',
      checks: baseChecks,
      timestamp: now,
    });
    expect(result.success).toBe(true);
  });

  it('rejects ready overall while a required check is not_ready', () => {
    const result = readinessSchema.safeParse({
      status: 'ready',
      service: 'api',
      version: '1.0.0',
      checks: [
        { name: 'database', status: 'ready', required: true },
        { name: 'valkey', status: 'not_ready', required: true, detail: 'down' },
      ],
      timestamp: now,
    });
    expect(result.success).toBe(false);
  });

  it('rejects ready overall while a required check is unknown', () => {
    const result = readinessSchema.safeParse({
      status: 'ready',
      service: 'api',
      version: '1.0.0',
      checks: [
        { name: 'database', status: 'ready', required: true },
        { name: 'valkey', status: 'unknown', required: true },
      ],
      timestamp: now,
    });
    expect(result.success).toBe(false);
  });

  it('rejects not_ready overall while every required check is ready', () => {
    const result = readinessSchema.safeParse({
      status: 'not_ready',
      service: 'api',
      version: '1.0.0',
      checks: baseChecks,
      timestamp: now,
    });
    expect(result.success).toBe(false);
  });

  it('accepts not_ready when a required check fails', () => {
    const result = readinessSchema.safeParse({
      status: 'not_ready',
      service: 'api',
      version: '1.0.0',
      checks: [
        { name: 'database', status: 'ready', required: true },
        { name: 'valkey', status: 'not_ready', required: true, detail: 'down' },
      ],
      timestamp: now,
    });
    expect(result.success).toBe(true);
  });

  it('ignores optional checks when computing coherence', () => {
    const result = readinessSchema.safeParse({
      status: 'ready',
      service: 'api',
      version: '1.0.0',
      checks: [
        { name: 'database', status: 'ready', required: true },
        { name: 'experimental', status: 'not_ready', required: false },
      ],
      timestamp: now,
    });
    expect(result.success).toBe(true);
  });
});

describe('shared contracts — errors and telemetry', () => {
  it('maps AppError kinds to HTTP status codes and stable bodies', () => {
    const error = AppError.badRequest('nope', [{ message: 'bad' }]);
    expect(error.status).toBe(statusForKind('bad_request'));
    expect(error.toBody('req-123').error.kind).toBe('bad_request');
    expect(AppError.notFound().status).toBe(404);
    expect(AppError.unavailable('down').status).toBe(503);
  });

  it('emits structured JSON logs filtered by level', () => {
    const records: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      records.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const logger = createJsonLogger('warn');
      logger.info('hidden');
      logger.warn('shown', { storeId: 'main' });
      const line = JSON.parse(records[records.length - 1] as string);
      expect(line.level).toBe('warn');
      expect(line.storeId).toBe('main');
      expect(records).toHaveLength(1);
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});

describe('shared contracts — application payloads', () => {
  it('validates echo and catalog query contracts', () => {
    expect(echoRequestSchema.safeParse({ message: 'ping' }).success).toBe(true);
    expect(echoRequestSchema.safeParse({ message: '' }).success).toBe(false);
    expect(catalogQuerySchema.parse({}).limit).toBe(20);
    expect(catalogQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('validates version metadata', () => {
    const version = versionSchema.parse({
      service: 'api',
      version: '1.0.0',
      node: process.version,
      env: 'test',
    });
    expect(version.service).toBe('api');
  });

  it('exposes the liveness contract name', () => {
    expect(LIVENESS_SCHEMA_NAME).toBe('liveness');
  });
});

describe('shared contracts — v1 products query', () => {
  it('splits the wire-format attribute string on the first colon', () => {
    const parsed = catalogV1ProductsQuerySchema.parse({ attribute: 'Size:M' });
    expect(parsed.attribute).toEqual({ name: 'Size', value: 'M' });
    const multi = catalogV1ProductsQuerySchema.parse({ attribute: 'Note:50%:x' });
    expect(multi.attribute).toEqual({ name: 'Note', value: '50%:x' });
  });

  it('rejects attribute strings without a usable name or value', () => {
    expect(catalogV1ProductsQuerySchema.safeParse({ attribute: 'nocolon' }).success).toBe(false);
    expect(catalogV1ProductsQuerySchema.safeParse({ attribute: ':value' }).success).toBe(false);
    expect(catalogV1ProductsQuerySchema.safeParse({ attribute: 'Name:' }).success).toBe(false);
    expect(catalogV1ProductsQuerySchema.safeParse({ attribute: '' }).success).toBe(false);
  });

  it('accepts internal object filters and absent attributes', () => {
    expect(catalogV1ProductsQuerySchema.parse({ attribute: { name: 'Size', value: 'M' } }).attribute).toEqual({
      name: 'Size',
      value: 'M',
    });
    expect(catalogV1ProductsQuerySchema.parse({}).attribute).toBeUndefined();
  });

  it('applies v1 list defaults and strict rejection', () => {
    const parsed = catalogV1ProductsQuerySchema.parse({});
    expect(parsed.limit).toBe(24);
    expect(parsed.sort).toBe('title-asc');
    expect(catalogV1ProductsQuerySchema.safeParse({ sort: 'price_desc' }).success).toBe(false);
    expect(catalogV1ProductsQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
  });
});
