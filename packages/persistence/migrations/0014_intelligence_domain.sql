-- FL06 TASK 01/08/09 — agentic intelligence domain & durable workflow execution correlation.
-- Forward migration after 0013_embedding_provider_identity.sql (historical migrations untouched).
-- Enforces store-scoped composite foreign keys, RLS (ENABLE + FORCE), vaarg_app grants,
-- bounded delegation depth (depth IN (0, 1), parent_run_id = root_run_id), atomic budget columns,
-- verified direct provider constraints, and explicit retention controls.

-- ---------------------------------------------------------------------------
-- 1. conversations — visitor conversation threads bound to store + session
-- ---------------------------------------------------------------------------
CREATE TABLE conversations (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  session_id uuid NOT NULL,
  customer_id uuid,
  hermes_session_id varchar(200) NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'expired', 'deleted')),
  message_seq bigint NOT NULL DEFAULT 0 CHECK (message_seq >= 0),
  last_context_version bigint NOT NULL DEFAULT 0 CHECK (last_context_version >= 0),
  retention_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  PRIMARY KEY (store_id, conversation_id),
  UNIQUE (store_id, hermes_session_id),
  FOREIGN KEY (store_id, session_id)
    REFERENCES visitor_sessions(store_id, session_id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, customer_id)
    REFERENCES customers(store_id, customer_id) ON DELETE SET NULL (customer_id)
);
CREATE INDEX conversations_session_status_idx
  ON conversations(store_id, session_id, status, updated_at DESC);
CREATE INDEX conversations_retention_idx
  ON conversations(store_id, retention_expires_at);

-- ---------------------------------------------------------------------------
-- 2. agent_prompt_versions — versioned role prompt registry
-- ---------------------------------------------------------------------------
CREATE TABLE agent_prompt_versions (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  prompt_version_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('master', 'discovery', 'experience', 'commerce', 'memory', 'marketing', 'support')),
  version varchar(64) NOT NULL,
  prompt_sha256 char(64) NOT NULL,
  template_text text NOT NULL CHECK (char_length(template_text) <= 32768),
  input_schema_version varchar(32) NOT NULL,
  output_schema_version varchar(32) NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, prompt_version_id),
  UNIQUE (store_id, role, version)
);

-- ---------------------------------------------------------------------------
-- 3. provider_policies — direct Gemini API & DeepSeek API policies only
-- ---------------------------------------------------------------------------
CREATE TABLE provider_policies (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  provider_policy_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('gemini', 'deepseek')),
  model varchar(120) NOT NULL CHECK (
    model <> 'auto'
    AND position('*' IN model) = 0
    AND lower(model) NOT LIKE 'openrouter/%'
    AND lower(model) NOT LIKE 'nous/%'
  ),
  permitted_roles text[] NOT NULL CHECK (cardinality(permitted_roles) >= 1),
  max_context_tokens integer NOT NULL CHECK (max_context_tokens BETWEEN 1024 AND 2000000),
  max_output_tokens integer NOT NULL CHECK (max_output_tokens BETWEEN 128 AND 65536),
  timeout_ms integer NOT NULL CHECK (timeout_ms BETWEEN 1000 AND 300000),
  input_cost_per_million_usd numeric(12, 6) NOT NULL CHECK (input_cost_per_million_usd >= 0),
  output_cost_per_million_usd numeric(12, 6) NOT NULL CHECK (output_cost_per_million_usd >= 0),
  cache_read_cost_per_million_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cache_read_cost_per_million_usd >= 0),
  cache_write_cost_per_million_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cache_write_cost_per_million_usd >= 0),
  pricing_verified boolean NOT NULL DEFAULT false,
  allow_implicit_fallback boolean NOT NULL DEFAULT false CHECK (allow_implicit_fallback = false),
  availability text NOT NULL DEFAULT 'not_configured' CHECK (availability IN ('enabled', 'disabled', 'not_configured')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, provider_policy_id),
  UNIQUE (store_id, provider, model),
  CHECK (NOT pricing_verified OR input_cost_per_million_usd > 0 OR output_cost_per_million_usd > 0)
);

