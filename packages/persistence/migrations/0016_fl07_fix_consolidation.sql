-- FL07-FIX — Industrial core consolidation.
-- Forward migration after 0015_fl07_agentic_surfaces_and_streams.sql.
-- Historical migrations are untouched. All additions are additive and forward-only.

-- ---------------------------------------------------------------------------
-- FIX01 — Atomic proposal publication: durable idempotent publication ledger.
-- One row per (store, idempotency key). Concurrent identical requests serialize
-- on the proposal row lock and the unique index; distinct payloads conflict.
-- ---------------------------------------------------------------------------
CREATE TABLE proposal_publications (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  publication_id uuid NOT NULL,
  run_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  session_id uuid NOT NULL,
  idempotency_key varchar(200),
  payload_hash char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('applied', 'replayed', 'rejected', 'stale', 'conflict')),
  experience_revision bigint CHECK (experience_revision IS NULL OR experience_revision >= 0),
  context_version bigint NOT NULL CHECK (context_version >= 0),
  result jsonb NOT NULL CHECK (pg_column_size(result) <= 65536),
  retention_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, publication_id),
  UNIQUE (store_id, idempotency_key) WHERE idempotency_key IS NOT NULL,
  FOREIGN KEY (store_id, run_id)
    REFERENCES agent_runs(store_id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, proposal_id)
    REFERENCES action_proposals(store_id, proposal_id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, session_id)
    REFERENCES visitor_sessions(store_id, session_id) ON DELETE CASCADE
);
CREATE INDEX proposal_publications_run_idx
  ON proposal_publications(store_id, run_id);
CREATE INDEX proposal_publications_proposal_idx
  ON proposal_publications(store_id, proposal_id);
CREATE INDEX proposal_publications_retention_idx
  ON proposal_publications(store_id, retention_expires_at);

ALTER TABLE proposal_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_publications FORCE ROW LEVEL SECURITY;
CREATE POLICY proposal_publications_tenant ON proposal_publications
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON proposal_publications TO vaarg_app;

-- ---------------------------------------------------------------------------
-- FIX04 — Stable provider-call identity. The existing model_usage.reservation_id
-- is retained; add an explicit logical provider-call ledger that makes one
-- reservation per logical call and records unknown/ambiguous outcomes.
-- ---------------------------------------------------------------------------
ALTER TABLE model_usage ADD COLUMN IF NOT EXISTS provider_call_id varchar(200);
ALTER TABLE model_usage ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'reserved'
  CHECK (status IN ('reserved', 'reconciled', 'abandoned', 'unknown', 'failed'));
ALTER TABLE model_usage ADD COLUMN IF NOT EXISTS abandoned_reason varchar(80);
CREATE UNIQUE INDEX model_usage_store_provider_call_uidx
  ON model_usage(store_id, provider_call_id)
  WHERE provider_call_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- FIX05 — Distributed provider admission ledger (Valkey is the fast path; this
-- table is the durable, PostgreSQL-authoritative per-store quota/usage record).
-- Provider calls are admitted only when an explicit budget allocation exists.
-- ---------------------------------------------------------------------------
CREATE TABLE provider_admission_ledger (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  allocation_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('hermes_inference', 'query_embedding', 'document_embedding', 'background_reindex')),
  provider text NOT NULL CHECK (provider IN ('gemini', 'deepseek')),
  model varchar(120) NOT NULL,
  scope_key varchar(200) NOT NULL,
  max_requests integer NOT NULL CHECK (max_requests > 0),
  max_cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (max_cost_usd >= 0),
  used_requests integer NOT NULL DEFAULT 0 CHECK (used_requests >= 0),
  used_cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (used_cost_usd >= 0),
  active_requests integer NOT NULL DEFAULT 0 CHECK (active_requests >= 0),
  authorized boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, allocation_id),
  UNIQUE (store_id, purpose, scope_key, provider, model)
);
CREATE INDEX provider_admission_ledger_expiry_idx
  ON provider_admission_ledger(store_id, expires_at);
ALTER TABLE provider_admission_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_admission_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_admission_ledger_tenant ON provider_admission_ledger
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON provider_admission_ledger TO vaarg_app;

