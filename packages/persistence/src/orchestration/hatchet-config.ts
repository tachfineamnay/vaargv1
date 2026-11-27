import { HatchetClient } from '@hatchet-dev/typescript-sdk';
import { AppError } from '@vaarg/shared';
import { z } from 'zod';

const hatchetTlsStrategySchema = z.enum(['tls', 'mtls', 'none']);

export const validatedHatchetSdkConfigSchema = z
  .object({
    enabled: z.boolean(),
    token: z.string().min(1).optional(),
    hostPort: z.string().min(3).max(255).optional(),
    apiUrl: z.string().url().optional(),
    tlsStrategy: hatchetTlsStrategySchema.default('tls'),
    namespace: z
      .string()
      .regex(/^[a-z0-9_-]{0,32}$/i)
      .default(''),
    workerName: z.string().min(1).max(80).default('vaarg-worker'),
    workerSlots: z.number().int().min(1).max(100).default(16),
  })
  .strict();

export type ValidatedHatchetSdkConfig = z.infer<typeof validatedHatchetSdkConfigSchema>;

function isRealToken(token: string | undefined): boolean {
  if (!token) return false;
  const trimmed = token.trim();
  if (trimmed.length < 10) return false;
  const lower = trimmed.toLowerCase();
  return !lower.includes('replace_me') && !lower.includes('placeholder');
}

export function resolveHatchetSdkConfig(
  env: Record<string, string | undefined> = process.env,
):
  | { status: 'NOT_CONFIGURED'; detail: string; config: ValidatedHatchetSdkConfig }
  | { status: 'CONFIGURED'; config: ValidatedHatchetSdkConfig } {
  const enabled = env.HATCHET_ENABLED === 'true';
  const rawToken = env.HATCHET_CLIENT_TOKEN?.trim() || env.HATCHET_TOKEN?.trim() || undefined;
  const rawUrl = env.HATCHET_URL?.trim() || env.HATCHET_CLIENT_SERVER_URL?.trim() || undefined;
  const rawHostPort = env.HATCHET_CLIENT_HOST_PORT?.trim() || undefined;
  const rawTls = (env.HATCHET_CLIENT_TLS_STRATEGY?.trim() || 'tls') as 'tls' | 'mtls' | 'none';
  const rawSlots = Number.parseInt(env.HATCHET_WORKER_SLOTS ?? '16', 10);

  let derivedHostPort = rawHostPort;
  if (!derivedHostPort && rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      derivedHostPort = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
    } catch {
      throw AppError.badRequest(`INVALID_HATCHET_URL: "${rawUrl}" is not a valid URL`);
    }
  }

  const parsed = validatedHatchetSdkConfigSchema.safeParse({
    enabled,
    token: rawToken,
    hostPort: derivedHostPort,
    apiUrl: rawUrl,
    tlsStrategy: rawTls,
    namespace: env.HATCHET_CLIENT_NAMESPACE?.trim() ?? '',
    workerName: env.HATCHET_WORKER_NAME?.trim() || 'vaarg-worker',
    workerSlots: Number.isFinite(rawSlots) && rawSlots > 0 ? rawSlots : 16,
  });

  if (!parsed.success) {
    throw AppError.badRequest(
      `INVALID_HATCHET_CONFIG: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }

  if (!parsed.data.enabled) {
    return {
      status: 'NOT_CONFIGURED',
      detail: 'HATCHET_ENABLED is false',
      config: parsed.data,
    };
  }
  if (!isRealToken(parsed.data.token)) {
    return {
      status: 'NOT_CONFIGURED',
      detail: 'Hatchet token (HATCHET_CLIENT_TOKEN / HATCHET_TOKEN) is missing or placeholder',
      config: parsed.data,
    };
  }
  if (!parsed.data.hostPort) {
    return {
      status: 'NOT_CONFIGURED',
      detail: 'Hatchet host/port (HATCHET_CLIENT_HOST_PORT or HATCHET_URL) is missing',
      config: parsed.data,
    };
  }

  return { status: 'CONFIGURED', config: parsed.data };
}

export function createHatchetSdkClient(config: ValidatedHatchetSdkConfig): HatchetClient {
  if (!config.token || !config.hostPort) {
    throw AppError.unavailable('HATCHET_NOT_CONFIGURED: Cannot initialize HatchetClient without token and hostPort');
  }
  return HatchetClient.init({
    token: config.token,
    host_port: config.hostPort,
    api_url: config.apiUrl ?? `http://${config.hostPort}`,
    namespace: config.namespace,
    tls_config: {
      tls_strategy: config.tlsStrategy,
    },
    log_level: 'WARN',
  });
}