-- ---------------------------------------------------------------------------
-- 4. agent_policies — server-owned role capability, delegation & budget limits
-- ---------------------------------------------------------------------------
CREATE TABLE agent_policies (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  agent_policy_id uuid NOT NULL,
  policy_key varchar(80) NOT NULL,
  role text NOT NULL CHECK (role IN ('master', 'discovery', 'experience', 'commerce', 'memory', 'marketing', 'support')),
  allowed_capabilities text[] NOT NULL DEFAULT ARRAY[]::text[],
  delegation_enabled boolean NOT NULL DEFAULT false,
  max_concurrent_children integer NOT NULL DEFAULT 3 CHECK (max_concurrent_children BETWEEN 0 AND 3),
  max_delegation_depth integer NOT NULL DEFAULT 1 CHECK (max_delegation_depth BETWEEN 0 AND 1),
  max_total_children integer NOT NULL DEFAULT 6 CHECK (max_total_children BETWEEN 0 AND 12),
  max_total_tokens integer NOT NULL CHECK (max_total_tokens > 0),
  max_model_calls integer NOT NULL CHECK (max_model_calls > 0),
  max_tool_calls integer NOT NULL CHECK (max_tool_calls >= 0),
  max_cost_usd numeric(12, 6) NOT NULL CHECK (max_cost_usd > 0),
  max_duration_ms integer NOT NULL CHECK (max_duration_ms BETWEEN 1000 AND 300000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, agent_policy_id),
  UNIQUE (store_id, policy_key, role),
  CHECK (role = 'master' OR (delegation_enabled = false AND max_concurrent_children = 0 AND max_delegation_depth = 0))
);

-- ---------------------------------------------------------------------------
-- 5. agent_runs — durable parent & child run lifecycle + shared atomic budget
-- ---------------------------------------------------------------------------
CREATE TABLE agent_runs (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  root_run_id uuid NOT NULL,
  parent_run_id uuid,
  conversation_id uuid NOT NULL,
  session_id uuid NOT NULL,
  customer_id uuid,
  trigger_message_id uuid,
  role text NOT NULL CHECK (role IN ('master', 'discovery', 'experience', 'commerce', 'memory', 'marketing', 'support')),
  depth integer NOT NULL DEFAULT 0 CHECK (depth IN (0, 1)),
  status text NOT NULL CHECK (status IN (
    'queued', 'running', 'cancelling', 'completed', 'failed',
    'cancelled', 'superseded', 'budget_exceeded', 'timed_out', 'unknown'
  )),
  terminal_reason varchar(120),
  hermes_run_id varchar(200),
  hermes_session_id varchar(200),
  delegation_id varchar(200),
  provider text NOT NULL CHECK (provider IN ('gemini', 'deepseek')),
  model varchar(120) NOT NULL,
  prompt_version varchar(64) NOT NULL,
  policy_key varchar(80) NOT NULL,
  context_version bigint NOT NULL CHECK (context_version >= 0),
  published_experience_revision bigint CHECK (published_experience_revision IS NULL OR published_experience_revision >= 0),
  correlation_id varchar(128) NOT NULL,
  idempotency_key varchar(200),
  payload_hash char(64),
  budget_max_tokens integer NOT NULL CHECK (budget_max_tokens > 0),
  budget_max_model_calls integer NOT NULL CHECK (budget_max_model_calls > 0),
  budget_max_tool_calls integer NOT NULL CHECK (budget_max_tool_calls >= 0),
  budget_max_cost_usd numeric(12, 6) NOT NULL CHECK (budget_max_cost_usd > 0),
  budget_max_concurrent_children integer NOT NULL DEFAULT 3 CHECK (budget_max_concurrent_children BETWEEN 0 AND 3),
  budget_max_total_children integer NOT NULL DEFAULT 6 CHECK (budget_max_total_children BETWEEN 0 AND 12),
  reserved_tokens integer NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
  consumed_tokens integer NOT NULL DEFAULT 0 CHECK (consumed_tokens >= 0),
  reserved_model_calls integer NOT NULL DEFAULT 0 CHECK (reserved_model_calls >= 0),
  consumed_model_calls integer NOT NULL DEFAULT 0 CHECK (consumed_model_calls >= 0),
  reserved_tool_calls integer NOT NULL DEFAULT 0 CHECK (reserved_tool_calls >= 0),
  consumed_tool_calls integer NOT NULL DEFAULT 0 CHECK (consumed_tool_calls >= 0),
  reserved_cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (reserved_cost_usd >= 0),
  consumed_cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (consumed_cost_usd >= 0),
  active_children_count integer NOT NULL DEFAULT 0 CHECK (active_children_count BETWEEN 0 AND 3),
  total_children_spawned integer NOT NULL DEFAULT 0 CHECK (total_children_spawned >= 0),
  deadline_at timestamptz NOT NULL,
  cancel_requested_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  redacted_trace jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(redacted_trace) <= 32768),
  validated_output jsonb CHECK (validated_output IS NULL OR pg_column_size(validated_output) <= 65536),
  error_code varchar(80),
  error_message varchar(500),
  retention_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, run_id),
  FOREIGN KEY (store_id, root_run_id)
    REFERENCES agent_runs(store_id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, parent_run_id)
    REFERENCES agent_runs(store_id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, conversation_id)
    REFERENCES conversations(store_id, conversation_id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, session_id)
    REFERENCES visitor_sessions(store_id, session_id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, customer_id)
    REFERENCES customers(store_id, customer_id) ON DELETE SET NULL (customer_id),
  CHECK (
    (depth = 0 AND parent_run_id IS NULL AND root_run_id = run_id AND role = 'master')
    OR (depth = 1 AND parent_run_id IS NOT NULL AND parent_run_id = root_run_id AND parent_run_id <> run_id AND role <> 'master')
  )
);
CREATE UNIQUE INDEX agent_runs_store_hermes_run_uidx
  ON agent_runs(store_id, hermes_run_id)
  WHERE hermes_run_id IS NOT NULL;
