import { z } from 'zod';

const image = z.object({ id: z.string().nullable(), url: z.url(), altText: z.string().nullable() });
const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const variant = z.object({ id: z.string().startsWith('gid://shopify/ProductVariant/'), title: z.string(), availableForSale: z.boolean(), price: z.object({ amount: z.string().regex(/^\d+(\.\d+)?$/), currencyCode: z.string().regex(/^[A-Z]{3}$/) }), selectedOptions: z.array(z.object({ name: z.string(), value: z.string() })) });
const metafield = z.object({ namespace:z.string(), key:z.string(), type:z.string(), value:z.string() }).nullable();
export const catalogProductSchema = z.object({ metafields:z.array(metafield).optional(), id: z.string().startsWith('gid://shopify/Product/'), handle: z.string().min(1), title: z.string(), description: z.string(), productType: z.string(), vendor: z.string(), tags: z.array(z.string()), options: z.array(z.object({ id: z.string(), name: z.string(), optionValues: z.array(z.object({ id: z.string(), name: z.string() })) })).optional(), updatedAt: z.iso.datetime(), availableForSale: z.boolean(), variants: z.object({ nodes: z.array(variant), pageInfo }), images: z.object({ nodes: z.array(image), pageInfo }), media: z.object({ nodes: z.array(z.object({ id: z.string(), mediaContentType: z.enum(['IMAGE','VIDEO','EXTERNAL_VIDEO','MODEL_3D']) }).passthrough()), pageInfo }) });
export const catalogCollectionSchema = z.object({ metafields:z.array(metafield).optional(), id: z.string().startsWith('gid://shopify/Collection/'), handle: z.string().min(1), title: z.string(), description: z.string(), updatedAt: z.iso.datetime(), image: image.nullable(), products: z.object({ nodes: z.array(z.object({ id: z.string().startsWith('gid://shopify/Product/') })), pageInfo }) });
export const catalogItemSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('product'), data: catalogProductSchema }), z.object({ kind: z.literal('collection'), data: catalogCollectionSchema })]);
export const catalogResponseSchema = z.object({ status: z.enum(['NOT_CONFIGURED','NOT_SYNCED','IN_PROGRESS','STALE','FRESH']), completedAt: z.iso.datetime().nullable(), items: z.array(catalogItemSchema), nextCursor: z.string().nullable() });
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;
export const catalogSyncResponseSchema = z.object({ status: z.enum(['NOT_SYNCED','IN_PROGRESS','STALE','FRESH','STARTED_OR_RESUMED','products','collections','complete']), completedAt: z.iso.datetime().nullable() });
export const catalogHttpQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(300).optional(),
  q: z.string().min(1).max(200).optional(),
  available: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  collectionId: z.string().startsWith('gid://shopify/Collection/').max(300).optional(),
});
export const catalogJobSchema = z.strictObject({
  ticket: z.string().min(1).max(4096),
});
export const merchantLoginRequestSchema = z.strictObject({ email: z.email().max(320), password: z.string().min(8).max(200) });
export const merchantLoginResponseSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const catalogDelegationRequestSchema = z.strictObject({ action: z.enum(['start','step']) });
export const catalogDelegationResponseSchema = z.strictObject({ jobId: z.uuid(), ticket: z.string().min(1).max(4096), expiresAt: z.iso.datetime() });
