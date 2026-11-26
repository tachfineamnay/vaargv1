#!/usr/bin/env node
/**
 * Local smoke runner for VAARG V1 P00.
 * Probes the executable web/API/worker boundaries that are actually running.
 * Usage: node scripts/certification/smoke.mjs
 * Exit 0 when every reachable boundary reports healthy; exit 1 otherwise.
 */
import { get } from 'node:http';

const TARGETS = [
  { name: 'api', url: process.env.API_SMOKE_URL ?? 'http://127.0.0.1:4111' },
  { name: 'web', url: process.env.WEB_SMOKE_URL ?? 'http://127.0.0.1:3000' },
];

const checks = [];

function probe(target, path, validator) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = get(`${target.url}${path}`, { timeout: 4000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const result = {
          target: target.name,
          path,
          status: res.statusCode,
          latencyMs: Date.now() - started,
          bodyPreview: body.slice(0, 240),
        };
        try {
          const verdict = validator(result, body);
          result.ok = verdict.ok;
          result.detail = verdict.detail;
        } catch (error) {
          result.ok = false;
          result.detail = `validator error: ${error.message}`;
        }
        resolve(result);
      });
    });
    req.on('error', (error) => {
      resolve({
        target: target.name,
        path,
        status: 0,
        latencyMs: Date.now() - started,
        ok: false,
        detail: `connection failed: ${error.message}`,
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.end();
  });
}

const apiValidator = (result, body) => {
  if (result.status !== 200) {
    return { ok: false, detail: `expected HTTP 200, got ${result.status}` };
  }
  const parsed = JSON.parse(body);
  if (parsed.status !== 'ok' || parsed.service !== 'api') {
    return { ok: false, detail: 'unexpected health payload' };
  }
  return { ok: true, detail: 'liveness ok' };
};

const webValidator = (result) => {
  if (result.status !== 200) {
    return { ok: false, detail: `expected HTTP 200, got ${result.status}` };
  }
  return { ok: true, detail: 'SSR page served' };
};

for (const target of TARGETS) {
  if (target.name === 'api') {
    checks.push(await probe(target, '/health', apiValidator));
    checks.push(await probe(target, '/health/ready', (result, body) => {
      if (result.status !== 200) {
        return { ok: false, detail: `expected HTTP 200, got ${result.status}` };
      }
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed.checks)) {
        return { ok: false, detail: 'missing readiness checks' };
      }
      return {
        ok: true,
        detail: `readiness ${parsed.status} (${parsed.checks.map((c) => `${c.name}=${c.status}`).join(', ')})`,
      };
    }));
    checks.push(await probe(target, '/version', (result) => {
      if (result.status !== 200) {
        return { ok: false, detail: `expected HTTP 200, got ${result.status}` };
      }
      return { ok: true, detail: 'version metadata served' };
    }));
  } else {
    checks.push(await probe(target, '/', webValidator));
  }
}

let failures = 0;
for (const check of checks) {
  const marker = check.ok ? 'PASS' : 'FAIL';
  if (!check.ok) failures += 1;
  console.log(
    `[${marker}] ${check.target} ${check.path} (${check.status}, ${check.latencyMs}ms) ${check.detail}`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} reachable smoke checks passed.`);
