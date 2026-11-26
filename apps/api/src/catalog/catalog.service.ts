import { Injectable } from '@nestjs/common';
import { catalogQuerySchema, STORE_ID_SCHEMA } from '@vaarg/shared';

/** The HTTP tenant resolver is not yet wired to the scoped catalog projection. */
@Injectable()
export class CatalogService {
  async list(query: unknown, storeId: string): Promise<{ status: 'NOT_CONFIGURED' }> {
    catalogQuerySchema.parse(query ?? {});
    STORE_ID_SCHEMA.parse(storeId);
    return { status: 'NOT_CONFIGURED' };
  }
}