CREATE UNIQUE INDEX agent_runs_store_session_idempotency_uidx
  ON agent_runs(store_id, session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX agent_runs_conversation_status_idx
  ON agent_runs(store_id, conversation_id, status, created_at DESC);
CREATE INDEX agent_runs_root_children_idx
  ON agent_runs(store_id, root_run_id, depth, status);
CREATE INDEX agent_runs_hermes_session_idx
  ON agent_runs(store_id, root_run_id, hermes_session_id)
  WHERE hermes_session_id IS NOT NULL;
CREATE INDEX agent_runs_retention_idx
  ON agent_runs(store_id, retention_expires_at);

-- ---------------------------------------------------------------------------
-- 6. messages — visitor & accepted Master assistant turns only
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  message_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  session_id uuid NOT NULL,
  run_id uuid,
  sequence bigint NOT NULL CHECK (sequence > 0),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  status text NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'superseded', 'cancelled', 'redacted')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 16384),
  structured_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(structured_payload) <= 65536),
  context_version bigint NOT NULL CHECK (context_version >= 0),
  correlation_id varchar(128) NOT NULL,
  idempotency_key varchar(200),
  payload_hash char(64),
  retention_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, message_id),
  UNIQUE (store_id, conversation_id, sequence),
  FOREIGN KEY (store_id, conversation_id)
    REFERENCES conversations(store_id, conversation_id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, session_id)
    REFERENCES visitor_sessions(store_id, session_id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, run_id)
    REFERENCES agent_runs(store_id, run_id) ON DELETE SET NULL (run_id)
);
CREATE UNIQUE INDEX messages_conversation_idempotency_uidx
  ON messages(store_id, conversation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX messages_conversation_seq_idx
  ON messages(store_id, conversation_id, sequence DESC);
CREATE INDEX messages_retention_idx
  ON messages(store_id, retention_expires_at);

-- ---------------------------------------------------------------------------
-- 7. conversation_summaries — bounded consent-aware summaries
-- ---------------------------------------------------------------------------
CREATE TABLE conversation_summaries (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  summary_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  covered_up_to_sequence bigint NOT NULL CHECK (covered_up_to_sequence >= 0),
  summary_text text NOT NULL CHECK (char_length(summary_text) BETWEEN 1 AND 4096),
  personalization_consented boolean NOT NULL DEFAULT false,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(provenance) <= 4096),
  retention_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, summary_id),
  UNIQUE (store_id, conversation_id, covered_up_to_sequence),
  FOREIGN KEY (store_id, conversation_id)
    REFERENCES conversations(store_id, conversation_id) ON DELETE CASCADE
);
CREATE INDEX conversation_summaries_retention_idx
  ON conversation_summaries(store_id, retention_expires_at);