-- ---------------------------------------------------------------------------
-- FIX07 — Session-scoped anonymous consent. Append-only evidence keyed by the
-- anonymous session (never a synthetic customer). Separate analytics and
-- personalization purposes. Effective projection + expiry + withdrawal.
-- No optional behavioral collection is performed before an explicit grant.
-- ---------------------------------------------------------------------------
CREATE TABLE anonymous_consent_records (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  record_id uuid NOT NULL,
  session_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('analytics', 'personalization')),
  granted boolean NOT NULL,
  source text NOT NULL CHECK (source IN ('user_action', 'merchant_policy', 'legal_basis')),
  note text,
  version integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, record_id),
  FOREIGN KEY (store_id, session_id)
    REFERENCES visitor_sessions(store_id, session_id) ON DELETE CASCADE
);
CREATE INDEX anonymous_consent_records_session_idx
  ON anonymous_consent_records(store_id, session_id, purpose, created_at);
CREATE INDEX anonymous_consent_records_expiry_idx
  ON anonymous_consent_records(store_id, expires_at);

CREATE TABLE anonymous_consent_projections (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('analytics', 'personalization')),
  granted boolean NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, session_id, purpose),
  FOREIGN KEY (store_id, session_id)
    REFERENCES visitor_sessions(store_id, session_id) ON DELETE CASCADE
);

ALTER TABLE anonymous_consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE anonymous_consent_records FORCE ROW LEVEL SECURITY;
ALTER TABLE anonymous_consent_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE anonymous_consent_projections FORCE ROW LEVEL SECURITY;
CREATE POLICY anonymous_consent_records_tenant ON anonymous_consent_records
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY anonymous_consent_projections_tenant ON anonymous_consent_projections
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON anonymous_consent_records TO vaarg_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON anonymous_consent_projections TO vaarg_app;

-- ---------------------------------------------------------------------------
-- FIX10 — Distributed abuse protection ledger (Valkey fast path; durable
-- per-identity/aggregate counters for login attempts, session/conversation/run
-- creation and public retrieval).
-- ---------------------------------------------------------------------------
CREATE TABLE abuse_limit_events (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  bucket_key varchar(200) NOT NULL,
  bucket_window text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN
    ('merchant_login', 'anonymous_session', 'conversation_create', 'run_create', 'public_retrieval')),
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  retention_expires_at timestamptz NOT NULL,
  PRIMARY KEY (store_id, event_id)
);
CREATE INDEX abuse_limit_events_bucket_idx
  ON abuse_limit_events(store_id, bucket_key, observed_at);
ALTER TABLE abuse_limit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE abuse_limit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY abuse_limit_events_tenant ON abuse_limit_events
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON abuse_limit_events TO vaarg_app;

-- Update the intelligence retention helper so publication rows are purged too.
CREATE OR REPLACE FUNCTION purge_expired_intelligence(p_store_id uuid, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_run_events bigint := 0;
  v_proposals bigint := 0;
  v_tools bigint := 0;
  v_usage bigint := 0;
  v_summaries bigint := 0;
  v_messages bigint := 0;
  v_runs bigint := 0;
  v_conversations bigint := 0;
  v_publications bigint := 0;
BEGIN
  DELETE FROM agent_run_events WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_run_events = ROW_COUNT;

  DELETE FROM action_proposals
   WHERE store_id = p_store_id AND expires_at <= p_now
     AND status IN ('proposed', 'pending_confirmation', 'stale', 'rejected', 'superseded', 'cancelled', 'expired', 'unavailable');
  GET DIAGNOSTICS v_proposals = ROW_COUNT;

  DELETE FROM proposal_publications WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_publications = ROW_COUNT;

  DELETE FROM tool_invocations WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_tools = ROW_COUNT;

  DELETE FROM model_usage WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_usage = ROW_COUNT;

  DELETE FROM conversation_summaries WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_summaries = ROW_COUNT;

  DELETE FROM messages WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_messages = ROW_COUNT;

  DELETE FROM agent_runs
   WHERE store_id = p_store_id AND retention_expires_at <= p_now
     AND status IN ('completed', 'failed', 'cancelled', 'superseded', 'budget_exceeded', 'timed_out', 'unknown');
  GET DIAGNOSTICS v_runs = ROW_COUNT;

  DELETE FROM conversations WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_conversations = ROW_COUNT;

  RETURN jsonb_build_object(
    'agent_run_events', v_run_events,
    'action_proposals', v_proposals,
    'proposal_publications', v_publications,
    'tool_invocations', v_tools,
    'model_usage', v_usage,
    'conversation_summaries', v_summaries,
    'messages', v_messages,
    'agent_runs', v_runs,
    'conversations', v_conversations
  );
END;
$$;
