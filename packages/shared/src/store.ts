import { z } from 'zod';

export const STORE_ID_SCHEMA = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, 'STORE_ID may only contain alphanumerics, dashes and underscores');

export const storeContextSchema = z.object({
  storeId: STORE_ID_SCHEMA,
  market: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, 'market may only contain alphanumerics, dashes and underscores')
    .default('default'),
});

export type StoreContext = z.infer<typeof storeContextSchema>;

export function parseStoreContext(raw: unknown): StoreContext {
  return storeContextSchema.parse(raw);
}

export function requireStoreId(raw: unknown): string {
  return STORE_ID_SCHEMA.parse(raw);
}
