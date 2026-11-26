// Validate runtime-only settings without printing values or baking secrets into Next.js.
try {
  const base = new URL(process.env.API_BASE_URL);
  if (!['http:', 'https:'].includes(base.protocol) || !base.hostname || !process.env.APP_VERSION?.trim()) throw new Error();
} catch {
  console.error(JSON.stringify({ event: 'web_invalid_configuration' }));
  process.exit(1);
}
await import('./apps/web/server.js');
