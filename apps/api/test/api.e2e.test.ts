import { describe, expect, it } from 'vitest';
import request from 'node:http';

// These are live-boundary smoke tests. They only run when API_TEST_URL points at
// an actually running API (e.g. started by scripts/certification/smoke.mjs or
// docker compose). Without a live server they report NOT_RUN rather than failing.
const BASE_URL = process.env.API_TEST_URL;
const enabled = Boolean(BASE_URL);

function get(path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request.get(`${BASE_URL}${path}`, { timeout: 5000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          // keep raw text for assertion messages
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

describe.skipIf(!enabled)('VAARG API (live smoke)', () => {
  it('exposes liveness at /health', async () => {
    const result = await get('/health');
    expect(result.status).toBe(200);
    const body = result.body as { status: string; service: string; version: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('api');
    expect(body.version).toBe('1.0.0');
  }, 10000);

  it('exposes /version metadata', async () => {
    const result = await get('/version');
    expect(result.status).toBe(200);
    const body = result.body as { service: string; node: string; env: string };
    expect(body.service).toBe('api');
    expect(body.node).toMatch(/^v\d+\./);
    expect(['development', 'test', 'production']).toContain(body.env);
  }, 10000);

  it('reports readiness with explicit component checks', async () => {
    const result = await get('/health/ready');
    expect(result.status).toBe(200);
    const body = result.body as { status: string; checks: { name: string; status: string }[] };
    expect(['ready', 'not_ready']).toContain(body.status);
    expect(Array.isArray(body.checks)).toBe(true);
    expect(body.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining(['database', 'valkey']),
    );
  }, 10000);
});
