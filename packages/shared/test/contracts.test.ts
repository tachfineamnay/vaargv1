import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AppError,
  APP_ENV_SCHEMA,
  catalogItemSchema,
  catalogListSchema,
  catalogQuerySchema,
  createJsonLogger,
  echoRequestSchema,
  healthSchema,
  parseAppEnv,
  readinessComponentSchema,
  readinessSchema,
  statusForKind,
  STORE_ID_SCHEMA,
  storeContextSchema,
  REQUEST_ID_SCHEMA,
  versionSchema,
} from '../src/index.js';

describe('shared contracts', () => {
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
  });

  it('validates store contexts without leaking arbitrary strings', () => {
    expect(STORE_ID_SCHEMA.safeParse('store_a-1').success).toBe(true);
    expect(STORE_ID_SCHEMA.safeParse('store/../etc').success).toBe(false);
    expect(storeContextSchema.parse({ storeId: 'main' }).market).toBe('default');
  });

  it('rejects malformed request ids', () => {
    expect(REQUEST_ID_SCHEMA.safeParse('abc-123_456').success).toBe(true);
    expect(REQUEST_ID_SCHEMA.safeParse('<script>').success).toBe(false);
  });

  it('accepts well-formed health, readiness and version payloads', () => {
    const health = healthSchema.parse({
      status: 'ok',
      service: 'api',
      version: '1.0.0',
      uptimeSeconds: 5,
      timestamp: new Date().toISOString(),
    });
    expect(health.status).toBe('ok');

    const readiness = readinessSchema.parse({
      status: 'ready',
      service: 'api',
      version: '1.0.0',
      checks: [readinessComponentSchema.parse({ name: 'database', status: 'ready' })],
      timestamp: new Date().toISOString(),
    });
    expect(readiness.checks).toHaveLength(1);

    const version = versionSchema.parse({
      service: 'api',
      version: '1.0.0',
      node: process.version,
      env: 'test',
    });
    expect(version.service).toBe('api');
  });

  it('validates echo, catalog and versioned contracts', () => {
    const request = echoRequestSchema.parse({ message: 'ping' });
    expect(request.message).toBe('ping');
    expect(echoRequestSchema.safeParse({ message: '' }).success).toBe(false);

    const item = catalogItemSchema.parse({
      id: 'p-1',
      storeId: 'main',
      title: 'Armchair',
      status: 'active',
    });
    expect(catalogItemSchema.safeParse({ ...item, status: 'sold' }).success).toBe(false);

    const query = catalogQuerySchema.parse({});
    expect(query.limit).toBe(20);

    const list = catalogListSchema.parse({ items: [item], nextCursor: null });
    expect(list.items[0]?.id).toBe('p-1');
  });

  it('maps AppError kinds to HTTP status codes and stable bodies', () => {
    const error = AppError.badRequest('nope', [{ message: 'bad' }]);
    expect(error.status).toBe(statusForKind('bad_request'));
    expect(error.toBody('req-123').error.kind).toBe('bad_request');
    expect(error.toBody('req-123').error.details).toEqual([{ message: 'bad' }]);
    expect(AppError.notFound().status).toBe(404);
    expect(AppError.unavailable('down').status).toBe(503);
  });

  it('emits structured JSON logs filtered by level', () => {
    const records: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    const originalError = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: string) => {
      records.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string) => {
      records.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      const logger = createJsonLogger({ level: 'warn' });
      logger.info('hidden');
      logger.warn('shown', { storeId: 'main' });
      const line = JSON.parse(records[records.length - 1] as string);
      expect(line.level).toBe('warn');
      expect(line.storeId).toBe('main');
      expect(records).toHaveLength(1);
    } finally {
      process.stdout.write = originalWrite;
      process.stderr.write = originalError;
    }
  });

  it('rejects unknown enum values in contracts', () => {
    expect(z.enum(['a', 'b']).safeParse('c').success).toBe(false);
  });
});
