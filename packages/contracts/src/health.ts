// Health and readiness check types

import { z } from 'zod';

/**
 * Health Check Response
 */
export const HealthCheckSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  timestamp: z.string().datetime({ offset: true }),
  version: z.string().optional(),
  commit: z.string().optional(),
  uptimeSeconds: z.number().nonnegative(),
  checks: z.record(z.string(), z.object({
      status: z.enum(['pass', 'warn', 'fail']),
      component: z.string(),
      observedValue: z.string().optional(),
      observedUnit: z.string().optional(),
      threshold: z.string().optional(),
      details: z.record(z.string(), z.unknown()).optional(),
    })
  ),
});

export type HealthCheck = z.infer<typeof HealthCheckSchema>;

/**
 * Readiness Check Response
 */
export const ReadinessCheckSchema = z.object({
  ready: z.boolean(),
  timestamp: z.string().datetime({ offset: true }),
  checks: z.record(z.string(), z.object({
      ready: z.boolean(),
      component: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    })
  ),
});

export type ReadinessCheck = z.infer<typeof ReadinessCheckSchema>;

/**
 * Liveness Check Response
 */
export const LivenessCheckSchema = z.object({
  alive: z.boolean(),
  timestamp: z.string().datetime({ offset: true }),
});

export type LivenessCheck = z.infer<typeof LivenessCheckSchema>;

/**
 * Dependency Check (for readiness)
 */
export const DependencyCheckSchema = z.object({
  name: z.string(),
  type: z.enum(['database', 'cache', 'message_queue', 'external_api', 'service']),
  url: z.string().optional(),
  timeoutMs: z.number().int().positive().default(5000),
  critical: z.boolean().default(true),
});

export type DependencyCheck = z.infer<typeof DependencyCheckSchema>;
