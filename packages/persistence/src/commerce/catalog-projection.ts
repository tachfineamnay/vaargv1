import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { collectionSchema, productSchema, type Collection, type Product } from './shopify.js';

/**
 * FL03 normalized catalog projection write side. Every function receives the
 * store-scoped transaction client from the import checkpoint (the caller
 * guarantees `app.store_id` is set and RLS is enforced) and mutates ONLY the
 * market rows passed in the scope — reconciliation never touches another
 * market. The projection payload written by the importer is the provider
 * evidence; these tables are derived and rebuildable at any time.
 */

export const marketScopeSchema = z.strictObject({
  storeId: z.uuid(),
  country: z.string().regex(/^[A-Z]{2}$/),
  language: z.string().regex(/^[A-Z]{2,3}$/),
});
export type MarketScope = z.infer<typeof marketScopeSchema>;

/** Deterministic text normalization shared by the projection and search reads. */
export function normalizeText(value: string): string {
  // Strip control characters without a control-character regex (lint rule).
  const stripped = Array.from(value.normalize('NFKC').toLowerCase()).map((char) => (char >= '\u0020' && char !== '\u007f' ? char : ' ')).join('');
  return stripped.replace(/\s+/g, ' ').trim();
}

/** Stable content hash over the normalized text fields (embedding incrementality). */
export function catalogContentHash(parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

function searchBody(product: Product): { body: string; tags: string[] } {
  const tags = product.tags.map((tag) => normalizeText(tag)).filter((tag) => tag.length > 0);
  const optionText = product.options?.flatMap((option) => option.optionValues.map((value) => value.name)) ?? [];
  const metafieldText = product.metafields?.filter((metafield) => metafield !== null).map((metafield) => `${metafield.namespace}.${metafield.key} ${metafield.value}`) ?? [];
  const body = normalizeText([
    product.description,
    product.productType,
    product.vendor,
    tags.join(' '),
    normalizeText(optionText.join(' ')),
    normalizeText(metafieldText.join(' ')),
  ].filter((part) => part.length > 0).join(' '));
  return { body, tags };
}

function mediaRows(product: Product): { mediaId: string; mediaType: string; ordinal: number; url: string; alt: string | null; previewUrl: string | null }[] {
  return product.media.nodes.map((media, ordinal) => {
    const previewUrl = media.previewImage?.url ?? null;
    const alt = media.alt ?? media.previewImage?.altText ?? null;
    switch (media.__typename) {
      case 'MediaImage': {
        const url = media.image?.url ?? previewUrl;
        if (!url) return null;
        return { mediaId: media.id, mediaType: 'IMAGE', ordinal, url, alt, previewUrl };
      }
      case 'Video':
      case 'Model3d':
        return { mediaId: media.id, mediaType: media.mediaContentType, ordinal, url: media.sources[0]?.url ?? previewUrl ?? '', alt, previewUrl };
      case 'ExternalVideo':
        return { mediaId: media.id, mediaType: 'EXTERNAL_VIDEO', ordinal, url: media.originUrl, alt, previewUrl };
    }
  }).filter((row): row is NonNullable<typeof row> => row !== null && row.url !== '');
}

function numericAmount(value: string): string {
  // Exact decimal: normalize the provider string into the column scale.
  return (Math.round(Number(value) * 1_000_000) / 1_000_000).toFixed(6);
}

/** Apply one committed import page to the normalized tables, in-transaction. */
export async function applyCatalogPage(client: PoolClient, scope: MarketScope, phase: 'products' | 'collections', generation: string, rawItems: unknown[]): Promise<void> {
  const parsedScope = marketScopeSchema.parse(scope);
  if (phase === 'products') {
    const items = rawItems.map((item) => productSchema.parse(item));
    for (const product of items) await upsertProduct(client, parsedScope, generation, product);
    return;
  }
  const items = rawItems.map((item) => collectionSchema.parse(item));
  for (const collection of items) await upsertCollection(client, parsedScope, generation, collection);
}

async function upsertProduct(client: PoolClient, scope: MarketScope, generation: string, product: Product): Promise<void> {
  const args = [scope.storeId, scope.country, scope.language];
  const titleNormalized = normalizeText(product.title);
  const { body, tags } = searchBody(product);
  const descriptionNormalized = body;
  const publishedAt = product.publishedAt ? new Date(product.publishedAt) : null;
  await client.query(
    `INSERT INTO catalog_products(store_id,country,language,product_gid,handle,title,title_normalized,description,description_normalized,product_type,vendor,tags,options,available_for_sale,published_at,provider_updated_at,generation,visible,observed_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,$15,$16,true,now())
     ON CONFLICT (store_id,country,language,product_gid) DO UPDATE SET
       handle=EXCLUDED.handle,title=EXCLUDED.title,title_normalized=EXCLUDED.title_normalized,
       description=EXCLUDED.description,description_normalized=EXCLUDED.description_normalized,
       product_type=EXCLUDED.product_type,vendor=EXCLUDED.vendor,tags=EXCLUDED.tags,options=EXCLUDED.options,
       available_for_sale=EXCLUDED.available_for_sale,published_at=EXCLUDED.published_at,
       provider_updated_at=EXCLUDED.provider_updated_at,generation=EXCLUDED.generation,visible=true,observed_at=now()`,
    [...args, product.id, product.handle, product.title, titleNormalized, product.description, descriptionNormalized,
      product.productType, product.vendor, product.tags, JSON.stringify(product.options ?? []), product.availableForSale,
      publishedAt, new Date(product.updatedAt), generation],
  );
  // Variants, media and attributes are replaced deterministically per product
  // page (the adapter delivers the complete lists for each product).
  await client.query('DELETE FROM catalog_variants WHERE store_id=$1 AND country=$2 AND language=$3 AND product_gid=$4', [...args, product.id]);
  for (const [index, variant] of product.variants.nodes.entries()) {
    await client.query(
      `INSERT INTO catalog_variants(store_id,country,language,variant_gid,product_gid,position,title,sku,selected_options,available_for_sale,currently_not_in_stock,quantity_available,price_amount,compare_at_amount,currency,image_url,image_alt,generation,visible)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,true)`,
      [...args, variant.id, product.id, variant.position ?? index, variant.title, variant.sku ?? null,
        JSON.stringify(variant.selectedOptions), variant.availableForSale, variant.currentlyNotInStock ?? false,
        variant.quantityAvailable ?? null, numericAmount(variant.price.amount),
        variant.compareAtPrice ? numericAmount(variant.compareAtPrice.amount) : null, variant.price.currencyCode,
        variant.image?.url ?? null, variant.image?.altText ?? null, generation],
    );
  }
  await client.query('DELETE FROM catalog_product_media WHERE store_id=$1 AND country=$2 AND language=$3 AND product_gid=$4', [...args, product.id]);
  for (const media of mediaRows(product)) {
    await client.query(
      `INSERT INTO catalog_product_media(store_id,country,language,product_gid,media_id,media_type,ordinal,url,alt,preview_url,generation)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [...args, product.id, media.mediaId, media.mediaType, media.ordinal, media.url, media.alt, media.previewUrl, generation],
    );
  }
  await client.query('DELETE FROM catalog_product_attributes WHERE store_id=$1 AND country=$2 AND language=$3 AND product_gid=$4', [...args, product.id]);
  for (const option of product.options ?? []) {
    for (const value of option.optionValues) {
      await client.query(
        `INSERT INTO catalog_product_attributes(store_id,country,language,product_gid,source,name,value,value_type,generation)
         VALUES($1,$2,$3,$4,'option',$5,$6,NULL,$7) ON CONFLICT DO NOTHING`,
        [...args, product.id, option.name, value.name, generation],
      );
    }
  }
  for (const metafield of product.metafields ?? []) {
    if (!metafield) continue;
    await client.query(
      `INSERT INTO catalog_product_attributes(store_id,country,language,product_gid,source,name,value,value_type,generation)
       VALUES($1,$2,$3,$4,'metafield',$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [...args, product.id, `${metafield.namespace}.${metafield.key}`, metafield.value, metafield.type, generation],
    );
  }
  await client.query(
    `INSERT INTO catalog_search_documents(store_id,country,language,product_gid,handle,title_normalized,body_normalized,tags_normalized,content_hash,generation,visible)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
     ON CONFLICT (store_id,country,language,product_gid) DO UPDATE SET
       handle=EXCLUDED.handle,title_normalized=EXCLUDED.title_normalized,body_normalized=EXCLUDED.body_normalized,
       tags_normalized=EXCLUDED.tags_normalized,content_hash=EXCLUDED.content_hash,generation=EXCLUDED.generation,visible=true,observed_at=now()`,
    [...args, product.id, product.handle, titleNormalized, descriptionNormalized, tags,
      catalogContentHash([titleNormalized, descriptionNormalized, tags.join(' '), product.productType, product.vendor]), generation],
  );
}

async function upsertCollection(client: PoolClient, scope: MarketScope, generation: string, collection: Collection): Promise<void> {
  const args = [scope.storeId, scope.country, scope.language];
  await client.query(
    `INSERT INTO catalog_collections(store_id,country,language,collection_gid,handle,title,title_normalized,description,image_url,image_alt,generation,visible)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
     ON CONFLICT (store_id,country,language,collection_gid) DO UPDATE SET
       handle=EXCLUDED.handle,title=EXCLUDED.title,title_normalized=EXCLUDED.title_normalized,
       description=EXCLUDED.description,image_url=EXCLUDED.image_url,image_alt=EXCLUDED.image_alt,
       generation=EXCLUDED.generation,visible=true,observed_at=now()`,
    [...args, collection.id, collection.handle, collection.title, normalizeText(collection.title), collection.description,
      collection.image?.url ?? null, collection.image?.altText ?? null, generation],
  );
  // The collection payload carries the full membership; replace it exactly.
  await client.query('DELETE FROM catalog_collection_members WHERE store_id=$1 AND country=$2 AND language=$3 AND collection_gid=$4', [...args, collection.id]);
  // Members are only inserted when the product row exists (products phase runs
  // first within a sweep); membership for unknown products is not fabricated.
  await client.query(
    `INSERT INTO catalog_collection_members(store_id,country,language,collection_gid,product_gid,generation)
     SELECT $1,$2,$3,$4,ref.value->>'id',$5
     FROM jsonb_array_elements($6::jsonb) AS ref(value)
     JOIN catalog_products p ON p.store_id=$1 AND p.country=$2 AND p.language=$3 AND p.product_gid=ref.value->>'id'
     ON CONFLICT DO NOTHING`,
    [...args, collection.id, generation, JSON.stringify(collection.products.nodes)],
  );
}

/**
 * Completion-time reconciliation, in the same transaction as the phase ->
 * complete checkpoint. Rows from an older generation were not seen in the
 * finished sweep: they stay stored as evidence but stop being served. Scope
 * is strictly the current market; other markets are never touched.
 */
export async function reconcileCatalogGeneration(client: PoolClient, scope: MarketScope, generation: string): Promise<void> {
  const args = [scope.storeId, scope.country, scope.language, generation];
  await client.query('UPDATE catalog_products SET visible=false WHERE store_id=$1 AND country=$2 AND language=$3 AND generation<>$4', args);
  await client.query('UPDATE catalog_variants SET visible=false WHERE store_id=$1 AND country=$2 AND language=$3 AND generation<>$4', args);
  await client.query('UPDATE catalog_collections SET visible=false WHERE store_id=$1 AND country=$2 AND language=$3 AND generation<>$4', args);
  await client.query('UPDATE catalog_search_documents SET visible=false WHERE store_id=$1 AND country=$2 AND language=$3 AND generation<>$4', args);
  await client.query(`DELETE FROM catalog_collection_members WHERE store_id=$1 AND country=$2 AND language=$3 AND generation<>$4`, args);
  await client.query(`DELETE FROM catalog_collection_members WHERE store_id=$1 AND country=$2 AND language=$3 AND collection_gid IN (SELECT collection_gid FROM catalog_collections WHERE store_id=$1 AND country=$2 AND language=$3 AND visible=false)`, args);
}
