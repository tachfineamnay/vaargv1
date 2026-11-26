-- FL03 — normalized, store-scoped catalog read projection.
-- Derived entirely from catalog_projection payloads (provider evidence);
-- rebuildable and synchronized in the same checkpoint transaction as the
-- imported page. Shopify remains the only commercial truth. Market-scoped
-- rows (store_id, country, language) ARE the localized snapshot, so no
-- second translation table is required. Forward-only; no existing table or
-- row is modified destructively.

CREATE TABLE catalog_products (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  country text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  language text NOT NULL CHECK (language ~ '^[A-Z]{2,3}$'),
  product_gid text NOT NULL CHECK (product_gid ~ '^gid://shopify/Product/'),
  handle text NOT NULL,
  title text NOT NULL,
  title_normalized text NOT NULL,
  description text NOT NULL,
  description_normalized text NOT NULL,
  product_type text NOT NULL,
  vendor text NOT NULL,
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  available_for_sale boolean NOT NULL,
  published_at timestamptz,
  provider_updated_at timestamptz NOT NULL,
  generation uuid NOT NULL,
  visible boolean NOT NULL DEFAULT true,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, country, language, product_gid),
  FOREIGN KEY (store_id, country, language) REFERENCES catalog_imports(store_id, country, language) ON DELETE CASCADE
);
CREATE UNIQUE INDEX catalog_products_handle_uidx ON catalog_products(store_id, country, language, handle);
CREATE INDEX catalog_products_visible_idx ON catalog_products(store_id, country, language, visible);
CREATE INDEX catalog_products_title_idx ON catalog_products(store_id, country, language, visible, title);
CREATE INDEX catalog_products_type_idx ON catalog_products(store_id, country, language, visible, product_type);
CREATE INDEX catalog_products_vendor_idx ON catalog_products(store_id, country, language, visible, vendor);
CREATE INDEX catalog_products_generation_idx ON catalog_products(store_id, country, language, generation);

-- Market-scoped variants: these rows carry the market price/availability
-- snapshot (variant_market_prices in PRD §7) because the whole projection is
-- per (store, country, language) context with explicit currency.
CREATE TABLE catalog_variants (
  store_id uuid NOT NULL,
  country text NOT NULL,
  language text NOT NULL,
  variant_gid text NOT NULL CHECK (variant_gid ~ '^gid://shopify/ProductVariant/'),
  product_gid text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  sku text,
  selected_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  available_for_sale boolean NOT NULL,
  currently_not_in_stock boolean NOT NULL DEFAULT false,
  quantity_available integer CHECK (quantity_available IS NULL OR quantity_available >= 0),
  price_amount numeric(20, 6) NOT NULL CHECK (price_amount >= 0),
  compare_at_amount numeric(20, 6) CHECK (compare_at_amount IS NULL OR compare_at_amount >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  image_url text,
  image_alt text,
  generation uuid NOT NULL,
  visible boolean NOT NULL DEFAULT true,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, country, language, variant_gid),
  FOREIGN KEY (store_id, country, language, product_gid) REFERENCES catalog_products(store_id, country, language, product_gid) ON DELETE CASCADE
);
CREATE INDEX catalog_variants_product_idx ON catalog_variants(store_id, country, language, product_gid, visible, position);
CREATE INDEX catalog_variants_price_idx ON catalog_variants(store_id, country, language, visible, currency, price_amount);
CREATE INDEX catalog_variants_generation_idx ON catalog_variants(store_id, country, language, generation);

CREATE TABLE catalog_product_media (
  store_id uuid NOT NULL,
  country text NOT NULL,
  language text NOT NULL,
  product_gid text NOT NULL,
  media_id text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('IMAGE', 'VIDEO', 'EXTERNAL_VIDEO', 'MODEL_3D')),
  ordinal integer NOT NULL,
  url text NOT NULL,
  alt text,
  preview_url text,
  generation uuid NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, country, language, product_gid, media_id),
  FOREIGN KEY (store_id, country, language, product_gid) REFERENCES catalog_products(store_id, country, language, product_gid) ON DELETE CASCADE
);
CREATE INDEX catalog_product_media_product_idx ON catalog_product_media(store_id, country, language, product_gid, ordinal);

