-- Context-specific Storefront snapshots; absence is not proof of global deletion.
CREATE TABLE catalog_imports (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  country text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  language text NOT NULL CHECK (language ~ '^[A-Z]{2,3}$'),
  generation uuid NOT NULL,
  phase text NOT NULL CHECK (phase IN ('products', 'collections', 'complete')),
  cursor text,
  cursor_history text[] NOT NULL DEFAULT ARRAY[]::text[],
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (store_id, country, language)
);
CREATE TABLE catalog_projection (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  country text NOT NULL,
  language text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('product', 'collection')),
  shopify_id text NOT NULL,
  payload jsonb NOT NULL,
  seen_generation uuid NOT NULL,
  visible boolean NOT NULL DEFAULT true,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, country, language, kind, shopify_id),
  FOREIGN KEY (store_id, country, language) REFERENCES catalog_imports(store_id, country, language) ON DELETE CASCADE
);
CREATE INDEX catalog_projection_visible_idx ON catalog_projection(store_id, country, language, kind, visible);
ALTER TABLE catalog_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_imports FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_projection FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_imports_tenant ON catalog_imports USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid) WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY catalog_projection_tenant ON catalog_projection USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid) WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON catalog_imports, catalog_projection TO vaarg_app;
