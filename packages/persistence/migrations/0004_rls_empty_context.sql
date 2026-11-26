-- PostgreSQL can reorder boolean predicates; do not cast an empty tenant GUC.
-- Update only the P01 policies, leaving any other policies untouched.
DO $$
DECLARE p record; predicate text := 'store_id = NULLIF(current_setting(''app.store_id'', true), '''')::uuid';
BEGIN
  FOR p IN SELECT pol.polname, pol.polcmd, c.relname
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND pol.polname IN (
      'stores_select','stores_insert','stores_update','stores_delete',
      'merchant_users_all','store_memberships_all','customers_all','customer_identities_all',
      'storefront_configs_all','consent_records_all','marketing_permissions_all','privacy_requests_all',
      'outbox_events_all','idempotency_keys_all','audit_logs_all','webhook_inbox_all','visitor_sessions_all'
    )
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I', p.polname, p.relname)
      || CASE WHEN p.polcmd <> 'a' THEN ' USING (' || predicate || ')' ELSE '' END
      || CASE WHEN p.polcmd IN ('a', 'w', '*') THEN ' WITH CHECK (' || predicate || ')' ELSE '' END;
  END LOOP;
END $$;