-- Options and configured metafields only. Unconfigured metafields are never
-- persisted here (provider payloads keep them out already by binding config).
CREATE TABLE catalog_product_attributes (
  store_id uuid NOT NULL,
  country text NOT NULL,
  language text NOT NULL,
  product_gid text NOT NULL,
  source text NOT NULL CHECK (source IN ('option', 'metafield')),
  name text NOT NULL,
  value text NOT NULL,
  value_type text,
  generation uuid NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, country, language, product_gid, source, name, value),
  FOREIGN KEY (store_id, country, language, product_gid) REFERENCES catalog_products(store_id, country, language, product_gid) ON DELETE CASCADE
);
CREATE INDEX catalog_product_attributes_lookup_idx ON catalog_product_attributes(store_id, country, language, source, name, value);
CREATE INDEX catalog_product_attributes_product_idx ON catalog_product_attributes(store_id, country, language, product_gid);

CREATE TABLE catalog_collections (
  store_id uuid NOT NULL,
  country text NOT NULL,
  language text NOT NULL,
  collection_gid text NOT NULL CHECK (collection_gid ~ '^gid://shopify/Collection/'),
  handle text NOT NULL,
  title text NOT NULL,
  title_normalized text NOT NULL,
  description text NOT NULL,
  image_url text,
  image_alt text,
  generation uuid NOT NULL,
  visible boolean NOT NULL DEFAULT true,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, country, language, collection_gid),
  FOREIGN KEY (store_id, country, language) REFERENCES catalog_imports(store_id, country, language) ON DELETE CASCADE
);
CREATE UNIQUE INDEX catalog_collections_handle_uidx ON catalog_collections(store_id, country, language, handle);
CREATE INDEX catalog_collections_visible_idx ON catalog_collections(store_id, country, language, visible);
CREATE INDEX catalog_collections_generation_idx ON catalog_collections(store_id, country, language, generation);

-- Explicit product relationships: collection membership with provenance
-- (the collection gid). Membership rows are the relationship evidence; pair
-- materialization is derived at read time to avoid unbounded growth.
CREATE TABLE catalog_collection_members (
  store_id uuid NOT NULL,
  country text NOT NULL,
  language text NOT NULL,
  collection_gid text NOT NULL,
  product_gid text NOT NULL,
  generation uuid NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, country, language, collection_gid, product_gid),
  FOREIGN KEY (store_id, country, language, collection_gid) REFERENCES catalog_collections(store_id, country, language, collection_gid) ON DELETE CASCADE,
  FOREIGN KEY (store_id, country, language, product_gid) REFERENCES catalog_products(store_id, country, language, product_gid) ON DELETE CASCADE
);
CREATE INDEX catalog_collection_members_product_idx ON catalog_collection_members(store_id, country, language, product_gid);

-- Rebuildable lexical search foundation (FL04/FL05 consume; no embedding
-- provider is called in FL03). Content hashes enable future incremental
-- embedding generation without re-reading Shopify.
CREATE TABLE catalog_search_documents (
  store_id uuid NOT NULL,
  country text NOT NULL,
  language text NOT NULL,
  product_gid text NOT NULL,
  handle text NOT NULL,
  title_normalized text NOT NULL,
  body_normalized text NOT NULL,
  tags_normalized text[] NOT NULL DEFAULT ARRAY[]::text[],
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  generation uuid NOT NULL,
  visible boolean NOT NULL DEFAULT true,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, country, language, product_gid),
  FOREIGN KEY (store_id, country, language, product_gid) REFERENCES catalog_products(store_id, country, language, product_gid) ON DELETE CASCADE
);
CREATE INDEX catalog_search_documents_title_trgm_idx ON catalog_search_documents USING gin(title_normalized gin_trgm_ops);
CREATE INDEX catalog_search_documents_body_trgm_idx ON catalog_search_documents USING gin(body_normalized gin_trgm_ops);
CREATE INDEX catalog_search_documents_tags_idx ON catalog_search_documents USING gin(tags_normalized);
CREATE INDEX catalog_search_documents_generation_idx ON catalog_search_documents(store_id, country, language, generation);

ALTER TABLE catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_products FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_variants FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog_product_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_product_media FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog_product_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_product_attributes FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_collections FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog_collection_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_collection_members FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog_search_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_search_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY catalog_products_tenant ON catalog_products USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid) WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY catalog_variants_tenant ON catalog_variants USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid) WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY catalog_product_media_tenant ON catalog_product_media USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid) WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY catalog_product_attributes_tenant ON catalog_product_attributes USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid) WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY catalog_collections_tenant ON catalog_collections USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid) WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY catalog_collection_members_tenant ON catalog_collection_members USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid) WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY catalog_search_documents_tenant ON catalog_search_documents USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid) WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON catalog_products, catalog_variants, catalog_product_media, catalog_product_attributes, catalog_collections, catalog_collection_members, catalog_search_documents TO vaarg_app;
