-- FL05 TASK 02 — PostgreSQL hybrid retrieval substrate (forward, after 0010).
-- Adds: (1) a trigger-maintained tsvector column with language-appropriate
-- configuration + GIN index on catalog_search_documents; (2) pgvector
-- embedding storage keyed by store, market, product reference, model,
-- model version, dimension and content hash. Previously applied migrations
-- are not modified. No embedding provider is called by this migration.

-- ---------------------------------------------------------------------------
-- 1. Full-text search vector (language-aware, trigger-maintained)
-- ---------------------------------------------------------------------------
-- Generated columns cannot take a per-row regconfig, so a BEFORE trigger
-- maps the market language to a text search configuration ('simple'
-- fallback keeps any language searchable without inventing a mapping).

ALTER TABLE catalog_search_documents ADD COLUMN search_vector tsvector;

CREATE FUNCTION catalog_search_documents_vector_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cfg regconfig;
BEGIN
  cfg := CASE lower(NEW.language)
    WHEN 'en' THEN 'english'::regconfig
    WHEN 'fr' THEN 'french'::regconfig
    WHEN 'de' THEN 'german'::regconfig
    WHEN 'es' THEN 'spanish'::regconfig
    WHEN 'it' THEN 'italian'::regconfig
    WHEN 'pt' THEN 'portuguese'::regconfig
    WHEN 'nl' THEN 'dutch'::regconfig
    WHEN 'ru' THEN 'russian'::regconfig
    ELSE 'simple'::regconfig
  END;
  NEW.search_vector := to_tsvector(
    cfg,
    coalesce(NEW.title_normalized, '') || ' ' ||
    coalesce(NEW.body_normalized, '') || ' ' ||
    coalesce(array_to_string(NEW.tags_normalized, ' '), '')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER catalog_search_documents_vector_trg
  BEFORE INSERT OR UPDATE OF title_normalized, body_normalized, tags_normalized, language
  ON catalog_search_documents
  FOR EACH ROW EXECUTE FUNCTION catalog_search_documents_vector_update();

-- Backfill existing rows with the same mapping (no-op on fresh installs).
UPDATE catalog_search_documents sd
SET search_vector = to_tsvector(
  CASE lower(sd.language)
    WHEN 'en' THEN 'english'::regconfig
    WHEN 'fr' THEN 'french'::regconfig
    WHEN 'de' THEN 'german'::regconfig
    WHEN 'es' THEN 'spanish'::regconfig
    WHEN 'it' THEN 'italian'::regconfig
    WHEN 'pt' THEN 'portuguese'::regconfig
    WHEN 'nl' THEN 'dutch'::regconfig
    WHEN 'ru' THEN 'russian'::regconfig
    ELSE 'simple'::regconfig
  END,
  coalesce(sd.title_normalized, '') || ' ' ||
  coalesce(sd.body_normalized, '') || ' ' ||
  coalesce(array_to_string(sd.tags_normalized, ' '), '')
)
WHERE sd.search_vector IS NULL;

CREATE INDEX catalog_search_documents_fts_idx
  ON catalog_search_documents USING gin(search_vector);

-- ---------------------------------------------------------------------------
-- 2. Embedding storage (pgvector, 768-dimension PRD baseline)
-- ---------------------------------------------------------------------------
-- Keyed by (store, market, product, model, model_version, dimension);
-- content_hash enables incremental reindexing and stale-embedding rejection.
-- The fixed vector(768) type plus CHECK keeps model/dimension compatibility
-- explicit: semantic queries MUST filter model + model_version + dimension
-- (enforced in the SearchPort SQL) so vectors are never compared across
-- models. A future baseline change lands in a new forward migration.

CREATE TABLE catalog_product_embeddings (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  country text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  language text NOT NULL CHECK (language ~ '^[A-Z]{2,3}$'),
  product_gid text NOT NULL CHECK (product_gid ~ '^gid://shopify/Product/'),
  model text NOT NULL CHECK (model ~ '^[a-z0-9][a-z0-9._-]{0,127}$'),
  model_version text NOT NULL CHECK (model_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  dimension integer NOT NULL CHECK (dimension = 768),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  embedding vector(768) NOT NULL,
  generation uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, country, language, product_gid, model, model_version),
  FOREIGN KEY (store_id, country, language, product_gid)
    REFERENCES catalog_products(store_id, country, language, product_gid) ON DELETE CASCADE
);

-- Reindex bookkeeping: find stale/missing embeddings per market + model.
CREATE INDEX catalog_product_embeddings_reindex_idx
  ON catalog_product_embeddings(store_id, country, language, model, model_version, content_hash);
CREATE INDEX catalog_product_embeddings_product_idx
  ON catalog_product_embeddings(store_id, country, language, product_gid);

-- Approximate nearest-neighbour for the semantic channel (cosine distance).
-- Queries always include the model/dimension predicate so the index serves
-- a single-model partition in practice.
CREATE INDEX catalog_product_embeddings_hnsw_idx
  ON catalog_product_embeddings USING hnsw (embedding vector_cosine_ops);

ALTER TABLE catalog_product_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_product_embeddings FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_product_embeddings_tenant ON catalog_product_embeddings
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON catalog_product_embeddings TO vaarg_app;
