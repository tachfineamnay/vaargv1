import { z } from 'zod';

const contextSchema = z.object({ country: z.string().regex(/^[A-Z]{2}$/), language: z.string().regex(/^[A-Z]{2,3}$/) });
const configSchema = z.object({ domain: z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/), token: z.string().min(1), apiVersion: z.enum(['2026-10']) });
const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }).refine((p) => !p.hasNextPage || !!p.endCursor);
const imageSchema = z.object({ id: z.string().nullable(), url: z.url().refine((value) => new URL(value).protocol === 'https:'), altText: z.string().nullable() });
const moneySchema = z.object({ amount: z.string().regex(/^\d+(\.\d+)?$/), currencyCode: z.string().regex(/^[A-Z]{3}$/) });
const variantSchema = z.object({ id: z.string().startsWith('gid://shopify/ProductVariant/'), title: z.string(), availableForSale: z.boolean(), price: moneySchema, selectedOptions: z.array(z.object({ name: z.string(), value: z.string() })) });
const mediaSourceSchema = z.object({ url: z.url().refine((value) => new URL(value).protocol === 'https:'), mimeType: z.string(), format: z.string() });
const mediaBase = { id: z.string(), mediaContentType: z.enum(['IMAGE', 'VIDEO', 'EXTERNAL_VIDEO', 'MODEL_3D']), alt: z.string().nullable(), previewImage: imageSchema.nullable() };
const mediaSchema = z.discriminatedUnion('__typename', [
  z.object({ ...mediaBase, __typename: z.literal('MediaImage'), image: imageSchema.nullable() }),
  z.object({ ...mediaBase, __typename: z.literal('ExternalVideo'), originUrl: z.url().refine((value) => new URL(value).protocol === 'https:') }),
  z.object({ ...mediaBase, __typename: z.literal('Video'), sources: z.array(mediaSourceSchema) }),
  z.object({ ...mediaBase, __typename: z.literal('Model3d'), sources: z.array(mediaSourceSchema) }),
]);
const productSchema = z.object({ id: z.string().startsWith('gid://shopify/Product/'), handle: z.string(), title: z.string(), description: z.string(), productType: z.string(), vendor: z.string(), tags: z.array(z.string()), updatedAt: z.iso.datetime(), availableForSale: z.boolean(), variants: z.object({ nodes: z.array(variantSchema), pageInfo: pageInfoSchema }), images: z.object({ nodes: z.array(imageSchema), pageInfo: pageInfoSchema }), media: z.object({ nodes: z.array(mediaSchema), pageInfo: pageInfoSchema }) });
const productRefSchema = z.object({ id: z.string().startsWith('gid://shopify/Product/') });
const collectionSchema = z.object({ id: z.string().startsWith('gid://shopify/Collection/'), handle: z.string(), title: z.string(), description: z.string(), updatedAt: z.iso.datetime(), image: imageSchema.nullable(), products: z.object({ nodes: z.array(productRefSchema), pageInfo: pageInfoSchema }) });
const envelopeSchema = z.object({ data: z.unknown().optional(), errors: z.array(z.object({ message: z.string(), extensions: z.object({ code: z.string().optional() }).optional() })).optional(), extensions: z.object({ context: contextSchema }).optional() });
const pageSchema = <T extends z.ZodType>(item: T) => z.object({ nodes: z.array(item), pageInfo: pageInfoSchema });
export type CommerceContext = z.infer<typeof contextSchema>;
export type Product = z.infer<typeof productSchema>;
export type Collection = z.infer<typeof collectionSchema>;
export interface CommercePage<T> { items: T[]; nextCursor: string | null }
export interface CommercePort {
  products(context: CommerceContext, after: string | null): Promise<CommercePage<Product>>;
  collections(context: CommerceContext, after: string | null): Promise<CommercePage<Collection>>;
}
export class CommerceError extends Error {
  constructor(readonly code: 'PROVIDER_ERROR' | 'THROTTLED' | 'INVALID_RESPONSE' | 'TIMEOUT' | 'NOT_CONFIGURED', readonly retryable = false) { super(code); }
}
const PRODUCTS = `query Products($country: CountryCode!, $language: LanguageCode!, $after: String) @inContext(country: $country, language: $language) { localization { country { currency { isoCode } } } products(first: 20, after: $after) { nodes { id handle title description productType vendor tags updatedAt availableForSale variants(first: 100) { nodes { id title availableForSale price { amount currencyCode } selectedOptions { name value } } pageInfo { hasNextPage endCursor } } images(first: 100) { nodes { id url altText } pageInfo { hasNextPage endCursor } } media(first: 100) { nodes { __typename id mediaContentType alt previewImage { id url altText } ... on MediaImage { image { id url altText } } ... on ExternalVideo { originUrl } ... on Video { sources { url mimeType format } } ... on Model3d { sources { url mimeType format } } } pageInfo { hasNextPage endCursor } } } pageInfo { hasNextPage endCursor } } }`;
const COLLECTIONS = `query Collections($country: CountryCode!, $language: LanguageCode!, $after: String) @inContext(country: $country, language: $language) { collections(first: 20, after: $after) { nodes { id handle title description updatedAt image { id url altText } products(first: 100) { nodes { id } pageInfo { hasNextPage endCursor } } } pageInfo { hasNextPage endCursor } } }`;
const PRODUCT_VARIANTS = `query ProductVariants($country: CountryCode!, $language: LanguageCode!, $id: ID!, $after: String) @inContext(country: $country, language: $language) { node(id: $id) { ... on Product { id variants(first: 100, after: $after) { nodes { id title availableForSale price { amount currencyCode } selectedOptions { name value } } pageInfo { hasNextPage endCursor } } } } }`;
const PRODUCT_IMAGES = `query ProductImages($country: CountryCode!, $language: LanguageCode!, $id: ID!, $after: String) @inContext(country: $country, language: $language) { node(id: $id) { ... on Product { id images(first: 100, after: $after) { nodes { id url altText } pageInfo { hasNextPage endCursor } } } } }`;
const COLLECTION_PRODUCTS = `query CollectionProducts($country: CountryCode!, $language: LanguageCode!, $id: ID!, $after: String) @inContext(country: $country, language: $language) { node(id: $id) { ... on Collection { id products(first: 100, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } } } }`;
const PRODUCT_MEDIA = `query ProductMedia($country: CountryCode!, $language: LanguageCode!, $id: ID!, $after: String) @inContext(country: $country, language: $language) { node(id: $id) { ... on Product { id media(first: 100, after: $after) { nodes { __typename id mediaContentType alt previewImage { id url altText } ... on MediaImage { image { id url altText } } ... on ExternalVideo { originUrl } ... on Video { sources { url mimeType format } } ... on Model3d { sources { url mimeType format } } } pageInfo { hasNextPage endCursor } } } } }`;
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Options = { fetcher?: Fetcher; maxAttempts?: number; retryDelay?: (ms: number) => Promise<void>; timeoutMs?: number };
export function createShopifyCommerce(configuration: unknown, options: Options = {}): { status: 'NOT_CONFIGURED' } | { status: 'READY'; port: CommercePort } {
  if (configuration == null) return { status: 'NOT_CONFIGURED' };
  const config = configSchema.parse(configuration);
  const fetcher = options.fetcher ?? fetch;
  const attempts = z.number().int().min(1).max(5).parse(options.maxAttempts ?? 3);
  const timeout = z.number().int().min(100).max(30000).parse(options.timeoutMs ?? 10000);
  const delay = options.retryDelay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // Per-client pacing bounds automated traffic; deployments need a shared per-store limiter.
  let tail: Promise<void> = Promise.resolve();
  let nextAllowed = 0;
  async function pacedFetch(url: string, init: RequestInit): Promise<Response> {
    const previous = tail;
    let release: () => void = () => undefined;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const wait = Math.max(0, nextAllowed - Date.now());
      if (wait) await delay(wait);
      nextAllowed = Math.max(Date.now(), nextAllowed) + 250;
      return await fetcher(url, init);
    } finally { release(); }
  }
  async function request(query: string, input: CommerceContext, after: string | null, id?: string): Promise<unknown> {
    const context = contextSchema.parse(input);
    z.string().max(4096).nullable().parse(after);
    for (let n = 0; n < attempts; n++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await pacedFetch(`https://${config.domain}/api/${config.apiVersion}/graphql.json`, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'X-Shopify-Storefront-Access-Token': config.token }, body: JSON.stringify({ query, variables: { ...context, after, ...(id ? { id } : {}) } }), signal: controller.signal });
        if (response.status === 429 || response.status >= 500) throw new CommerceError(response.status === 429 ? 'THROTTLED' : 'PROVIDER_ERROR', true);
        if (!response.ok) throw new CommerceError('PROVIDER_ERROR');
        const parsed = envelopeSchema.safeParse(await response.json());
        if (!parsed.success) throw new CommerceError('INVALID_RESPONSE');
        const result = parsed.data;
        if (result.errors?.length) {
          const throttled = result.errors.some((e) => e.extensions?.code === 'THROTTLED');
          const transient = result.errors.every((e) => e.extensions?.code === 'THROTTLED' || e.extensions?.code === 'INTERNAL_SERVER_ERROR');
          throw new CommerceError(throttled ? 'THROTTLED' : 'PROVIDER_ERROR', transient);
        }
        if (!result.extensions?.context || result.extensions.context.country !== context.country || result.extensions.context.language !== context.language) throw new CommerceError('INVALID_RESPONSE');
        return result.data;
      } catch (error) {
        const mapped = error instanceof CommerceError ? error : new CommerceError(controller.signal.aborted ? 'TIMEOUT' : 'PROVIDER_ERROR', true);
        if (n + 1 === attempts || !mapped.retryable) throw mapped;
        await delay(Math.min(2000, 250 * 2 ** n));
      } finally { clearTimeout(timer); }
    }
    throw new CommerceError('PROVIDER_ERROR');
  }
  return { status: 'READY', port: {
    async products(context, after) {
      const result = z.object({ localization: z.object({ country: z.object({ currency: z.object({ isoCode: z.string().regex(/^[A-Z]{3}$/) }) }) }), products: pageSchema(productSchema) }).safeParse(await request(PRODUCTS, context, after));
      if (!result.success) throw new CommerceError('INVALID_RESPONSE');
      for (const product of result.data.products.nodes) {
        const seenVariants = new Set<string>();
        while (product.variants.pageInfo.hasNextPage) {
          const cursor = product.variants.pageInfo.endCursor;
          if (!cursor || seenVariants.has(cursor) || seenVariants.size >= 100) throw new CommerceError('INVALID_RESPONSE');
          seenVariants.add(cursor);
          const next = z.object({ node: z.object({ id: z.literal(product.id), variants: pageSchema(variantSchema) }) }).safeParse(await request(PRODUCT_VARIANTS, context, cursor, product.id));
          if (!next.success) throw new CommerceError('INVALID_RESPONSE');
          product.variants.nodes.push(...next.data.node.variants.nodes);
          product.variants.pageInfo = next.data.node.variants.pageInfo;
        }
        const seenImages = new Set<string>();
        while (product.images.pageInfo.hasNextPage) {
          const cursor = product.images.pageInfo.endCursor;
          if (!cursor || seenImages.has(cursor) || seenImages.size >= 100) throw new CommerceError('INVALID_RESPONSE');
          seenImages.add(cursor);
          const next = z.object({ node: z.object({ id: z.literal(product.id), images: pageSchema(imageSchema) }) }).safeParse(await request(PRODUCT_IMAGES, context, cursor, product.id));
          if (!next.success) throw new CommerceError('INVALID_RESPONSE');
          product.images.nodes.push(...next.data.node.images.nodes);
          product.images.pageInfo = next.data.node.images.pageInfo;
        }
        const seenMedia = new Set<string>();
        while (product.media.pageInfo.hasNextPage) {
          const cursor = product.media.pageInfo.endCursor;
          if (!cursor || seenMedia.has(cursor) || seenMedia.size >= 100) throw new CommerceError('INVALID_RESPONSE');
          seenMedia.add(cursor);
          const next = z.object({ node: z.object({ id: z.literal(product.id), media: pageSchema(mediaSchema) }) }).safeParse(await request(PRODUCT_MEDIA, context, cursor, product.id));
          if (!next.success) throw new CommerceError('INVALID_RESPONSE');
          product.media.nodes.push(...next.data.node.media.nodes);
          product.media.pageInfo = next.data.node.media.pageInfo;
        }
      }
      if (result.data.products.nodes.some((p) => p.variants.nodes.some((v) => v.price.currencyCode !== result.data.localization.country.currency.isoCode))) throw new CommerceError('INVALID_RESPONSE');
      return { items: result.data.products.nodes, nextCursor: result.data.products.pageInfo.hasNextPage ? result.data.products.pageInfo.endCursor : null };
    },
    async collections(context, after) {
      const result = z.object({ collections: pageSchema(collectionSchema) }).safeParse(await request(COLLECTIONS, context, after));
      if (!result.success) throw new CommerceError('INVALID_RESPONSE');
      for (const collection of result.data.collections.nodes) {
        const seen = new Set<string>();
        while (collection.products.pageInfo.hasNextPage) {
          const cursor = collection.products.pageInfo.endCursor;
          if (!cursor || seen.has(cursor) || seen.size >= 1000) throw new CommerceError('INVALID_RESPONSE');
          seen.add(cursor);
          const next = z.object({ node: z.object({ id: z.literal(collection.id), products: pageSchema(productRefSchema) }) }).safeParse(await request(COLLECTION_PRODUCTS, context, cursor, collection.id));
          if (!next.success) throw new CommerceError('INVALID_RESPONSE');
          collection.products.nodes.push(...next.data.node.products.nodes);
          collection.products.pageInfo = next.data.node.products.pageInfo;
        }
      }
      return { items: result.data.collections.nodes, nextCursor: result.data.collections.pageInfo.hasNextPage ? result.data.collections.pageInfo.endCursor : null };
    },
  } };
}
