CREATE TABLE merchant_sessions (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  merchant_user_id uuid NOT NULL REFERENCES merchant_users(merchant_user_id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rotated', 'revoked')),
  expires_at timestamptz NOT NULL,
  rotated_from uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merchant_sessions_store_user_fk FOREIGN KEY (store_id, merchant_user_id) REFERENCES merchant_users(store_id, merchant_user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX merchant_sessions_store_token_uidx ON merchant_sessions(store_id, token_hash);
ALTER TABLE merchant_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY merchant_sessions_tenant ON merchant_sessions USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid) WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON merchant_sessions TO vaarg_app;
