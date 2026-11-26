import { Injectable } from '@nestjs/common';
import {
  catalogQuerySchema,
  echoResponseSchema,
  parseStoreContext,
  STORE_ID_SCHEMA,
  type CatalogList,
} from '@vaarg/shared';

/**
 * Catalog boundary. P00 intentionally avoids premature business schemas:
 * this endpoint validates the store context and query contract and returns a
 * typed, honest response. Actual catalog reads against Shopify belong to P02.
 */
@Injectable()
export class CatalogService {
  async list(query: unknown, storeId: string): Promise<CatalogList> {
    const parsed = catalogQuerySchema.parse(query ?? {});
    const safeStore = STORE_ID_SCHEMA.parse(storeId);
    const context = parseStoreContext({ storeId: safeStore, market: 'default' });

    return echoResponseSchema.parse({
      message: `catalog query accepted for store ${context.storeId} (limit ${parsed.limit})`,
      storeId: context.storeId,
      receivedAt: new Date().toISOString(),
    });
  }
}
