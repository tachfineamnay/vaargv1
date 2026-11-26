-- Durable redelivery receipts; the page checkpoint and receipt commit together.
CREATE TABLE catalog_job_receipts (
  store_id uuid NOT NULL,
  country text NOT NULL,
  language text NOT NULL,
  job_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('start','step')),
  generation uuid NOT NULL,
  phase text NOT NULL,
  cursor text,
  cursor_history text[] NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(store_id,job_id),
  FOREIGN KEY(store_id,country,language) REFERENCES catalog_imports(store_id,country,language) ON DELETE CASCADE
);
ALTER TABLE catalog_job_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_job_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_job_receipts_tenant ON catalog_job_receipts USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid) WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON catalog_job_receipts TO vaarg_app;