-- ---------------------------------------------------------------------------
-- 8. tool_invocations — redacted ToolBroker audit & idempotency records
-- ---------------------------------------------------------------------------
CREATE TABLE tool_invocations (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  invocation_id uuid NOT NULL,
  run_id uuid NOT NULL,
  root_run_id uuid NOT NULL,
  session_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('master', 'discovery', 'experience', 'commerce', 'memory', 'marketing', 'support')),
  role_verified boolean NOT NULL DEFAULT false,
  capability varchar(120) NOT NULL,
  tool_call_id varchar(200),
  idempotency_key varchar(200),
  payload_hash char(64),
  correlation_id varchar(128) NOT NULL,
  status text NOT NULL CHECK (status IN (
    'started', 'succeeded', 'denied', 'validation_failed',
    'budget_exceeded', 'cancelled', 'timed_out', 'failed'
  )),
  context_version bigint NOT NULL CHECK (context_version >= 0),
  input_redacted jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(input_redacted) <= 16384),
  output_redacted jsonb CHECK (output_redacted IS NULL OR pg_column_size(output_redacted) <= 32768),
  error_code varchar(80),
  error_message varchar(500),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  retention_expires_at timestamptz NOT NULL,
  PRIMARY KEY (store_id, invocation_id),
  FOREIGN KEY (store_id, run_id)
    REFERENCES agent_runs(store_id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, root_run_id)
    REFERENCES agent_runs(store_id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, session_id)
    REFERENCES visitor_sessions(store_id, session_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX tool_invocations_run_cap_idempotency_uidx
  ON tool_invocations(store_id, run_id, capability, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX tool_invocations_root_run_idx
  ON tool_invocations(store_id, root_run_id, started_at);
CREATE INDEX tool_invocations_retention_idx
  ON tool_invocations(store_id, retention_expires_at);

-- ---------------------------------------------------------------------------
-- 9. model_usage — preventive reservations & reconciled provider usage
-- ---------------------------------------------------------------------------
CREATE TABLE model_usage (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  usage_id uuid NOT NULL,
  run_id uuid NOT NULL,
  root_run_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('gemini', 'deepseek')),
  model varchar(120) NOT NULL,
  provider_request_id varchar(200),
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens integer NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  cache_read_tokens integer NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens integer NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  reserved_tokens integer NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
  reserved_cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (reserved_cost_usd >= 0),
  measured_cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (measured_cost_usd >= 0),
  reconciled boolean NOT NULL DEFAULT false,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  route_source varchar(64),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  retention_expires_at timestamptz NOT NULL,
  PRIMARY KEY (store_id, usage_id),
  FOREIGN KEY (store_id, run_id)
    REFERENCES agent_runs(store_id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, root_run_id)
    REFERENCES agent_runs(store_id, run_id) ON DELETE CASCADE
);
CREATE INDEX model_usage_root_run_idx
  ON model_usage(store_id, root_run_id, recorded_at);
CREATE INDEX model_usage_retention_idx
  ON model_usage(store_id, retention_expires_at);

-- ---------------------------------------------------------------------------
-- 10. action_proposals — non-executing confirmation/CAS-gated proposals
-- ---------------------------------------------------------------------------
CREATE TABLE action_proposals (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL,
  run_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  session_id uuid NOT NULL,
  customer_id uuid,
  proposed_by_role text NOT NULL CHECK (proposed_by_role IN ('master', 'discovery', 'experience', 'commerce', 'memory', 'marketing', 'support')),
  proposal_type text NOT NULL CHECK (proposal_type IN (
    'experience_composition', 'explicit_criteria_update', 'cart_change',
    'checkout_start', 'memory_preference', 'campaign_draft', 'support_case'
  )),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN (
    'proposed', 'pending_confirmation', 'confirmed', 'applied',
    'rejected', 'superseded', 'cancelled', 'expired', 'unavailable'
  )),
  requires_confirmation boolean NOT NULL DEFAULT true,
  context_version bigint NOT NULL CHECK (context_version >= 0),
  applied_experience_revision bigint CHECK (applied_experience_revision IS NULL OR applied_experience_revision >= 0),
  payload jsonb NOT NULL CHECK (pg_column_size(payload) <= 262144),
  correlation_id varchar(128) NOT NULL,
  idempotency_key varchar(200),
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, proposal_id),
  FOREIGN KEY (store_id, run_id)
    REFERENCES agent_runs(store_id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, conversation_id)
    REFERENCES conversations(store_id, conversation_id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, session_id)
    REFERENCES visitor_sessions(store_id, session_id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, customer_id)
    REFERENCES customers(store_id, customer_id) ON DELETE SET NULL (customer_id)
);
CREATE INDEX action_proposals_run_status_idx
  ON action_proposals(store_id, run_id, status);
