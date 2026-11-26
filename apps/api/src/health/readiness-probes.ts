export interface ReadinessProbeResult {
  name: string;
  status: 'ready' | 'not_ready' | 'unknown';
  detail?: string;
  latencyMs?: number;
}

export interface ReadinessProbes {
  check(): Promise<ReadinessProbeResult[]>;
}
