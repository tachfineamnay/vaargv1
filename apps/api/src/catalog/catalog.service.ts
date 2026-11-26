import { Injectable } from '@nestjs/common';
import {
  catalogItemSchema,
  catalogListSchema,
  catalogQuerySchema,
  STORE_ID_SCHEMA,
  type CatalogItem,
  type CatalogList,
} from '@vaarg/shared';
import { DatabaseClient } from '../infra/database-client.js';

@Injectable()
export class CatalogService {
  constructor(private readonly database: DatabaseClient) {}

  async list(query: unknown, storeId: string): Promise<CatalogList> {
    const parsed = catalogQuerySchema.parse(query ?? {});
    const safeStore = STORE_ID_SCHEMA.parse(storeId);

    const params: unknown[] = [safeStore];
    let sql = `SELECT id, store_id AS "storeId", title, status
               FROM catalog_items
               WHERE store_id = $1`;
    if (parsed.cursor) {
      params.push(parsed.cursor);
      sql += ` AND id > $2`;
    }
    sql += ` ORDER BY id ASC LIMIT $${params.length + 1}`;
    params.push(parsed.limit + 1);

    const rows = await this.database.query<Record<string, unknown>>(sql, params);
    const items: CatalogItem[] = rows.slice(0, parsed.limit).map((row) =>
      catalogItemSchema.parse({
        id: String(row.id),
        storeId: String(row.storeId),
        title: String(row.title),
        status: row.status as CatalogItem['status'],
      }),
    );
    const nextCursor =
      rows.length > parsed.limit ? String(rows[rows.length - 1]?.id ?? '') || null : null;

    return catalogListSchema.parse({ items, nextCursor });
  }
}
