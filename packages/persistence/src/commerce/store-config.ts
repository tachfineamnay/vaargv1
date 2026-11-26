import { z } from 'zod';

const hostSchema = z.string().min(1).max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/);
const bindingSchema = z.strictObject({
  host: hostSchema,
  storeId: z.uuid(),
  country: z.string().regex(/^[A-Z]{2}$/),
  language: z.string().regex(/^[A-Z]{2,3}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  shopifyDomain: z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/),
  tokenEnv: z.string().regex(/^SHOPIFY_[A-Z0-9_]+$/).max(128),
  metafields: z.array(z.strictObject({ namespace:z.string().min(1).max(255), key:z.string().min(1).max(255) })).max(50).optional(),
});
export type StorefrontBinding = z.infer<typeof bindingSchema>;

/** Configuration is supplied by the operator, never by the request. */
export function parseStorefrontBindings(raw: unknown): StorefrontBinding[] {
  const entries = z.array(bindingSchema).max(1000).parse(raw);
  const hosts = new Set<string>();
  const stores = new Map<string, string>();
  const providers = new Map<string, string>();
  const markets = new Map<string, string>();
  for (const entry of entries) {
    if (hosts.has(entry.host)) throw new Error('DUPLICATE_STOREFRONT_HOST');
    hosts.add(entry.host);
    const provider = `${entry.shopifyDomain}:${entry.tokenEnv}:${JSON.stringify(entry.metafields ?? [])}`;
    if (stores.has(entry.storeId) && stores.get(entry.storeId) !== provider) throw new Error('CONFLICTING_STORE_PROVIDER');
    stores.set(entry.storeId, provider);
    if (providers.has(entry.shopifyDomain) && providers.get(entry.shopifyDomain) !== entry.storeId) throw new Error('PROVIDER_ASSIGNED_TO_MULTIPLE_STORES');
    providers.set(entry.shopifyDomain, entry.storeId);
    const market = `${entry.storeId}:${entry.country}:${entry.language}`;
    if (markets.has(market) && markets.get(market) !== entry.currency) throw new Error('CONFLICTING_MARKET_CURRENCY');
    markets.set(market, entry.currency);
  }
  return entries;
}

export function loadStorefrontBindings(env: NodeJS.ProcessEnv = process.env): StorefrontBinding[] {
  const raw = env.STOREFRONT_BINDINGS_JSON;
  if (!raw) return [];
  try { return parseStorefrontBindings(JSON.parse(raw)); }
  catch { throw new Error('INVALID_STOREFRONT_BINDINGS'); }
}

/** Use the direct Host header; forwarded headers and caller store IDs are ignored. */
export function resolveStorefront(bindings: readonly StorefrontBinding[], host: unknown): StorefrontBinding | null {
  if (typeof host !== 'string' || host.length > 260) return null;
  const match = /^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/i.exec(host);
  if (!match || (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535))) return null;
  const hostname = match[1]!.toLowerCase();
  if (!hostSchema.safeParse(hostname).success) return null;
  return bindings.find(entry => entry.host === hostname) ?? null;
}
