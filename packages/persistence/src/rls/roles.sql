-- VAARG V1 — runtime role and extensions.
-- Created by the migration runner as superuser. The application connects
-- as vaarg_app, which has NO BYPASSRLS and NO superuser privileges.

-- Extensions: vector (pgvector) + pg_trgm (trigram search).
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Restricted runtime role. NO BYPASSRLS, NO superuser, NO createdb.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vaarg_app') THEN
    CREATE ROLE vaarg_app LOGIN PASSWORD 'vaarg_app_runtime_password';
  END IF;
END
$$;

ALTER ROLE vaarg_app WITH NOSUPERUSER NOCREATEDB NOINHERIT;
-- Explicitly ensure the role cannot bypass RLS.
ALTER ROLE vaarg_app NOBYPASSRLS;

-- Grant the runtime role the minimal privileges needed.
GRANT USAGE ON SCHEMA public TO vaarg_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vaarg_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vaarg_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vaarg_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO vaarg_app;
