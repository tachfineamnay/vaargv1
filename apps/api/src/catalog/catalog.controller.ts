import { Controller, Get, Query } from '@nestjs/common';
import { STORE_ID_SCHEMA } from '@vaarg/shared';
import { CatalogService } from './catalog.service.js';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  async list(
    @Query('q') q: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('storeId') storeId: string | undefined,
  ): Promise<unknown> {
    const safeStore = STORE_ID_SCHEMA.parse(storeId ?? 'demo');
    return this.catalogService.list(
      {
        ...(q === undefined ? {} : { q }),
        ...(limit === undefined ? {} : { limit: Number(limit) }),
        ...(cursor === undefined ? {} : { cursor }),
      },
      safeStore,
    );
  }
}
