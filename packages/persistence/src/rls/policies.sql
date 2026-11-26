-- VAARG V1 — Row Level Security policies (migration 0001).
-- Every tenant-scoped table is filtered by the app.store_id GUC, set per
-- transaction via SET LOCAL. The runtime role vaarg_app has NO BYPASSRLS,
-- so these policies always apply. The guarded expression
--   (current_setting('app.store_id', true) <> '' AND store_id = <gucs>::uuid)
-- denies access when the GUC is unset (NULL) or empty, and never raises a
-- cast error on an empty value.

-- Enable + force RLS on every tenant-scoped table.
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores FORCE ROW LEVEL SECURITY;
ALTER TABLE merchant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_users FORCE ROW LEVEL SECURITY;
ALTER TABLE store_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
ALTER TABLE customer_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE storefront_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE storefront_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;
ALTER TABLE marketing_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_inbox FORCE ROW LEVEL SECURITY;
ALTER TABLE visitor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_sessions FORCE ROW LEVEL SECURITY;

-- stores: full CRUD scoped to the active store context.
CREATE POLICY stores_select ON stores
  FOR SELECT USING (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  );
CREATE POLICY stores_insert ON stores
  FOR INSERT WITH CHECK (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  );
CREATE POLICY stores_update ON stores
  FOR UPDATE USING (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  );
CREATE POLICY stores_delete ON stores
  FOR DELETE USING (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  );

-- Child tables: ALL privileges scoped to the active store context.
CREATE POLICY merchant_users_all ON merchant_users
  FOR ALL USING (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  );
CREATE POLICY store_memberships_all ON store_memberships
  FOR ALL USING (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  );
CREATE POLICY customers_all ON customers
  FOR ALL USING (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  );
CREATE POLICY customer_identities_all ON customer_identities
  FOR ALL USING (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  );
CREATE POLICY storefront_configs_all ON storefront_configs
  FOR ALL USING (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  );
CREATE POLICY consent_records_all ON consent_records
  FOR ALL USING (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  );
CREATE POLICY marketing_permissions_all ON marketing_permissions
  FOR ALL USING (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  );
CREATE POLICY privacy_requests_all ON privacy_requests
  FOR ALL USING (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  );
CREATE POLICY outbox_events_all ON outbox_events
  FOR ALL USING (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  );
CREATE POLICY idempotency_keys_all ON idempotency_keys
  FOR ALL USING (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  );
CREATE POLICY audit_logs_all ON audit_logs
  FOR ALL USING (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  );
CREATE POLICY webhook_inbox_all ON webhook_inbox
  FOR ALL USING (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  );
CREATE POLICY visitor_sessions_all ON visitor_sessions
  FOR ALL USING (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.store_id', true) <> ''
    AND store_id = current_setting('app.store_id', true)::uuid
  );