CREATE INDEX action_proposals_conversation_status_idx
  ON action_proposals(store_id, conversation_id, status, created_at DESC);
CREATE INDEX action_proposals_expiry_idx
  ON action_proposals(store_id, expires_at);

-- ---------------------------------------------------------------------------
-- 11. workflow_executions — PostgreSQL durable Hatchet workflow correlation
-- ---------------------------------------------------------------------------
CREATE TABLE workflow_executions (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  execution_id uuid NOT NULL,
  workflow_name varchar(120) NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  correlation_id varchar(128) NOT NULL,
  concurrency_key varchar(200),
  hatchet_workflow_run_id varchar(200),
  outbox_event_id uuid,
  status text NOT NULL CHECK (status IN (
    'pending_submission', 'submission_unknown', 'submitted',
    'running', 'completed', 'failed', 'cancelled', 'not_implemented'
  )),
  payload_hash char(64) NOT NULL,
  input_redacted jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(input_redacted) <= 16384),
  result_summary jsonb CHECK (result_summary IS NULL OR pg_column_size(result_summary) <= 16384),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error varchar(500),
  submitted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, execution_id),
  UNIQUE (store_id, workflow_name, idempotency_key)
);
CREATE INDEX workflow_executions_hatchet_run_idx
  ON workflow_executions(store_id, hatchet_workflow_run_id)
  WHERE hatchet_workflow_run_id IS NOT NULL;
CREATE INDEX workflow_executions_status_idx
  ON workflow_executions(store_id, status, updated_at DESC);

-- ---------------------------------------------------------------------------
-- RLS + runtime grants
-- ---------------------------------------------------------------------------
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_prompt_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE provider_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_summaries FORCE ROW LEVEL SECURITY;
ALTER TABLE tool_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_invocations FORCE ROW LEVEL SECURITY;
ALTER TABLE model_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE action_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_proposals FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_executions FORCE ROW LEVEL SECURITY;

CREATE POLICY conversations_tenant ON conversations
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY agent_prompt_versions_tenant ON agent_prompt_versions
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY provider_policies_tenant ON provider_policies
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY agent_policies_tenant ON agent_policies
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY agent_runs_tenant ON agent_runs
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY messages_tenant ON messages
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY conversation_summaries_tenant ON conversation_summaries
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY tool_invocations_tenant ON tool_invocations
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY model_usage_tenant ON model_usage
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY action_proposals_tenant ON action_proposals
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY workflow_executions_tenant ON workflow_executions
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  conversations,
  agent_prompt_versions,
  provider_policies,
  agent_policies,
  agent_runs,
  messages,
  conversation_summaries,
  tool_invocations,
  model_usage,
  action_proposals,
  workflow_executions
TO vaarg_app;

-- Explicit retention helper for intelligence records
CREATE FUNCTION purge_expired_intelligence(p_store_id uuid, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_proposals bigint := 0;
  v_tools bigint := 0;
  v_usage bigint := 0;
  v_summaries bigint := 0;
  v_messages bigint := 0;
  v_runs bigint := 0;
  v_conversations bigint := 0;
BEGIN
  DELETE FROM action_proposals
   WHERE store_id = p_store_id AND expires_at <= p_now
     AND status IN ('proposed', 'pending_confirmation', 'rejected', 'superseded', 'cancelled', 'expired', 'unavailable');
  GET DIAGNOSTICS v_proposals = ROW_COUNT;

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
    'action_proposals', v_proposals,
    'tool_invocations', v_tools,
    'model_usage', v_usage,
    'conversation_summaries', v_summaries,
    'messages', v_messages,
    'agent_runs', v_runs,
    'conversations', v_conversations
  );
END;
$$;

GRANT EXECUTE ON FUNCTION purge_expired_intelligence(uuid, timestamptz) TO vaarg_app;
