interface Dependency {
  connect(): Promise<unknown>;
  ping(): Promise<string>;
  quit(): Promise<unknown>;
}

export async function startWorker(dependency: Dependency): Promise<() => Promise<void>> {
  await dependency.connect();
  if (await dependency.ping() !== 'PONG') throw new Error('Valkey readiness check failed');
  return async () => { await dependency.quit(); };
}
