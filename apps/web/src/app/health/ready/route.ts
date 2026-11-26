export const dynamic = 'force-dynamic';
export async function GET(): Promise<Response> {
  try {
    const base = process.env.API_BASE_URL;
    if (!base) throw new Error('API_BASE_URL missing');
    const response = await fetch(`${base.replace(/\/+$/, '')}/health/ready`, { signal: AbortSignal.timeout(4000), cache: 'no-store' });
    const body: unknown = await response.json();
    const ready = response.ok && typeof body === 'object' && body !== null && 'status' in body && body.status === 'ready';
    return Response.json({ status: ready ? 'ready' : 'not_ready' }, { status: ready ? 200 : 503 });
  } catch {
    return Response.json({ status: 'not_ready' }, { status: 503 });
  }
}
