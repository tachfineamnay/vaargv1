import type { ReadinessCheck } from '@vaarg/shared';

export interface ReadinessProbes {
  check(): Promise<ReadinessCheck[]>;
}
